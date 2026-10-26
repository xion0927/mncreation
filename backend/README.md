# 音声採譜・PDF楽譜OMR API

## セットアップ

Python 3.10を使い、Audiverisを公式配布元からインストールしてください。
Audiverisの実行ファイルがPATHにない場合は、FastAPIを起動する前に
`AUDIVERIS_CMD`へ実行ファイルのパスを設定します。

```powershell
$env:AUDIVERIS_CMD = "C:\Program Files\Audiveris\Audiveris.exe"
$env:MUSESCORE_CMD = "C:\Program Files\MuseScore 4\bin\MuseScore4.exe"
py -3.10 -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
python -m uvicorn app.main:app --app-dir backend --reload
```

Audiverisの起動時に必要なJava環境など、詳細は[公式インストール手順](https://audiveris.github.io/audiveris/_pages/tutorials/install/binaries/)を確認してください。
FastAPIのAPIドキュメントは `http://localhost:8000/docs` です。
フロントエンドは既定で `http://localhost:3000` からの接続を許可します。
許可する接続元を変更する場合は `FRONTEND_ORIGINS` にURLをカンマ区切りで指定します。
フロントエンドから別のAPI URLへ接続する場合は、Next.js起動前に
`NEXT_PUBLIC_API_BASE_URL` を設定してください（既定値 `http://localhost:8000`）。
MP3書き出しにはMuseScore 4が必要です。MuseScoreの実行ファイルがPATHにない場合は、
上記のように `MUSESCORE_CMD` を設定してFastAPIを起動してください。
AudiverisだけではMP3を書き出せません。MuseScore 4は別途インストールが必要です。

## PDF楽譜の認識

`POST /api/omr` に `file` フィールドでPDFをmultipart/form-dataとして送ります。
最大サイズは100MBです。AudiverisがPDFを認識してMusicXMLへエクスポートし、
成功時にはOSMDで読み込める非圧縮MusicXMLを返します。
フロントエンドでは「PDFから読み込む」からPDFを選択すると、認識後の譜面が
表示され、既存の再生ボタンで音を鳴らせます。OMRの認識精度はPDFの品質や譜面に
よって異なります。

```powershell
curl.exe -X POST http://localhost:8000/api/omr `
  -F "file=@score.pdf" `
  --output recognized.musicxml
```

## 音源からの採譜

`POST /api/transcribe` に `.mp3` または `.wav` をアップロードすると、
basic-pitchで変換したMIDIファイルを返します。

```powershell
curl.exe -X POST http://localhost:8000/api/transcribe `
  -F "file=@recording.wav" `
  --output transcription.mid
```

## 編集譜の書き出し

楽譜画面から音符の追加・削除・音高・長さ、テンポ、拍子、調号を編集できます。
MusicXML保存は編集内容を含むMusicXMLをダウンロードします。
PDF保存・印刷はブラウザーの印刷ダイアログを開き、「PDFに保存」を選びます。

MP3保存は `POST /api/export/mp3` に編集済みMusicXMLを送り、MuseScore 4で
再生可能なMP3音源を生成します。MP3変換は最大600秒でタイムアウトします。

```powershell
curl.exe -X POST http://localhost:8000/api/export/mp3 `
  -F "file=@score.musicxml" `
  --output score.mp3
```

PDF、音源、MusicXMLと変換生成物はリクエストごとの一時ディレクトリに保存され、
成功・失敗のどちらの場合も処理終了時に削除されます。
PDFのOMR処理とMP3書き出しは、それぞれ最大600秒でタイムアウトします。
