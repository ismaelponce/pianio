import { createInstance } from "i18next";
import { describe, expect, it, vi } from "vitest";
import { initializeI18n, i18n, syncDocumentMetadata } from "./index";
import { translationResourceCoverage, validateTranslationResources } from "../../../../scripts/check-translations.mjs";

describe("i18n foundation", () => {
  it("falls back and still resolves initialization if startup initialization fails", async () => {
    document.head.innerHTML = '<meta name="description" content="old">';
    document.documentElement.lang = "en";
    vi.spyOn(i18n, "init").mockRejectedValueOnce(new Error("simulated initialization failure"));
    await initializeI18n("en");
    expect(i18n.language).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    await i18n.changeLanguage("en");
    syncDocumentMetadata("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("Pianio — Free, open piano lessons");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toContain("Learn piano");
  });

  it("falls back to the source language when a resource key is missing", async () => {
    const instance = createInstance();
    await instance.init({
      lng: "fr",
      fallbackLng: "en",
      ns: ["common"],
      defaultNS: "common",
      resources: { en: { common: { foundationProbe: "Source fallback" } }, fr: { common: {} } },
    });
    expect(instance.t("foundationProbe" as never)).toBe("Source fallback");
  });

  it("falls back when a localized resource is empty", async () => {
    const instance = createInstance();
    await instance.init({
      lng: "fr",
      fallbackLng: "en",
      ns: ["common"],
      defaultNS: "common",
      returnEmptyString: false,
      resources: { en: { common: { foundationProbe: "Source fallback" } }, fr: { common: { foundationProbe: "" } } },
    });
    expect(instance.t("foundationProbe" as never)).toBe("Source fallback");
  });

  it("accepts locale-specific plural categories without requiring another locale's forms", () => {
    const resources = {
      en: { common: { item_one: "{{count}} item", item_other: "{{count}} items" } },
      ar: {
        common: {
          item_zero: "{{count}} item", item_one: "{{count}} item", item_two: "{{count}} items",
          item_few: "{{count}} items", item_many: "{{count}} items", item_other: "{{count}} items",
        },
      },
    };
    expect(validateTranslationResources(resources, ["en", "ar"], "en")).toEqual([]);
  });

  it("counts each plural message once and requires all locale-specific forms for completeness", () => {
    const resources = {
      en: { common: { greeting: "Hello", item_one: "{{count}} item", item_other: "{{count}} items" } },
      fr: { common: { greeting: "Bonjour", item_one: "{{count}} élément" } },
      it: { common: { greeting: "Ciao", item_many: "{{count}} elementi", item_one: "{{count}} elemento", item_other: "{{count}} elementi" } },
    };
    expect(translationResourceCoverage(resources, ["en", "fr", "it"], "en")).toEqual([
      { language: "en", translated: 2, total: 2 },
      { language: "fr", translated: 1, total: 2 },
      { language: "it", translated: 2, total: 2 },
    ]);
  });

  it("reports missing keys, unexpected keys, empty strings, parameter mismatch and plural gaps", () => {
    const invalid = {
      en: { common: { greeting: "Hello {{name}}", item_one: "{{count}} item", item_other: "{{count}} items" } },
      fr: { common: { greeting: "Bonjour", extra: "surplus", empty: "", item_one: "{{count}} élément" } },
    };
    const issues = validateTranslationResources(invalid, ["en", "fr"], "en");
    expect(issues).toContain('fr: interpolation parameters differ at "common.greeting"');
    expect(issues).toContain('fr: unexpected key "common.extra"');
    expect(issues).toContain('fr: empty string at "common.empty"');
    expect(issues).toContain('fr: plural key "common.item" is missing form "other"');
  });

  it("can report incomplete translations as fallback warnings while retaining structural errors", () => {
    const resources = {
      en: { common: { greeting: "Hello {{name}}" } },
      fr: { common: { greeting: "", extra: "surplus" } },
    };
    const warnings: string[] = [];
    const issues = validateTranslationResources(resources, ["en", "fr"], "en", undefined, { allowFallbacks: true, warnings });
    expect(warnings).toContain('fr: empty string at "common.greeting"; using the source-language fallback');
    expect(issues).toContain('fr: unexpected key "common.extra"');
    expect(issues).not.toContain('fr: missing key "common.greeting"');
  });

  it("rejects mismatched namespaces and keys in otherwise valid fixtures", () => {
    const valid = {
      en: { common: { greeting: "Hello {{name}}" }, catalog: {} },
      fr: { common: { greeting: "Bonjour {{name}}" }, catalog: {} },
    };
    expect(validateTranslationResources(valid, ["en", "fr"], "en")).toEqual([]);
    expect(validateTranslationResources(valid, ["en", "fr"], "en", ["common", "catalog", "practice", "diagnostics", "progress"]))
      .toContain('en: missing namespace "practice"');
    expect(validateTranslationResources({ ...valid, fr: { common: { greeting: "Bonjour {{name}}" }, extra: {} } }, ["en", "fr"], "en"))
      .toContain('fr: missing namespace "catalog"');
  });
});
