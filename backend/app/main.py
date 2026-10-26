import logging
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

logger = logging.getLogger(__name__)

MAX_AUDIO_SIZE_BYTES = 100 * 1024 * 1024
MAX_PDF_SIZE_BYTES = 100 * 1024 * 1024
UPLOAD_CHUNK_SIZE_BYTES = 1024 * 1024
SUPPORTED_AUDIO_SUFFIXES = {".mp3", ".wav"}
AUDIVERIS_TIMEOUT_SECONDS = 600
MUSESCORE_TIMEOUT_SECONDS = 600

app = FastAPI(
    title="Mncreation Music API",
    description="音声の採譜とPDF楽譜のOMRを行うAPIです。",
    version="0.1.0",
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["POST"],
    allow_headers=["*"],
)


def convert_audio_to_midi(audio_path: Path, output_directory: Path) -> Path:
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict_and_save

    predict_and_save(
        [str(audio_path)],
        str(output_directory),
        save_midi=True,
        sonify_midi=False,
        save_model_outputs=False,
        save_notes=False,
        model_or_model_path=ICASSP_2022_MODEL_PATH,
    )

    midi_path = output_directory / f"{audio_path.stem}_basic_pitch.mid"
    if not midi_path.is_file():
        raise FileNotFoundError("basic-pitch did not create the expected MIDI file")
    return midi_path


def read_musicxml_file(path: Path) -> bytes:
    if path.suffix.lower() != ".mxl":
        return path.read_bytes()

    with zipfile.ZipFile(path) as archive:
        container_data = archive.read("META-INF/container.xml")
        container = ElementTree.fromstring(container_data)
        rootfile = next(
            (
                element.attrib["full-path"]
                for element in container.iter()
                if element.tag.rsplit("}", 1)[-1] == "rootfile"
                and "full-path" in element.attrib
            ),
            None,
        )
        if rootfile is None:
            raise ValueError("Compressed MusicXML does not contain a root score")

        score_info = archive.getinfo(rootfile)
        if score_info.file_size > MAX_PDF_SIZE_BYTES:
            raise ValueError("Exported MusicXML exceeds the allowed size")
        return archive.read(rootfile)


def convert_pdf_to_musicxml(pdf_path: Path, output_directory: Path) -> bytes:
    configured_command = os.getenv("AUDIVERIS_CMD", "audiveris")
    executable = shutil.which(configured_command)
    if executable is None:
        raise FileNotFoundError(
            "Audiveris was not found. Install it and set AUDIVERIS_CMD to its executable."
        )

    result = subprocess.run(
        [
            executable,
            "-batch",
            "-export",
            "-output",
            str(output_directory),
            str(pdf_path),
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=AUDIVERIS_TIMEOUT_SECONDS,
        stdin=subprocess.DEVNULL,
    )
    if result.returncode != 0:
        logger.error("Audiveris failed: %s", result.stderr[-4000:])
        raise RuntimeError("Audiveris failed to recognize the PDF")

    exported_files = sorted(
        path
        for path in output_directory.rglob("*")
        if path.is_file() and path.suffix.lower() in {".mxl", ".musicxml", ".xml"}
    )
    if not exported_files:
        logger.error("Audiveris produced no MusicXML: %s", result.stdout[-4000:])
        raise RuntimeError("Audiveris did not export a MusicXML score")
    if len(exported_files) > 1:
        logger.warning(
            "Audiveris exported multiple MusicXML files; using %s",
            exported_files[0].name,
        )
    return read_musicxml_file(exported_files[0])


def export_musicxml_to_mp3(musicxml_data: bytes, output_directory: Path) -> Path:
    configured_command = os.getenv("MUSESCORE_CMD", "MuseScore4.exe")
    executable = shutil.which(configured_command)
    if executable is None and Path(configured_command).is_file():
        executable = configured_command
    if executable is None:
        raise FileNotFoundError(
            "MuseScore 4 was not found. Install it and set MUSESCORE_CMD."
        )

    musicxml_path = output_directory / "score.musicxml"
    mp3_path = output_directory / "score.mp3"
    musicxml_path.write_bytes(musicxml_data)
    result = subprocess.run(
        [executable, "-o", str(mp3_path), str(musicxml_path)],
        capture_output=True,
        text=True,
        check=False,
        timeout=MUSESCORE_TIMEOUT_SECONDS,
        stdin=subprocess.DEVNULL,
    )
    if result.returncode != 0 or not mp3_path.is_file():
        logger.error("MuseScore MP3 export failed: %s", result.stderr[-4000:])
        raise RuntimeError("MuseScore did not export an MP3 file")
    return mp3_path


@app.post(
    "/api/transcribe",
    response_class=Response,
    responses={
        200: {
            "content": {"audio/midi": {}},
            "description": "変換されたMIDIファイル",
        },
        400: {"description": "空の音声ファイル"},
        413: {"description": "ファイルサイズ超過"},
        415: {"description": "未対応の音声形式"},
        500: {"description": "音声変換エラー"},
    },
)
async def transcribe_audio(
    file: UploadFile = File(..., description="採譜するMP3またはWAV音声"),
) -> Response:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED_AUDIO_SUFFIXES:
        await file.close()
        raise HTTPException(
            status_code=415,
            detail="MP3またはWAVファイルを指定してください。",
        )

    try:
        with tempfile.TemporaryDirectory(prefix="mncreation-transcription-") as temp_dir:
            working_directory = Path(temp_dir)
            audio_path = working_directory / f"upload{suffix}"
            output_directory = working_directory / "output"
            output_directory.mkdir()

            total_bytes = 0
            with audio_path.open("wb") as audio_file:
                while chunk := await file.read(UPLOAD_CHUNK_SIZE_BYTES):
                    total_bytes += len(chunk)
                    if total_bytes > MAX_AUDIO_SIZE_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail="音声ファイルは100MB以下にしてください。",
                        )
                    audio_file.write(chunk)

            if total_bytes == 0:
                raise HTTPException(
                    status_code=400,
                    detail="空の音声ファイルは変換できません。",
                )

            try:
                midi_path = await run_in_threadpool(
                    convert_audio_to_midi,
                    audio_path,
                    output_directory,
                )
                midi_data = midi_path.read_bytes()
            except Exception as exc:
                logger.exception("Audio-to-MIDI conversion failed")
                raise HTTPException(
                    status_code=500,
                    detail="音声の解析中にエラーが発生しました。",
                ) from exc

            return Response(
                content=midi_data,
                media_type="audio/midi",
                headers={
                    "Content-Disposition": 'attachment; filename="transcription.mid"',
                    "X-Content-Type-Options": "nosniff",
                },
            )
    finally:
        await file.close()


@app.post(
    "/api/omr",
    response_class=Response,
    responses={
        200: {
            "content": {"application/vnd.recordare.musicxml+xml": {}},
            "description": "OMRで認識されたMusicXML",
        },
        400: {"description": "無効または空のPDF"},
        413: {"description": "ファイルサイズ超過"},
        415: {"description": "未対応のファイル形式"},
        422: {"description": "楽譜を認識できない"},
        503: {"description": "Audiverisが未インストール"},
        504: {"description": "OMR処理タイムアウト"},
    },
)
async def recognize_score(
    file: UploadFile = File(..., description="MusicXMLに変換するPDF楽譜"),
) -> Response:
    if Path(file.filename or "").suffix.lower() != ".pdf":
        await file.close()
        raise HTTPException(
            status_code=415,
            detail="PDF形式の楽譜ファイルを指定してください。",
        )

    try:
        with tempfile.TemporaryDirectory(prefix="mncreation-omr-") as temp_dir:
            working_directory = Path(temp_dir)
            pdf_path = working_directory / "score.pdf"
            output_directory = working_directory / "output"
            output_directory.mkdir()

            total_bytes = 0
            pdf_signature = bytearray()
            with pdf_path.open("wb") as pdf_file:
                while chunk := await file.read(UPLOAD_CHUNK_SIZE_BYTES):
                    total_bytes += len(chunk)
                    if total_bytes > MAX_PDF_SIZE_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail="PDFファイルは100MB以下にしてください。",
                        )
                    if len(pdf_signature) < 5:
                        pdf_signature.extend(chunk[: 5 - len(pdf_signature)])
                    pdf_file.write(chunk)

            if total_bytes == 0:
                raise HTTPException(status_code=400, detail="空のPDFは処理できません。")
            if pdf_signature != b"%PDF-":
                raise HTTPException(
                    status_code=400,
                    detail="有効なPDFファイルを指定してください。",
                )

            try:
                musicxml_data = await run_in_threadpool(
                    convert_pdf_to_musicxml,
                    pdf_path,
                    output_directory,
                )
            except FileNotFoundError as exc:
                logger.error("Audiveris is not configured: %s", exc)
                raise HTTPException(
                    status_code=503,
                    detail="OMRエンジンが利用できません。Audiverisをインストールしてください。",
                ) from exc
            except subprocess.TimeoutExpired as exc:
                logger.exception("Audiveris OMR processing timed out")
                raise HTTPException(
                    status_code=504,
                    detail="PDFの解析がタイムアウトしました。",
                ) from exc
            except (RuntimeError, ValueError, zipfile.BadZipFile, ElementTree.ParseError) as exc:
                logger.exception("PDF-to-MusicXML conversion failed")
                raise HTTPException(
                    status_code=422,
                    detail="楽譜を認識できませんでした。別のPDFをお試しください。",
                ) from exc
            except OSError as exc:
                logger.exception("Could not run Audiveris")
                raise HTTPException(
                    status_code=503,
                    detail="Audiverisを起動できません。インストールと設定を確認してください。",
                ) from exc

            return Response(
                content=musicxml_data,
                media_type="application/vnd.recordare.musicxml+xml",
                headers={
                    "Content-Disposition": 'attachment; filename="recognized.musicxml"',
                    "X-Content-Type-Options": "nosniff",
                },
            )
    finally:
        await file.close()


@app.post(
    "/api/export/mp3",
    response_class=Response,
    responses={
        200: {"content": {"audio/mpeg": {}}, "description": "再生用MP3音源"},
        413: {"description": "MusicXMLファイルのサイズ超過"},
        422: {"description": "MP3変換エラー"},
        503: {"description": "MuseScoreが未インストール"},
        504: {"description": "MP3変換タイムアウト"},
    },
)
async def export_mp3(
    file: UploadFile = File(..., description="MP3に変換するMusicXML"),
) -> Response:
    if Path(file.filename or "").suffix.lower() not in {".xml", ".musicxml"}:
        await file.close()
        raise HTTPException(
            status_code=415,
            detail="MusicXML形式のファイルを指定してください。",
        )

    try:
        musicxml_data = await file.read(MAX_PDF_SIZE_BYTES + 1)
        if len(musicxml_data) > MAX_PDF_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail="MusicXMLファイルは100MB以下にしてください。",
            )
        if not musicxml_data:
            raise HTTPException(status_code=400, detail="MusicXMLが空です。")

        try:
            with tempfile.TemporaryDirectory(prefix="mncreation-mp3-") as temp_dir:
                mp3_path = await run_in_threadpool(
                    export_musicxml_to_mp3,
                    musicxml_data,
                    Path(temp_dir),
                )
                mp3_data = mp3_path.read_bytes()
        except FileNotFoundError as exc:
            logger.error("MuseScore is not configured: %s", exc)
            raise HTTPException(
                status_code=503,
                detail="MP3変換にはMuseScore 4が必要です。インストール後にMUSESCORE_CMDを設定してください。",
            ) from exc
        except subprocess.TimeoutExpired as exc:
            logger.exception("MuseScore MP3 export timed out")
            raise HTTPException(
                status_code=504,
                detail="MP3変換がタイムアウトしました。",
            ) from exc
        except RuntimeError as exc:
            logger.exception("MusicXML-to-MP3 conversion failed")
            raise HTTPException(
                status_code=422,
                detail="MusicXMLをMP3に変換できませんでした。",
            ) from exc
        except OSError as exc:
            logger.exception("Could not run MuseScore")
            raise HTTPException(
                status_code=503,
                detail="MuseScoreを起動できません。インストールと設定を確認してください。",
            ) from exc

        return Response(
            content=mp3_data,
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": 'attachment; filename="score.mp3"',
                "X-Content-Type-Options": "nosniff",
            },
        )
    finally:
        await file.close()
