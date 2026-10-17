import i18n, { type InitOptions } from "i18next";
import { initReactI18next } from "react-i18next";
import { fallbackLanguage, getInitialLanguage, persistExplicitLanguage, supportedLanguages, type Language } from "./language";
import { resources } from "./resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: typeof resources.en;
    returnNull: false;
  }
}

export const namespaces = ["common", "catalog", "practice", "diagnostics", "progress"] as const;
export type Namespace = (typeof namespaces)[number];

export function syncDocumentMetadata(language: Language = (i18n.resolvedLanguage ?? i18n.language ?? fallbackLanguage) as Language): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.title = i18n.t("document.title", { ns: "common", lng: language });
  const description = i18n.t("document.description", { ns: "common", lng: language });
  document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", description);
}

let initialization: Promise<void> | undefined;

function options(language: Language): InitOptions {
  return {
    resources,
    lng: language,
    fallbackLng: fallbackLanguage,
    supportedLngs: [...supportedLanguages],
    ns: [...namespaces],
    defaultNS: "common",
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
  };
}

export function initializeI18n(language: Language = getInitialLanguage()): Promise<void> {
  if (!initialization) {
    i18n.use(initReactI18next);
    initialization = i18n.init(options(language))
      .then(() => {
        syncDocumentMetadata(language);
      })
      .catch(async () => {
        try {
          if (!i18n.isInitialized) await i18n.init(options(fallbackLanguage));
          else await i18n.changeLanguage(fallbackLanguage);
          syncDocumentMetadata(fallbackLanguage);
        } catch {
          // React still renders with i18next's key fallback instead of waiting forever.
        }
      });
  }
  return initialization;
}

export async function changeLanguage(language: Language): Promise<void> {
  persistExplicitLanguage(language);
  await initializeI18n();
  try {
    await i18n.changeLanguage(language);
  } finally {
    syncDocumentMetadata(language);
  }
}

i18n.on("languageChanged", (language) => {
  syncDocumentMetadata((language.split("-")[0] as Language) || fallbackLanguage);
});

export { i18n };
export default i18n;
