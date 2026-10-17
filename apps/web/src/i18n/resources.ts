import enCommon from "./locales/en/common.json";
import enCatalog from "./locales/en/catalog.json";
import enPractice from "./locales/en/practice.json";
import enDiagnostics from "./locales/en/diagnostics.json";
import enProgress from "./locales/en/progress.json";

export const resources = {
  en: { common: enCommon, catalog: enCatalog, practice: enPractice, diagnostics: enDiagnostics, progress: enProgress },
} as const;

export type Language = keyof typeof resources;
export const languageLabels: Record<Language, string> = { en: "English" };
