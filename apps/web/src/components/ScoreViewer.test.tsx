import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../content/catalogFixture";
import { initializeI18n, i18n } from "../i18n";
import { ScoreViewer } from "./ScoreViewer";

const mock = vi.hoisted(() => ({ instances: [] as any[], waits: new Map<string, Promise<void>>() }));
vi.mock("opensheetmusicdisplay", () => ({ OpenSheetMusicDisplay: class {
  zoom = 1; position = 0; host: HTMLElement; xml = "";
  cursor = {
    Iterator: { EndReached: false },
    reset: () => { this.position = 0; this.cursor.Iterator.EndReached = false; this.paint(); },
    next: () => { this.position++; this.cursor.Iterator.EndReached = this.position >= 5; this.paint(); },
    show: () => { this.host.dataset.hidden = "false"; this.paint(); },
    hide: () => { this.host.dataset.hidden = "true"; },
    NotesUnderCursor: () => [{ isRest: () => false }],
  };
  constructor(host: HTMLElement) { this.host = host; mock.instances.push(this); }
  async load(xml: string) { this.xml = xml; await mock.waits.get(xml); }
  paint() { this.host.dataset.position = String(this.position); }
  render() { if (this.xml.includes("Bad rendering")) throw Error("render failed"); this.host.dataset.zoom = String(this.zoom); this.host.textContent = this.xml; }
} }));
const en = "/generated/en/scores/method-level-1a/one.musicxml";
const alternateScorePath = "/generated/en/scores/method-level-1a/two.musicxml";
const xml = (score: string) => `<score-partwise><work><work-title>${score}</work-title></work></score-partwise>`;
beforeAll(() => initializeI18n("en"));
beforeEach(async () => {
  await i18n.changeLanguage("en"); mock.instances.length = 0; mock.waits.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(callback, 0));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("score continuity", () => {
  it("restores zoom and current session cursor after replacement with no new MIDI event", async () => {
    vi.stubGlobal("fetch", vi.fn(async (path: string) => new Response(xml(path))));
    const view = render(<ScoreViewer scorePath={en} matchedCount={3} />);
    await screen.findByRole("button", { name: "Zoom in" });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(mock.instances[0].host.dataset).toMatchObject({ position: "3", zoom: "1.15" });
    view.rerender(<ScoreViewer scorePath={alternateScorePath} matchedCount={3} />);
    await waitFor(() => expect(mock.instances[1]?.host.isConnected).toBe(true));
    await waitFor(() => expect(mock.instances[1].host.dataset).toMatchObject({ position: "3", zoom: "1.15", hidden: "false" }));
    expect(screen.getByText("115%")).toBeTruthy();
  });

  it("ignores stale score loads, restores latest position and keeps completed cursors hidden", async () => {
    vi.stubGlobal("fetch", vi.fn(async (path: string) => new Response(xml(path))));
    const slow = deferred<void>(); mock.waits.set(xml(alternateScorePath), slow.promise);
    const view = render(<ScoreViewer scorePath={en} matchedCount={2} />);
    await screen.findByRole("button", { name: "Zoom in" });
    view.rerender(<ScoreViewer scorePath={alternateScorePath} matchedCount={2} />);
    await waitFor(() => expect(mock.instances).toHaveLength(2));
    view.rerender(<ScoreViewer scorePath={en} matchedCount={5} />);
    await screen.findByRole("button", { name: "Zoom in" });
    await act(async () => { slow.resolve(); });
    expect(mock.instances[1].host.isConnected).toBe(false);
    expect(mock.instances[2].host.isConnected).toBe(true);
    expect(mock.instances[2].host.dataset.hidden).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(mock.instances[2].host.dataset.hidden).toBe("true");
  });
});
