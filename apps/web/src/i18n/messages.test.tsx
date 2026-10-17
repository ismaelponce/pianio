import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initializeI18n, i18n } from "./index";
import { nativeErrorMessage, renderMessage } from "./messages";

describe("message descriptors", () => {
  it("maps known native MIDI error names and keeps original details separately", () => {
    expect(nativeErrorMessage(new DOMException("Permission denied by browser", "NotAllowedError"), "midi"))
      .toMatchObject({ namespace: "diagnostics", key: "midi.error.permission-denied", technicalDetail: "Permission denied by browser" });
    expect(nativeErrorMessage(new Error("opaque platform text"), "midi"))
      .toMatchObject({ key: "midi.error.unknown", technicalDetail: "opaque platform text" });
  });

  it("normalizes network and HTTP failures while retaining transport details", () => {
    expect(nativeErrorMessage(new Error("Catalog request failed with 503"), "catalog"))
      .toMatchObject({ namespace: "catalog", key: "catalog.error.http", params: { status: 503 } });
    expect(nativeErrorMessage(new TypeError("Failed to fetch"), "score"))
      .toMatchObject({ namespace: "practice", key: "score.error.network", technicalDetail: "Failed to fetch" });
  });

  it("renders a stable message descriptor from the active resources", async () => {
    await initializeI18n("en");
    const message = { namespace: "progress" as const, key: "progress.import.success", params: { importedCount: 2 } };
    render(<div role="status">{renderMessage(message, "en")}</div>);
    expect(screen.getByRole("status").textContent).toBe("Imported 2 completed exercises.");
  });

  it("formats zero, singular, and plural counts from the source dictionaries", async () => {
    await initializeI18n("en");
    expect(i18n.t("ui.exercises", { ns: "catalog", count: 0 })).toBe("0 exercises");
    expect(i18n.t("ui.exercises", { ns: "catalog", count: 1 })).toBe("1 exercise");
    expect(i18n.t("ui.exercises", { ns: "catalog", count: 8 })).toBe("8 exercises");
    expect(i18n.t("ui.dayStreak", { ns: "progress", count: 0 })).toBe("0 day streak");
    expect(i18n.t("ui.dayStreak", { ns: "progress", count: 1 })).toBe("1 day streak");
    expect(i18n.t("ui.dayStreak", { ns: "progress", count: 5 })).toBe("5 day streak");
  });
});
