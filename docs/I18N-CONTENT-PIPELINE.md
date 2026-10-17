# Localized course content pipeline

Course source files under `content/` remain canonical and language-independent. Optional editorial translations live under `content-locales/<locale>/`, with one file per course. The pipeline combines translated editorial fields with canonical musical data to generate locale-specific catalogs and MusicXML assets.

Use the reusable course translation starting point in [`templates/i18n/content/`](../templates/i18n/content/). For the UI resource templates and the complete language contribution workflow, see [Adding a language](ADDING-A-LANGUAGE.en.md).

## Translation contract

A translation file is named `<courseId>.json` and uses stable exercise IDs:

```json
{
  "courseId": "method-level-1a",
  "title": "Course title",
  "summary": "Course summary",
  "exercises": {
    "exercise-id": {
      "title": "Exercise title",
      "summary": "Exercise summary",
      "goal": "Exercise goal",
      "license": { "notes": "Editorial licensing note" }
    }
  }
}
```

Only editorial fields may be translated. IDs, slugs, order, notes, rhythms, tempo, key signatures, attribution, and other musical or licensing data come from the canonical source. Missing or blank editorial fields use the source-language value and produce warnings. The strict translation check can require complete coverage.

## Generation and validation

`localization.config.json` declares the supported locales, source locale, and fallback locale. The pipeline reads only canonical course files from `content/`; it never treats translation files as source courses. It validates locale configuration and translation documents, builds each localized catalog from the same musical data, and writes generated assets beneath `apps/web/public/generated/`.

The translation checker compares UI resource structure and interpolation parameters and validates content coverage. Run `pnpm check:i18n` to see missing UI keys, per-course translated/fallback field counts, and separate UI and course completeness percentages for each configured locale. A UI plural message counts as complete only when all plural forms required by that locale are present. The ordinary check and production build warn when a source-language fallback is present. `pnpm check:i18n:full` can be run separately to require complete translations. Review happens through the project's normal pull request process. Generated output is disposable and should not be committed.

See [Adding a language](ADDING-A-LANGUAGE.en.md) for the contribution workflow and validation commands.
