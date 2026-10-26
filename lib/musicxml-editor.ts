export interface EditableNote {
  partIndex: number;
  partId: string;
  partName: string;
  measureIndex: number;
  noteIndex: number;
  pitch: string | null;
  midi: number | null;
  durationBeats: number;
  timestampBeats: number;
  staff: number;
  voice: string;
  isRest: boolean;
}

export interface EditableDynamic {
  partIndex: number;
  measureIndex: number;
  directionIndex: number;
  timestampBeats: number;
  staff: number;
  value: "p" | "mp" | "mf" | "f" | "sf";
}

export interface ScorePart {
  index: number;
  id: string;
  name: string;
}

export interface ScoreMetadata {
  tempo: number;
  beats: number;
  beatType: number;
  fifths: number;
}

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const durationTypes = new Map<number, string>([
  [0.25, "16th"],
  [0.5, "eighth"],
  [0.75, "eighth"],
  [1, "quarter"],
  [1.5, "quarter"],
  [2, "half"],
  [3, "half"],
  [4, "whole"],
  [6, "whole"],
  [8, "breve"],
]);
const dottedDurations = new Set([0.75, 1.5, 3, 6]);

function elements(parent: ParentNode, name: string): Element[] {
  const matching: Element[] = [];
  parent.querySelectorAll("*").forEach((element) => {
    if (element.localName === name) {
      matching.push(element);
    }
  });
  return matching;
}

function directChild(parent: Element, name: string): Element | undefined {
  return Array.from(parent.children).find((child) => child.localName === name);
}

function parseDocument(xml: string): XMLDocument {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error("MusicXMLを解析できませんでした。");
  }
  return document;
}

function readPitch(note: Element): string | null {
  const pitch = directChild(note, "pitch");
  const step = pitch && directChild(pitch, "step")?.textContent;
  const octave = pitch && directChild(pitch, "octave")?.textContent;
  if (!step || !octave) {
    return null;
  }
  const alter = Number(directChild(pitch, "alter")?.textContent ?? 0);
  const accidental = alter === 1 ? "#" : alter === -1 ? "b" : "";
  return `${step}${accidental}${octave}`;
}

function pitchToMidi(note: Element): number | null {
  const pitch = directChild(note, "pitch");
  const step = pitch && directChild(pitch, "step")?.textContent;
  const octave = Number(pitch && directChild(pitch, "octave")?.textContent);
  if (!step || !Number.isInteger(octave)) {
    return null;
  }
  const semitones: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  const alter = Number(directChild(pitch, "alter")?.textContent ?? 0);
  return (octave + 1) * 12 + semitones[step] + alter;
}

export function getEditableNotes(xml: string): EditableNote[] {
  const document = parseDocument(xml);
  const scoreParts = getScorePartsFromDocument(document);
  return scoreParts.flatMap((scorePart) => {
    const part = partAt(document, scorePart.index);
    if (!part) {
      return [];
    }
    return measureElements(part).flatMap((measure, measureIndex) => {
      const divisions = divisionsAtMeasure(part, measureIndex);
      let cursor = 0;
      let noteIndex = 0;
      const notes: EditableNote[] = [];
      for (const element of Array.from(measure.children)) {
        if (element.localName === "backup" || element.localName === "forward") {
          const amount = Number(directChild(element, "duration")?.textContent ?? 0);
          cursor += element.localName === "backup" ? -amount : amount;
          continue;
        }
        if (element.localName !== "note") {
          continue;
        }
        const currentNoteIndex = noteIndex++;
        const pitch = readPitch(element);
        const midi = pitchToMidi(element);
        const durationTicks = Number(
          directChild(element, "duration")?.textContent ?? divisions,
        );
        notes.push({
          partIndex: scorePart.index,
          partId: scorePart.id,
          partName: scorePart.name,
          measureIndex,
          noteIndex: currentNoteIndex,
          pitch,
          midi,
          durationBeats: durationTicks / divisions,
          timestampBeats: cursor / divisions,
          staff: Number(directChild(element, "staff")?.textContent ?? 1),
          voice: directChild(element, "voice")?.textContent ?? "1",
          isRest: directChild(element, "rest") !== undefined,
        });
        if (!directChild(element, "chord")) {
          cursor += durationTicks;
        }
      }
      return notes;
    });
  });
}

function getScorePartsFromDocument(document: XMLDocument): ScorePart[] {
  const partElements = Array.from(document.querySelectorAll("*")).filter(
    (element) => element.localName === "part",
  );
  const partList = Array.from(document.querySelectorAll("*")).find(
    (element) => element.localName === "part-list",
  );
  const definitions = partList
    ? Array.from(partList.children).filter(
        (element) => element.localName === "score-part",
      )
    : [];
  return partElements.map((part, index) => {
    const id = part.getAttribute("id") ?? "";
    const definition = definitions.find((entry) => entry.getAttribute("id") === id);
    return {
      index,
      id,
      name: directChild(definition ?? part, "part-name")?.textContent?.trim() || id || `パート ${index + 1}`,
    };
  });
}

export function getScoreParts(xml: string): ScorePart[] {
  return getScorePartsFromDocument(parseDocument(xml));
}

export function getMeasureCount(xml: string): number {
  const part = elements(parseDocument(xml), "part")[0];
  return part ? measureElements(part).length : 0;
}

export function getMeasureIndexByNumber(xml: string, number: string): number {
  const part = elements(parseDocument(xml), "part")[0];
  const measures = part ? measureElements(part) : [];
  const exactIndex = measures.findIndex(
    (measure) => measure.getAttribute("number") === number,
  );
  if (exactIndex >= 0) {
    return exactIndex;
  }
  const numericIndex = Number(number) - 1;
  return Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < measures.length
    ? numericIndex
    : -1;
}

export function getSupportedDurations(xml: string): number[] {
  const part = elements(parseDocument(xml), "part")[0];
  if (!part) {
    return [1];
  }
  return [0.5, 1, 2, 4].filter((beats) =>
    measureElements(part).every((_, index) =>
      Number.isInteger(divisionsAtMeasure(part, index) * beats),
    ),
  );
}

export function getScoreMetadata(xml: string): ScoreMetadata {
  const document = parseDocument(xml);
  const part = elements(document, "part")[0];
  const attributes = part && elements(part, "attributes")[0];
  const time = attributes && elements(attributes, "time")[0];
  const key = attributes && elements(attributes, "key")[0];
  const tempoElement = elements(document, "sound").find(
    (element) => element.hasAttribute("tempo"),
  );
  return {
    tempo: Number(tempoElement?.getAttribute("tempo") ?? 120),
    beats: Number(time && elements(time, "beats")[0]?.textContent) || 4,
    beatType: Number(time && elements(time, "beat-type")[0]?.textContent) || 4,
    fifths: Number(key && elements(key, "fifths")[0]?.textContent) || 0,
  };
}

function setElementText(
  document: XMLDocument,
  parent: Element,
  name: string,
  value: string,
): Element {
  let element = directChild(parent, name);
  if (!element) {
    element = document.createElementNS(parent.namespaceURI, name);
    parent.appendChild(element);
  }
  element.textContent = value;
  return element;
}

function measureElements(part: Element): Element[] {
  return Array.from(part.children).filter(
    (element) => element.localName === "measure",
  );
}

function divisionsAtMeasure(part: Element, measureIndex: number): number {
  let divisions = 1;
  for (const [index, measure] of measureElements(part).entries()) {
    if (index > measureIndex) {
      break;
    }
    const attributes = directChild(measure, "attributes");
    const measureDivisions = attributes && directChild(attributes, "divisions");
    if (measureDivisions) {
      divisions = Number(measureDivisions.textContent) || divisions;
    }
  }
  return Math.max(1, divisions);
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

function leastCommonMultiple(left: number, right: number): number {
  return (left / greatestCommonDivisor(left, right)) * right;
}

function ensureMeasureResolution(
  document: XMLDocument,
  part: Element,
  measureIndex: number,
  timestampsInBeats: number[],
): number {
  const measures = measureElements(part);
  if (measures.length === 0) {
    throw new Error("譜面に小節がありません。");
  }
  const targetDivisions = divisionsAtMeasure(part, measureIndex);
  let factor = 1;
  const isRepresentable = () =>
    timestampsInBeats.every((beats) =>
      Number.isInteger(beats * targetDivisions * factor),
    );
  while (!isRepresentable() && factor <= 1024) {
    factor *= 2;
  }
  if (!isRepresentable()) {
    throw new Error("この拍位置はMusicXMLの分解能で表現できません。");
  }
  if (factor === 1) {
    return targetDivisions;
  }

  const divisionsByMeasure = measures.map((_, index) =>
    divisionsAtMeasure(part, index),
  );
  const newDivisions = divisionsByMeasure.reduce(
    (current, divisions) => leastCommonMultiple(current, divisions),
    targetDivisions * factor,
  );
  if (!Number.isSafeInteger(newDivisions) || newDivisions > 1_000_000) {
    throw new Error("この譜面の分解能を安全に拡張できません。");
  }

  measures.forEach((measure, measureIndex) => {
    const ratio = newDivisions / divisionsByMeasure[measureIndex];
    for (const name of ["duration", "offset"]) {
      for (const element of elements(measure, name)) {
        const scaled = Number(element.textContent ?? 0) * ratio;
        if (!Number.isInteger(scaled)) {
          throw new Error("既存の音符位置を新しい分解能へ変換できません。");
        }
        element.textContent = String(scaled);
      }
    }
    const attributes = directChild(measure, "attributes");
    if (attributes) {
      const divisions = directChild(attributes, "divisions");
      if (divisions) {
        divisions.textContent = String(newDivisions);
      }
    }
  });

  let firstAttributes = directChild(measures[0], "attributes");
  if (!firstAttributes) {
    firstAttributes = document.createElementNS(part.namespaceURI, "attributes");
    measures[0].insertBefore(firstAttributes, measures[0].firstChild);
  }
  let divisions = directChild(firstAttributes, "divisions");
  if (!divisions) {
    divisions = document.createElementNS(part.namespaceURI, "divisions");
    firstAttributes.insertBefore(divisions, firstAttributes.firstChild);
  }
  divisions.textContent = String(newDivisions);
  return newDivisions;
}

function partAt(document: XMLDocument, partIndex: number): Element | undefined {
  return elements(document, "part")[partIndex];
}

function noteAt(
  document: XMLDocument,
  target: Pick<EditableNote, "partIndex" | "measureIndex" | "noteIndex">,
): { part: Element; measure: Element; note: Element; divisions: number } {
  const part = partAt(document, target.partIndex);
  const measure = part && measureElements(part)[target.measureIndex];
  const note =
    measure &&
    Array.from(measure.children).filter((child) => child.localName === "note")[
      target.noteIndex
    ];
  if (!part || !measure || !note) {
    throw new Error("選択した音符が見つかりません。");
  }
  return {
    part,
    measure,
    note,
    divisions: divisionsAtMeasure(part, target.measureIndex),
  };
}

function measureCursorBounds(measure: Element): { cursor: number; maximum: number } {
  let cursor = 0;
  let maximum = 0;
  for (const child of Array.from(measure.children)) {
    if (child.localName === "backup" || child.localName === "forward") {
      const amount = Number(directChild(child, "duration")?.textContent ?? 0);
      cursor += child.localName === "backup" ? -amount : amount;
    } else if (child.localName === "note") {
      if (!directChild(child, "chord")) {
        cursor += Number(directChild(child, "duration")?.textContent ?? 0);
      }
    }
    maximum = Math.max(maximum, cursor);
  }
  return { cursor, maximum };
}

function positionMeasureCursor(
  document: XMLDocument,
  measure: Element,
  targetTicks: number,
): number {
  if (!Number.isInteger(targetTicks) || targetTicks < 0) {
    throw new Error("追加位置は小節内の有効な拍位置を指定してください。");
  }
  const { cursor, maximum } = measureCursorBounds(measure);
  const barline =
    Array.from(measure.children).find((child) => child.localName === "barline") ??
    null;
  if (cursor < maximum) {
    const forward = document.createElementNS(measure.namespaceURI, "forward");
    setElementText(document, forward, "duration", String(maximum - cursor));
    measure.insertBefore(forward, barline);
  } else if (cursor > maximum) {
    throw new Error("小節内の声部位置を解決できません。");
  }
  if (maximum > targetTicks) {
    const backup = document.createElementNS(measure.namespaceURI, "backup");
    setElementText(document, backup, "duration", String(maximum - targetTicks));
    measure.insertBefore(backup, barline);
  } else if (targetTicks > maximum) {
    const forward = document.createElementNS(measure.namespaceURI, "forward");
    setElementText(document, forward, "duration", String(targetTicks - maximum));
    measure.insertBefore(forward, barline);
  }
  return Math.max(maximum, targetTicks);
}

function restoreMeasureCursor(
  document: XMLDocument,
  measure: Element,
  currentTicks: number,
  targetEndTicks: number,
): void {
  if (targetEndTicks === currentTicks) {
    return;
  }
  const forward = document.createElementNS(
    measure.namespaceURI,
    targetEndTicks > currentTicks ? "forward" : "backup",
  );
  setElementText(
    document,
    forward,
    "duration",
    String(Math.abs(targetEndTicks - currentTicks)),
  );
  const barline =
    Array.from(measure.children).find((child) => child.localName === "barline") ??
    null;
  measure.insertBefore(forward, barline);
}

function createNoteElement(
  document: XMLDocument,
  namespace: string | null,
  pitchText: string | null,
  durationTicks: number,
  durationBeats: number,
  voiceText: string,
  staffNumber: number,
): Element {
  const note = document.createElementNS(namespace, "note");
  if (pitchText) {
    replacePitch(document, note, pitchText);
  } else {
    note.appendChild(document.createElementNS(namespace, "rest"));
  }
  setElementText(document, note, "duration", String(durationTicks));
  const voice = setElementText(document, note, "voice", voiceText);
  const type = durationTypes.get(durationBeats);
  if (type) {
    setElementText(document, note, "type", type);
  }
  note.insertBefore(voice, directChild(note, "type") ?? null);
  setElementText(document, note, "staff", String(staffNumber));
  if (dottedDurations.has(durationBeats)) {
    note.insertBefore(
      document.createElementNS(namespace, "dot"),
      directChild(note, "staff") ?? null,
    );
  }
  return note;
}

function rippleFollowingVoice(
  document: XMLDocument,
  measure: Element,
  targetTicks: number,
  shiftTicks: number,
  staff: number,
  voice: string,
): void {
  let cursor = 0;
  let firstShiftedNote: Element | null = null;
  let shift = shiftTicks;
  for (const child of Array.from(measure.children)) {
    if (child.localName === "backup" || child.localName === "forward") {
      const amount = Number(directChild(child, "duration")?.textContent ?? 0);
      cursor += child.localName === "backup" ? -amount : amount;
      continue;
    }
    if (child.localName !== "note" || directChild(child, "chord")) {
      continue;
    }
    const childVoice = directChild(child, "voice")?.textContent ?? "1";
    const childStaff = Number(directChild(child, "staff")?.textContent ?? 1);
    const duration = Number(directChild(child, "duration")?.textContent ?? 0);
    if (
      childVoice === voice &&
      childStaff === staff &&
      cursor + duration > targetTicks
    ) {
      firstShiftedNote = child;
      shift = Math.max(shiftTicks, targetTicks + shiftTicks - cursor);
      break;
    }
    cursor += duration;
  }
  if (!firstShiftedNote || shift <= 0) {
    return;
  }

  const forward = document.createElementNS(measure.namespaceURI, "forward");
  setElementText(document, forward, "duration", String(shift));
  measure.insertBefore(forward, firstShiftedNote);

  let nextBackup = firstShiftedNote.nextElementSibling;
  while (nextBackup && nextBackup.localName !== "backup") {
    nextBackup = nextBackup.nextElementSibling;
  }
  if (nextBackup) {
    const duration = directChild(nextBackup, "duration");
    const existing = Number(duration?.textContent ?? 0);
    if (existing + shift <= 0) {
      throw new Error("後続音符をずらせません。声部のタイミングを確認してください。");
    }
    setElementText(document, nextBackup, "duration", String(existing + shift));
  }
}

function removeNoteFromMeasure(document: XMLDocument, note: Element): void {
  if (!directChild(note, "chord")) {
    const chordSuccessor = note.nextElementSibling;
    if (
      chordSuccessor &&
      chordSuccessor.localName === "note" &&
      directChild(chordSuccessor, "chord")
    ) {
      directChild(chordSuccessor, "chord")?.remove();
      note.remove();
      return;
    }
    const duration = Number(directChild(note, "duration")?.textContent ?? 0);
    let nextBackup = note.nextElementSibling;
    while (nextBackup && nextBackup.localName !== "backup") {
      nextBackup = nextBackup.nextElementSibling;
    }
    if (nextBackup && duration > 0) {
      const existing = Number(directChild(nextBackup, "duration")?.textContent ?? 0);
      if (existing <= duration) {
        throw new Error("この音符は他の声部と共有する時間位置のため削除できません。");
      }
      setElementText(document, nextBackup, "duration", String(existing - duration));
    }
  }
  note.remove();
}

function replacePitch(
  document: XMLDocument,
  note: Element,
  pitchText: string,
): void {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitchText);
  if (!match) {
    throw new Error("音高はC4、F#5、Bb3の形式で入力してください。");
  }
  let pitch = directChild(note, "pitch");
  if (!pitch) {
    pitch = document.createElementNS(note.namespaceURI, "pitch");
    const duration = directChild(note, "duration");
    note.insertBefore(pitch, duration ?? null);
  }

  setElementText(document, pitch, "step", match[1]);
  const alter = match[2] === "#" ? "1" : match[2] === "b" ? "-1" : null;
  if (alter === null) {
    directChild(pitch, "alter")?.remove();
  } else {
    setElementText(document, pitch, "alter", alter);
  }
  setElementText(document, pitch, "octave", match[3]);
}

function replaceDuration(
  document: XMLDocument,
  note: Element,
  divisions: number,
  beats: number,
): void {
  if (!Number.isFinite(beats) || beats <= 0 || beats > 16) {
    throw new Error("音符の長さは0より大きく16拍以下にしてください。");
  }
  const duration = beats * divisions;
  if (!Number.isInteger(duration)) {
    throw new Error("この拍数は楽譜の分解能では表現できません。");
  }
  setElementText(document, note, "duration", String(duration));
  const typeName = durationTypes.get(beats);
  if (typeName) {
    setElementText(document, note, "type", typeName);
  } else {
    directChild(note, "type")?.remove();
  }
  for (const dot of Array.from(note.children).filter(
    (child) => child.localName === "dot",
  )) {
    dot.remove();
  }
  if (dottedDurations.has(beats)) {
    const followingElement = ["accidental", "time-modification", "stem", "notehead", "staff"]
      .map((name) => directChild(note, name))
      .find((element) => element !== undefined);
    note.insertBefore(
      document.createElementNS(note.namespaceURI, "dot"),
      followingElement ?? null,
    );
  }
}

export function updateNote(
  xml: string,
  target: EditableNote,
  pitchText: string,
  durationBeats: number,
): string {
  const document = parseDocument(xml);
  const { note, divisions } = noteAt(document, target);
  replacePitch(document, note, pitchText);
  directChild(note, "rest")?.remove();
  replaceDuration(document, note, divisions, durationBeats);
  return new XMLSerializer().serializeToString(document);
}

export function addNote(
  xml: string,
  measureIndex: number,
  pitchText: string,
  durationBeats: number,
): string {
  const notes = getEditableNotes(xml).filter((note) => note.measureIndex === measureIndex);
  const last = notes.reduce(
    (end, note) => Math.max(end, note.timestampBeats + note.durationBeats),
    0,
  );
  return addNoteAt(xml, 0, measureIndex, last, pitchText, durationBeats, 1, "1");
}

export function addRest(
  xml: string,
  measureIndex: number,
  durationBeats: number,
): string {
  const notes = getEditableNotes(xml).filter((note) => note.measureIndex === measureIndex);
  const last = notes.reduce(
    (end, note) => Math.max(end, note.timestampBeats + note.durationBeats),
    0,
  );
  return addRestAt(xml, 0, measureIndex, last, durationBeats, 1, "1");
}

export function addNoteAt(
  xml: string,
  partIndex: number,
  measureIndex: number,
  timestampBeats: number,
  pitchText: string,
  durationBeats: number,
  staff: number,
  voice: string,
): string {
  const document = parseDocument(xml);
  const part = partAt(document, partIndex);
  const measure = part && measureElements(part)[measureIndex];
  if (!part || !measure) {
    throw new Error("音符を追加する小節が見つかりません。");
  }
  if (!Number.isFinite(durationBeats) || durationBeats <= 0 || durationBeats > 16) {
    throw new Error("音符の長さは0より大きく16拍以下にしてください。");
  }
  const divisions = ensureMeasureResolution(
    document,
    part,
    measureIndex,
    [timestampBeats, durationBeats],
  );
  const targetTicks = timestampBeats * divisions;
  const durationTicks = durationBeats * divisions;
  if (!Number.isInteger(targetTicks) || !Number.isInteger(durationTicks)) {
    throw new Error("この拍位置や長さは楽譜の分解能では表現できません。");
  }
  rippleFollowingVoice(
    document,
    measure,
    targetTicks,
    durationTicks,
    staff,
    voice,
  );
  const baseline = positionMeasureCursor(document, measure, targetTicks);
  const note = createNoteElement(
    document,
    part.namespaceURI,
    pitchText,
    durationTicks,
    durationBeats,
    voice,
    staff,
  );
  const barline =
    Array.from(measure.children).find((child) => child.localName === "barline") ??
    null;
  measure.insertBefore(note, barline);
  restoreMeasureCursor(document, measure, targetTicks + durationTicks, baseline);
  return normalizeOverflow(
    new XMLSerializer().serializeToString(document),
    partIndex,
    measureIndex,
    staff,
    voice,
  );
}

export function addRestAt(
  xml: string,
  partIndex: number,
  measureIndex: number,
  timestampBeats: number,
  durationBeats: number,
  staff: number,
  voice: string,
): string {
  const document = parseDocument(xml);
  const part = partAt(document, partIndex);
  const measure = part && measureElements(part)[measureIndex];
  if (!part || !measure) {
    throw new Error("休符を追加する小節が見つかりません。");
  }
  if (!Number.isFinite(durationBeats) || durationBeats <= 0 || durationBeats > 16) {
    throw new Error("休符の長さは0より大きく16拍以下にしてください。");
  }
  const divisions = ensureMeasureResolution(
    document,
    part,
    measureIndex,
    [timestampBeats, durationBeats],
  );
  const targetTicks = timestampBeats * divisions;
  const durationTicks = durationBeats * divisions;
  if (!Number.isInteger(targetTicks) || !Number.isInteger(durationTicks)) {
    throw new Error("この拍位置や長さは楽譜の分解能では表現できません。");
  }
  rippleFollowingVoice(
    document,
    measure,
    targetTicks,
    durationTicks,
    staff,
    voice,
  );
  const baseline = positionMeasureCursor(document, measure, targetTicks);
  const rest = createNoteElement(
    document,
    part.namespaceURI,
    null,
    durationTicks,
    durationBeats,
    voice,
    staff,
  );
  const barline =
    Array.from(measure.children).find((child) => child.localName === "barline") ??
    null;
  measure.insertBefore(rest, barline);
  restoreMeasureCursor(document, measure, targetTicks + durationTicks, baseline);
  return normalizeOverflow(
    new XMLSerializer().serializeToString(document),
    partIndex,
    measureIndex,
    staff,
    voice,
  );
}

export function addDynamicAt(
  xml: string,
  partIndex: number,
  measureIndex: number,
  timestampBeats: number,
  dynamic: EditableDynamic["value"],
  staff: number,
): string {
  const document = parseDocument(xml);
  const part = partAt(document, partIndex);
  const measure = part && measureElements(part)[measureIndex];
  if (!part || !measure) {
    throw new Error("記号を追加する小節が見つかりません。");
  }
  const divisions = ensureMeasureResolution(
    document,
    part,
    measureIndex,
    [timestampBeats],
  );
  const targetTicks = timestampBeats * divisions;
  if (!Number.isInteger(targetTicks) || targetTicks < 0) {
    throw new Error("強弱記号の位置は小節内の有効な拍位置を指定してください。");
  }
  const baseline = positionMeasureCursor(document, measure, targetTicks);
  const direction = document.createElementNS(part.namespaceURI, "direction");
  direction.setAttribute("placement", "below");
  const directionType = document.createElementNS(part.namespaceURI, "direction-type");
  const dynamics = document.createElementNS(part.namespaceURI, "dynamics");
  dynamics.appendChild(document.createElementNS(part.namespaceURI, dynamic));
  directionType.appendChild(dynamics);
  direction.appendChild(directionType);
  const staffElement = document.createElementNS(part.namespaceURI, "staff");
  staffElement.textContent = String(staff);
  direction.appendChild(staffElement);
  const barline =
    Array.from(measure.children).find((child) => child.localName === "barline") ??
    null;
  measure.insertBefore(direction, barline);
  restoreMeasureCursor(document, measure, targetTicks, baseline);
  return new XMLSerializer().serializeToString(document);
}

export function addDynamic(
  xml: string,
  measureIndex: number,
  dynamic: "p" | "mp" | "mf" | "f",
): string {
  return addDynamicAt(xml, 0, measureIndex, 0, dynamic, 1);
}

export function removeNote(
  xml: string,
  target: EditableNote,
): string {
  const document = parseDocument(xml);
  const { note } = noteAt(document, target);
  removeNoteFromMeasure(document, note);
  return new XMLSerializer().serializeToString(document);
}

export function getEditableDynamics(xml: string): EditableDynamic[] {
  const document = parseDocument(xml);
  return getScorePartsFromDocument(document).flatMap((scorePart) => {
    const part = partAt(document, scorePart.index);
    if (!part) {
      return [];
    }
    return measureElements(part).flatMap((measure, measureIndex) => {
      const divisions = divisionsAtMeasure(part, measureIndex);
      let cursor = 0;
      let directionIndex = 0;
      const dynamics: EditableDynamic[] = [];
      for (const child of Array.from(measure.children)) {
        if (child.localName === "backup" || child.localName === "forward") {
          const amount = Number(directChild(child, "duration")?.textContent ?? 0);
          cursor += child.localName === "backup" ? -amount : amount;
        } else if (child.localName === "note") {
          if (!directChild(child, "chord")) {
            cursor += Number(directChild(child, "duration")?.textContent ?? 0);
          }
        } else if (child.localName === "direction") {
          const currentDirectionIndex = directionIndex++;
          const offset = Number(directChild(child, "offset")?.textContent ?? 0);
          const dynamicsElement = elements(child, "dynamics")[0];
          const value = dynamicsElement?.firstElementChild?.localName;
          if (value && ["p", "mp", "mf", "f", "sf"].includes(value)) {
            dynamics.push({
              partIndex: scorePart.index,
              measureIndex,
              directionIndex: currentDirectionIndex,
              timestampBeats: (cursor + offset) / divisions,
              staff: Number(directChild(child, "staff")?.textContent ?? 1),
              value: value as EditableDynamic["value"],
            });
          }
        }
      }
      return dynamics;
    });
  });
}

function directionAt(
  document: XMLDocument,
  target: EditableDynamic,
): { direction: Element; part: Element; measure: Element } {
  const part = partAt(document, target.partIndex);
  const measure = part && measureElements(part)[target.measureIndex];
  const direction =
    measure &&
    Array.from(measure.children).filter((child) => child.localName === "direction")[
      target.directionIndex
    ];
  if (!part || !measure || !direction) {
    throw new Error("選択した強弱記号が見つかりません。");
  }
  return { direction, part, measure };
}

export function removeDynamic(xml: string, target: EditableDynamic): string {
  const document = parseDocument(xml);
  directionAt(document, target).direction.remove();
  return new XMLSerializer().serializeToString(document);
}

function measureDurationBeats(part: Element, measureIndex: number): number {
  let beats = 4;
  let beatType = 4;
  for (const [index, measure] of measureElements(part).entries()) {
    if (index > measureIndex) {
      break;
    }
    const time = directChild(directChild(measure, "attributes") ?? measure, "time");
    const parsedBeats = Number(directChild(time ?? measure, "beats")?.textContent);
    const parsedBeatType = Number(
      directChild(time ?? measure, "beat-type")?.textContent,
    );
    if (Number.isFinite(parsedBeats) && parsedBeats > 0) {
      beats = parsedBeats;
    }
    if (Number.isFinite(parsedBeatType) && parsedBeatType > 0) {
      beatType = parsedBeatType;
    }
  }
  return (beats * 4) / beatType;
}

function appendEmptyMeasures(document: XMLDocument, count: number): void {
  for (const part of elements(document, "part")) {
    const measures = measureElements(part);
    while (measures.length < count) {
      const lastNumber = measures[measures.length - 1]?.getAttribute("number");
      const numericNumber = Number(lastNumber);
      const nextNumber = Number.isInteger(numericNumber)
        ? numericNumber + 1
        : measures.length + 1;
      const measure = document.createElementNS(part.namespaceURI, "measure");
      measure.setAttribute("number", String(nextNumber));
      part.appendChild(measure);
      measures.push(measure);
    }
  }
}

function clearNoteTies(note: Element): void {
  for (const tie of Array.from(note.children).filter(
    (child) => child.localName === "tie",
  )) {
    tie.remove();
  }
  const notations = directChild(note, "notations");
  if (notations) {
    for (const tied of elements(notations, "tied")) {
      tied.remove();
    }
    if (notations.children.length === 0) {
      notations.remove();
    }
  }
}

function addNoteTie(
  document: XMLDocument,
  note: Element,
  type: "start" | "stop",
): void {
  const tie = document.createElementNS(note.namespaceURI, "tie");
  tie.setAttribute("type", type);
  const voice = directChild(note, "voice");
  note.insertBefore(tie, voice ?? directChild(note, "type") ?? null);

  let notations = directChild(note, "notations");
  if (!notations) {
    notations = document.createElementNS(note.namespaceURI, "notations");
    note.appendChild(notations);
  }
  const tied = document.createElementNS(note.namespaceURI, "tied");
  tied.setAttribute("type", type);
  notations.appendChild(tied);
}

function splitNoteAtMeasureBoundary(
  xml: string,
  target: EditableNote,
  capacity: number,
): string {
  const document = parseDocument(xml);
  const source = noteAt(document, target);
  const durationBeats =
    Number(directChild(source.note, "duration")?.textContent ?? source.divisions) /
    source.divisions;
  const firstDurationBeats = capacity - target.timestampBeats;
  const continuationBeats = durationBeats - firstDurationBeats;
  const destinationMeasureIndex = target.measureIndex + 1;
  appendEmptyMeasures(document, destinationMeasureIndex + 1);
  const divisions = ensureMeasureResolution(
    document,
    source.part,
    destinationMeasureIndex,
    [firstDurationBeats, continuationBeats],
  );
  replaceDuration(document, source.note, divisions, firstDurationBeats);
  const continuation = source.note.cloneNode(true) as Element;
  clearNoteTies(source.note);
  clearNoteTies(continuation);
  if (!target.isRest) {
    addNoteTie(document, source.note, "start");
    addNoteTie(document, continuation, "stop");
  }
  replaceDuration(document, continuation, divisions, continuationBeats);

  const destinationMeasure =
    measureElements(source.part)[destinationMeasureIndex];
  const continuationTicks = continuationBeats * divisions;
  rippleFollowingVoice(
    document,
    destinationMeasure,
    0,
    continuationTicks,
    target.staff,
    target.voice,
  );
  const baseline = positionMeasureCursor(document, destinationMeasure, 0);
  const barline =
    Array.from(destinationMeasure.children).find(
      (child) => child.localName === "barline",
    ) ?? null;
  destinationMeasure.insertBefore(continuation, barline);
  restoreMeasureCursor(document, destinationMeasure, continuationTicks, baseline);
  return new XMLSerializer().serializeToString(document);
}

function normalizeOverflow(
  xml: string,
  partIndex: number,
  startingMeasure: number,
  staff: number,
  voice: string,
): string {
  let updatedXml = xml;
  let measureIndex = startingMeasure;
  let operationCount = 0;
  while (operationCount < 10_000) {
    const document = parseDocument(updatedXml);
    const part = partAt(document, partIndex);
    const measures = part ? measureElements(part) : [];
    if (!part || measureIndex >= measures.length) {
      return updatedXml;
    }
    const capacity = measureDurationBeats(part, measureIndex);
    const notes = getEditableNotes(updatedXml).filter(
      (note) =>
        note.partIndex === partIndex &&
        note.measureIndex === measureIndex &&
        note.staff === staff &&
        note.voice === voice,
    );
    const crossingNote = notes.find(
      (note) =>
        note.timestampBeats < capacity - 0.0001 &&
        note.timestampBeats + note.durationBeats > capacity + 0.0001,
    );
    if (crossingNote) {
      updatedXml = splitNoteAtMeasureBoundary(
        updatedXml,
        crossingNote,
        capacity,
      );
      operationCount += 1;
      continue;
    }
    const overflowNote = notes
      .filter((note) => note.timestampBeats >= capacity - 0.0001)
      .sort((left, right) => left.timestampBeats - right.timestampBeats)[0];
    if (!overflowNote) {
      measureIndex += 1;
      continue;
    }
    if (measureIndex + 1 >= measures.length) {
      appendEmptyMeasures(document, measureIndex + 2);
      updatedXml = new XMLSerializer().serializeToString(document);
    }
    updatedXml = moveNoteElement(
      updatedXml,
      overflowNote,
      partIndex,
      measureIndex + 1,
      overflowNote.timestampBeats - capacity,
      overflowNote.pitch,
      staff,
      voice,
    );
    operationCount += 1;
  }
  throw new Error("後続音符の小節移動が上限を超えました。");
}

function moveNoteElement(
  xml: string,
  target: EditableNote,
  partIndex: number,
  measureIndex: number,
  timestampBeats: number,
  pitchText: string | null,
  staff: number,
  voice: string,
): string {
  const document = parseDocument(xml);
  const source = noteAt(document, target);
  const clone = source.note.cloneNode(true) as Element;
  directChild(clone, "chord")?.remove();
  const durationBeats =
    Number(directChild(clone, "duration")?.textContent ?? source.divisions) /
    source.divisions;
  if (pitchText) {
    replacePitch(document, clone, pitchText);
    directChild(clone, "rest")?.remove();
  } else {
    directChild(clone, "pitch")?.remove();
    if (!directChild(clone, "rest")) {
      clone.insertBefore(
        document.createElementNS(clone.namespaceURI, "rest"),
        directChild(clone, "duration") ?? null,
      );
    }
  }
  setElementText(document, clone, "staff", String(staff));
  setElementText(document, clone, "voice", voice);
  removeNoteFromMeasure(document, source.note);

  const destinationPart = partAt(document, partIndex);
  const destinationMeasure =
    destinationPart && measureElements(destinationPart)[measureIndex];
  if (!destinationPart || !destinationMeasure) {
    throw new Error("音符を移動する小節が見つかりません。");
  }
  const divisions = ensureMeasureResolution(
    document,
    destinationPart,
    measureIndex,
    [timestampBeats, durationBeats],
  );
  const targetTicks = timestampBeats * divisions;
  const durationTicks = durationBeats * divisions;
  if (!Number.isInteger(targetTicks) || targetTicks < 0) {
    throw new Error("移動先は小節内の有効な拍位置を指定してください。");
  }
  if (!Number.isInteger(durationTicks) || durationTicks <= 0) {
    throw new Error("音符の長さを移動先の分解能で表現できません。");
  }
  replaceDuration(document, clone, divisions, durationBeats);
  rippleFollowingVoice(
    document,
    destinationMeasure,
    targetTicks,
    durationTicks,
    staff,
    voice,
  );
  const baseline = positionMeasureCursor(document, destinationMeasure, targetTicks);
  const barline =
    Array.from(destinationMeasure.children).find(
      (child) => child.localName === "barline",
    ) ?? null;
  destinationMeasure.insertBefore(clone, barline);
  restoreMeasureCursor(
    document,
    destinationMeasure,
    targetTicks + durationTicks,
    baseline,
  );
  return new XMLSerializer().serializeToString(document);
}

export function moveNote(
  xml: string,
  target: EditableNote,
  partIndex: number,
  measureIndex: number,
  timestampBeats: number,
  pitchText: string | null,
  staff: number,
  voice: string,
): string {
  return normalizeOverflow(
    moveNoteElement(
      xml,
      target,
      partIndex,
      measureIndex,
      timestampBeats,
      pitchText,
      staff,
      voice,
    ),
    partIndex,
    measureIndex,
    staff,
    voice,
  );
}

export function moveDynamic(
  xml: string,
  target: EditableDynamic,
  partIndex: number,
  measureIndex: number,
  timestampBeats: number,
  staff: number,
): string {
  const document = parseDocument(xml);
  const { direction } = directionAt(document, target);
  const value = elements(direction, "dynamics")[0]?.firstElementChild?.localName;
  if (!value || !["p", "mp", "mf", "f", "sf"].includes(value)) {
    throw new Error("選択した強弱記号を移動できません。");
  }
  const clone = direction.cloneNode(true) as Element;
  setElementText(document, clone, "staff", String(staff));
  direction.remove();
  const destinationPart = partAt(document, partIndex);
  const destinationMeasure =
    destinationPart && measureElements(destinationPart)[measureIndex];
  if (!destinationPart || !destinationMeasure) {
    throw new Error("強弱記号を移動する小節が見つかりません。");
  }
  const divisions = ensureMeasureResolution(
    document,
    destinationPart,
    measureIndex,
    [timestampBeats],
  );
  const targetTicks = timestampBeats * divisions;
  if (!Number.isInteger(targetTicks) || targetTicks < 0) {
    throw new Error("移動先は小節内の有効な拍位置を指定してください。");
  }
  const baseline = positionMeasureCursor(document, destinationMeasure, targetTicks);
  const barline =
    Array.from(destinationMeasure.children).find(
      (child) => child.localName === "barline",
    ) ?? null;
  destinationMeasure.insertBefore(clone, barline);
  restoreMeasureCursor(document, destinationMeasure, targetTicks, baseline);
  return new XMLSerializer().serializeToString(document);
}

export function updateMetadata(xml: string, metadata: ScoreMetadata): string {
  if (
    !Number.isInteger(metadata.tempo) ||
    metadata.tempo < 20 ||
    metadata.tempo > 300 ||
    !Number.isInteger(metadata.beats) ||
    metadata.beats < 1 ||
    metadata.beats > 32 ||
    ![1, 2, 4, 8, 16].includes(metadata.beatType) ||
    !Number.isInteger(metadata.fifths) ||
    metadata.fifths < -7 ||
    metadata.fifths > 7
  ) {
    throw new Error("テンポ・拍子・調号の値を確認してください。");
  }

  const document = parseDocument(xml);
  const part = elements(document, "part")[0];
  const firstMeasure = part && measureElements(part)[0];
  if (!part || !firstMeasure) {
    throw new Error("譜面の最初の小節が見つかりません。");
  }

  let attributes = Array.from(firstMeasure.children).find(
    (child) => child.localName === "attributes",
  );
  if (!attributes) {
    attributes = document.createElementNS(part.namespaceURI, "attributes");
    firstMeasure.insertBefore(attributes, firstMeasure.firstChild);
  }
  let key = directChild(attributes, "key");
  if (!key) {
    key = document.createElementNS(part.namespaceURI, "key");
    attributes.insertBefore(key, directChild(attributes, "time") ?? null);
  }
  setElementText(document, key, "fifths", String(metadata.fifths));

  let time = directChild(attributes, "time");
  if (!time) {
    time = document.createElementNS(part.namespaceURI, "time");
    attributes.appendChild(time);
  }
  setElementText(document, time, "beats", String(metadata.beats));
  setElementText(document, time, "beat-type", String(metadata.beatType));

  const tempoSounds = elements(document, "sound").filter((item) =>
    item.hasAttribute("tempo"),
  );
  if (tempoSounds.length > 0) {
    for (const sound of tempoSounds) {
      sound.setAttribute("tempo", String(metadata.tempo));
    }
  }

  const firstMusicalEvent = Array.from(firstMeasure.children).find((child) =>
    ["note", "backup", "forward", "barline"].includes(child.localName),
  );
  const firstTempoSound = Array.from(firstMeasure.children)
    .filter((child) => child.localName === "direction")
    .flatMap((direction) => elements(direction, "sound"))
    .find((sound) => sound.hasAttribute("tempo"));
  const tempoIsAtScoreStart = firstTempoSound
    ? !firstMusicalEvent ||
      Boolean(
        (firstTempoSound.parentElement?.compareDocumentPosition(
          firstMusicalEvent,
        ) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
      )
    : false;

  if (!tempoIsAtScoreStart) {
    const direction = document.createElementNS(part.namespaceURI, "direction");
    const directionType = document.createElementNS(
      part.namespaceURI,
      "direction-type",
    );
    const metronome = document.createElementNS(part.namespaceURI, "metronome");
    const beatUnit = document.createElementNS(part.namespaceURI, "beat-unit");
    beatUnit.textContent = "quarter";
    const perMinute = document.createElementNS(part.namespaceURI, "per-minute");
    perMinute.textContent = String(metadata.tempo);
    metronome.append(beatUnit, perMinute);
    directionType.appendChild(metronome);
    direction.appendChild(directionType);
    const sound = document.createElementNS(part.namespaceURI, "sound");
    sound.setAttribute("tempo", String(metadata.tempo));
    direction.appendChild(sound);

    firstMeasure.insertBefore(direction, firstMusicalEvent ?? null);
  }
  for (const metronome of elements(document, "metronome")) {
    setElementText(
      document,
      metronome,
      "per-minute",
      String(metadata.tempo),
    );
  }
  return new XMLSerializer().serializeToString(document);
}

export function formatPitchOptions(): string[] {
  return Array.from({ length: 60 }, (_, index) => {
    const midi = 36 + index;
    return `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`;
  });
}
