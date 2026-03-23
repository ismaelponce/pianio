import { useEffect, useRef, useState } from "react";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

interface ScoreViewerProps {
  scorePath: string;
  matchedCount: number;
}

type LoadState = "idle" | "loading" | "ready" | "error";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.8;
const ZOOM_STEP = 0.15;

export function ScoreViewer({ scorePath, matchedCount }: ScoreViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const noteStepMapRef = useRef<number[]>([]);
  const currentCursorStepRef = useRef<number>(0);

  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const zoomRef = useRef(1.0);

  // Helper: re-render OSMD at given zoom and restore cursor to current step
  const rerender = (osmd: OpenSheetMusicDisplay, zoomLevel: number) => {
    osmd.zoom = zoomLevel;
    osmd.render();
    osmd.cursor.show();
    osmd.cursor.reset();
    for (let i = 0; i < currentCursorStepRef.current; i++) {
      if (!osmd.cursor.Iterator.EndReached) osmd.cursor.next();
    }
  };

  // Main effect: load and render score when scorePath changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;

    // Clear any previous OSMD rendering before starting fresh
    osmdRef.current = null;
    container.innerHTML = "";
    noteStepMapRef.current = [];
    currentCursorStepRef.current = 0;

    setLoadState("loading");
    setErrorMessage(null);

    const osmd = new OpenSheetMusicDisplay(container, {
      followCursor: true,
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawingParameters: "default",
    });
    osmdRef.current = osmd;

    const run = async () => {
      let xml: string;

      try {
        const response = await fetch(scorePath);
        if (!response.ok) {
          throw new Error(`Failed to fetch score: ${response.status} ${response.statusText}`);
        }
        xml = await response.text();
      } catch (err) {
        if (!cancelled) {
          setLoadState("error");
          setErrorMessage(err instanceof Error ? err.message : "Failed to load score");
        }
        return;
      }

      if (cancelled) {
        return;
      }

      try {
        await osmd.load(xml);

        if (cancelled) {
          return;
        }

        // Wait for browser layout so the container has its real width before OSMD renders.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

        if (cancelled) {
          return;
        }

        osmd.zoom = zoomRef.current;
        osmd.render();
        osmd.cursor.show();

        // Build noteStepMap by stepping through cursor positions
        const noteStepMap: number[] = [];
        let stepCount = 0;

        osmd.cursor.reset();

        while (!osmd.cursor.Iterator.EndReached) {
          const notes = osmd.cursor.NotesUnderCursor();
          if (notes.length > 0 && notes.some((n) => !n.isRest())) {
            noteStepMap.push(stepCount);
          }
          stepCount++;
          if (!osmd.cursor.Iterator.EndReached) {
            osmd.cursor.next();
          }
        }

        noteStepMapRef.current = noteStepMap;

        // Reset cursor and advance to first actual note
        osmd.cursor.reset();
        currentCursorStepRef.current = 0;

        if (noteStepMap.length > 0) {
          const target = noteStepMap[0];
          for (let i = 0; i < target; i++) {
            if (!osmd.cursor.Iterator.EndReached) {
              osmd.cursor.next();
            }
          }
          currentCursorStepRef.current = target;
        }

        if (!cancelled) {
          setLoadState("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setLoadState("error");
          setErrorMessage(err instanceof Error ? err.message : "Failed to render score");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [scorePath]);

  // Effect: re-render when zoom changes (after score is ready)
  useEffect(() => {
    zoomRef.current = zoom;
    if (loadState !== "ready") return;
    const osmd = osmdRef.current;
    if (!osmd) return;
    rerender(osmd, zoom);
  }, [zoom, loadState]);

  // Effect: re-render score when container width changes (sidebar toggle, window resize)
  useEffect(() => {
    if (loadState !== "ready") return;
    const container = containerRef.current;
    const osmd = osmdRef.current;
    if (!container || !osmd) return;

    let lastWidth = container.offsetWidth;
    const observer = new ResizeObserver(() => {
      const width = container.offsetWidth;
      if (width > 0 && Math.abs(width - lastWidth) > 10) {
        lastWidth = width;
        rerender(osmd, zoomRef.current);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [loadState]);

  // Effect: sync cursor when matchedCount changes (after score is ready)
  useEffect(() => {
    if (loadState !== "ready") {
      return;
    }

    const osmd = osmdRef.current;
    if (!osmd) {
      return;
    }

    const noteStepMap = noteStepMapRef.current;

    if (matchedCount >= noteStepMap.length) {
      // Exercise complete — hide cursor
      osmd.cursor.hide();
      return;
    }

    osmd.cursor.show();

    const target = noteStepMap[matchedCount];
    const current = currentCursorStepRef.current;

    if (target === current) {
      return;
    }

    if (target > current) {
      // Advance forward
      const steps = target - current;
      for (let i = 0; i < steps; i++) {
        if (!osmd.cursor.Iterator.EndReached) {
          osmd.cursor.next();
        }
      }
      currentCursorStepRef.current = target;
    } else {
      // target < current: reset then advance to target
      osmd.cursor.reset();
      currentCursorStepRef.current = 0;
      for (let i = 0; i < target; i++) {
        if (!osmd.cursor.Iterator.EndReached) {
          osmd.cursor.next();
        }
      }
      currentCursorStepRef.current = target;
    }
  }, [matchedCount, loadState]);

  return (
    <div className="score-viewer-wrap">
      {loadState === "loading" && (
        <div className="score-skeleton" />
      )}
      {loadState === "error" && (
        <div className="score-placeholder">{errorMessage ?? "Failed to load score"}</div>
      )}
      {loadState === "ready" && (
        <div className="score-zoom-controls">
          <button
            className="score-zoom-btn"
            type="button"
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
            disabled={zoom <= ZOOM_MIN}
            title="Zoom out"
          >−</button>
          <span className="score-zoom-label">{Math.round(zoom * 100)}%</span>
          <button
            className="score-zoom-btn"
            type="button"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
            disabled={zoom >= ZOOM_MAX}
            title="Zoom in"
          >+</button>
        </div>
      )}
      {/* Container is always in the DOM so OSMD can measure its real width.
          It's empty (height 0) until render() fills it with SVG. */}
      <div ref={containerRef} className="score-viewer" />
    </div>
  );
}
