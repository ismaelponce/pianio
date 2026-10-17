# Adding a language

English (`en`) is the canonical source and fallback language. UI messages and course editorial content are translated independently. The files in [`templates/i18n/`](../templates/i18n/) provide starting points for both layers. Review translations in the pull request; no separate review registry or AI tool is required.

## 1. Choose a language code

Use the lowercase base language code supported by the application, such as `fr` or `de`. The current language resolver matches browser language preferences by their base code, so region-specific variants are not separate application languages.

Add the language to `localization.config.json` when the application should offer it. Missing UI messages and course fields use English at runtime and produce warnings, so a language can be introduced incrementally. Malformed files, invalid structure, unexpected keys, and mismatched interpolation variables still fail validation.

## 2. Translate the user interface

Start with the five files in [`templates/i18n/ui/`](../templates/i18n/ui/): `common.json`, `catalog.json`, `practice.json`, `diagnostics.json`, and `progress.json`. Copy them to `apps/web/src/i18n/locales/<language>/` and replace each empty string with its translation.

Keep the JSON keys and nesting unchanged. Preserve every interpolation variable such as `{{count}}` and `{{status}}`. Keep all plural keys and add any plural categories required by the new language; `pnpm check:i18n` validates the categories using `Intl.PluralRules`. Translate accessibility labels and document title and description as well as visible text.

Then update the application registry:

1. Import the five JSON files and add the language resource and its display name in `apps/web/src/i18n/resources.ts`.
2. Add localized note names and invalid-note labels in `apps/web/src/i18n/formatNote.ts` when the language uses different note spelling.
3. Add the language to `supportedLanguages` in `localization.config.json`.
4. Add or update locale-specific tests where behavior differs, including note formatting and language selection.

The resource type is inferred from `resources.ts`, so register the resources before using the language in application code.

## 3. Translate course content

Course source files under `content/` remain canonical. After adding the language to `localization.config.json`, scaffold one translation file for every existing course:

```sh
pnpm i18n:scaffold --locale fr
```

Replace `fr` with the locale code being added. The command uses canonical course and exercise IDs, creates empty editable fields under `content-locales/<language>/`, and leaves existing translation files untouched. It never overwrites translations, so it is safe to rerun as new source courses are added. The generic [`templates/i18n/content/course.translation.json`](../templates/i18n/content/course.translation.json) remains available as a reference for new course translation files.

Replace the placeholder course and exercise IDs with the exact `courseId` and `exercise.id` values from the source course. Add an entry for every exercise. Translate only `title`, `summary`, `goal`, and `license.notes`; omit `license.notes` when the source note is empty. Do not translate IDs, slugs, ordering, musical data, attribution, or license types. The validator rejects unknown fields and mismatched IDs.

Missing or blank editorial fields fall back to English and produce warnings. They do not count as complete translations; use the strict checker when verifying a completed translation rollout.

## 4. Validate before submitting

Run the relevant checks from the repository root:

```sh
pnpm check:i18n
pnpm check:i18n:full
pnpm test:ui
pnpm test:content
pnpm typecheck
pnpm test
pnpm build
```

`pnpm check:i18n` checks every language listed in `localization.config.json`. It reports missing UI keys by namespace, course coverage counts for each locale/course, and a per-language completeness summary for UI messages and course fields. A plural message counts as complete only when all forms required by that language are present. Warning details identify content that will use the English fallback. `pnpm check:i18n:full` runs the same validation in strict mode and exits with an error if UI keys or course fields are missing. The production build uses the warning-based check before generating localized catalogs and MusicXML. Include the translated UI, course files, and validation results in the contribution; maintainers review the changes in the pull request.
