import i18n from "./index";
import { fallbackLanguage, normalizeLanguage, type Language } from "./language";
import type { MidiSupportDescription } from "@pianio/midi-web";
import type { ProgressImportResult } from "../progress";

export type MessageNamespace = "catalog" | "diagnostics" | "practice" | "progress";
export interface MessageDescriptor {
  namespace: MessageNamespace;
  key: string;
  params?: Record<string, string | number>;
  /** Original native or transport detail, retained for technical diagnostics. */
  technicalDetail?: string;
}

export function renderMessage(message: MessageDescriptor, language?: Language): string {
  return String(i18n.t(message.key as never, {
    ns: message.namespace,
    ...(language ? { lng: language } : {}),
    ...(message.params ?? {}),
  } as never));
}

export function resolveLanguage(language: string | undefined): Language {
  return normalizeLanguage(language) ?? fallbackLanguage;
}

export function midiSupportMessages(support: MidiSupportDescription): { summary: MessageDescriptor; detail: MessageDescriptor } {
  return {
    summary: { namespace: "diagnostics", key: `midi.support.${support.code}.summary` },
    detail: { namespace: "diagnostics", key: `midi.support.${support.code}.detail` },
  };
}

export function nativeErrorMessage(error: unknown, area: "midi" | "catalog" | "score"): MessageDescriptor {
  const errorRecord = error && typeof error === "object" ? error as { name?: unknown; message?: unknown } : null;
  const technicalDetail = typeof errorRecord?.message === "string" ? errorRecord.message : typeof error === "string" ? error : undefined;
  const name = typeof errorRecord?.name === "string" ? errorRecord.name : "";
  const namespace: MessageNamespace = area === "midi" ? "diagnostics" : area === "catalog" ? "catalog" : "practice";

  if (area === "midi") {
    const keyByName: Record<string, string> = {
      NotAllowedError: "midi.error.permission-denied",
      SecurityError: "midi.error.security",
      AbortError: "midi.error.aborted",
      InvalidStateError: "midi.error.invalid-state",
      NotSupportedError: "midi.error.unsupported",
    };
    return { namespace, key: keyByName[name] ?? "midi.error.unknown", technicalDetail };
  }

  const statusMatch = technicalDetail?.match(/(?:failed to fetch score:|catalog request failed with|(?:score|catalog) HTTP)\s*(\d{3})/i);
  if (statusMatch) {
    return { namespace, key: `${area}.error.http`, params: { status: Number(statusMatch[1]) }, technicalDetail };
  }
  if (name === "TypeError" || name === "NetworkError") {
    return { namespace, key: `${area}.error.network`, technicalDetail };
  }
  return { namespace, key: `${area}.error.unknown`, technicalDetail };
}

export function importProgressMessage(result: ProgressImportResult): MessageDescriptor {
  return {
    namespace: "progress",
    key: result.code,
    ...(result.outcome === "success" ? { params: result.params } : {}),
  };
}
