import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogCourse, CatalogExercise, GeneratedCatalog } from "@pianio/content-schema";
import { getBestStars, getCompletedCount, getCompletedSlugs, getPracticeStreak, isExerciseComplete, recordPracticeDay, exportProgress, importProgress, resetProgress } from "./progress";
import { describeMidiSupport } from "@pianio/midi-web";
import { importProgressMessage, midiSupportMessages, renderMessage, type MessageDescriptor } from "./i18n/messages";
import { LanguageSelector } from "./components/LanguageSelector";
import { useLanguage } from "./i18n/LanguageProvider";
import { isEditingTarget } from "./i18n/shortcuts";
import { sourceLanguage, supportedLanguages } from "./i18n/language";
import { readPreference, savePreference } from "./storage";
import { startAudio } from "./audio/pianoSampler";
import { DiagnosticsScreen } from "./screens/DiagnosticsScreen";
import {
  Check,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Sun,
  Moon,
  Settings,
  Music,
  Music2,
  Music4,
  Github,
  ExternalLink,
  Keyboard,
} from "lucide-react";

const ExercisePracticePanelLazy = lazy(() =>
  import("./components/ExercisePracticePanel").then((m) => ({ default: m.ExercisePracticePanel }))
);

// Musical navigation: map shelf cell position to MIDI note
// Level 1: C4-A4 ascending, Level 2: C4,E4,G4,C5,E5 arpeggiated, Level 3+: transposed up
const LEVEL_NOTES: Record<number, number[]> = {
  1: [60, 62, 64, 65, 67, 69],      // C4, D4, E4, F4, G4, A4
  2: [60, 64, 67, 72, 76],           // C4, E4, G4, C5, E5
  3: [72, 74, 76, 77, 79, 81],       // C5, D5, E5, F5, G5, A5
  4: [72, 76, 79, 84, 88],           // C5, E5, G5, C6, E6
  5: [84, 86, 88, 89, 91, 93],       // C6, D6, E6, F6, G6, A6
  6: [84, 88, 91, 96, 100],          // C6, E6, G6, C7, E7
};

let hoverNoteModule: typeof import("./audio/pianoSampler") | null = null;

function playShelfNote(level: number, cellIndex: number): void {
  const notes = LEVEL_NOTES[level] ?? LEVEL_NOTES[1];
  const midiNote = notes[cellIndex % notes.length];
  if (hoverNoteModule) {
    hoverNoteModule.playHoverNote(midiNote);
  } else {
    import("./audio/pianoSampler").then((mod) => {
      hoverNoteModule = mod;
      mod.playHoverNote(midiNote);
    });
  }
}

const STAR_D = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";

function useScrollReveal() {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const setup = useCallback((container: HTMLElement | null) => {
    if (!container) return;
    if (observerRef.current) observerRef.current.disconnect();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -60px 0px", threshold: 0.1 }
    );
    observerRef.current = io;
    for (const el of container.querySelectorAll(".scroll-reveal")) {
      io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return setup;
}

const TROPHY_D = "M6.5 2h11v1.5h2.5v4c0 1.38-1.12 2.5-2.5 2.5h-.6A5.5 5.5 0 0112 14.9V17h3v2H9v-2h3v-2.1A5.5 5.5 0 017.1 10H6.5A2.5 2.5 0 014 7.5v-4h2.5V2zm0 3H6v2.5a.5.5 0 00.5.5h.5c-.3-.9-.5-1.9-.5-3zm11 0V8h.5a.5.5 0 00.5-.5V5h-1z";

function TrophyIcon({ variant = "gold", size = 22 }: { variant?: "gold" | "silver" | "bronze"; size?: number }) {
  const colors = { gold: "#FFC857", silver: "#A8B0B5", bronze: "#C4956A" };
  return (
    <svg className={`trophy-icon trophy-${variant}`} width={size} height={size} viewBox="0 0 24 24" fill={colors[variant]}>
      <path d={TROPHY_D} />
    </svg>
  );
}

function PianioMascot({ height = 200 }: { height?: number }) {
  const width = Math.round(height * (200 / 236));
  return (
    <svg
      className="mascot"
      viewBox="0 0 200 236"
      width={width}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ overflow: 'visible' }}
    >
      {/* Right arm (behind body) */}
      <path d="M150 120 C158 134 161 150 157 166" stroke="#2D2D2D" strokeWidth="14" strokeLinecap="round" fill="none"/>
      <path d="M150 120 C158 134 161 150 157 166" stroke="#3B9AB2" strokeWidth="10" strokeLinecap="round" fill="none"/>

      {/* Legs */}
      <path d="M76 143 L70 197" stroke="#2D2D2D" strokeWidth="16" strokeLinecap="round" fill="none"/>
      <path d="M76 143 L70 197" stroke="#3B9AB2" strokeWidth="12" strokeLinecap="round" fill="none"/>
      <path d="M122 143 L128 197" stroke="#2D2D2D" strokeWidth="16" strokeLinecap="round" fill="none"/>
      <path d="M122 143 L128 197" stroke="#3B9AB2" strokeWidth="12" strokeLinecap="round" fill="none"/>

      {/* Shoes */}
      <ellipse cx="64" cy="204" rx="16" ry="9" fill="white" stroke="#2D2D2D" strokeWidth="2.5"/>
      <ellipse cx="134" cy="204" rx="16" ry="9" fill="white" stroke="#2D2D2D" strokeWidth="2.5"/>

      {/* Body 3D shadow */}
      <rect x="36" y="99" width="118" height="48" rx="5" fill="#2D7A8E" stroke="#2D2D2D" strokeWidth="2.5"/>

      {/* Left arm — waves once then drops to resting position */}
      <g>
        <animateTransform
          attributeName="transform"
          type="rotate"
          values="0 40 120;-20 40 120;5 40 120;-20 40 120;5 40 120;-20 40 120;0 40 120"
          keyTimes="0;0.12;0.24;0.36;0.48;0.6;1"
          dur="1.5s"
          repeatCount="1"
          fill="freeze"
        />
        <path d="M40 120 C30 110 20 100 12 92" stroke="#2D2D2D" strokeWidth="14" strokeLinecap="round" fill="none">
          <animate attributeName="d" from="M40 120 C30 110 20 100 12 92" to="M40 120 C32 134 29 150 33 166" begin="1.5s" dur="0.6s" fill="freeze"/>
        </path>
        <path d="M40 120 C30 110 20 100 12 92" stroke="#3B9AB2" strokeWidth="10" strokeLinecap="round" fill="none">
          <animate attributeName="d" from="M40 120 C30 110 20 100 12 92" to="M40 120 C32 134 29 150 33 166" begin="1.5s" dur="0.6s" fill="freeze"/>
        </path>
      </g>

      {/* Stem */}
      <rect x="143" y="25" width="7" height="73" rx="1" fill="#3B9AB2" stroke="#2D2D2D" strokeWidth="2.5"/>

      {/* Body */}
      <rect x="32" y="95" width="118" height="48" rx="5" fill="#3B9AB2" stroke="#2D2D2D" strokeWidth="2.5"/>

      {/* Flag */}
      <path d="M147 26 C151 16 178 14 183 32 C186 46 168 50 150 54 Z" fill="#E8B84B" stroke="#2D2D2D" strokeWidth="2.5" strokeLinejoin="round"/>

      {/* Left eye */}
      <ellipse cx="76" cy="113" rx="13" ry="14" fill="white" stroke="#2D2D2D" strokeWidth="2.2"/>
      <circle cx="73" cy="110" r="6.5" fill="#2D2D2D"/>
      <circle cx="71" cy="108" r="2.2" fill="white"/>

      {/* Right eye */}
      <ellipse cx="114" cy="113" rx="13" ry="14" fill="white" stroke="#2D2D2D" strokeWidth="2.2"/>
      <circle cx="111" cy="110" r="6.5" fill="#2D2D2D"/>
      <circle cx="109" cy="108" r="2.2" fill="white"/>

      {/* Mouth */}
      <path d="M88 130 Q95 137 102 130" stroke="#2D2D2D" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

function InlineStars({ count, size = 12 }: { count: 1 | 2 | 3; size?: number }) {
  return (
    <span className="star-rating">
      {[1, 2, 3].map((i) => (
        <svg key={i} className={`star-icon${i <= count ? " star-icon-filled" : ""}`} width={size} height={size} viewBox="0 0 24 24"
          fill={i <= count ? "#FFC857" : "none"} stroke={i <= count ? "none" : "#D9B382"} strokeWidth="1.5">
          <path d={STAR_D} />
        </svg>
      ))}
    </span>
  );
}


type Route =
  | { screen: "catalog" }
  | { screen: "diagnostics" }
  | { screen: "progress" }
  | { screen: "course"; courseId: string }
  | { screen: "exercise"; courseId: string; exerciseSlug: string }
  | { screen: "notfound" };

function parseRoute(hash: string): Route {
  const trimmed = hash.replace(/^#\/?/, "").replace(/\/+$/, "");

  if (!trimmed) {
    return { screen: "catalog" };
  }

  if (trimmed === "diagnostics") {
    return { screen: "diagnostics" };
  }

  if (trimmed === "progress") {
    return { screen: "progress" };
  }

  const segments = trimmed.split("/").map(decodeURIComponent);

  if (segments[0] !== "courses") {
    return { screen: "notfound" };
  }

  if (segments.length === 1) {
    return { screen: "catalog" };
  }

  if (segments.length === 2) {
    return { screen: "course", courseId: segments[1] };
  }

  if (segments.length === 4 && segments[2] === "exercises") {
    return {
      screen: "exercise",
      courseId: segments[1],
      exerciseSlug: segments[3]
    };
  }

  return { screen: "notfound" };
}

function getCatalogHref() {
  return "#/courses";
}

function getProgressHref() {
  return "#/progress";
}

function getCourseHref(courseId: string) {
  return `#/courses/${encodeURIComponent(courseId)}`;
}

function getExerciseHref(courseId: string, exerciseSlug: string) {
  return `${getCourseHref(courseId)}/exercises/${encodeURIComponent(exerciseSlug)}`;
}

function formatHands(value: CatalogExercise["hands"], t: (key: string) => string) {
  return t(value === "together" ? "practice:ui.hand.together" : value === "left" ? "practice:ui.hand.left" : "practice:ui.hand.right");
}

function formatClef(value: CatalogExercise["clef"], t: (key: string) => string) {
  return t(value === "G" ? "practice:ui.clef.treble" : String(value) === "GF" ? "practice:ui.clef.grand" : "practice:ui.clef.bass");
}

function formatSourceKind(value: CatalogExercise["sourceKind"], t: (key: string) => string) {
  const keys: Record<CatalogExercise["sourceKind"], string> = { original: "original", public_domain: "public_domain", open_license: "open_license" };
  return t(`catalog:ui.source.${keys[value]}`);
}

function formatCategory(value: string, t: (key: string) => string) {
  const categoryKeys: Record<string, string> = {
    baroque: "baroque", celtic: "celtic", children: "children", christian: "christian", classical: "classical",
    dance: "dance", festive: "festive", folk: "folk", "jazz-blues": "jazzBlues", latin: "latin",
    lullaby: "lullaby", march: "march", meditation: "meditation", patriotic: "patriotic", ragtime: "ragtime",
    "romantic-era": "romanticEra", waltz: "waltz", world: "world", "film-tv": "filmTv", opera: "opera", "sea-shanty": "seaShanty", "musical-theater": "musicalTheater"
  };
  return t(`catalog:ui.category.${categoryKeys[value] ?? "other"}`);
}

function formatTimeSignature([top, bottom]: CatalogExercise["timeSignature"]) {
  return `${top}/${bottom}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getResumeTarget(catalog: GeneratedCatalog): { href: string; label: string; courseTitle: string } {
  for (const course of catalog.courses) {
    for (const exercise of course.exercises) {
      if (!isExerciseComplete(course.id, exercise.slug)) {
        return {
          href: getExerciseHref(course.id, exercise.slug),
          label: exercise.title,
          courseTitle: course.title
        };
      }
    }
  }
  // All complete - loop back to first
  const first = catalog.courses[0].exercises[0];
  return {
    href: getExerciseHref(catalog.courses[0].id, first.slug),
    label: first.title,
    courseTitle: catalog.courses[0].title
  };
}

function findCourse(catalog: GeneratedCatalog | null, courseId: string) {
  return catalog?.courses.find((course) => course.id === courseId) ?? null;
}

function findExercise(course: CatalogCourse | null, exerciseSlug: string) {
  return course?.exercises.find((exercise) => exercise.slug === exerciseSlug) ?? null;
}

type CourseGroup = { label: string; courses: CatalogCourse[] };

function groupCourses(courses: CatalogCourse[]): CourseGroup[] {
  const groups: Record<string, CourseGroup> = {
    method: { label: "method", courses: [] },
    technique: { label: "technique", courses: [] },
    songs: { label: "songs", courses: [] },
    other: { label: "other", courses: [] }
  };
  for (const course of courses) {
    if (course.id.startsWith("method")) groups.method.courses.push(course);
    else if (course.id.startsWith("technique")) groups.technique.courses.push(course);
    else if (course.id.startsWith("songs")) groups.songs.courses.push(course);
    else groups.other.courses.push(course);
  }
  return Object.values(groups).filter((g) => g.courses.length > 0);
}

function courseCategory(id: string): "method" | "technique" | "songs" {
  if (id.startsWith("method")) return "method";
  if (id.startsWith("technique")) return "technique";
  return "songs";
}

const RING_R = 19;
const RING_C = 2 * Math.PI * RING_R;

function ProgressRing({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? done / total : 0;
  const offset = RING_C * (1 - pct);
  return (
    <div className="progress-ring">
      <svg viewBox="0 0 48 48">
        <circle className="progress-ring-bg" cx="24" cy="24" r={RING_R} />
        <circle className="progress-ring-fill" cx="24" cy="24" r={RING_R}
          strokeDasharray={RING_C} strokeDashoffset={offset} />
      </svg>
      <span className="progress-ring-text">
        {done > 0 ? `${Math.round(pct * 100)}%` : total}
      </span>
    </div>
  );
}

/* ── Shelf Grid (compact level×sublevel grid) ── */

type ShelfCell = {
  course: CatalogCourse;
  label: string;
  done: number;
  total: number;
};

type ShelfRow = {
  level: number;
  parent: CatalogCourse | null;
  cells: (ShelfCell | null)[];
};

function parseCourseLevel(id: string): { level: number; sublevel: string | null } | null {
  const match = id.match(/level-(\d+)([a-e])?$/);
  if (!match) return null;
  return { level: parseInt(match[1]), sublevel: match[2] || null };
}

function buildShelfRows(courses: CatalogCourse[]): ShelfRow[] {
  const levels = new Map<number, ShelfRow>();
  for (const course of courses) {
    const parsed = parseCourseLevel(course.id);
    if (!parsed) continue;
    if (!levels.has(parsed.level)) {
      levels.set(parsed.level, { level: parsed.level, parent: null, cells: [null, null, null, null, null] });
    }
    const row = levels.get(parsed.level)!;
    if (parsed.sublevel) {
      const idx = parsed.sublevel.charCodeAt(0) - 97;
      row.cells[idx] = {
        course,
        label: `${parsed.level}${parsed.sublevel.toUpperCase()}`,
        done: getCompletedCount(course.id),
        total: course.exerciseCount
      };
    } else {
      row.parent = course;
    }
  }
  return Array.from(levels.values()).sort((a, b) => a.level - b.level);
}

function ShelfCellTile({ cell, cellIndex = 0, level = 1 }: { cell: ShelfCell; cellIndex?: number; level?: number }) {
  const { t: translate, i18n } = useTranslation();
  const t = translate as (key: string, options?: Record<string, unknown>) => string;
  const pct = cell.total > 0 ? cell.done / cell.total : 0;
  const status = pct === 1 ? "complete" : pct > 0 ? "progress" : "pending";
  const trophyVariant = status === "complete" ? "gold" as const : status === "progress" ? "silver" as const : "bronze" as const;
  const levelTier = level <= 2 ? "beginner" : level <= 4 ? "intermediate" : "mastery";
  const bestStars = (() => {
    let s3 = 0;
    for (const ex of cell.course.exercises) {
      if (getBestStars(cell.course.id, ex.slug) === 3) s3++;
    }
    return s3;
  })();
  return (
    <a
      className={`shelf-cell shelf-${status} shelf-tier-${levelTier}`}
      href={getCourseHref(cell.course.id)}
      title={t("catalog:ui.cellTooltip", { title: cell.course.title, done: new Intl.NumberFormat(i18n.language).format(cell.done), count: cell.total })}
      style={{ '--fill-pct': status === "progress" ? Math.round(pct * 100) + '%' : undefined, '--cell-idx': cellIndex } as React.CSSProperties}
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
        e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
      }}
      onMouseEnter={() => playShelfNote(level, cellIndex)}
    >
      <span className="hover-note" aria-hidden="true" />
      <TrophyIcon variant={trophyVariant} size={26} />
      <span className="shelf-cell-label">{cell.label}</span>
      {cell.done > 0 && (
        <span className="shelf-cell-fraction">{cell.done}/{cell.total}</span>
      )}
      {bestStars > 0 && (
        <span className="shelf-cell-stars">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="#FFC857"><path d={STAR_D} /></svg>
          {bestStars}
        </span>
      )}
      <div className="shelf-cell-bar">
        <div className="shelf-cell-bar-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
    </a>
  );
}

function ShelfGrid({ courses, title, category }: { courses: CatalogCourse[]; title: string; category: "method" | "technique" }) {
  const { t: translate, i18n } = useTranslation();
  const t = translate as (key: string, options?: Record<string, unknown>) => string;
  const rows = buildShelfRows(courses);
  const totalDone = courses.reduce((t, c) => t + getCompletedCount(c.id), 0);
  const totalExercises = courses.reduce((t, c) => t + c.exerciseCount, 0);
  const pctOverall = totalExercises > 0 ? Math.round((totalDone / totalExercises) * 100) : 0;

  // Determine max columns with actual cells
  const maxCols = Math.max(...rows.map(r => {
    let max = 0;
    r.cells.forEach((c, i) => { if (c) max = i + 1; });
    return max;
  }), 0);
  const colHeaders = ["A", "B", "C", "D", "E"].slice(0, maxCols);
  const COL_HINTS: Record<string, string> = { A: t("catalog:ui.col.foundations"), B: t("catalog:ui.col.building"), C: t("catalog:ui.col.combined"), D: t("catalog:ui.col.applied"), E: t("catalog:ui.col.mastery") };

  return (
    <section className={`shelf-section panel shelf-${category}`}>
      <div className="shelf-header">
        <div>
          <h3 className="shelf-title" title={category === "method" ? t("catalog:ui.titleMethod") : t("catalog:ui.titleTechnique")}>{title}</h3>
          <span className="shelf-stats">{totalDone > 0 ? t("catalog:ui.progressStats", { done: new Intl.NumberFormat(i18n.language).format(totalDone), count: totalExercises, percent: new Intl.NumberFormat(i18n.language).format(pctOverall) }) : t("catalog:ui.exercises", { count: totalExercises })}</span>
        </div>
        <div className="shelf-header-bar">
          <div className="shelf-header-bar-fill" style={{ width: `${pctOverall}%` }} />
        </div>
      </div>
      <div className="shelf-grid" style={{ gridTemplateColumns: `48px repeat(${maxCols}, 1fr)` }}>
        {/* Column headers */}
        <div className="shelf-corner" />
        {colHeaders.map(h => (
          <div key={h} className="shelf-col-header" title={COL_HINTS[h]}>{h}</div>
        ))}

        {/* Rows */}
        {rows.map((row, rowIdx) => {
          const hasCells = row.cells.some(c => c !== null);

          if (!hasCells && row.parent) {
            // Full-width row for single courses (e.g. technique-level-3)
            const done = getCompletedCount(row.parent.id);
            const pct = row.parent.exerciseCount > 0 ? Math.round((done / row.parent.exerciseCount) * 100) : 0;
            const status = done === row.parent.exerciseCount ? "complete" : done > 0 ? "progress" : "pending";
            return (
              <div key={row.level} className="shelf-row-full" style={{ gridColumn: `1 / -1` }}>
                <a
                  className={`shelf-cell-wide shelf-${status}`}
                  href={getCourseHref(row.parent.id)}
                  title={t("catalog:ui.cellTooltip", { title: row.parent.title, done: new Intl.NumberFormat(i18n.language).format(done), count: row.parent.exerciseCount })}
                  style={{ '--cell-idx': rowIdx * maxCols } as React.CSSProperties}
                >
                  <span className="shelf-row-level">{row.level}</span>
                  <TrophyIcon variant={status === "complete" ? "gold" : status === "progress" ? "silver" : "bronze"} size={20} />
                  <span className="shelf-wide-title">{row.parent.title}</span>
                  <span className="shelf-wide-progress">{done}/{row.parent.exerciseCount}</span>
                  <div className="shelf-cell-bar shelf-wide-bar">
                    <div className="shelf-cell-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </a>
              </div>
            );
          }

          return (
            <div key={row.level} className="shelf-row" style={{ display: "contents" }}>
              <div className="shelf-row-label">
                {row.parent ? (
                  <a
                    href={getCourseHref(row.parent.id)}
                    className="shelf-level-link"
                    title={t("catalog:ui.cellTooltip", { title: row.parent.title, done: getCompletedCount(row.parent.id), count: row.parent.exerciseCount })}
                  >
                    {row.level}
                  </a>
                ) : (
                  <span className="shelf-level-num">{row.level}</span>
                )}
              </div>
              {row.cells.slice(0, maxCols).map((cell, i) => (
                cell ? (
                  <ShelfCellTile key={i} cell={cell} cellIndex={rowIdx * maxCols + i} level={row.level} />
                ) : (
                  <div key={i} className="shelf-placeholder" />
                )
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const SONG_ACCENT: Record<string, string> = {
  Beginner: '#3B9AB2',
  Folk: '#8B7355',
  Holiday: '#C93312',
  'Hymns & Sacred': '#6B5B95',
  Intermediate: '#DD8D29',
  'Jazz & Blues': '#2d7a8f',
  Advanced: '#E1BD6D',
  Pro: '#C4956A',
};

function SongCards({ courses }: { courses: CatalogCourse[] }) {
  const { t: translate, i18n } = useTranslation();
  const t = translate as (key: string, options?: Record<string, unknown>) => string;
  const sorted = [...courses].sort((a, b) => a.level - b.level);
  return (
    <section className="shelf-section panel shelf-songs">
      <div className="shelf-header">
        <div>
          <h3 className="shelf-title" title={t("catalog:ui.titleSongs")}>{t("catalog:ui.group.songs")}</h3>
          <span className="shelf-stats">
            {(() => { const d = sorted.reduce((t, c) => t + getCompletedCount(c.id), 0); const tot = sorted.reduce((t, c) => t + c.exerciseCount, 0); return d > 0 ? t("catalog:ui.progressStats", { done: new Intl.NumberFormat(i18n.language).format(d), count: tot, percent: new Intl.NumberFormat(i18n.language).format(Math.round((d / tot) * 100)) }) : t("catalog:ui.exercises", { count: tot }); })()}
          </span>
        </div>
      </div>
      <div className="song-grid">
        {sorted.map((course, idx) => {
          const done = getCompletedCount(course.id);
          const pct = course.exerciseCount > 0 ? Math.round((done / course.exerciseCount) * 100) : 0;
          const status = done === course.exerciseCount ? "complete" : done > 0 ? "progress" : "pending";
          return (
            <a key={course.id} className={`song-card shelf-${status}`} href={getCourseHref(course.id)} style={{ '--cell-idx': idx } as React.CSSProperties}
              onPointerMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
                e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
              }}
              onMouseEnter={() => playShelfNote(course.level, idx)}
            >
              <span className="hover-note" aria-hidden="true" />
              <span className="song-card-emoji" aria-hidden="true" style={{ color: SONG_ACCENT[course.title.replace(/^Songs:\s*/, '')] || 'var(--accent-gold)' }}>
                {course.level <= 2 ? <Music size={28} /> : course.level <= 4 ? <Music2 size={28} /> : <Music4 size={28} />}
              </span>
              <h4 className="song-card-title">{course.title.replace(/^Songs:\s*/, "")}</h4>
              <span className="song-card-level">{t("catalog:ui.level", { level: new Intl.NumberFormat(i18n.language).format(course.level) })}</span>
              <span className="song-card-fraction">{done > 0 ? `${done}/${course.exerciseCount}` : t("catalog:ui.exercises", { count: course.exerciseCount })}</span>
              <div className="shelf-cell-bar song-card-bar">
                <div className="shelf-cell-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function CourseTableSection({ course }: { course: CatalogCourse }) {
  const [expanded, setExpanded] = useState(false);
  const done = getCompletedCount(course.id);
  const completedSlugs = getCompletedSlugs(course.id);
  const pct = Math.round((done / course.exerciseCount) * 100);
  const trophyVariant = pct === 100 ? "gold" as const : pct > 0 ? "silver" as const : "bronze" as const;

  return (
    <div className="course-table-section panel surface-card">
      <button
        className="course-table-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <TrophyIcon variant={trophyVariant} size={24} />
        <h3>{course.title}</h3>
        <span className="course-table-level">L{course.level}</span>
        <span className="course-table-progress">
          {done}/{course.exerciseCount}
        </span>
        <ProgressRing done={done} total={course.exerciseCount} />
        <span className={`course-table-chevron${expanded ? " open" : ""}`}><ChevronRight size={16} /></span>
      </button>
      {expanded && (
        <div className="exercise-table" role="list">
          {course.exercises.map((exercise, i) => {
            const isComplete = completedSlugs.has(exercise.slug);
            const stars = getBestStars(course.id, exercise.slug);
            return (
              <a
                key={exercise.id}
                className={`exercise-table-row${isComplete ? " row-complete" : ""}`}
                href={getExerciseHref(course.id, exercise.slug)}
                role="listitem"
              >
                <span className="exercise-table-num">{isComplete ? <Check size={14} /> : i + 1}</span>
                <span className="exercise-table-title">{exercise.title}</span>
                <span className="exercise-table-stars">
                  {stars ? <InlineStars count={stars} size={13} /> : null}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CatalogScreen({ catalog, progressVersion }: { catalog: GeneratedCatalog; progressVersion: number }) {
  const { t: translate } = useTranslation();
  const t = translate as (key: string) => string;
  void progressVersion;
  const groups = groupCourses(catalog.courses);

  const methodCourses = groups.find(g => g.label === "method")?.courses ?? [];
  const techniqueCourses = groups.find(g => g.label === "technique")?.courses ?? [];
  const songCourses = groups.find(g => g.label === "songs")?.courses ?? [];

  return (
    <div className="screen-stack">
      <div className="catalog-triptych">
        {methodCourses.length > 0 && <ShelfGrid courses={methodCourses} title={t("catalog:ui.group.method")} category="method" />}
        {techniqueCourses.length > 0 && <ShelfGrid courses={techniqueCourses} title={t("catalog:ui.group.technique")} category="technique" />}
        {songCourses.length > 0 && <SongCards courses={songCourses} />}
      </div>
    </div>
  );
}

function CourseScreen({ course, progressVersion }: { course: CatalogCourse; progressVersion: number }) {
  const { t: translate, i18n } = useTranslation();
  const t = translate as (key: string, options?: Record<string, unknown>) => string;
  void progressVersion;
  const completedSlugs = getCompletedSlugs(course.id);
  return (
    <div className="screen-stack">
      <section className="panel surface-card detail-panel">
        <div className="section-head">
          <div>
            <h2>{course.title}</h2>
          </div>
          <a
            className="action-link primary"
            href={getExerciseHref(course.id, course.exercises[0].slug)}
          >
            {t("catalog:ui.openFirst")}
          </a>
        </div>
        <p className="lead">{course.summary}</p>
        <div className="course-meta-line">
          <span>{t("catalog:ui.level", { level: course.level })}</span>
          <span className="course-meta-dot" />
          <span>{t("catalog:ui.exercises", { count: course.exerciseCount })}</span>
          {completedSlugs.size > 0 && (
            <>
              <span className="course-meta-dot" />
              <span>{t("catalog:ui.completed", { count: completedSlugs.size })}/{course.exerciseCount}</span>
            </>
          )}
        </div>
        {completedSlugs.size > 0 && (
          <>
            <div className="course-progress-bar-wrap" style={{ marginTop: 12 }}>
              <div
                className="course-progress-bar-fill"
                style={{ width: `${Math.round((completedSlugs.size / course.exerciseCount) * 100)}%` }}
              />
            </div>
            <span className="course-progress-label">
              {t("catalog:ui.completePercent", { percent: new Intl.NumberFormat(i18n.language).format(Math.round((completedSlugs.size / course.exerciseCount) * 100)) })}
            </span>
          </>
        )}
      </section>

      <section className="panel surface-card">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("catalog:ui.exercisesLabel")}</span>
            <h3>{t("catalog:ui.exercises", { count: course.exerciseCount })}</h3>
          </div>
        </div>
        <div className="exercise-table" role="list">
          {course.exercises.map((exercise, i) => {
            const isComplete = completedSlugs.has(exercise.slug);
            const stars = getBestStars(course.id, exercise.slug);
            return (
              <a
                key={exercise.id}
                className={`exercise-table-row${isComplete ? " row-complete" : ""}`}
                href={getExerciseHref(course.id, exercise.slug)}
                role="listitem"
              >
                <span className="exercise-table-num">{isComplete ? <Check size={14} /> : i + 1}</span>
                <span className="exercise-table-title">{exercise.title}</span>
                <span className="exercise-table-stars">
                  {stars ? <InlineStars count={stars} size={13} /> : null}
                </span>
              </a>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ExerciseScreen({
  course,
  exercise,
  progressVersion,
  onExerciseComplete
}: {
  course: CatalogCourse;
  exercise: CatalogExercise;
  progressVersion: number;
  onExerciseComplete: () => void;
}) {
  const { t: translate } = useTranslation();
  const t = translate as (key: string, options?: Record<string, unknown>) => string;
  void progressVersion;
  const completedSlugs = getCompletedSlugs(course.id);
  const exerciseIndex = course.exercises.findIndex((entry) => entry.slug === exercise.slug);

  const previousExercise = exerciseIndex > 0 ? course.exercises[exerciseIndex - 1] : null;
  const nextExercise =
    exerciseIndex >= 0 && exerciseIndex < course.exercises.length - 1
      ? course.exercises[exerciseIndex + 1]
      : null;

  const [outlineOpen, setOutlineOpen] = useState(true);
  const panelResetRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowRight" && nextExercise) {
        e.preventDefault();
        window.location.hash = getExerciseHref(course.id, nextExercise.slug).slice(1);
      } else if (e.key === "ArrowLeft" && previousExercise) {
        e.preventDefault();
        window.location.hash = getExerciseHref(course.id, previousExercise.slug).slice(1);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        panelResetRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [course.id, nextExercise?.slug, previousExercise?.slug]);

  return (
    <div className={`exercise-layout${outlineOpen ? "" : " no-outline"}`}>
      <div className="exercise-main">
        <div className="exercise-header panel">
          <div className="exercise-header-top">
            <a className="back-link" href={getCourseHref(course.id)}>
              <ArrowLeft size={14} /> {course.title}
            </a>
            <div className="exercise-pager">
              {previousExercise ? (
                <a className="pager-link" aria-label={t("practice:ui.navigation.previousExercise")} href={getExerciseHref(course.id, previousExercise.slug)}>
                  <ChevronLeft size={16} />
                </a>
              ) : (
                <span className="pager-link disabled"><ChevronLeft size={16} /></span>
              )}
              <span className="pager-count">{exerciseIndex + 1} / {course.exerciseCount}</span>
              {nextExercise ? (
                <a className="pager-link" aria-label={t("practice:ui.navigation.nextExercise")} href={getExerciseHref(course.id, nextExercise.slug)}>
                  <ChevronRight size={16} />
                </a>
              ) : (
                <span className="pager-link disabled"><ChevronRight size={16} /></span>
              )}
              {!outlineOpen && (
                <button className="panel-toggle-btn expand" onClick={() => setOutlineOpen(true)} title={t("common:ui.outline.show")} aria-label={t("common:ui.outline.show")}><Menu size={16} /></button>
              )}
            </div>
          </div>
          <div className="exercise-header-body">
            <h2 className="exercise-title">{exercise.title}</h2>
            <p className="exercise-goal">{exercise.goal}</p>
          </div>
          <div className="exercise-chips">
            <span className="chip">{formatHands(exercise.hands, t)}</span>
            <span className="chip">{formatClef(exercise.clef, t)}</span>
            {exercise.category ? <span className="chip">{formatCategory(exercise.category, t)}</span> : null}
            <span className="chip">{exercise.tempoBpm} bpm</span>
            <span className="chip">{formatTimeSignature(exercise.timeSignature)}</span>
            <span className="kbd-hints">
              <kbd>R</kbd> {t("practice:ui.reset")}
              <kbd><ArrowLeft size={10} /></kbd><kbd><ArrowRight size={10} /></kbd> {t("practice:ui.navigate")}
            </span>
          </div>
        </div>

        <Suspense fallback={<div className="score-loading">{t("practice:ui.score.loading")}</div>}>
          <ExercisePracticePanelLazy
            key={`${course.id}/${exercise.id}`}
            exercise={exercise}
            courseId={course.id}
            nextExerciseHref={nextExercise ? getExerciseHref(course.id, nextExercise.slug) : undefined}
            courseHref={getCourseHref(course.id)}
            onComplete={onExerciseComplete}
            resetRef={panelResetRef}
          />
        </Suspense>
      </div>

      {outlineOpen && <aside className="outline-panel panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("practice:ui.outline.title")}</span>
            <h3>{course.title}</h3>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <a className="plain-link" href={getCourseHref(course.id)}>
              {t("practice:ui.outline.viewCourse")}
            </a>
            <button className="panel-toggle-btn" onClick={() => setOutlineOpen(false)} title={t("common:ui.outline.hide")} aria-label={t("common:ui.outline.hide")}><X size={14} /></button>
          </div>
        </div>

        <div className="outline-compact-grid">
          {course.exercises.map((entry, index) => {
            const active = entry.slug === exercise.slug;
            const done = completedSlugs.has(entry.slug);
            return (
              <a
                key={entry.id}
                className={`outline-compact-item${active ? " active" : ""}${done ? " done" : ""}`}
                href={getExerciseHref(course.id, entry.slug)}
                aria-current={active ? "page" : undefined}
                title={entry.title}
              >
                {done ? <Check size={12} /> : index + 1}
              </a>
            );
          })}
        </div>
      </aside>}
    </div>
  );
}

function SidebarShelf({ courses, title, activeCourseId }: { courses: CatalogCourse[]; title: string; activeCourseId: string | null }) {
  const rows = buildShelfRows(courses);
  const maxCols = Math.max(...rows.map(r => {
    let max = 0;
    r.cells.forEach((c, i) => { if (c) max = i + 1; });
    return max;
  }), 0);

  // Courses that didn't parse into the level grid (e.g. songs-beginner)
  const gridCourseIds = new Set<string>();
  for (const row of rows) {
    if (row.parent) gridCourseIds.add(row.parent.id);
    for (const cell of row.cells) {
      if (cell) gridCourseIds.add(cell.course.id);
    }
  }
  const ungridded = courses.filter(c => !gridCourseIds.has(c.id))
    .sort((a, b) => a.level - b.level || a.title.localeCompare(b.title));

  return (
    <div className="sidebar-shelf">
      <span className="sidebar-shelf-label">{title}</span>

      {maxCols > 0 && (
        <div className="sidebar-shelf-grid" style={{ gridTemplateColumns: `repeat(${maxCols}, 1fr)` }}>
          {rows.map(row => {
            const hasCells = row.cells.some(c => c !== null);

            if (!hasCells && row.parent) {
              const done = getCompletedCount(row.parent.id);
              const isActive = row.parent.id === activeCourseId;
              const status = done === row.parent.exerciseCount ? "complete" : done > 0 ? "progress" : "pending";
              return (
                <a
                  key={row.level}
                  className={`sidebar-shelf-cell-wide shelf-${status}${isActive ? " shelf-active" : ""}`}
                  href={getCourseHref(row.parent.id)}
                  title={row.parent.title}
                  style={{ gridColumn: `1 / -1` }}
                >
                  <span className="sidebar-shelf-celltext">L{row.level}</span>
                </a>
              );
            }

            return row.cells.slice(0, maxCols).map((cell, i) => {
              if (!cell) return <div key={`${row.level}-${i}`} className="sidebar-shelf-empty" />;
              const done = cell.done;
              const isActive = cell.course.id === activeCourseId;
              const status = done === cell.total ? "complete" : done > 0 ? "progress" : "pending";
              return (
                <a
                  key={cell.course.id}
                  className={`sidebar-shelf-cell shelf-${status}${isActive ? " shelf-active" : ""}`}
                  href={getCourseHref(cell.course.id)}
                  title={`${cell.course.title}\n${done}/${cell.total}`}
                >
                  <span className="sidebar-shelf-celltext">{cell.label}</span>
                </a>
              );
            });
          })}
        </div>
      )}

      {/* Ungridded courses (songs, or anything without level-N pattern) */}
      {ungridded.length > 0 && (
        <div className="sidebar-shelf-list">
          {ungridded.map(course => {
            const done = getCompletedCount(course.id);
            const isActive = course.id === activeCourseId;
            const status = done === course.exerciseCount ? "complete" : done > 0 ? "progress" : "pending";
            const label = course.title.replace(/^Songs:\s*/, "").replace(/^Technique\s*/, "T");
            return (
              <a
                key={course.id}
                className={`sidebar-shelf-cell-wide shelf-${status}${isActive ? " shelf-active" : ""}`}
                href={getCourseHref(course.id)}
                title={`${course.title}\n${done}/${course.exerciseCount}`}
              >
                <span className="sidebar-shelf-celltext">{label}</span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProgressScreen({ catalog, progressVersion, onImport }: { catalog: GeneratedCatalog; progressVersion: number; onImport: () => void }) {
  const { i18n, t: translate } = useTranslation();
  const t = translate as (key: string, options?: Record<string, unknown>) => string;
  void progressVersion;

  const totalExercises = catalog.courses.reduce((t, c) => t + c.exerciseCount, 0);
  const totalCompleted = catalog.courses.reduce((t, c) => t + getCompletedCount(c.id), 0);
  const pctOverall = totalExercises > 0 ? Math.round((totalCompleted / totalExercises) * 100) : 0;

  let total3 = 0, total2 = 0, total1 = 0;
  for (const course of catalog.courses) {
    for (const ex of course.exercises) {
      const s = getBestStars(course.id, ex.slug);
      if (s === 3) total3++;
      else if (s === 2) total2++;
      else if (s === 1) total1++;
    }
  }

  const groups = groupCourses(catalog.courses);
  const resumeTarget = getResumeTarget(catalog);
  const streak = getPracticeStreak();
  const [importMsg, setImportMsg] = useState<MessageDescriptor | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    resetProgress();
    setConfirmReset(false);
    onImport(); // triggers progressVersion bump to re-render
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = importProgress(e.target?.result as string);
        setImportMsg(importProgressMessage(result));
        if (result.ok) onImport();
        setTimeout(() => setImportMsg(null), 4000);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const firstMethodCourse = catalog.courses.find(c => c.id.startsWith("method"));
  const firstExerciseHref = firstMethodCourse
    ? getExerciseHref(firstMethodCourse.id, firstMethodCourse.exercises[0].slug)
    : getCatalogHref();
  const fileActions = <>
    <button className="action-link secondary" type="button" onClick={exportProgress}>{t("progress:ui.export")}</button>
    <button className="action-link secondary" type="button" onClick={handleImport}>{t("progress:ui.import")}</button>
  </>;

  return (
    <div className="screen-stack">
      {totalCompleted === 0 ? (
        <div className="progress-empty-state">
          <PianioMascot height={80} />
          <h3>{t("progress:ui.startTitle")}</h3>
          <p>{t("progress:ui.startDescription")}</p>
          <a className="action-link primary" href={firstExerciseHref}>{t("progress:ui.startPractice")}</a>
          <div className="progress-actions">{fileActions}</div>
        </div>
      ) : (
      <section className="progress-header">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("progress:ui.yourProgress")}</span>
            <h2>{t("progress:ui.summary")}</h2>
          </div>
          <div className="progress-actions">
            <a className="action-link primary" href={resumeTarget.href}>{t("progress:ui.continue")}</a>
            {fileActions}
            <button
              className={`action-link secondary${confirmReset ? " danger" : ""}`}
              type="button"
              onClick={handleReset}
              onBlur={() => setConfirmReset(false)}
            >
              {confirmReset ? t("progress:ui.confirmReset") : t("progress:ui.reset")}
            </button>
          </div>
        </div>

        <div className="progress-journey">
          <div className="journey-bar">
            <div className="journey-bar-fill" style={{ width: `${pctOverall}%` }} />
          </div>
          <div className="journey-stats">
            <span className="journey-stat">
              <strong>{pctOverall > 0 ? `${pctOverall}%` : totalCompleted}</strong>
              {" "}{pctOverall > 0 ? t("progress:ui.complete") : t("progress:ui.ofComplete", { count: totalExercises })}
            </span>
            {total3 > 0 && (
              <>
                <span className="journey-dot" />
                <span className="journey-stat">{t("progress:ui.perfect", { count: total3 })}</span>
              </>
            )}
            {streak > 0 && (
              <>
                <span className="journey-dot" />
                <span className="journey-stat">{t("progress:ui.dayStreak", { count: streak })}</span>
              </>
            )}
          </div>
        </div>
      </section>
      )}
      {importMsg && <p className="import-msg">{renderMessage(importMsg)}</p>}

      <div className="section-head">
        <div>
          <span className="eyebrow">{t("progress:ui.yourCourses")}</span>
          <h2>{t("progress:ui.byCategory")}</h2>
        </div>
      </div>

      <div className="catalog-triptych progress-triptych">
        {(() => {
          const methodCourses = groups.find(g => g.label === "method")?.courses ?? [];
          const techniqueCourses = groups.find(g => g.label === "technique")?.courses ?? [];
          const songCourses = groups.find(g => g.label === "songs")?.courses ?? [];
          return (
            <>
              {methodCourses.length > 0 && <ShelfGrid courses={methodCourses} title={t("catalog:ui.group.method")} category="method" />}
              {techniqueCourses.length > 0 && <ShelfGrid courses={techniqueCourses} title={t("catalog:ui.group.technique")} category="technique" />}
              {songCourses.length > 0 && <SongCards courses={songCourses} />}
            </>
          );
        })()}
      </div>
    </div>
  );
}

function EmptyScreen({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  const { t: translate } = useTranslation();
  const t = translate as (key: string) => string;
  return (
    <section className="panel empty-panel">
      <span className="eyebrow">{t("common:ui.unavailable")}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <a className="action-link primary" href={getCatalogHref()}>
        {t("common:ui.returnCatalog")}
      </a>
    </section>
  );
}

function ScrollToTop() {
  const { t: translate } = useTranslation();
  const t = translate as (key: string) => string;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!visible) return null;
  return (
    <button
      className="scroll-to-top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      title={t("common:ui.backToTop")}
      aria-label={t("common:ui.backToTop")}
    >
      <ChevronLeft size={18} style={{ transform: 'rotate(90deg)' }} />
    </button>
  );
}

function TopNav({ midi, darkMode, setDarkMode, route }: {
  midi: ReturnType<typeof describeMidiSupport>;
  darkMode: boolean;
  setDarkMode: (fn: (v: boolean) => boolean) => void;
  route: Route;
}) {
  const { i18n, t: translate } = useTranslation();
  const t = translate as (key: string, options?: Record<string, unknown>) => string;
  const midiMessages = midiSupportMessages(midi);
  return (
    <header className="top-nav">
      <a className="top-nav-logo" href={getCatalogHref()}>
        <img src="/pianio.svg" alt="" className="top-nav-logo-icon" width={24} height={24} />
        Pianio
      </a>
      <nav className="top-nav-links">
        <a className={route.screen === "catalog" ? "active" : undefined} href={getCatalogHref()}>{t("common:ui.nav.courses")}</a>
        <a className={route.screen === "progress" ? "active" : undefined} href={getProgressHref()}>{t("common:ui.nav.progress")}</a>
      </nav>
      <div className="top-nav-right">
        {supportedLanguages.length > 1 && <LanguageSelector />}
        <span className={midi.available ? "midi-indicator ok" : "midi-indicator warn"}>
          <span className="midi-dot" />
          {renderMessage(midiMessages.summary)}
        </span>
        <a className="top-nav-settings" href="#/diagnostics" title={t("common:ui.midiDiagnostics")} aria-label={t("common:ui.midiDiagnostics")}>
          <Settings size={16} />
        </a>
        <button
          className="theme-toggle-btn"
          onClick={() => setDarkMode((v) => !v)}
          title={darkMode ? t("common:ui.theme.light") : t("common:ui.theme.dark")}
          aria-label={darkMode ? t("common:ui.theme.light") : t("common:ui.theme.dark")}
        >
          {darkMode ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}

export default function App() {
  const { i18n, t: translate } = useTranslation();
  const t = translate as (key: string, options?: Record<string, unknown>) => string;
  const { catalog, error, retry, activeLanguage, contentLanguage } = useLanguage();
  const [progressVersion, setProgressVersion] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(() => readPreference("pianio:dark") === "1");
  const handleExerciseComplete = () => { recordPracticeDay(); setProgressVersion((v) => v + 1); };
  const resumeTarget = catalog ? getResumeTarget(catalog) : null;
  const hasProgress = catalog
    ? catalog.courses.some((c) => getCompletedCount(c.id) > 0)
    : false;
  void progressVersion; // causes resumeTarget/hasProgress to recompute after completion
  const [route, setRoute] = useState<Route>(() =>
    typeof window === "undefined" ? { screen: "catalog" } : parseRoute(window.location.hash)
  );
  const midi = describeMidiSupport();

  useEffect(() => {
    const handler = () => {
      startAudio();
      document.removeEventListener("click", handler);
      document.removeEventListener("touchstart", handler);
    };
    document.addEventListener("click", handler, { once: true });
    document.addEventListener("touchstart", handler, { once: true });
    return () => {
      document.removeEventListener("click", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    savePreference("pianio:dark", darkMode ? "1" : "0");
  }, [darkMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const syncRoute = () => {
      const update = () => setRoute(parseRoute(window.location.hash));
      if (document.startViewTransition) {
        document.startViewTransition(update);
      } else {
        update();
      }
    };

    syncRoute();
    window.addEventListener("hashchange", syncRoute);

    return () => {
      window.removeEventListener("hashchange", syncRoute);
    };
  }, []);

  const selectedCourse =
    route.screen === "course" || route.screen === "exercise"
      ? findCourse(catalog, route.courseId)
      : null;
  const selectedExercise =
    route.screen === "exercise" ? findExercise(selectedCourse, route.exerciseSlug) : null;
  const activeCourseId =
    route.screen === "course" || route.screen === "exercise"
      ? route.courseId
      : null;

  useEffect(() => {
    const base = "Pianio";
    if (route.screen === "progress") {
      document.title = `${t("common:ui.nav.progress")} | ${base}`;
    } else if (route.screen === "diagnostics") {
      document.title = `${t("common:ui.midiDiagnostics")} | ${base}`;
    } else if (route.screen === "course" && selectedCourse) {
      document.title = `${selectedCourse.title} | ${base}`;
    } else if (route.screen === "exercise" && selectedExercise && selectedCourse) {
      document.title = `${selectedExercise.title} - ${selectedCourse.title} | ${base}`;
    } else {
      document.title = t("common:document.title");
    }
    // Emotional contrast: scope backgrounds per screen
    const screenType = route.screen === "exercise" ? "practice" : route.screen === "progress" ? "progress" : "catalog";
    document.documentElement.setAttribute("data-screen", screenType);
  }, [route.screen, selectedCourse, selectedExercise, activeLanguage]);

  let content: ReactNode = null;

  if (error && !catalog) {
    content = (
      <section className="panel empty-panel">
        <span className="eyebrow">{t("catalog:ui.catalogError")}</span>
        <h2>{t("catalog:ui.contentError")}</h2>
        <p>{t("common:language.initialError")}</p>
        <button type="button" onClick={retry}>{t("common:language.retry")}</button>
      </section>
    );
  } else if (!catalog) {
    content = (
      <div className="loading-screen">
        <PianioMascot height={80} />
        <div className="score-spinner" />
      </div>
    );
  } else if (route.screen === "catalog") {
    content = <CatalogScreen catalog={catalog} progressVersion={progressVersion} />;
  } else if (route.screen === "progress") {
    content = <ProgressScreen catalog={catalog} progressVersion={progressVersion} onImport={() => setProgressVersion((v) => v + 1)} />;
  } else if (route.screen === "diagnostics") {
    content = <DiagnosticsScreen />;
  } else if (route.screen === "notfound") {
    content = (
      <section className="panel empty-panel notfound-panel">
        <h2 className="notfound-title">404</h2>
        <p>{t("common:ui.page404")}</p>
        <a className="action-link primary" href={getCatalogHref()}>{t("common:ui.nav.backToCourses")}</a>
      </section>
    );
  } else if (!selectedCourse) {
    content = (
      <EmptyScreen
        title={t("catalog:ui.courseNotFound")}
        description={t("catalog:ui.courseMissing")}
      />
    );
  } else if (route.screen === "course") {
    content = <CourseScreen course={selectedCourse} progressVersion={progressVersion} />;
  } else if (!selectedExercise) {
    content = (
      <EmptyScreen
        title={t("catalog:ui.exerciseNotFound")}
        description={t("catalog:ui.exerciseMissing")}
      />
    );
  } else {
    content = (
      <ExerciseScreen
        course={selectedCourse}
        exercise={selectedExercise}
        progressVersion={progressVersion}
        onExerciseComplete={handleExerciseComplete}
      />
    );
  }

  return (
    <>
    <a href="#main-content" className="skip-link">{t("common:ui.skip")}</a>
    <TopNav midi={midi} darkMode={darkMode} setDarkMode={setDarkMode} route={route} />
    {route.screen === "catalog" && (
      <header className="hero-panel">
        <div className="hero-inner">
          <div className="hero-copy">
            <h1>Pianio</h1>
            <p className="hero-tagline">{t("catalog:ui.tagline")}</p>
            <p className="hero-stat-line">{t("catalog:ui.stats", { courses: new Intl.NumberFormat(i18n.language).format(catalog?.courses.length ?? 0), exercises: new Intl.NumberFormat(i18n.language).format(catalog?.courses.reduce((n, c) => n + c.exerciseCount, 0) ?? 0) })}</p>
            <a className="action-link primary hero-cta" href={resumeTarget?.href ?? getCatalogHref()}>
              {hasProgress ? t("catalog:ui.continue") : t("catalog:ui.startLearning")}
            </a>
            {hasProgress && resumeTarget && (
              <p className="hero-resume-hint">{t("catalog:ui.resumeHint", { title: resumeTarget.label })}</p>
            )}
              <div className="hero-steps" aria-label={t("catalog:ui.howItWorks")}>
                <div className="hero-step">
                  <Keyboard size={24} />
                  <h3>{t("catalog:ui.connect")}</h3>
                  <p>{t("catalog:ui.connectHint")}</p>
                </div>
                <div className="hero-step">
                  <Music size={24} />
                  <h3>{t("catalog:ui.play")}</h3>
                  <p>{t("catalog:ui.playHint")}</p>
                </div>
                <div className="hero-step">
                  <Check size={24} />
                  <h3>{t("catalog:ui.learn")}</h3>
                  <p>{t("catalog:ui.learnHint")}</p>
                </div>
              </div>
          </div>
          <div className="hero-mascot-area" aria-hidden="true">
            <PianioMascot height={260} />
          </div>
        </div>
      </header>
    )}
    <main className="app-shell" id="main-content">

      <div className={`browser-layout${sidebarOpen && route.screen !== "catalog" && route.screen !== "exercise" && route.screen !== "progress" && route.screen !== "diagnostics" ? "" : " no-sidebar"}`}>
        {sidebarOpen && route.screen !== "catalog" && route.screen !== "exercise" && route.screen !== "progress" && route.screen !== "diagnostics" && (
          <aside className="browser-sidebar">
            <section className="panel sidebar-panel">
              <div className="section-head">
                <div>
                  <span className="eyebrow">{t("common:ui.navigation")}</span>
                  <h2>{t("common:ui.nav.courses")}</h2>
                </div>
                <div className="sidebar-nav-actions">
                  <button className="panel-toggle-btn" onClick={() => setSidebarOpen(false)} title={t("common:ui.sidebar.hide")} aria-label={t("common:ui.sidebar.hide")}><X size={14} /></button>
                  <a className="plain-link" href={getCatalogHref()}>{t("common:ui.nav.catalog")}</a>
                  <a className="plain-link" href={getProgressHref()}>{t("common:ui.nav.progress")}</a>
                </div>
              </div>

              {!catalog ? (
                <p className="support-copy">{t("catalog:ui.sidebarLoading")}</p>
              ) : (
                <nav className="course-nav sidebar-shelves" aria-label={t("catalog:ui.courseCatalog")}>
                  {(() => {
                    const groups = groupCourses(catalog.courses);
                    const methodCourses = groups.find(g => g.label === "method")?.courses ?? [];
                    const techniqueCourses = groups.find(g => g.label === "technique")?.courses ?? [];
                    const songCourses = groups.find(g => g.label === "songs")?.courses ?? [];
                    return (
                      <>
                        {methodCourses.length > 0 && <SidebarShelf courses={methodCourses} title={t("catalog:ui.group.method")} activeCourseId={activeCourseId} />}
                        {techniqueCourses.length > 0 && <SidebarShelf courses={techniqueCourses} title={t("catalog:ui.group.technique")} activeCourseId={activeCourseId} />}
                        {songCourses.length > 0 && <SidebarShelf courses={songCourses} title={t("catalog:ui.group.songs")} activeCourseId={activeCourseId} />}
                      </>
                    );
                  })()}
                </nav>
              )}
            </section>
          </aside>
        )}

        <section className="browser-main">
          {route.screen !== "progress" && route.screen !== "diagnostics" && route.screen !== "catalog" && (
          <nav className="breadcrumbs" aria-label={t("common:ui.breadcrumb")}>
            {!sidebarOpen && (
              <button className="panel-toggle-btn expand" onClick={() => setSidebarOpen(true)} title={t("common:ui.sidebar.show")} aria-label={t("common:ui.sidebar.show")}><Menu size={16} /></button>
            )}
        <a href={getCatalogHref()}>{t("common:ui.nav.courses")}</a>
            {selectedCourse ? (
              <>
                <span>/</span>
                <a href={getCourseHref(selectedCourse.id)}>{selectedCourse.title}</a>
              </>
            ) : null}
            {selectedExercise ? (
              <>
                <span>/</span>
                <span aria-current="page">{selectedExercise.title}</span>
              </>
            ) : null}
          </nav>
          )}

          {error && catalog && <div className="language-notice" role="alert">
            {t("common:language.error")} <button type="button" onClick={retry}>{t("common:language.retry")}</button>
          </div>}
          {catalog && activeLanguage !== contentLanguage && <p className="language-notice" role="status">{t("common:language.fallback")}</p>}
          {activeLanguage !== sourceLanguage && catalog?.courses.some(c => (c.coverage?.fallbackFields ?? 0) > 0) && <p className="language-notice">{t("common:language.partial")}</p>}
          {activeLanguage !== sourceLanguage && (selectedCourse?.coverage?.fallbackFields ?? 0) > 0 && <p className="language-notice">{t("common:language.coursePartial")}</p>}
          {content}
        </section>
      </div>
      <ScrollToTop />
    </main>
    <footer className="site-footer">
      <div className="footer-brand">
        <PianioMascot height={32} />
        <span className="site-footer-brand">Pianio</span>
      </div>
      <div className="footer-tagline">{t("common:ui.footer")}</div>
      <div className="site-footer-links">
        <a href="https://github.com/ismaelponce/pianio" target="_blank" rel="noreferrer"><Github size={14} /> GitHub</a>
        <a href="https://github.com/ismaelponce/pianio/blob/main/LICENSE" target="_blank" rel="noreferrer">{t("common:ui.license")}</a>
        <span className="footer-midi-badge"><Keyboard size={12} /> MIDI</span>
      </div>
    </footer>
    </>
  );
}
