import localizationConfig from "../../../../localization.config.json";
import type { Language } from "./resources";
export type { Language } from "./resources";

export const supportedLanguages = localizationConfig.supportedLanguages as readonly Language[];

export const sourceLanguage = localizationConfig.sourceLanguage as Language;
export const fallbackLanguage = localizationConfig.fallbackLanguage as Language;
export const languageStorageKey = "pianio:language";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LanguageEnvironment {
  storage?: StorageLike | null;
  navigatorLanguages?: readonly string[] | null;
  explicitMemoryPreference?: Language | null;
}

let explicitMemoryPreference: Language | null = null;

export function normalizeLanguage(value: unknown): Language | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  if (!normalized) return undefined;
  const baseLanguage = normalized.split("-")[0];
  return supportedLanguages.find((language) => language === baseLanguage);
}

function safelyReadStorage(storage: StorageLike | null | undefined): unknown {
  try {
    return storage?.getItem(languageStorageKey);
  } catch {
    return undefined;
  }
}

export function resolveLanguage(environment: LanguageEnvironment = {}): Language {
  const memoryPreference = environment.explicitMemoryPreference ?? explicitMemoryPreference;
  if (memoryPreference) return memoryPreference;

  const storedLanguage = normalizeLanguage(safelyReadStorage(environment.storage));
  if (storedLanguage) return storedLanguage;

  for (const preferredLanguage of environment.navigatorLanguages ?? []) {
    const language = normalizeLanguage(preferredLanguage);
    if (language) return language;
  }
  return fallbackLanguage;
}

export function rememberExplicitLanguage(language: Language): void {
  explicitMemoryPreference = language;
}

export function persistExplicitLanguage(
  language: Language,
  storage: StorageLike | null | undefined = getBrowserStorage(),
): boolean {
  rememberExplicitLanguage(language);
  try {
    storage?.setItem(languageStorageKey, language);
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function getBrowserStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function getBrowserLanguages(): readonly string[] {
  try {
    return globalThis.navigator?.languages ?? [];
  } catch {
    return [];
  }
}

export function getInitialLanguage(): Language {
  return resolveLanguage({ storage: getBrowserStorage(), navigatorLanguages: getBrowserLanguages() });
}

export function resetExplicitLanguageForTests(): void {
  explicitMemoryPreference = null;
}
