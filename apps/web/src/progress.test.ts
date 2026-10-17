import { afterEach, describe, expect, it, vi } from "vitest";
import { exportProgress, getBestStars, getCompletedCount, importProgress, isExerciseComplete, resetProgress, type ProgressExport } from "./progress";
import legacyFixture from "./fixtures/progress-v1.baseline.json";
import { i18n, initializeI18n } from "./i18n";
import { importProgressMessage, renderMessage } from "./i18n/messages";

describe("structured progress import", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a coded JSON parse failure", () => {
    expect(importProgress("{" )).toMatchObject({ outcome: "failure", code: "progress.import.invalid-json", ok: false });
  });

  it("returns a coded unsupported format failure", () => {
    expect(importProgress(JSON.stringify({ version: 2 }))).toMatchObject({ outcome: "failure", code: "progress.import.unsupported-format", ok: false });
  });

  it("imports version 1 data and reports the completed exercise count", () => {
    const legacyExport: ProgressExport = {
      version: 1, exportedAt: "2025-01-01T00:00:00.000Z", completed: ["course/a", "course/b"],
      stars: { "course/a": 3 }, streakDates: ["2025-01-01"],
    };
    expect(importProgress(JSON.stringify(legacyExport))).toMatchObject({
      outcome: "success", code: "progress.import.success", params: { importedCount: 2 }, ok: true,
    });
    expect(localStorage.getItem("pianio:completed")).toBe(JSON.stringify(legacyExport.completed));
    expect(localStorage.getItem("pianio:stars")).toBe(JSON.stringify(legacyExport.stars));
  });

  it("reports storage write failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });
    expect(importProgress(JSON.stringify({ version: 1, completed: [] }))).toMatchObject({ outcome: "failure", code: "progress.import.storage-write-failed", ok: false });
  });

  it("round-trips the synthetic baseline v1 fixture in the source language", async () => {
    await initializeI18n("en");
    await i18n.changeLanguage("en");
    localStorage.setItem("pianio:language", "en");
    localStorage.setItem("pianio:dark", "1");
    const result = importProgress(JSON.stringify(legacyFixture));
    expect(result.ok).toBe(true);
    expect(renderMessage(importProgressMessage(result), "en")).toBe("Imported 2 completed exercises.");
    expect(getCompletedCount("method-level-1a")).toBe(2);
    expect(isExerciseComplete("method-level-1a", "single-c-pulse")).toBe(true);
    expect(getBestStars("method-level-1a", "single-c-pulse")).toBe(3);
    expect(getBestStars("method-level-1a", "c-and-d")).toBe(2);
    expect(JSON.parse(localStorage.getItem("pianio:streak_dates")!)).toEqual(legacyFixture.streakDates);
    let exported: Blob | undefined;
    vi.stubGlobal("URL", { createObjectURL: (blob: Blob) => { exported = blob; return "blob:test"; }, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    exportProgress();
    const json = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(exported!);
    });
    expect(JSON.parse(json)).toEqual({ ...legacyFixture, exportedAt: expect.any(String) });
    resetProgress();
    expect(getCompletedCount("method-level-1a")).toBe(0);
    expect(getBestStars("method-level-1a", "single-c-pulse")).toBeNull();
    expect(localStorage.getItem("pianio:streak_dates")).toBeNull();
    expect(localStorage.getItem("pianio:language")).toBe("en");
    expect(localStorage.getItem("pianio:dark")).toBe("1");
    expect(importProgress(json).ok).toBe(true);
    expect(getCompletedCount("method-level-1a")).toBe(2);
  });
});
