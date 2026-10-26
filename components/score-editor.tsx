"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addNoteAt,
  formatPitchOptions,
  getEditableDynamics,
  getEditableNotes,
  getMeasureCount,
  getScoreParts,
  getScoreMetadata,
  removeDynamic,
  removeNote,
  updateMetadata,
  updateNote,
  type EditableDynamic,
  type ScoreMetadata,
} from "@/lib/musicxml-editor";

interface ScoreEditorProps {
  xml: string;
  onApply: (xml: string) => Promise<void>;
  disabled: boolean;
  selectedNoteIndex: number;
  onSelectNote: (index: number) => void;
  selectedDynamicIndex: number;
  onSelectDynamic: (index: number) => void;
}

export default function ScoreEditor({
  xml,
  onApply,
  disabled,
  selectedNoteIndex,
  onSelectNote,
  selectedDynamicIndex,
  onSelectDynamic,
}: ScoreEditorProps) {
  const notes = useMemo(() => getEditableNotes(xml), [xml]);
  const dynamics = useMemo(() => getEditableDynamics(xml), [xml]);
  const parts = useMemo(() => getScoreParts(xml), [xml]);
  const measureCount = useMemo(() => getMeasureCount(xml), [xml]);
  const initialMetadata = useMemo(() => getScoreMetadata(xml), [xml]);
  const pitches = useMemo(() => formatPitchOptions(), []);
  const [pitch, setPitch] = useState("C4");
  const [duration, setDuration] = useState(1);
  const [selectedMeasure, setSelectedMeasure] = useState(0);
  const [selectedPart, setSelectedPart] = useState(0);
  const [selectedTimestamp, setSelectedTimestamp] = useState(0);
  const [selectedStaff, setSelectedStaff] = useState(1);
  const [selectedVoice, setSelectedVoice] = useState("1");
  const [newPitch, setNewPitch] = useState("C4");
  const [newDuration, setNewDuration] = useState(1);
  const [metadata, setMetadata] = useState<ScoreMetadata>(initialMetadata);
  const [error, setError] = useState<string | null>(null);

  const selectedNote = notes[selectedNoteIndex];
  const selectedDynamic: EditableDynamic | undefined = dynamics[selectedDynamicIndex];
  const measures = useMemo(() => {
    const count = Math.max(
      measureCount,
      1,
      ...notes.map((note) => note.measureIndex + 1),
    );
    return Array.from({ length: count }, (_, index) => index);
  }, [measureCount, notes]);

  useEffect(() => {
    setSelectedMeasure(0);
    setMetadata(initialMetadata);
    setError(null);
  }, [xml, initialMetadata]);

  useEffect(() => {
    if (selectedNoteIndex >= notes.length && notes.length > 0) {
      onSelectNote(notes.length - 1);
    }
  }, [notes, onSelectNote, selectedNoteIndex]);

  useEffect(() => {
    if (selectedNote) {
      setPitch(selectedNote.pitch ?? "C4");
      setDuration(selectedNote.durationBeats);
      setSelectedMeasure(selectedNote.measureIndex);
      setSelectedPart(selectedNote.partIndex);
      setSelectedTimestamp(selectedNote.timestampBeats);
      setSelectedStaff(selectedNote.staff);
      setSelectedVoice(selectedNote.voice);
    } else {
      setPitch("C4");
      setDuration(1);
    }
  }, [selectedNote]);

  const applyXml = async (nextXml: string) => {
    setError(null);
    try {
      await onApply(nextXml);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "編集内容を反映できませんでした。",
      );
    }
  };

  const applyNote = async () => {
    if (!selectedNote) {
      return;
    }
    try {
      await applyXml(updateNote(xml, selectedNote, pitch, duration));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "音符を更新できませんでした。",
      );
    }
  };

  const handleMetadataChange = <K extends keyof ScoreMetadata>(
    key: K,
    value: number,
  ) => {
    setMetadata((current) => ({ ...current, [key]: value }));
  };

  const applyScoreMetadata = async () => {
    try {
      await applyXml(updateMetadata(xml, metadata));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "テンポや楽譜の設定を更新できませんでした。",
      );
    }
  };

  return (
    <details id="score-editor-details" className="border-b border-stone-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-stone-800 hover:bg-stone-50 sm:px-6">
        楽譜を編集
      </summary>
      <div className="grid gap-6 border-t border-stone-100 p-4 sm:p-6 lg:grid-cols-2">
        <fieldset disabled={disabled} className="min-w-0 space-y-3">
          <legend className="mb-3 text-sm font-semibold text-stone-700">
            音符
          </legend>
          <label className="block text-sm text-stone-600">
            編集する音符
            <select
              value={selectedNoteIndex}
              onChange={(event) => onSelectNote(Number(event.target.value))}
              className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-stone-900"
            >
              <option value={-1}>選択なし</option>
              {notes.map((note, index) => (
                <option key={`${note.partIndex}-${note.measureIndex}-${note.noteIndex}`} value={index}>
                  {note.partName} / 小節 {note.measureIndex + 1}: {note.isRest ? "休符" : note.pitch} / {note.durationBeats}拍
                </option>
              ))}
              {notes.length === 0 && <option value={0}>編集できる音符がありません</option>}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-stone-600">
              音高
              <input
                list="musicxml-pitches"
                value={pitch}
                onChange={(event) => setPitch(event.target.value)}
                className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 px-3 text-stone-900"
                aria-label="音高"
              />
              <datalist id="musicxml-pitches">
                {pitches.map((value) => <option key={value} value={value} />)}
              </datalist>
            </label>
            <label className="text-sm text-stone-600">
              長さ（拍）
              <input
                type="number"
                min={0.125}
                max={16}
                step="any"
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
                className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 px-3 text-stone-900"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void applyNote()}
              disabled={!selectedNote}
              className="min-h-10 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-stone-300"
            >
              音符を更新
            </button>
            <button
              type="button"
              onClick={() => {
                if (!selectedNote) {
                  return;
                }
                try {
                  void applyXml(removeNote(xml, selectedNote));
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "音符を削除できませんでした。",
                  );
                }
              }}
              disabled={!selectedNote}
              className="min-h-10 rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:text-stone-400"
            >
              選択音符を削除
            </button>
          </div>
          <div className="grid grid-cols-2 items-end gap-2 border-t border-stone-100 pt-3 sm:grid-cols-3 lg:grid-cols-6">
            <label className="text-sm text-stone-600">
              追加先のパート
              <select
                value={selectedPart}
                onChange={(event) => setSelectedPart(Number(event.target.value))}
                className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 bg-white px-2 text-stone-900"
              >
                {parts.map((part) => (
                  <option key={part.id} value={part.index}>{part.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm text-stone-600">
              追加先の小節
              <select
                value={selectedMeasure}
                onChange={(event) => setSelectedMeasure(Number(event.target.value))}
                className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 bg-white px-2 text-stone-900"
              >
                {measures.map((measure) => (
                  <option key={measure} value={measure}>小節 {measure + 1}</option>
                ))}
              </select>
            </label>
            <label className="text-sm text-stone-600">
              追加する音高
              <input
                list="musicxml-pitches"
                value={newPitch}
                onChange={(event) => setNewPitch(event.target.value)}
                className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 px-2 text-stone-900"
                aria-label="追加する音高"
              />
            </label>
            <label className="text-sm text-stone-600">
              譜表番号
              <input
                type="number"
                min={1}
                max={4}
                value={selectedStaff}
                onChange={(event) => setSelectedStaff(Number(event.target.value))}
                className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 px-2 text-stone-900"
              />
            </label>
            <label className="text-sm text-stone-600">
              声部番号
              <input
                type="number"
                min={1}
                max={8}
                value={selectedVoice}
                onChange={(event) => setSelectedVoice(event.target.value)}
                className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 px-2 text-stone-900"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                try {
                  void applyXml(addNoteAt(
                    xml,
                    selectedPart,
                    selectedMeasure,
                    selectedTimestamp,
                    newPitch,
                    newDuration,
                    selectedStaff,
                    selectedVoice,
                  ));
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "音符を追加できませんでした。",
                  );
                }
              }}
              className="min-h-10 rounded-lg border border-stone-300 px-3 text-sm font-medium hover:bg-stone-50"
            >
              音符を追加
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-stone-600">
              追加位置（拍・16分音符単位）
              <input
                type="number"
                min={0}
                step={0.25}
                value={selectedTimestamp}
                onChange={(event) => setSelectedTimestamp(Number(event.target.value))}
                className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 px-3 text-stone-900"
              />
            </label>
            <label className="text-sm text-stone-600">
              追加する長さ（拍）
              <input
                type="number"
                min={0.125}
                max={16}
                step="any"
                value={newDuration}
                onChange={(event) => setNewDuration(Number(event.target.value))}
                className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 px-3 text-stone-900"
              />
            </label>
          </div>
        </fieldset>

        <fieldset disabled={disabled} className="min-w-0 space-y-3">
          <legend className="mb-3 text-sm font-semibold text-stone-700">
            強弱記号
          </legend>
          <label className="block text-sm text-stone-600">
            編集する記号
            <select
              value={selectedDynamicIndex}
              onChange={(event) => onSelectDynamic(Number(event.target.value))}
              className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-stone-900"
            >
              <option value={-1}>選択なし</option>
              {dynamics.map((dynamic, index) => (
                <option
                  key={`${dynamic.partIndex}-${dynamic.measureIndex}-${dynamic.directionIndex}`}
                  value={index}
                >
                  {parts[dynamic.partIndex]?.name ?? `パート ${dynamic.partIndex + 1}`} / 小節 {dynamic.measureIndex + 1}: {dynamic.value}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              if (!selectedDynamic) {
                return;
              }
              try {
                void applyXml(removeDynamic(xml, selectedDynamic));
                onSelectDynamic(-1);
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "強弱記号を削除できませんでした。",
                );
              }
            }}
            disabled={!selectedDynamic}
            className="min-h-10 rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:text-stone-400"
          >
            選択した強弱記号を削除
          </button>
        </fieldset>

        <fieldset disabled={disabled} className="space-y-3">
          <legend className="mb-3 text-sm font-semibold text-stone-700">
            テンポ・拍子・調号
          </legend>
          <label className="block text-sm text-stone-600">
            テンポ（BPM）
            <input
              type="number"
              min={20}
              max={300}
              value={metadata.tempo}
              onChange={(event) => handleMetadataChange("tempo", Number(event.target.value))}
              className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 px-3 text-stone-900"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-stone-600">
              拍子の分子
              <input
                type="number"
                min={1}
                max={32}
                value={metadata.beats}
                onChange={(event) => handleMetadataChange("beats", Number(event.target.value))}
                className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 px-3 text-stone-900"
              />
            </label>
            <label className="text-sm text-stone-600">
              拍子の分母
              <select
                value={metadata.beatType}
                onChange={(event) => handleMetadataChange("beatType", Number(event.target.value))}
                className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-stone-900"
              >
                {[1, 2, 4, 8, 16].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm text-stone-600">
            調号（♭の数は負、♯の数は正）
            <input
              type="number"
              min={-7}
              max={7}
              value={metadata.fifths}
              onChange={(event) => handleMetadataChange("fifths", Number(event.target.value))}
              className="mt-1 block min-h-10 w-full rounded-lg border border-stone-300 px-3 text-stone-900"
            />
          </label>
          <button
            type="button"
            onClick={() => void applyScoreMetadata()}
            className="min-h-10 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            設定を反映
          </button>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-red-700 lg:col-span-2">{error}</p>
        )}
      </div>
      <p className="px-4 pb-4 text-xs text-stone-500 sm:px-6">
        音符は選択したパート・小節・拍位置に追加され、同じ声部の後続音符は後ろへ移動します。
      </p>
    </details>
  );
}
