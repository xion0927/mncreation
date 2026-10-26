"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PointF2D,
  type GraphicalNote,
  type OpenSheetMusicDisplay,
} from "opensheetmusicdisplay";
import * as Tone from "tone";
import ScoreEditor from "@/components/score-editor";
import {
  addDynamicAt,
  addNoteAt,
  addRestAt,
  getEditableNotes,
  getEditableDynamics,
  getMeasureIndexByNumber,
  getScoreParts,
  getScoreMetadata,
  getSupportedDurations,
  moveDynamic,
  moveNote,
  removeDynamic,
  removeNote,
  type EditableDynamic,
  type EditableNote,
} from "@/lib/musicxml-editor";

type ScoreTool = "select" | "note" | "rest" | "dynamic";

const QUARTER_NOTES_PER_WHOLE_NOTE = 4;

interface PlaybackStep {
  beat: number;
  seconds: number;
  bpm: number;
  measure: number;
  pitches: string[];
  durationBeats: number;
}

interface DragStart {
  kind: "note" | "dynamic";
  note?: EditableNote;
  dynamic?: EditableDynamic;
  graphicalNote?: GraphicalNote;
  pointerX: number;
  pointerY: number;
  startPositionY: number;
}

function quantizeBeat(timestampWholeNotes: number): number {
  return Math.max(0, Math.round(timestampWholeNotes * 16) / 4);
}

function transposeDiatonically(pitch: string, steps: number): string {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch);
  if (!match) {
    return pitch;
  }
  const letters = ["C", "D", "E", "F", "G", "A", "B"];
  const initialIndex = Number(match[3]) * 7 + letters.indexOf(match[1]);
  const targetIndex = initialIndex + steps;
  const octave = Math.floor(targetIndex / 7);
  const letter = letters[((targetIndex % 7) + 7) % 7];
  return `${letter}${match[2]}${octave}`;
}

export default function ScorePlayer() {
  const scoreContainerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const synthRef = useRef<Tone.PolySynth<Tone.Synth> | null>(null);
  const scheduledEventsRef = useRef<number[]>([]);
  const isPlayingRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("楽譜を読み込み中...");
  const [isPlaying, setIsPlaying] = useState(false);
  const [fileName, setFileName] = useState("example.musicxml");
  const [musicXml, setMusicXml] = useState("");
  const [zoom, setZoom] = useState(0.65);
  const [isExporting, setIsExporting] = useState(false);
  const [currentMeasure, setCurrentMeasure] = useState<number | null>(null);
  const [selectedNoteIndex, setSelectedNoteIndex] = useState(-1);
  const [selectedDynamicIndex, setSelectedDynamicIndex] = useState(-1);
  const [scoreTool, setScoreTool] = useState<ScoreTool>("select");
  const [placementPitch, setPlacementPitch] = useState("C4");
  const [placementDuration, setPlacementDuration] = useState(1);
  const [placementDynamic, setPlacementDynamic] = useState<EditableDynamic["value"]>("mf");
  const [error, setError] = useState<string | null>(null);
  const dragStartRef = useRef<DragStart | null>(null);
  const didDragRef = useRef(false);
  const placementDurations = useMemo(
    () => (musicXml ? getSupportedDurations(musicXml) : [1]),
    [musicXml],
  );

  useEffect(() => {
    if (!placementDurations.includes(placementDuration)) {
      setPlacementDuration(placementDurations[0] ?? 1);
    }
  }, [placementDuration, placementDurations]);

  const clearScheduledPlayback = (time?: number) => {
    const transport = Tone.getTransport();
    for (const eventId of scheduledEventsRef.current) {
      transport.clear(eventId);
    }
    scheduledEventsRef.current = [];
    transport.stop(time);
    transport.position = 0;
  };

  const stopPlayback = (time?: number) => {
    isPlayingRef.current = false;
    clearScheduledPlayback(time);
    synthRef.current?.releaseAll(time);
    osmdRef.current?.cursors.forEach((cursor) => cursor.hide());
    setIsPlaying(false);
  };

  const fitToWidth = () => {
    const osmd = osmdRef.current;
    const score = scoreContainerRef.current;
    const viewport = score?.closest(".score-viewport");
    const svg = score?.querySelector("svg");
    if (!osmd || !viewport || !svg) {
      changeZoom(0.65);
      return;
    }
    const availableWidth = viewport.clientWidth - 24;
    const renderedWidth = svg.getBoundingClientRect().width;
    if (availableWidth <= 0 || renderedWidth <= 0) {
      changeZoom(0.65);
      return;
    }
    changeZoom(osmd.Zoom * (availableWidth / renderedWidth));
  };

  const loadMusicXml = async (xml: string, name: string) => {
    const osmd = osmdRef.current;
    if (!osmd) {
      throw new Error("楽譜表示の準備ができていません。");
    }

    stopPlayback();
    setError(null);
    setIsLoading(true);
    setLoadingMessage("楽譜を読み込み中...");
    try {
      await osmd.load(xml, name);
      osmd.Zoom = zoom;
      osmd.render();
      fitToWidth();
      osmd.cursors.forEach((cursor) => {
        cursor.reset();
        cursor.show();
      });
      setCurrentMeasure(null);
      setFileName(name);
      setMusicXml(xml);
      setIsReady(true);
    } finally {
      setIsLoading(false);
    }
  };

  const changeZoom = (nextZoom: number) => {
    const boundedZoom = Math.min(1.5, Math.max(0.35, nextZoom));
    setZoom(boundedZoom);
    if (osmdRef.current) {
      osmdRef.current.Zoom = boundedZoom;
      osmdRef.current.render();
      osmdRef.current.cursors.forEach((cursor) => cursor.hide());
    }
  };

  const downloadMusicXml = () => {
    if (!musicXml) {
      return;
    }
    const blob = new Blob([musicXml], {
      type: "application/vnd.recordare.musicxml+xml",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName.toLowerCase().endsWith(".musicxml")
      ? fileName
      : `${fileName.replace(/\.[^.]+$/, "")}.musicxml`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadMp3 = async () => {
    if (!musicXml || isExporting) {
      return;
    }
    setError(null);
    setIsExporting(true);
    try {
      const formData = new FormData();
      formData.append(
        "file",
        new File([musicXml], "score.musicxml", { type: "application/xml" }),
      );
      const apiBaseUrl = (
        process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
      ).replace(/\/+$/, "");
      const response = await fetch(`${apiBaseUrl}/api/export/mp3`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const body: { detail?: string } | null = await response
          .json()
          .catch(() => null);
        throw new Error(body?.detail ?? "MP3を書き出せませんでした。");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${fileName.replace(/\.[^.]+$/, "")}.mp3`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "MP3を書き出せませんでした。",
      );
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    let disposed = false;
    let osmd: OpenSheetMusicDisplay | null = null;

    const initialize = async () => {
      try {
        const [{ OpenSheetMusicDisplay }, response] = await Promise.all([
          import("opensheetmusicdisplay"),
          fetch("/example.musicxml"),
        ]);
        if (!response.ok) {
          throw new Error("サンプル楽譜を読み込めませんでした。");
        }
        const xml = await response.text();
        if (disposed || !scoreContainerRef.current) {
          return;
        }

        osmd = new OpenSheetMusicDisplay(scoreContainerRef.current, {
          backend: "svg",
          autoResize: true,
          drawTitle: true,
          followCursor: true,
          cursorsOptions: [
            { type: 0, color: "#059669", alpha: 0.45, follow: true },
            { type: 3, color: "#a7f3d0", alpha: 0.22, follow: false },
          ],
        });
        osmdRef.current = osmd;
        await loadMusicXml(xml, "example.musicxml");
      } catch (cause) {
        if (!disposed) {
          setError(
            cause instanceof Error
              ? cause.message
              : "楽譜の初期化中にエラーが発生しました。",
          );
          setIsLoading(false);
        }
      }
    };

    void initialize();

    return () => {
      disposed = true;
      isPlayingRef.current = false;
      clearScheduledPlayback();
      synthRef.current?.dispose();
      synthRef.current = null;
      osmd?.cursors.forEach((cursor) => cursor.Dispose());
      osmdRef.current = null;
    };
    // Initialization is intentionally limited to the component lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!/\.(musicxml|xml)$/i.test(file.name)) {
      setError("MusicXML形式の .musicxml または .xml ファイルを選択してください。");
      return;
    }

    try {
      await loadMusicXml(await file.text(), file.name);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "MusicXMLファイルを読み込めませんでした。",
      );
    }
  };

  const handlePdfChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("PDF形式の楽譜ファイルを選択してください。");
      return;
    }

    stopPlayback();
    setError(null);
    setIsLoading(true);
    setLoadingMessage("PDFの楽譜を解析中...");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const apiBaseUrl = (
        process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
      ).replace(/\/+$/, "");
      const response = await fetch(`${apiBaseUrl}/api/omr`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body: { detail?: string } | null = await response
          .json()
          .catch(() => null);
        throw new Error(body?.detail ?? "PDFの楽譜を解析できませんでした。");
      }

      await loadMusicXml(
        await response.text(),
        `${file.name.replace(/\.pdf$/i, "")}.musicxml`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "PDFの楽譜を解析できませんでした。",
      );
      setIsLoading(false);
    }
  };

  const handlePlay = async () => {
    const osmd = osmdRef.current;
    if (!osmd || isLoading || !isReady) {
      return;
    }

    try {
      setError(null);
      await Tone.start();
      if (!synthRef.current) {
        synthRef.current = new Tone.PolySynth(Tone.Synth).toDestination();
      }

      stopPlayback();
      const cursor = osmd.cursors[0];
      const measureCursor = osmd.cursors[1];
      cursor.reset();
      measureCursor?.reset();
      cursor.show();
      measureCursor?.show();

      const iterator = cursor.Iterator.clone();
      const steps: PlaybackStep[] = [];
      let guard = 0;
      while (!iterator.EndReached && guard < 100_000) {
        const voiceEntries = iterator.CurrentAudibleVoiceEntries();
        const notes = voiceEntries.flatMap((voiceEntry) =>
          voiceEntry.Notes.filter((note) => !note.isRest()),
        );
        const pitches = notes.map((note) =>
          Tone.Frequency(note.Pitch.Frequency).toNote(),
        );
        const durationBeats = notes.reduce(
          (longest, note) =>
            Math.max(
              longest,
              note.Length.RealValue * QUARTER_NOTES_PER_WHOLE_NOTE,
            ),
          0,
        );

        steps.push({
          beat:
            iterator.CurrentEnrolledTimestamp.RealValue *
            QUARTER_NOTES_PER_WHOLE_NOTE,
          seconds: 0,
          bpm: iterator.CurrentBpm > 0 ? iterator.CurrentBpm : 120,
          measure: iterator.CurrentMeasureIndex + 1,
          pitches,
          durationBeats,
        });
        iterator.moveToNext();
        guard += 1;
      }
      if (guard >= 100_000) {
        throw new Error("楽譜の読み取りが上限を超えました。");
      }
      if (steps.length === 0 || !steps.some((step) => step.pitches.length > 0)) {
        throw new Error("再生できる音符が楽譜に見つかりませんでした。");
      }

      let elapsedSeconds = 0;
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        if (index > 0) {
          const previous = steps[index - 1];
          const beatDelta = Math.max(0, step.beat - previous.beat);
          elapsedSeconds += (beatDelta * 60) / previous.bpm;
        }
        step.seconds = elapsedSeconds;
      }

      const transport = Tone.getTransport();
      clearScheduledPlayback();
      isPlayingRef.current = true;
      setIsPlaying(true);
      steps.forEach((step, index) => {
        const eventId = transport.scheduleOnce((time) => {
          if (!isPlayingRef.current) {
            return;
          }
          if (index > 0) {
            cursor.next();
            measureCursor?.next();
          }
          setCurrentMeasure(step.measure);
          if (step.pitches.length > 0) {
            const next = steps[index + 1];
            const duration =
              step.durationBeats > 0
                ? (step.durationBeats * 60) / step.bpm
                : next
                  ? next.seconds - step.seconds
                  : 0.5;
            synthRef.current?.triggerAttackRelease(
              step.pitches,
              Math.max(0.08, duration * 0.9),
              time,
            );
          }
        }, step.seconds);
        scheduledEventsRef.current.push(eventId);
      });

      const finalStep = steps[steps.length - 1];
      const finishAt =
        finalStep.seconds +
        Math.max(0.25, (finalStep.durationBeats * 60) / finalStep.bpm);
      const finishEventId = transport.scheduleOnce((time) => {
        stopPlayback(time);
      }, finishAt);
      scheduledEventsRef.current.push(finishEventId);
      transport.start();
    } catch (cause) {
      stopPlayback();
      setError(
        cause instanceof Error
          ? cause.message
          : "楽譜の再生中にエラーが発生しました。",
      );
    }
  };

  const getScorePoint = (clientX: number, clientY: number) => {
    const osmd = osmdRef.current;
    const svg = scoreContainerRef.current?.querySelector("svg");
    const transform = svg?.getScreenCTM();
    if (!osmd || !svg || !transform) {
      return null;
    }
    const svgPoint = svg.createSVGPoint();
    svgPoint.x = clientX;
    svgPoint.y = clientY;
    const localPoint = svgPoint.matrixTransform(transform.inverse());
    return {
      osmd,
      svg,
      position: osmd.GraphicSheet.svgToOsmd(
        new PointF2D(localPoint.x, localPoint.y),
      ),
    };
  };

  const getScoreLocation = (
    clientX: number,
    clientY: number,
    preferredMeasure?: SVGGElement | null,
  ) => {
    const point = getScorePoint(clientX, clientY);
    if (!point) {
      return null;
    }
    const entry = point.osmd.GraphicSheet.GetNearestStaffEntry(point.position);
    const staff = entry.sourceStaffEntry.ParentStaff;
    const parts = getScoreParts(musicXml);
    const partIndex = parts.findIndex(
      (part) => part.id === staff.ParentInstrument.IdString,
    );
    if (partIndex < 0) {
      return null;
    }
    let timestampWholeNotes = entry.relInMeasureTimestamp.RealValue;
    const measureIndex =
      entry.parentMeasure.parentSourceMeasure.measureListIndex;
    const visualMeasures = Array.from(
      point.svg.querySelectorAll<SVGGElement>("g.vf-measure"),
    ).filter((measure) => {
      const byMeasureNumber = getMeasureIndexByNumber(
        musicXml,
        measure.getAttribute("id") ?? "",
      );
      return byMeasureNumber === measureIndex ||
        Number(measure.getAttribute("id")) === measureIndex;
    });
    const visualMeasure = (preferredMeasure
      ? [{ measure: preferredMeasure, bounds: preferredMeasure.getBoundingClientRect(), distance: 0 }]
      : visualMeasures
      .map((measure) => {
        const bounds = measure.getBoundingClientRect();
        const dx = Math.max(bounds.left - clientX, 0, clientX - bounds.right);
        const dy = Math.max(bounds.top - clientY, 0, clientY - bounds.bottom);
        return { measure, bounds, distance: dx * dx + dy * dy };
      })
      .sort((left, right) => left.distance - right.distance))[0];
    if (visualMeasure && visualMeasure.bounds.width > 0) {
      const fraction = Math.min(
        1,
        Math.max(
          0,
          (clientX - visualMeasure.bounds.left) / visualMeasure.bounds.width,
        ),
      );
      const metadata = getScoreMetadata(musicXml);
      timestampWholeNotes =
        (fraction * metadata.beats * 4) / metadata.beatType / 4;
    }
    const voiceEntry = entry.sourceStaffEntry.VoiceEntries.find((candidate) =>
      candidate.Notes.some(
        (note) => note.ParentStaffEntry.ParentStaff.Id === staff.Id,
      ),
    );
    return {
      ...point,
      partIndex,
      measureIndex,
      timestampBeats: quantizeBeat(timestampWholeNotes),
      staff: staff.Id,
      voice: String(voiceEntry?.ParentVoice.VoiceId ?? 1),
    };
  };

  const findNoteAtPoint = (clientX: number, clientY: number) => {
    const point = getScorePoint(clientX, clientY);
    if (!point) {
      return null;
    }
    const graphicalNote = point.osmd.GraphicSheet.GetNearestNote(
      point.position,
      new PointF2D(12, 12),
    );
    if (!graphicalNote) {
      return null;
    }
    const sourceNote = graphicalNote.sourceNote;
    const partId =
      sourceNote.ParentStaffEntry.ParentStaff.ParentInstrument.IdString;
    const partIndex = getScoreParts(musicXml).findIndex(
      (part) => part.id === partId,
    );
    if (partIndex < 0) {
      return null;
    }
    const isRest = sourceNote.isRest();
    const midi = isRest
      ? null
      : Math.round(69 + 12 * Math.log2(sourceNote.Pitch.Frequency / 440));
    const measureIndex = sourceNote.SourceMeasure.measureListIndex;
    const timestampBeats = sourceNote.ParentVoiceEntry.Timestamp.RealValue * 4;
    const staff = sourceNote.ParentStaffEntry.ParentStaff.Id;
    const notes = getEditableNotes(musicXml);
    const exactIndex = notes.findIndex(
      (note) =>
        note.partIndex === partIndex &&
        note.measureIndex === measureIndex &&
        Math.abs(note.timestampBeats - timestampBeats) < 0.001 &&
        note.midi === midi &&
        note.staff === staff &&
        note.isRest === isRest,
    );
    const candidates = notes
      .map((note, index) => ({ note, index }))
      .filter(
        ({ note }) =>
          note.partIndex === partIndex &&
          note.measureIndex === measureIndex &&
          note.midi === midi &&
          note.staff === staff &&
          note.isRest === isRest,
      )
      .sort(
        (left, right) =>
          Math.abs(left.note.timestampBeats - timestampBeats) -
          Math.abs(right.note.timestampBeats - timestampBeats),
      );
    const index =
      exactIndex >= 0
        ? exactIndex
        : candidates[0] &&
            (!candidates[1] ||
              Math.abs(candidates[0].note.timestampBeats - timestampBeats) <
                Math.abs(candidates[1].note.timestampBeats - timestampBeats))
          ? candidates[0].index
          : -1;
    return index >= 0
      ? { index, note: notes[index], graphicalNote, osmd: point.osmd }
      : null;
  };

  const findDynamicAtPoint = (clientX: number, clientY: number) => {
    const point = getScorePoint(clientX, clientY);
    const element = point?.svg.ownerDocument.elementFromPoint(clientX, clientY);
    const location = getScoreLocation(
      clientX,
      clientY,
      element instanceof Element
        ? element.closest<SVGGElement>("g.vf-measure")
        : null,
    );
    if (!location) {
      return null;
    }
    const target = location.svg.ownerDocument.elementFromPoint(clientX, clientY);
    const value = target instanceof Element
      ? target.closest("g.vf-text")?.textContent?.trim()
      : undefined;
    if (!value || !["p", "mp", "mf", "f", "sf"].includes(value)) {
      return null;
    }
    const dynamics = getEditableDynamics(musicXml);
    const candidates = dynamics
      .map((dynamic, index) => ({ dynamic, index }))
      .filter(
        ({ dynamic }) =>
          dynamic.partIndex === location.partIndex &&
          dynamic.measureIndex === location.measureIndex &&
          dynamic.staff === location.staff &&
          dynamic.value === value,
      )
      .sort(
        (left, right) =>
          Math.abs(left.dynamic.timestampBeats - location.timestampBeats) -
          Math.abs(right.dynamic.timestampBeats - location.timestampBeats),
      );
    return candidates[0] ?? null;
  };

  const handleScorePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isReady || isLoading || isPlaying || scoreTool !== "select") {
      return;
    }
    didDragRef.current = false;
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const dynamicHit = target.closest("g.vf-text");
    if (dynamicHit) {
      const selected = findDynamicAtPoint(event.clientX, event.clientY);
      if (selected) {
        const point = getScorePoint(event.clientX, event.clientY);
        dragStartRef.current = {
          kind: "dynamic",
          dynamic: selected.dynamic,
          pointerX: event.clientX,
          pointerY: event.clientY,
          startPositionY: point?.position.y ?? 0,
        };
      }
      return;
    }
    if (!target.closest(".vf-notehead, .vf-rest, .vf-stavenote")) {
      return;
    }
    const selected = findNoteAtPoint(event.clientX, event.clientY);
    if (selected) {
      const point = getScorePoint(event.clientX, event.clientY);
      dragStartRef.current = {
        kind: "note",
        note: selected.note,
        graphicalNote: selected.graphicalNote,
        pointerX: event.clientX,
        pointerY: event.clientY,
        startPositionY: point?.position.y ?? 0,
      };
    }
  };

  const handleScorePointerUp = async (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStartRef.current;
    dragStartRef.current = null;
    if (
      !drag ||
      Math.hypot(event.clientX - drag.pointerX, event.clientY - drag.pointerY) < 5
    ) {
      return;
    }
    didDragRef.current = true;
    const location = getScoreLocation(
      event.clientX,
      event.clientY,
      event.target instanceof Element
        ? event.target.closest<SVGGElement>("g.vf-measure")
        : null,
    );
    if (!location) {
      setError("移動先のパートや小節を特定できませんでした。");
      return;
    }
    try {
      const updatedXml =
        drag.kind === "note" && drag.note && drag.graphicalNote
          ? moveNote(
              musicXml,
              drag.note,
              location.partIndex,
              location.measureIndex,
              location.timestampBeats,
              drag.note.pitch
                ? transposeDiatonically(
                    drag.note.pitch,
                    -Math.round(
                      (location.position.y - drag.startPositionY) / 0.5,
                    ),
                  )
                : null,
              location.staff,
              location.voice,
            )
          : drag.kind === "dynamic" && drag.dynamic
            ? moveDynamic(
                musicXml,
                drag.dynamic,
                location.partIndex,
                location.measureIndex,
                location.timestampBeats,
                location.staff,
              )
            : musicXml;
      await loadMusicXml(updatedXml, fileName);
      setSelectedNoteIndex(-1);
      setSelectedDynamicIndex(-1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "譜面上で移動できませんでした。",
      );
    }
  };

  const highlightSelectedElement = (target: Element) => {
    const svg = scoreContainerRef.current?.querySelector("svg");
    svg?.querySelectorAll(".score-item-selected").forEach((element) => {
      if (element instanceof SVGElement) {
        element.style.filter = "";
        element.classList.remove("score-item-selected");
      }
    });
    const selected = target.closest("g.vf-text, g.vf-stavenote");
    if (selected instanceof SVGElement) {
      selected.classList.add("score-item-selected");
      selected.style.filter = "drop-shadow(0 0 3px #10b981)";
    }
  };

  const handleScoreClick = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    if (!isReady || isLoading || isPlaying) {
      return;
    }
    const target = event.target;
    if (scoreTool === "select") {
      if (!(target instanceof Element)) {
        return;
      }
      const dynamicText = target.closest("g.vf-text")?.textContent?.trim();
      if (dynamicText && ["p", "mp", "mf", "f", "sf"].includes(dynamicText)) {
        const selected = findDynamicAtPoint(event.clientX, event.clientY);
        if (!selected) {
          setError("クリックした強弱記号を編集対象として特定できませんでした。");
          return;
        }
        setError(null);
        setSelectedDynamicIndex(selected.index);
        setSelectedNoteIndex(-1);
        highlightSelectedElement(target);
        document.getElementById("score-editor-details")?.setAttribute("open", "");
        return;
      }
      if (target.closest("g.vf-text")) {
        return;
      }
      if (!target.closest(".vf-notehead, .vf-rest, .vf-stavenote")) {
        return;
      }
      const selected = findNoteAtPoint(event.clientX, event.clientY);
      if (!selected) {
        setError("クリックした音符・休符を編集対象として特定できませんでした。");
        return;
      }
      setError(null);
      setSelectedNoteIndex(selected.index);
      setSelectedDynamicIndex(-1);
      highlightSelectedElement(target);
      document.getElementById("score-editor-details")?.setAttribute("open", "");
      return;
    }

    const location = getScoreLocation(
      event.clientX,
      event.clientY,
      target instanceof Element
        ? target.closest<SVGGElement>("g.vf-measure")
        : null,
    );
    if (!location) {
      setError("クリックした譜表のパートを特定できませんでした。");
      return;
    }
    try {
      const updatedXml =
        scoreTool === "note"
          ? addNoteAt(
              musicXml,
              location.partIndex,
              location.measureIndex,
              location.timestampBeats,
              placementPitch,
              placementDuration,
              location.staff,
              location.voice,
            )
          : scoreTool === "rest"
            ? addRestAt(
                musicXml,
                location.partIndex,
                location.measureIndex,
                location.timestampBeats,
                placementDuration,
                location.staff,
                location.voice,
              )
            : addDynamicAt(
                musicXml,
                location.partIndex,
                location.measureIndex,
                location.timestampBeats,
                placementDynamic,
                location.staff,
              );
      await loadMusicXml(updatedXml, fileName);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "譜面に追加できませんでした。",
      );
    }
  };

  const deleteSelectedNote = async () => {
    const target = getEditableNotes(musicXml)[selectedNoteIndex];
    if (!target) {
      return;
    }
    try {
      await loadMusicXml(removeNote(musicXml, target), fileName);
      setSelectedNoteIndex(-1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "音符を削除できませんでした。");
    }
  };

  const deleteSelectedDynamic = async () => {
    const target = getEditableDynamics(musicXml)[selectedDynamicIndex];
    if (!target) {
      return;
    }
    try {
      await loadMusicXml(removeDynamic(musicXml, target), fileName);
      setSelectedDynamicIndex(-1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "強弱記号を削除できませんでした。",
      );
    }
  };

  return (
    <section className="print-score overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="print-hide flex flex-col gap-4 border-b border-stone-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h2 className="font-semibold">スコア</h2>
          <p className="mt-1 truncate text-sm text-stone-500">{fileName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-700 transition hover:bg-stone-50">
              MusicXMLを開く
              <input
                className="sr-only"
                type="file"
                accept=".musicxml,.xml,application/vnd.recordare.musicxml+xml,application/xml,text/xml"
                onChange={handleFileChange}
                disabled={isLoading}
              />
            </label>
            <label className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-emerald-700 px-4 text-sm font-medium text-emerald-800 transition hover:bg-emerald-50">
              PDFから読み込む
              <input
                className="sr-only"
                type="file"
                accept=".pdf,application/pdf"
                onChange={handlePdfChange}
                disabled={isLoading}
              />
            </label>
          </div>
          {isPlaying ? (
            <button
              type="button"
              onClick={() => stopPlayback()}
              className="inline-flex min-h-10 items-center rounded-lg bg-stone-800 px-5 text-sm font-semibold text-white transition hover:bg-stone-700"
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePlay}
              disabled={!isReady || isLoading}
              className="inline-flex min-h-10 items-center rounded-lg bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              再生
            </button>
          )}
        </div>
      </div>

      <div className="print-hide flex flex-wrap items-center justify-between gap-2 bg-stone-50 px-4 py-3 text-sm sm:px-6">
        <p aria-live="polite" className="text-stone-600">
          {isLoading
            ? loadingMessage
            : isPlaying
              ? "再生中"
              : "停止中"}
        </p>
        <p className="font-medium text-emerald-800" aria-live="polite">
          {currentMeasure === null ? "小節: -" : `小節: ${currentMeasure}`}
        </p>
      </div>

      {isReady && (
        <ScoreEditor
          xml={musicXml}
          onApply={(updatedXml) => loadMusicXml(updatedXml, fileName)}
          disabled={isLoading || isPlaying}
          selectedNoteIndex={selectedNoteIndex}
          onSelectNote={setSelectedNoteIndex}
          selectedDynamicIndex={selectedDynamicIndex}
          onSelectDynamic={setSelectedDynamicIndex}
        />
      )}

      <div className="print-hide flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2 text-sm">
          <span className="mr-1 text-stone-600">縮尺</span>
          <button
            type="button"
            onClick={() => changeZoom(zoom - 0.1)}
            disabled={zoom <= 0.35}
            aria-label="縮小"
            className="size-9 rounded-lg border border-stone-300 text-lg hover:bg-stone-50 disabled:text-stone-300"
          >
            −
          </button>
          <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => changeZoom(zoom + 0.1)}
            disabled={zoom >= 1.5}
            aria-label="拡大"
            className="size-9 rounded-lg border border-stone-300 text-lg hover:bg-stone-50 disabled:text-stone-300"
          >
            +
          </button>
          <button
            type="button"
            onClick={fitToWidth}
            className="min-h-9 rounded-lg border border-stone-300 px-3 text-xs font-medium hover:bg-stone-50"
          >
            幅に合わせる
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={downloadMusicXml}
            disabled={!isReady || isLoading}
            className="min-h-9 rounded-lg border border-stone-300 px-3 text-xs font-medium hover:bg-stone-50 disabled:text-stone-400"
          >
            MusicXML保存
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!isReady || isLoading}
            className="min-h-9 rounded-lg border border-stone-300 px-3 text-xs font-medium hover:bg-stone-50 disabled:text-stone-400"
          >
            PDF保存・印刷
          </button>
          <button
            type="button"
            onClick={() => void downloadMp3()}
            disabled={!isReady || isLoading || isExporting}
            className="min-h-9 rounded-lg border border-stone-300 px-3 text-xs font-medium hover:bg-stone-50 disabled:text-stone-400"
          >
            {isExporting ? "MP3変換中..." : "MP3保存"}
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="print-hide border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 sm:px-6"
        >
          {error}
        </p>
      )}

      <div className="score-viewport max-h-[70vh] min-h-64 overflow-auto p-3 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-stone-700">譜面上をクリック:</span>
          {([
            ["select", "音符を選択"],
            ["note", "音符を追加"],
            ["rest", "休符を追加"],
            ["dynamic", "強弱記号を追加"],
          ] as const).map(([tool, label]) => (
            <button
              key={tool}
              type="button"
              aria-pressed={scoreTool === tool}
              onClick={() => setScoreTool(tool)}
              className={`min-h-9 rounded-lg border px-3 text-xs font-medium ${
                scoreTool === tool
                  ? "border-emerald-700 bg-emerald-50 text-emerald-800"
                  : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
              }`}
            >
              {label}
            </button>
          ))}
          {scoreTool === "select" && selectedNoteIndex >= 0 && (
            <button
              type="button"
              onClick={() => void deleteSelectedNote()}
              disabled={isLoading || isPlaying}
              className="min-h-9 rounded-lg border border-red-300 px-3 text-xs font-medium text-red-700 hover:bg-red-50 disabled:text-stone-400"
            >
              選択音符・休符を削除
            </button>
          )}
          {scoreTool === "select" && selectedDynamicIndex >= 0 && (
            <button
              type="button"
              onClick={() => void deleteSelectedDynamic()}
              disabled={isLoading || isPlaying}
              className="min-h-9 rounded-lg border border-red-300 px-3 text-xs font-medium text-red-700 hover:bg-red-50 disabled:text-stone-400"
            >
              選択強弱記号を削除
            </button>
          )}
          {scoreTool === "note" && (
            <>
              <label className="text-xs text-stone-600">
                音高
                <select
                  value={placementPitch}
                  onChange={(event) => setPlacementPitch(event.target.value)}
                  className="ml-1 min-h-9 rounded-lg border border-stone-300 bg-white px-2"
                >
                  {Array.from({ length: 60 }, (_, index) => {
                    const midi = 36 + index;
                    const pitch = `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`;
                    return <option key={pitch} value={pitch}>{pitch}</option>;
                  })}
                </select>
              </label>
              <label className="text-xs text-stone-600">
                長さ
                <select
                  value={placementDuration}
                  onChange={(event) => setPlacementDuration(Number(event.target.value))}
                  className="ml-1 min-h-9 rounded-lg border border-stone-300 bg-white px-2"
                >
                  {placementDurations.map((duration) => (
                    <option key={duration} value={duration}>
                      {duration === 0.5
                        ? "8分音符"
                        : duration === 1
                          ? "4分音符"
                          : duration === 2
                            ? "2分音符"
                            : "全音符"}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {scoreTool === "rest" && (
            <label className="text-xs text-stone-600">
              長さ
              <select
                value={placementDuration}
                onChange={(event) => setPlacementDuration(Number(event.target.value))}
                className="ml-1 min-h-9 rounded-lg border border-stone-300 bg-white px-2"
              >
                {placementDurations.map((duration) => (
                  <option key={duration} value={duration}>
                    {duration === 0.5
                      ? "8分休符"
                      : duration === 1
                        ? "4分休符"
                        : duration === 2
                          ? "2分休符"
                          : "全休符"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {scoreTool === "dynamic" && (
            <label className="text-xs text-stone-600">
              強弱
              <select
                value={placementDynamic}
                onChange={(event) =>
                  setPlacementDynamic(event.target.value as typeof placementDynamic)
                }
                className="ml-1 min-h-9 rounded-lg border border-stone-300 bg-white px-2"
              >
                <option value="p">p</option>
                <option value="mp">mp</option>
                <option value="mf">mf</option>
                <option value="f">f</option>
                <option value="sf">sf</option>
              </select>
            </label>
          )}
        </div>
        <p className="mb-3 text-xs text-stone-500" aria-live="polite">
          {scoreTool === "select"
            ? "音符・休符・強弱記号をクリックして選択し、ドラッグで移動できます。"
            : "追加するパート・譜表をクリックすると、その拍位置に追加します。位置は16分音符単位で調整され、同じ声部の後続音符はずれます。"}
        </p>
        <div
          ref={scoreContainerRef}
          onClick={(event) => void handleScoreClick(event)}
          onPointerDown={handleScorePointerDown}
          onPointerUp={(event) => void handleScorePointerUp(event)}
          className={`w-full min-w-0 ${scoreTool === "select" ? "cursor-pointer" : "cursor-crosshair"}`}
        />
      </div>
      <p className="print-hide border-t border-stone-100 px-4 py-3 text-xs leading-5 text-stone-500 sm:px-6">
        PDFの読み込みにはFastAPIとAudiverisによるOMR処理が必要です。認識精度は原稿の状態によって異なります。再生中は音符カーソルと小節ハイライトが譜面に追従します。
      </p>
    </section>
  );
}
