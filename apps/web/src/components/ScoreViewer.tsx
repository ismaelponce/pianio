import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { nativeErrorMessage, renderMessage, type MessageDescriptor } from "../i18n/messages";
import { sourceLanguage, supportedLanguages } from "../i18n/language";

interface ScoreViewerProps { scorePath: string; matchedCount: number }
type LoadState = "loading" | "ready" | "error";
const ZOOM_MIN = 0.5, ZOOM_MAX = 1.8, ZOOM_STEP = 0.15;

export function englishScorePath(path: string): string | null {
  const match = path.match(/^\/generated\/([a-z-]+)\/scores\/[a-z0-9-]+\/[a-z0-9-]+\.musicxml$/);
  const locale = supportedLanguages.find(language => language === match?.[1]);
  return locale && locale !== sourceLanguage ? path.replace(`/generated/${locale}/`, `/generated/${sourceLanguage}/`) : null;
}

export function ScoreViewer({ scorePath, matchedCount }: ScoreViewerProps) {
  const { t } = useTranslation("practice");
  const { t: common } = useTranslation("common");
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const noteStepMapRef = useRef<number[]>([]);
  const matchedRef = useRef(matchedCount);
  matchedRef.current = matchedCount;
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<MessageDescriptor | null>(null);
  const [fallback, setFallback] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  function restoreCursor(osmd: OpenSheetMusicDisplay) {
    const map = noteStepMapRef.current;
    osmd.cursor.reset();
    if (matchedRef.current >= map.length) { osmd.cursor.hide(); return; }
    const target = map[matchedRef.current] ?? 0;
    for (let i = 0; i < target && !osmd.cursor.Iterator.EndReached; i++) osmd.cursor.next();
    osmd.cursor.show();
  }
  function fitInstructions() {
    // OSMD can place long directions outside its SVG viewBox. Extend the viewport,
    // without scaling the music, so the scroll region can expose the entire text.
    for (const svg of containerRef.current?.querySelectorAll("svg") ?? []) {
      const bounds = svg.getBBox();
      const box = svg.viewBox.baseVal;
      const right = Math.ceil(bounds.x + bounds.width + 16);
      if (right > box.width) {
        svg.setAttribute("width", String(right));
        svg.setAttribute("viewBox", `${box.x} ${box.y} ${right} ${box.height}`);
      }
    }
  }
  function rerender(osmd: OpenSheetMusicDisplay) {
    osmd.zoom = zoomRef.current;
    osmd.render();
    fitInstructions();
    restoreCursor(osmd);
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    const controller = new AbortController();
    osmdRef.current = null;
    setLoadState("loading");
    setErrorMessage(null);
    setFallback(false);

    async function load(path: string) {
      const response = await fetch(path, { signal: controller.signal });
      if (!response.ok) throw new Error(`Score HTTP ${response.status}`);
      const xml = await response.text();
      const document = new DOMParser().parseFromString(xml, "application/xml");
      if (document.querySelector("parsererror") || !["score-partwise", "score-timewise"].includes(document.documentElement.tagName)) throw new Error("Invalid MusicXML");
      if (cancelled) return null;
      // Each load owns its host: a late OSMD.load cannot replace a newer rendering.
      const host = window.document.createElement("div");
      host.style.width = `${container!.clientWidth}px`;
      const osmd = new OpenSheetMusicDisplay(host, { followCursor: true, drawTitle: false, drawSubtitle: false, drawComposer: false, drawLyricist: false, drawingParameters: "default" });
      await osmd.load(xml);
      return { host, osmd };
    }
    async function display(path: string) {
      const result = await load(path);
      if (cancelled || !result) return;
      const { host, osmd } = result;
      container!.replaceChildren(host);
      host.style.width = "100%";
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (cancelled) return;
      osmd.zoom = zoomRef.current;
      osmd.render();
      fitInstructions();
      osmd.cursor.reset();
      const map: number[] = [];
      let step = 0;
      while (!osmd.cursor.Iterator.EndReached) {
        if (osmd.cursor.NotesUnderCursor().some(n => !n.isRest())) map.push(step);
        step++;
        osmd.cursor.next();
      }
      noteStepMapRef.current = map;
      osmdRef.current = osmd;
      restoreCursor(osmd); // Current session position, even without another MIDI event.
    }
    void (async () => {
      try {
        let usedFallback = false;
        try { await display(scorePath); }
        catch (error) {
          const english = englishScorePath(scorePath);
          if (cancelled || !english) throw error;
          await display(english);
          usedFallback = true;
        }
        if (cancelled) return;
        setFallback(usedFallback);
        setLoadState("ready");
      } catch (error) {
        if (cancelled) return;
        container.replaceChildren();
        setErrorMessage(nativeErrorMessage(error, "score"));
        setLoadState("error");
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [scorePath, attempt]);

  useEffect(() => {
    if (loadState === "ready" && osmdRef.current) rerender(osmdRef.current);
  }, [zoom, loadState]);
  useEffect(() => {
    if (loadState === "ready" && osmdRef.current) restoreCursor(osmdRef.current);
  }, [matchedCount, loadState]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || loadState !== "ready") return;
    let lastWidth = container.offsetWidth;
    const observer = new ResizeObserver(() => {
      const width = container.offsetWidth;
      if (width > 0 && Math.abs(width - lastWidth) > 10) {
        lastWidth = width;
        if (osmdRef.current) rerender(osmdRef.current);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [loadState]);

  return <div className="score-viewer-wrap" aria-busy={loadState === "loading"}>
    {loadState === "loading" && <div className="score-skeleton" />}
    {(fallback || loadState === "error") && <div className="language-notice" role="status">
      {fallback ? common("language.scoreFallback") : errorMessage ? renderMessage(errorMessage) : t("ui.score.failed")}
      {" "}<button type="button" onClick={() => setAttempt(a => a + 1)}>{common(fallback ? "language.scoreRetry" : "language.retry")}</button>
    </div>}
    {loadState === "ready" && <div className="score-zoom-controls">
      <button className="score-zoom-btn" type="button" onClick={() => setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))} disabled={zoom <= ZOOM_MIN} title={t("ui.score.zoomOut")} aria-label={t("ui.score.zoomOut")}>−</button>
      <span className="score-zoom-label">{Math.round(zoom * 100)}%</span>
      <button className="score-zoom-btn" type="button" onClick={() => setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))} disabled={zoom >= ZOOM_MAX} title={t("ui.score.zoomIn")} aria-label={t("ui.score.zoomIn")}>+</button>
    </div>}
    <div ref={containerRef} className="score-viewer" data-score-scroll tabIndex={0} role="region" aria-label={t("ui.score.scroll")} />
    {loadState === "ready" && <p className="score-scroll-hint">{t("ui.score.scroll")}</p>}
  </div>;
}
