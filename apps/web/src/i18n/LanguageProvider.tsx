import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { LocalizedCatalog } from "@pianio/content-schema";
import { catalogLoader, visibleCatalog } from "../content/catalogLoader";
import { i18n, syncDocumentMetadata } from "./index";
import { getInitialLanguage, persistExplicitLanguage, sourceLanguage, type Language } from "./language";

interface LanguageState {
  requestedLanguage: Language;
  activeLanguage: Language;
  contentLanguage: Language | null;
  catalog: LocalizedCatalog | null;
  pending: boolean;
  deferred: boolean;
  error: boolean;
}
interface LanguageContextValue extends LanguageState {
  requestLanguage: (language: Language) => void;
  retry: () => void;
  beginActivity: () => () => void;
}
const LanguageContext = createContext<LanguageContextValue | null>(null);
export function LanguageProvider({ children, loader = catalogLoader, initialLanguage = getInitialLanguage() }: {
  children: ReactNode; loader?: Pick<typeof catalogLoader, "load">; initialLanguage?: Language;
}) {
  const [state, setState] = useState<LanguageState>(() => ({ requestedLanguage: initialLanguage, activeLanguage: initialLanguage, contentLanguage: null, catalog: null, pending: true, deferred: false, error: false }));
  const serial = useRef(0);
  const requested = useRef(initialLanguage);
  const activities = useRef(new Set<symbol>());
  const alive = useRef(true);
  const ready = useRef<{ serial: number; language: Language; catalog: LocalizedCatalog } | null>(null);

  const applyReady = useCallback(() => {
    const next = ready.current;
    if (!alive.current || !next || next.serial !== serial.current || activities.current.size) return;
    ready.current = null;
    // Dictionaries are bundled: changeLanguage emits synchronously, in the same React batch.
    void i18n.changeLanguage(next.language);
    syncDocumentMetadata(next.language);
    setState({ requestedLanguage: next.language, activeLanguage: next.language, contentLanguage: next.catalog.locale as Language, catalog: visibleCatalog(next.catalog), pending: false, deferred: false, error: false });
  }, []);

  const load = useCallback((language: Language) => {
    const version = ++serial.current;
    requested.current = language;
    ready.current = null;
    setState(s => ({ ...s, requestedLanguage: language, pending: true, deferred: activities.current.size > 0, error: false }));
    void (async () => {
      let catalog: LocalizedCatalog;
      try {
        try { catalog = await loader.load(language); }
        catch (error) {
          if (version !== serial.current || !alive.current) return;
          if (language === sourceLanguage) throw error;
          catalog = await loader.load(sourceLanguage);
        }
        if (version !== serial.current || !alive.current) return;
        ready.current = { serial: version, language, catalog };
        applyReady();
      } catch {
        if (version !== serial.current || !alive.current) return;
        setState(s => ({ ...s, pending: false, deferred: false, error: true }));
      }
    })();
  }, [loader, applyReady]);

  useEffect(() => {
    alive.current = true;
    load(requested.current);
    return () => { alive.current = false; ++serial.current; };
  }, [load]);

  const requestLanguage = useCallback((language: Language) => {
    persistExplicitLanguage(language);
    load(language);
  }, [load]);
  const beginActivity = useCallback(() => {
    const token = Symbol();
    activities.current.add(token);
    setState(s => ({ ...s, deferred: s.pending }));
    return () => {
      if (!activities.current.delete(token)) return;
      if (!alive.current) return;
      if (!activities.current.size) {
        setState(s => ({ ...s, deferred: false }));
        applyReady();
      }
    };
  }, [applyReady]);
  return <LanguageContext.Provider value={{ ...state, requestLanguage, retry: () => load(requested.current), beginActivity }}>{children}</LanguageContext.Provider>;
}
export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("LanguageProvider is required");
  return context;
}
