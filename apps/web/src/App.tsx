import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { CatalogCourse, CatalogExercise, GeneratedCatalog } from "@pianio/content-schema";
import { getBestStars, getCompletedCount, getCompletedSlugs, getPracticeStreak, isExerciseComplete, recordPracticeDay, exportProgress, importProgress, resetProgress } from "./progress";
import { describeMidiSupport } from "@pianio/midi-web";
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

      {/* Body */}
      <rect x="32" y="95" width="118" height="48" rx="5" fill="#3B9AB2" stroke="#2D2D2D" strokeWidth="2.5"/>

      {/* Stem */}
      <rect x="143" y="25" width="7" height="73" rx="1" fill="#3B9AB2" stroke="#2D2D2D" strokeWidth="2.5"/>

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

      {/* Left arm — waving */}
      <g>
        <animateTransform
          attributeName="transform"
          type="rotate"
          values="0 40 120;-20 40 120;5 40 120;-20 40 120;5 40 120;-20 40 120;0 40 120;0 40 120"
          keyTimes="0;0.08;0.16;0.24;0.32;0.4;0.5;1"
          dur="2.5s"
          repeatCount="indefinite"
        />
        <path d="M40 120 C30 110 20 100 12 92" stroke="#2D2D2D" strokeWidth="14" strokeLinecap="round" fill="none"/>
        <path d="M40 120 C30 110 20 100 12 92" stroke="#3B9AB2" strokeWidth="10" strokeLinecap="round" fill="none"/>
        <circle cx="11" cy="90" r="7" fill="#3B9AB2" stroke="#2D2D2D" strokeWidth="2.2"/>
        <ellipse cx="8" cy="80" rx="3.5" ry="6" fill="#3B9AB2" stroke="#2D2D2D" strokeWidth="2" transform="rotate(-10 8 80)"/>
      </g>
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

function formatHands(value: CatalogExercise["hands"]) {
  return value === "together" ? "Hands together" : `${capitalize(value)} hand`;
}

function formatClef(value: CatalogExercise["clef"]) {
  return value === "G" ? "Treble clef" : "Bass clef";
}

function formatSourceKind(value: CatalogExercise["sourceKind"]) {
  return value.replaceAll("_", " ");
}

function formatCategory(value: string) {
  return value.split("-").map(capitalize).join(" ");
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
    method: { label: "Method", courses: [] },
    technique: { label: "Technique", courses: [] },
    songs: { label: "Songs", courses: [] },
    other: { label: "Other", courses: [] }
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
      title={`${cell.course.title}\n${cell.done}/${cell.total} exercises`}
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
  const COL_HINTS: Record<string, string> = { A: "Foundations", B: "Building Blocks", C: "Combined Skills", D: "Applied Practice", E: "Mastery" };

  return (
    <section className={`shelf-section panel shelf-${category}`}>
      <div className="shelf-header">
        <div>
          <h3 className="shelf-title" title={category === "method" ? "Structured piano curriculum from beginner to advanced" : "Technical exercises for building finger strength and accuracy"}>{title}</h3>
          <span className="shelf-stats">{totalDone > 0 ? `${totalDone}/${totalExercises} exercises \u00b7 ${pctOverall}%` : `${totalExercises} exercises`}</span>
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
                  title={`${row.parent.title}\n${done}/${row.parent.exerciseCount} exercises`}
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
                    title={`${row.parent.title}\n${getCompletedCount(row.parent.id)}/${row.parent.exerciseCount} exercises`}
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
  const sorted = [...courses].sort((a, b) => a.level - b.level);
  return (
    <section className="shelf-section panel shelf-songs">
      <div className="shelf-header">
        <div>
          <h3 className="shelf-title" title="Complete songs to practice your skills">Songs</h3>
          <span className="shelf-stats">
            {(() => { const d = sorted.reduce((t, c) => t + getCompletedCount(c.id), 0); const tot = sorted.reduce((t, c) => t + c.exerciseCount, 0); return d > 0 ? `${d}/${tot} exercises` : `${tot} exercises`; })()}
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
              <span className="song-card-level">Level {course.level}</span>
              <span className="song-card-fraction">{done > 0 ? `${done}/${course.exerciseCount}` : `${course.exerciseCount} exercises`}</span>
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
  void progressVersion;
  const groups = groupCourses(catalog.courses);

  const methodCourses = groups.find(g => g.label === "Method")?.courses ?? [];
  const techniqueCourses = groups.find(g => g.label === "Technique")?.courses ?? [];
  const songCourses = groups.find(g => g.label === "Songs")?.courses ?? [];

  return (
    <div className="screen-stack">
      <div className="catalog-triptych">
        {methodCourses.length > 0 && <ShelfGrid courses={methodCourses} title="Method" category="method" />}
        {techniqueCourses.length > 0 && <ShelfGrid courses={techniqueCourses} title="Technique" category="technique" />}
        {songCourses.length > 0 && <SongCards courses={songCourses} />}
      </div>
    </div>
  );
}

function CourseScreen({ course, progressVersion }: { course: CatalogCourse; progressVersion: number }) {
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
            Open first exercise
          </a>
        </div>
        <p className="lead">{course.summary}</p>
        <div className="course-meta-line">
          <span>Level <strong>{course.level}</strong></span>
          <span className="course-meta-dot" />
          <span><strong>{course.exerciseCount}</strong> exercises</span>
          {completedSlugs.size > 0 && (
            <>
              <span className="course-meta-dot" />
              <span><strong>{completedSlugs.size}</strong>/{course.exerciseCount} completed</span>
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
              {Math.round((completedSlugs.size / course.exerciseCount) * 100)}% complete
            </span>
          </>
        )}
      </section>

      <section className="panel surface-card">
        <div className="section-head">
          <div>
            <span className="eyebrow">Exercises</span>
            <h3>{course.exerciseCount} exercises</h3>
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
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
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
                <a className="pager-link" href={getExerciseHref(course.id, previousExercise.slug)}>
                  <ChevronLeft size={16} />
                </a>
              ) : (
                <span className="pager-link disabled"><ChevronLeft size={16} /></span>
              )}
              <span className="pager-count">{exerciseIndex + 1} / {course.exerciseCount}</span>
              {nextExercise ? (
                <a className="pager-link" href={getExerciseHref(course.id, nextExercise.slug)}>
                  <ChevronRight size={16} />
                </a>
              ) : (
                <span className="pager-link disabled"><ChevronRight size={16} /></span>
              )}
              {!outlineOpen && (
                <button className="panel-toggle-btn expand" onClick={() => setOutlineOpen(true)} title="Show outline" aria-label="Show outline"><Menu size={16} /></button>
              )}
            </div>
          </div>
          <div className="exercise-header-body">
            <h2 className="exercise-title">{exercise.title}</h2>
            <p className="exercise-goal">{exercise.goal}</p>
          </div>
          <div className="exercise-chips">
            <span className="chip">{formatHands(exercise.hands)}</span>
            <span className="chip">{formatClef(exercise.clef)}</span>
            {exercise.category ? <span className="chip">{formatCategory(exercise.category)}</span> : null}
            <span className="chip">{exercise.tempoBpm} bpm</span>
            <span className="chip">{formatTimeSignature(exercise.timeSignature)}</span>
            <span className="kbd-hints">
              <kbd>R</kbd> reset
              <kbd><ArrowLeft size={10} /></kbd><kbd><ArrowRight size={10} /></kbd> navigate
            </span>
          </div>
        </div>

        <Suspense fallback={<div className="score-loading">Loading score...</div>}>
          <ExercisePracticePanelLazy
            exercise={exercise}
            courseId={course.id}
            nextExerciseHref={nextExercise ? getExerciseHref(course.id, nextExercise.slug) : undefined}
            onComplete={onExerciseComplete}
            resetRef={panelResetRef}
          />
        </Suspense>
      </div>

      {outlineOpen && <aside className="outline-panel panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Course Outline</span>
            <h3>{course.title}</h3>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <a className="plain-link" href={getCourseHref(course.id)}>
              View course
            </a>
            <button className="panel-toggle-btn" onClick={() => setOutlineOpen(false)} title="Collapse outline" aria-label="Collapse outline"><X size={14} /></button>
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
  const [importMsg, setImportMsg] = useState<string | null>(null);
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
        setImportMsg(result.message);
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

  return (
    <div className="screen-stack">
      {totalCompleted === 0 ? (
        <div className="progress-empty-state">
          <PianioMascot height={80} />
          <h3>Start your journey</h3>
          <p>Complete your first exercise to begin tracking progress. Every note counts toward your first star.</p>
          <a className="action-link primary" href={firstExerciseHref}>Start practicing</a>
        </div>
      ) : (
      <section className="progress-header">
        <div className="section-head">
          <div>
            <span className="eyebrow">Your Progress</span>
            <h2>Practice Summary</h2>
          </div>
          <div className="progress-actions">
            <a className="action-link primary" href={resumeTarget.href}>Continue practice</a>
            <button className="action-link secondary" type="button" onClick={exportProgress}>Export</button>
            <button className="action-link secondary" type="button" onClick={handleImport}>Import</button>
            <button
              className={`action-link secondary${confirmReset ? " danger" : ""}`}
              type="button"
              onClick={handleReset}
              onBlur={() => setConfirmReset(false)}
            >
              {confirmReset ? "Confirm reset?" : "Reset"}
            </button>
          </div>
        </div>
        {importMsg && <p className="import-msg">{importMsg}</p>}

        <div className="progress-journey">
          <div className="journey-bar">
            <div className="journey-bar-fill" style={{ width: `${pctOverall}%` }} />
          </div>
          <div className="journey-stats">
            <span className="journey-stat">
              <strong>{pctOverall > 0 ? `${pctOverall}%` : totalCompleted}</strong>
              {" "}{pctOverall > 0 ? "complete" : `of ${totalExercises} complete`}
            </span>
            {total3 > 0 && (
              <>
                <span className="journey-dot" />
                <span className="journey-stat"><strong>{total3}</strong> perfect</span>
              </>
            )}
            {streak > 0 && (
              <>
                <span className="journey-dot" />
                <span className="journey-stat"><strong>{streak}</strong> day streak</span>
              </>
            )}
          </div>
        </div>
      </section>
      )}

      <div className="section-head">
        <div>
          <span className="eyebrow">Your Courses</span>
          <h2>Progress by Category</h2>
        </div>
      </div>

      <div className="catalog-triptych progress-triptych">
        {(() => {
          const methodCourses = groups.find(g => g.label === "Method")?.courses ?? [];
          const techniqueCourses = groups.find(g => g.label === "Technique")?.courses ?? [];
          const songCourses = groups.find(g => g.label === "Songs")?.courses ?? [];
          return (
            <>
              {methodCourses.length > 0 && <ShelfGrid courses={methodCourses} title="Method" category="method" />}
              {techniqueCourses.length > 0 && <ShelfGrid courses={techniqueCourses} title="Technique" category="technique" />}
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
  return (
    <section className="panel empty-panel">
      <span className="eyebrow">Unavailable</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <a className="action-link primary" href={getCatalogHref()}>
        Return to catalog
      </a>
    </section>
  );
}

function ScrollToTop() {
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
      title="Back to top"
      aria-label="Back to top"
    >
      <ChevronLeft size={18} style={{ transform: 'rotate(90deg)' }} />
    </button>
  );
}

function TopNav({ midi, darkMode, setDarkMode, route }: {
  midi: { available: boolean; summary: string };
  darkMode: boolean;
  setDarkMode: (fn: (v: boolean) => boolean) => void;
  route: Route;
}) {
  return (
    <header className="top-nav">
      <a className="top-nav-logo" href={getCatalogHref()}>
        <img src="/pianio.png" alt="" className="top-nav-logo-icon" width={24} height={24} />
        Pianio
      </a>
      <nav className="top-nav-links">
        <a className={route.screen === "catalog" ? "active" : undefined} href={getCatalogHref()}>Courses</a>
        <a className={route.screen === "progress" ? "active" : undefined} href={getProgressHref()}>Progress</a>
      </nav>
      <div className="top-nav-right">
        <span className={midi.available ? "midi-indicator ok" : "midi-indicator warn"}>
          <span className="midi-dot" />
          {midi.summary}
        </span>
        <a className="top-nav-settings" href="#/diagnostics" title="MIDI Diagnostics" aria-label="MIDI diagnostics">
          <Settings size={16} />
        </a>
        <button
          className="theme-toggle-btn"
          onClick={() => setDarkMode((v) => !v)}
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          {darkMode ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}

export default function App() {
  const [catalog, setCatalog] = useState<GeneratedCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressVersion, setProgressVersion] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("pianio:dark") === "1");
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
    if (darkMode) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    localStorage.setItem("pianio:dark", darkMode ? "1" : "0");
  }, [darkMode]);

  useEffect(() => {
    let active = true;

    fetch("/generated/catalog.json")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Catalog request failed with ${response.status}`);
        }

        return (await response.json()) as GeneratedCatalog;
      })
      .then((data) => {
        if (active) {
          setCatalog(data);
        }
      })
      .catch((fetchError) => {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : "Unknown error");
        }
      });

    return () => {
      active = false;
    };
  }, []);

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
      document.title = `My Progress | ${base}`;
    } else if (route.screen === "diagnostics") {
      document.title = `Diagnostics | ${base}`;
    } else if (route.screen === "course" && selectedCourse) {
      document.title = `${selectedCourse.title} | ${base}`;
    } else if (route.screen === "exercise" && selectedExercise && selectedCourse) {
      document.title = `${selectedExercise.title} - ${selectedCourse.title} | ${base}`;
    } else {
      document.title = base;
    }
    // Emotional contrast: scope backgrounds per screen
    const screenType = route.screen === "exercise" ? "practice" : route.screen === "progress" ? "progress" : "catalog";
    document.documentElement.setAttribute("data-screen", screenType);
  }, [route.screen, selectedCourse, selectedExercise]);

  let content: ReactNode = null;

  if (error) {
    content = (
      <section className="panel empty-panel">
        <span className="eyebrow">Catalog Error</span>
        <h2>Unable to load generated content</h2>
        <p>{error}</p>
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
        <p>This page doesn't exist</p>
        <a className="action-link primary" href={getCatalogHref()}>Back to courses</a>
      </section>
    );
  } else if (!selectedCourse) {
    content = (
      <EmptyScreen
        title="Course not found"
        description="The selected course route does not exist in the generated catalog."
      />
    );
  } else if (route.screen === "course") {
    content = <CourseScreen course={selectedCourse} progressVersion={progressVersion} />;
  } else if (!selectedExercise) {
    content = (
      <EmptyScreen
        title="Exercise not found"
        description="The selected exercise route does not exist in this course."
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
    <a href="#main-content" className="skip-link">Skip to content</a>
    <TopNav midi={midi} darkMode={darkMode} setDarkMode={setDarkMode} route={route} />
    {route.screen === "catalog" && (
      <header className="hero-panel">
        <div className="hero-inner">
          <div className="hero-copy">
            <h1>Pianio</h1>
            <p className="hero-tagline">Free piano lessons that listen. Connect a MIDI keyboard, sight-read real scores, and get graded in real time.</p>
            <p className="hero-stat-line">{catalog?.courses.length ?? '…'} courses &middot; {catalog?.courses.reduce((t, c) => t + c.exerciseCount, 0) ?? '…'} exercises &middot; Open source</p>
            <a className="action-link primary hero-cta" href={resumeTarget?.href ?? getCatalogHref()}>
              {hasProgress ? "Continue" : "Start learning"}
            </a>
            {hasProgress && resumeTarget && (
              <p className="hero-resume-hint">Next up: {resumeTarget.label}</p>
            )}
            {hasProgress && (
              <a className="action-link secondary" href={getCatalogHref()}>Browse all courses</a>
            )}
              <div className="hero-steps" aria-label="How it works">
                <div className="hero-step">
                  <Keyboard size={24} />
                  <h3>Connect</h3>
                  <p>Plug in any MIDI keyboard</p>
                </div>
                <div className="hero-step">
                  <Music size={24} />
                  <h3>Play</h3>
                  <p>Follow real sheet music in real time</p>
                </div>
                <div className="hero-step">
                  <Check size={24} />
                  <h3>Learn</h3>
                  <p>Get graded and track your progress</p>
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
                  <span className="eyebrow">Navigation</span>
                  <h2>Courses</h2>
                </div>
                <div className="sidebar-nav-actions">
                  <button className="panel-toggle-btn" onClick={() => setSidebarOpen(false)} title="Collapse sidebar" aria-label="Collapse sidebar"><X size={14} /></button>
                  <a className="plain-link" href={getCatalogHref()}>All courses</a>
                  <a className="plain-link" href={getProgressHref()}>Progress</a>
                </div>
              </div>

              {!catalog ? (
                <p className="support-copy">Course list appears after the generated catalog loads.</p>
              ) : (
                <nav className="course-nav sidebar-shelves" aria-label="Course catalog">
                  {(() => {
                    const groups = groupCourses(catalog.courses);
                    const methodCourses = groups.find(g => g.label === "Method")?.courses ?? [];
                    const techniqueCourses = groups.find(g => g.label === "Technique")?.courses ?? [];
                    const songCourses = groups.find(g => g.label === "Songs")?.courses ?? [];
                    return (
                      <>
                        {methodCourses.length > 0 && <SidebarShelf courses={methodCourses} title="Method" activeCourseId={activeCourseId} />}
                        {techniqueCourses.length > 0 && <SidebarShelf courses={techniqueCourses} title="Technique" activeCourseId={activeCourseId} />}
                        {songCourses.length > 0 && <SidebarShelf courses={songCourses} title="Songs" activeCourseId={activeCourseId} />}
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
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            {!sidebarOpen && (
              <button className="panel-toggle-btn expand" onClick={() => setSidebarOpen(true)} title="Show sidebar" aria-label="Show sidebar"><Menu size={16} /></button>
            )}
            <a href={getCatalogHref()}>Courses</a>
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
      <div className="footer-tagline">Free, open-source piano lessons that listen.</div>
      <div className="site-footer-links">
        <a href="https://github.com/ismaelponce/pianio" target="_blank" rel="noreferrer"><Github size={14} /> GitHub</a>
        <a href="https://github.com/ismaelponce/pianio/blob/main/LICENSE" target="_blank" rel="noreferrer">MIT License</a>
        <span className="footer-midi-badge"><Keyboard size={12} /> MIDI</span>
      </div>
    </footer>
    </>
  );
}
