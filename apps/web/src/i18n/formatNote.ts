import type { Language } from "./language";

const NOTE_NAMES: Record<Language, readonly string[]> = {
  en: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],
};
const INVALID_NOTE_LABEL: Record<Language, string> = { en: "Note" };

/** UI note spelling. MIDI numbers and enharmonic spelling remain unchanged. */
export function formatNote(midi: number, language: Language = "en"): string {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) return `${INVALID_NOTE_LABEL[language]} ${midi}`;
  return `${NOTE_NAMES[language][midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function formatNoteName(midi: number, language: Language = "en"): string {
  const formatted = formatNote(midi, language);
  return Number.isInteger(midi) && midi >= 0 && midi <= 127
    ? formatted.slice(0, -String(Math.floor(midi / 12) - 1).length)
    : formatted;
}
