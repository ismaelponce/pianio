/** Valid note duration tokens: e=eighth, q=quarter, h=half, w=whole, de/dq/dh=dotted variants */
export type NoteDuration = "e" | "q" | "h" | "w" | "de" | "dq" | "dh";

export type ExerciseHand = "left" | "right" | "together";
export type ExerciseSourceKind = "original" | "public_domain" | "open_license";
export type DynamicMarking = 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff';
export type ClefSign = "G" | "F";
export type SongCategory =
  | "classical"
  | "folk"
  | "festive"
  | "christian"
  | "children"
  | "patriotic"
  | "film-tv"
  | "jazz-blues"
  | "ragtime"
  | "latin"
  | "celtic"
  | "world"
  | "romantic-era"
  | "baroque"
  | "waltz"
  | "march"
  | "lullaby"
  | "dance"
  | "opera"
  | "sea-shanty"
  | "musical-theater"
  | "meditation";

export interface LicenseMetadata {
  type: string;
  attribution: string;
  notes: string;
}

export interface SourceExercise {
  id: string;
  slug: string;
  title: string;
  summary: string;
  goal: string;
  hands: ExerciseHand;
  clef: ClefSign;
  tempoBpm: number;
  timeSignature: [number, number];
  keySignature?: number;
  sourceKind: ExerciseSourceKind;
  license: LicenseMetadata;
  category?: SongCategory;
  measures: string[][];
  /** Optional left-hand part. When present, the exercise uses a grand staff (treble + bass). */
  measuresLeft?: string[][];
  /** Dynamic markings positioned by measure/beat. Applies from position until next marking. */
  dynamics?: Array<{
    measure: number;
    beat?: number;
    marking: DynamicMarking;
  }>;
  /** Pedal events: down/up pairs positioned by measure/beat. */
  pedal?: Array<{
    measure: number;
    beat: number;
    type: 'down' | 'up';
  }>;
  /** When true, eighth notes use swing feel (~67% / ~33% split instead of 50/50). */
  swing?: boolean;
}

export interface SourceCourseDocument {
  courseId: string;
  title: string;
  level: number;
  summary: string;
  sourcePolicy: string;
  exercises: SourceExercise[];
}

export interface CatalogExpectedNote {
  noteNumber: number;
  /** When present, this is a chord — array of MIDI note numbers to play simultaneously. */
  noteNumbers?: number[];
  startBeat: number;
  durationBeats: number;
  hand: ExerciseHand;
  /** Active dynamic marking at this note's position (e.g. 'mf', 'p'). */
  dynamicMarking?: string;
  /** Expected pedal state when this note is played. */
  pedalState?: 'down' | 'up' | null;
}

export interface CatalogExercise {
  id: string;
  slug: string;
  title: string;
  summary: string;
  goal: string;
  hands: ExerciseHand;
  clef: ClefSign;
  sourceKind: ExerciseSourceKind;
  tempoBpm: number;
  timeSignature: [number, number];
  keySignature?: number;
  license: LicenseMetadata;
  category?: SongCategory;
  scorePath: string;
  expectedNotes: CatalogExpectedNote[];
  /** When true, eighth notes use swing feel. */
  swing?: boolean;
}

/** Only editorial fields may be overridden. Empty/missing strings use source English. */
export interface ExerciseTranslation {
  title?: string;
  summary?: string;
  goal?: string;
  license?: { notes?: string };
}
export interface CourseTranslationDocument {
  courseId: string;
  title?: string;
  summary?: string;
  exercises?: Record<string, ExerciseTranslation>;
}
/** Full text shape; runtime also requires license.notes when source notes are nonempty. */
export interface CompleteCourseTranslationDocument extends CourseTranslationDocument {
  title: string;
  summary: string;
  exercises: Record<string, Required<Omit<ExerciseTranslation, "license">> & { license?: { notes: string } }>;
}
export interface ContentCoverage {
  locale: string;
  sourceLanguage: string;
  totalFields: number;
  sourceFields: number;
  translatedFields: number;
  fallbackFields: number;
  fields: Record<string, "source" | "translated" | "fallback">;
}
export interface CatalogCourse {
  id: string;
  title: string;
  level: number;
  summary: string;
  sourcePolicy: string;
  exerciseCount: number;
  /** Optional while existing callers migrate; always emitted by the new generator. */
  coverage?: ContentCoverage;
  exercises: CatalogExercise[];
}

export interface GeneratedCatalog {
  /** Optional for compatibility with pre-localization fixtures and callers. */
  locale?: string;
  generatedAt: string;
  courses: CatalogCourse[];
}
/** Phase 5 loader may require the stronger generated contract after runtime checks. */
export interface LocalizedCatalog extends GeneratedCatalog {
  locale: string;
  courses: Array<CatalogCourse & { coverage: ContentCoverage }>;
}
