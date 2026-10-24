"use client";

import { useEffect, useRef, useState } from "react";
import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import * as Tone from "tone";

interface PlaybackStep {
  beat: number;
  seconds: number;
  bpm: number;
  measure: number;
  pitches: string[];
  durationBeats: number;
}

export default function ScorePlayer() {
  const scoreContainerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const synthRef = useRef<Tone.PolySynth<Tone.Synth> | null>(null);
  const scheduledEventsRef = useRef<number[]>([]);
  const isPlayingRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fileName, setFileName] = useState("example.musicxml");
  const [currentMeasure, setCurrentMeasure] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const loadMusicXml = async (xml: string, name: string) => {
    const osmd = osmdRef.current;
    if (!osmd) {
      throw new Error("楽譜表示の準備ができていません。");
    }

    stopPlayback();
    setError(null);
    setIsLoading(true);
    try {
      await osmd.load(xml, name);
      osmd.render();
      osmd.cursors.forEach((cursor) => {
        cursor.reset();
        cursor.show();
      });
      setCurrentMeasure(null);
      setFileName(name);
      setIsReady(true);
    } finally {
      setIsLoading(false);
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
          (longest, note) => Math.max(longest, note.Length.RealValue),
          0,
        );

        steps.push({
          beat: iterator.CurrentEnrolledTimestamp.RealValue,
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

  return (
    <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-stone-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h2 className="font-semibold">スコア</h2>
          <p className="mt-1 truncate text-sm text-stone-500">{fileName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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

      <div className="flex flex-wrap items-center justify-between gap-2 bg-stone-50 px-4 py-3 text-sm sm:px-6">
        <p aria-live="polite" className="text-stone-600">
          {isLoading
            ? "楽譜を読み込み中..."
            : isPlaying
              ? "再生中"
              : "停止中"}
        </p>
        <p className="font-medium text-emerald-800" aria-live="polite">
          {currentMeasure === null ? "小節: -" : `小節: ${currentMeasure}`}
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 sm:px-6"
        >
          {error}
        </p>
      )}

      <div className="max-h-[70vh] min-h-64 overflow-auto p-4 sm:p-6">
        <div ref={scoreContainerRef} className="min-w-[640px]" />
      </div>
      <p className="border-t border-stone-100 px-4 py-3 text-xs leading-5 text-stone-500 sm:px-6">
        再生中はOSMDの音符カーソルと小節ハイライトが譜面に追従します。初回再生時はブラウザの音声開始操作が必要です。
      </p>
    </section>
  );
}
