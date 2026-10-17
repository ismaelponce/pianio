import { useTranslation } from "react-i18next";
import { useLanguage } from "../i18n/LanguageProvider";
import { normalizeLanguage, supportedLanguages } from "../i18n/language";
import { languageLabels } from "../i18n/resources";

export function LanguageSelector() {
  const { t } = useTranslation("common");
  const { requestedLanguage, pending, deferred, requestLanguage } = useLanguage();
  return <label className="language-selector">
    <span>{t("language.label")}</span>
    <select value={requestedLanguage} aria-label={t("language.label")} aria-busy={pending} onChange={e => {
      const language = normalizeLanguage(e.target.value);
      if (language) requestLanguage(language);
    }}>
      {supportedLanguages.map(language => <option key={language} value={language}>{languageLabels[language]}</option>)}
    </select>
    {pending && <span className="language-pending" role="status">{t(deferred ? "language.deferred" : "language.loading")}</span>}
  </label>;
}
