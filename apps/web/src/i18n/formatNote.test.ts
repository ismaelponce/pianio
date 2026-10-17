import { describe, expect, it } from "vitest";
import { formatNote, formatNoteName } from "./formatNote";

describe("UI note formatting", () => {
  it("formats middle C and both ends of the MIDI range", () => {
    expect(formatNote(60)).toBe("C4");
    expect(formatNote(0)).toBe("C-1");
    expect(formatNote(127)).toBe("G9");
  });

  it("keeps the existing sharp spellings without enharmonic conversion", () => {
    expect(formatNote(61)).toBe("C#4");
    expect(formatNoteName(66)).toBe("F#");
  });

  it("reports invalid values without treating them as MIDI notes", () => {
    expect(formatNote(-1)).toBe("Note -1");
    expect(formatNote(128)).toBe("Note 128");
    expect(formatNote(60.5)).toBe("Note 60.5");
    expect(formatNote(Number.NaN)).toBe("Note NaN");
  });
});
