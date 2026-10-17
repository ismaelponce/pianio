import { afterEach, describe, expect, it } from "vitest";
import {
  getInitialLanguage, languageStorageKey, normalizeLanguage, persistExplicitLanguage,
  resetExplicitLanguageForTests, resolveLanguage, type StorageLike,
} from "./language";

afterEach(() => resetExplicitLanguageForTests());

describe("language selection", () => {
  it("normalizes supported regional tags and rejects unsupported values", () => {
    expect(normalizeLanguage("en-US")).toBe("en");
    expect(normalizeLanguage("EN_us")).toBe("en");
    expect(normalizeLanguage("fr-FR")).toBeUndefined();
    expect(normalizeLanguage({})).toBeUndefined();
  });

  it("uses the supported stored language or the first supported browser language", () => {
    const storage: StorageLike = { getItem: () => "en-US", setItem: () => undefined };
    expect(resolveLanguage({ storage, navigatorLanguages: ["fr-FR", "en-US"] })).toBe("en");
    expect(resolveLanguage({ storage: { getItem: () => "broken", setItem: () => undefined }, navigatorLanguages: ["fr", "en-US"] })).toBe("en");
    expect(resolveLanguage({ storage: null, navigatorLanguages: ["fr-FR"] })).toBe("en");
  });

  it("remembers explicit choices when storage is absent or throws", () => {
    expect(persistExplicitLanguage("en", null)).toBe(false);
    expect(resolveLanguage({ storage: null, navigatorLanguages: ["fr-FR"] })).toBe("en");
    const blockedStorage: StorageLike = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(resolveLanguage({ storage: blockedStorage, navigatorLanguages: ["fr-FR"] })).toBe("en");
    expect(persistExplicitLanguage("en", blockedStorage)).toBe(false);
    expect(resolveLanguage({ storage: null, navigatorLanguages: null })).toBe("en");
  });

  it("uses English if browser globals are unavailable", () => {
    expect(resolveLanguage({ storage: null, navigatorLanguages: null })).toBe("en");
    expect(getInitialLanguage()).toBe("en");
    expect(languageStorageKey).toBe("pianio:language");
  });
});
