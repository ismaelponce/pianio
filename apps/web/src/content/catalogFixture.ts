import type { LocalizedCatalog } from "@pianio/content-schema";
import type { Language } from "../i18n/language";

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export function catalogFixture(language: Language): LocalizedCatalog {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z", locale: language,
    courses: [{
      id: "method-level-1a", title: `Course ${language}`, summary: "Summary", level: 1, sourcePolicy: "original", exerciseCount: 2,
      coverage: { locale: language, sourceLanguage: "en", totalFields: 2, sourceFields: 2, translatedFields: 0, fallbackFields: 0, fields: { title: "source", summary: "source" } },
      exercises: ["one", "two"].map((slug, index) => ({ id: `ex-${slug}`, slug, title: `Exercise ${slug}`, summary: "Summary", goal: "Play C", hands: "right", clef: "G", sourceKind: "original", tempoBpm: 120, timeSignature: [4, 4], license: { type: "CC0", attribution: "", notes: "" }, scorePath: `/generated/${language}/scores/method-level-1a/${slug}.musicxml`, expectedNotes: [0, 4, 8].map(startBeat => ({ noteNumber: 60 + index, startBeat, durationBeats: 1, hand: "right" })) }))
    }]
  };
}
