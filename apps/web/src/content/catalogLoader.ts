import type { CatalogExercise, LocalizedCatalog } from "@pianio/content-schema";
import { sourceLanguage, supportedLanguages, type Language } from "../i18n/language";

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const id = (v: unknown): v is string => text(v) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
const midi = (v: unknown) => finite(v) && Number.isInteger(v) && v >= 0 && v <= 127;
const hands = ["left", "right", "together"];
function requireValid(valid: unknown): asserts valid {
  if (!valid) throw new Error("Invalid localized catalog");
}

/** Validate before caching: Firebase can return the SPA HTML with a successful status. */
export function validateCatalog(value: unknown, language: Language): LocalizedCatalog {
  requireValid(record(value) && value.locale === language && text(value.generatedAt) && Number.isFinite(Date.parse(value.generatedAt)) && Array.isArray(value.courses) && value.courses.length > 0);
  const courseIds = new Set<string>();
  for (const c of value.courses) {
    requireValid(record(c) && id(c.id) && !courseIds.has(c.id) && text(c.title) && text(c.summary) && text(c.sourcePolicy) && finite(c.level) && Array.isArray(c.exercises) && c.exercises.length > 0 && c.exerciseCount === c.exercises.length);
    courseIds.add(c.id);
    const cov = c.coverage;
    requireValid(record(cov) && cov.locale === language && cov.sourceLanguage === sourceLanguage && record(cov.fields));
    const counts = [cov.totalFields, cov.sourceFields, cov.translatedFields, cov.fallbackFields];
    requireValid(counts.every(n => finite(n) && Number.isInteger(n) && n >= 0) && cov.totalFields === Number(cov.sourceFields) + Number(cov.translatedFields) + Number(cov.fallbackFields));
    const fields = Object.values(cov.fields);
    requireValid(fields.length === cov.totalFields && fields.every(v => ["source", "translated", "fallback"].includes(String(v))) && fields.filter(v => v === "translated").length === cov.translatedFields && fields.filter(v => v === "fallback").length === cov.fallbackFields);
    const ids = new Set<string>(), slugs = new Set<string>();
    for (const e of c.exercises) {
      requireValid(record(e) && id(e.id) && id(e.slug) && !ids.has(e.id) && !slugs.has(e.slug));
      ids.add(e.id); slugs.add(e.slug);
      requireValid(text(e.title) && text(e.summary) && text(e.goal) && hands.includes(String(e.hands)) && ["G", "F", "GF"].includes(String(e.clef)) && ["original", "public_domain", "open_license"].includes(String(e.sourceKind)) && finite(e.tempoBpm) && e.tempoBpm > 0);
      requireValid(Array.isArray(e.timeSignature) && e.timeSignature.length === 2 && e.timeSignature.every(n => finite(n) && Number.isInteger(n) && n > 0));
      requireValid((e.keySignature === undefined || (finite(e.keySignature) && Number.isInteger(e.keySignature) && Math.abs(e.keySignature) <= 7)) && (e.swing === undefined || typeof e.swing === "boolean"));
      requireValid(e.category === undefined || text(e.category));
      requireValid(record(e.license) && [e.license.type, e.license.attribution, e.license.notes].every(text));
      requireValid(e.scorePath === `/generated/${language}/scores/${c.id}/${e.slug}.musicxml` && Array.isArray(e.expectedNotes) && e.expectedNotes.length > 0);
      for (const n of e.expectedNotes) {
        requireValid(record(n) && midi(n.noteNumber) && finite(n.startBeat) && n.startBeat >= 0 && finite(n.durationBeats) && n.durationBeats > 0 && hands.includes(String(n.hand)));
        requireValid(n.noteNumbers === undefined || (Array.isArray(n.noteNumbers) && n.noteNumbers.length > 0 && n.noteNumbers.every(midi)));
        requireValid(n.dynamicMarking === undefined || ["pp", "p", "mp", "mf", "f", "ff"].includes(String(n.dynamicMarking)));
        requireValid(n.pedalState === undefined || n.pedalState === null || ["down", "up"].includes(String(n.pedalState)));
      }
    }
  }
  return value as unknown as LocalizedCatalog;
}

const musicalData = (e: CatalogExercise) => JSON.stringify([e.expectedNotes, e.timeSignature, e.tempoBpm, e.hands, e.clef, e.keySignature, e.swing]);
export function visibleCatalog(catalog: LocalizedCatalog): LocalizedCatalog {
  return { ...catalog, courses: catalog.courses.filter(c => !/^(method|technique)-level-\d+$/.test(c.id)) };
}

export function createCatalogLoader(fetcher: typeof fetch = (...args) => fetch(...args)) {
  const cache = new Map<Language, LocalizedCatalog>();
  const pending = new Map<Language, Promise<LocalizedCatalog>>();
  let identity: string | undefined;
  const canonical = new Map<string, { signature: string; exercise: CatalogExercise }>();
  function load(language: Language): Promise<LocalizedCatalog> {
    if (!supportedLanguages.includes(language)) return Promise.reject(new Error("Unsupported catalog language"));
    const cached = cache.get(language);
    if (cached) return Promise.resolve(cached);
    const inFlight = pending.get(language);
    if (inFlight) return inFlight;
    const request = (async () => {
      const response = await fetcher(`/generated/${language}/catalog.json`);
      if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
      const catalog = validateCatalog(await response.json(), language);
      const nextIdentity = JSON.stringify(catalog.courses.map(c => [c.id, c.exercises.map(e => [e.id, e.slug])]));
      if (identity !== undefined && identity !== nextIdentity) throw new Error("Inconsistent catalog identities or order");
      // Compare every exercise before publishing any data. Text changes keep music references.
      const additions: Array<[string, { signature: string; exercise: CatalogExercise }]> = [];
      for (const c of catalog.courses) for (const e of c.exercises) {
        const key = `${c.id}/${e.id}/${e.slug}`;
        const signature = musicalData(e);
        const previous = canonical.get(key);
        if (previous && previous.signature !== signature) throw new Error(`Inconsistent music: ${key}`);
        if (previous) {
          e.expectedNotes = previous.exercise.expectedNotes;
          e.timeSignature = previous.exercise.timeSignature;
        } else additions.push([key, { signature, exercise: e }]);
      }
      for (const [key, data] of additions) canonical.set(key, data);
      identity = nextIdentity;
      cache.set(language, catalog);
      return catalog;
    })().finally(() => pending.delete(language));
    pending.set(language, request);
    return request;
  }
  return { load };
}
export const catalogLoader = createCatalogLoader();
