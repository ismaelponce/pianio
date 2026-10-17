import { startTransition, useDeferredValue, useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createMidiAccessAdapter,
  describeMidiSupport,
  requestMidiAccess,
  type MidiAccessLike,
  type MidiInputSummary,
  type ParsedMidiEvent
} from "@pianio/midi-web";
import { formatNote } from "../i18n/formatNote";
import type { Language } from "../i18n/language";
import { midiSupportMessages, nativeErrorMessage, renderMessage, resolveLanguage, type MessageDescriptor } from "../i18n/messages";

interface LoggedMidiEvent {
  id: number;
  capturedAt: string;
  event: ParsedMidiEvent;
}

interface MidiDebugSession {
  startedAt: string;
  lastUpdatedAt: string;
  requestCount: number;
  accessRequestedAt: string | null;
  accessGrantedAt: string | null;
  lastError: MessageDescriptor | null;
  inputs: MidiInputSummary[];
  events: LoggedMidiEvent[];
}

type AccessState = "idle" | "requesting" | "granted" | "error";

const MAX_DEBUG_EVENTS = 40;
function createEmptySession(inputs: MidiInputSummary[] = []): MidiDebugSession {
  const now = new Date().toISOString();

  return {
    startedAt: now,
    lastUpdatedAt: now,
    requestCount: 0,
    accessRequestedAt: null,
    accessGrantedAt: null,
    lastError: null,
    inputs,
    events: []
  };
}

function formatTimestamp(value: string | null, language: Language, notYet: string): string {
  if (!value) {
    return notYet;
  }
  return new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function formatRawData(data: readonly number[]): string {
  return data.map((value) => value.toString(16).padStart(2, "0")).join(" ");
}

function formatEventSummary(event: ParsedMidiEvent, language: Language, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (event.type === "sustain") {
    return event.engaged ? t("ui.event.pedalDown") : t("ui.event.pedalUp");
  }
  return t(event.type === "note-on" ? "ui.event.noteOn" : "ui.event.noteOff", { note: formatNote(event.note, language) });
}

function formatEventDetail(event: ParsedMidiEvent, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (event.type === "sustain") {
    return t("ui.event.channelValue", { channel: event.channel, value: event.value });
  }
  return t("ui.event.channelVelocity", { channel: event.channel, velocity: event.velocity });
}

export function DiagnosticsScreen() {
  const { i18n, t: translate } = useTranslation("diagnostics");
  const t = translate as (key: string, options?: Record<string, unknown>) => string;
  const language = resolveLanguage(i18n.resolvedLanguage ?? i18n.language);
  const midiSupport = describeMidiSupport();
  const supportMessages = midiSupportMessages(midiSupport);
  const [access, setAccess] = useState<MidiAccessLike | null>(null);
  const [accessState, setAccessState] = useState<AccessState>("idle");
  const [session, setSession] = useState<MidiDebugSession>(() => createEmptySession());
  const deferredEvents = useDeferredValue(session.events);
  const eventCounter = useRef(0);

  const handleInputsChanged = useEffectEvent((inputs: MidiInputSummary[]) => {
    const updatedAt = new Date().toISOString();

    startTransition(() => {
      setSession((current) => ({
        ...current,
        inputs,
        lastUpdatedAt: updatedAt
      }));
    });
  });

  const handleMidiEvent = useEffectEvent((event: ParsedMidiEvent) => {
    const capturedAt = new Date().toISOString();
    const nextEvent: LoggedMidiEvent = {
      id: eventCounter.current,
      capturedAt,
      event
    };

    eventCounter.current += 1;

    startTransition(() => {
      setSession((current) => ({
        ...current,
        lastUpdatedAt: capturedAt,
        events: [nextEvent, ...current.events].slice(0, MAX_DEBUG_EVENTS)
      }));
    });
  });

  useEffect(() => {
    if (!access) {
      return undefined;
    }

    const adapter = createMidiAccessAdapter(access);
    setSession((current) => ({
      ...current,
      inputs: adapter.getInputs(),
      lastUpdatedAt: new Date().toISOString()
    }));

    return adapter.subscribe({
      onMidiEvent: handleMidiEvent,
      onInputsChanged: handleInputsChanged
    });
  }, [access]);

  const handleRequestAccess = async () => {
    const requestedAt = new Date().toISOString();
    setAccessState("requesting");
    setSession((current) => ({
      ...current,
      requestCount: current.requestCount + 1,
      accessRequestedAt: requestedAt,
      lastUpdatedAt: requestedAt,
      lastError: null
    }));

    try {
      const midiAccess = await requestMidiAccess();
      const grantedAt = new Date().toISOString();

      setAccess(midiAccess);
      setAccessState("granted");
      setSession((current) => ({
        ...current,
        accessGrantedAt: grantedAt,
        lastUpdatedAt: grantedAt,
        lastError: null
      }));
    } catch (error) {
      const failedAt = new Date().toISOString();
      const message = nativeErrorMessage(error, "midi");

      setAccess(null);
      setAccessState("error");
      setSession((current) => ({
        ...current,
        lastError: message,
        lastUpdatedAt: failedAt
      }));
    }
  };

  const handleResetSession = () => {
    eventCounter.current = 0;
    setSession((current) => ({
      ...createEmptySession(current.inputs),
      requestCount: current.requestCount,
      accessRequestedAt: current.accessRequestedAt,
      accessGrantedAt: current.accessGrantedAt,
      lastError: current.lastError
    }));
  };

  const requestButtonLabel = access ? t("ui.requestAgain") : t("ui.requestAccess");

  return (
    <div className="screen-stack diagnostics-page">
      <section className="diagnostics-header">
        <div>
          <span className="eyebrow">{t("ui.title")}</span>
          <h1>{t("ui.midiCheck")}</h1>
          <p>
            {t("ui.intro")}
          </p>
          <div className="button-row">
            <button
              className="action-button"
              type="button"
              onClick={handleRequestAccess}
              disabled={!midiSupport.available || accessState === "requesting"}
            >
              {accessState === "requesting" ? t("ui.requesting") : requestButtonLabel}
            </button>
            <button className="secondary-button" type="button" onClick={handleResetSession}>
              {t("ui.resetSession")}
            </button>
          </div>
        </div>
        <div className="panel status-card">
          <h2>{t("ui.browserReadiness")}</h2>
          <p className={midiSupport.available ? "status ok" : "status warn"}>
            {renderMessage(supportMessages.summary)}
          </p>
          <p>{renderMessage(supportMessages.detail)}</p>
          <p className="hint">
            {t("ui.validationHint")}
          </p>
        </div>
      </section>

      <section className="diagnostics-grid">
        <article className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("ui.session")}</span>
              <h2>{t("ui.debugState")}</h2>
            </div>
            <p className={accessState === "error" ? "status warn" : "status ok"}>
              {accessState === "idle" && t("ui.permissionIdle")}
              {accessState === "requesting" && t("ui.permissionWaiting")}
              {accessState === "granted" && t("ui.permissionGranted")}
              {accessState === "error" && t("ui.permissionFailed")}
            </p>
          </div>

          <div className="session-grid">
            <div>
              <span className="meta-label">{t("ui.started")}</span>
              <strong>{formatTimestamp(session.startedAt, language, t("ui.notYet"))}</strong>
            </div>
            <div>
              <span className="meta-label">{t("ui.lastUpdate")}</span>
              <strong>{formatTimestamp(session.lastUpdatedAt, language, t("ui.notYet"))}</strong>
            </div>
            <div>
              <span className="meta-label">{t("ui.accessRequested")}</span>
              <strong>{formatTimestamp(session.accessRequestedAt, language, t("ui.notYet"))}</strong>
            </div>
            <div>
              <span className="meta-label">{t("ui.accessGranted")}</span>
              <strong>{formatTimestamp(session.accessGrantedAt, language, t("ui.notYet"))}</strong>
            </div>
            <div>
              <span className="meta-label">{t("ui.requestCount")}</span>
              <strong>{session.requestCount}</strong>
            </div>
            <div>
              <span className="meta-label">{t("ui.capturedEvents")}</span>
              <strong>{session.events.length}</strong>
            </div>
          </div>

          {session.lastError ? <p className="status warn">{renderMessage(session.lastError)}{session.lastError.technicalDetail ? <code> — {session.lastError.technicalDetail}</code> : null}</p> : null}
        </article>

        <article className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("ui.inputs")}</span>
              <h2>{t("ui.devices")}</h2>
            </div>
            <p>{t("ui.visibleCount", { count: session.inputs.length })}</p>
          </div>

          {session.inputs.length === 0 ? (
            <div className="empty-state">
              <strong>{t("ui.noInputs")}</strong>
              <p>
                {t("ui.noInputsHint")}
              </p>
            </div>
          ) : (
            <ul className="input-list">
              {session.inputs.map((input) => (
                <li className="input-card" key={input.id}>
                  <div>
                    <strong>{input.name ?? t("ui.unnamedInput")}</strong>
                    <p>{input.manufacturer ?? t("ui.unknownManufacturer")}</p>
                  </div>
                  <div className="input-meta">
                    <span className="pill">{t(`ui.deviceState.${input.state}`)}</span>
                    <span className="pill muted">{t(`ui.connectionState.${input.connection}`)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
              <span className="eyebrow">{t("ui.events")}</span>
              <h2>{t("ui.recentTraffic")}</h2>
          </div>
          <p>{t("ui.loggingHint")}</p>
        </div>

        {deferredEvents.length === 0 ? (
          <div className="empty-state">
            <strong>{t("ui.noEvents")}</strong>
            <p>
              {t("ui.noEventsHint")}
            </p>
          </div>
        ) : (
          <div className="event-table" role="table" aria-label={t("ui.recentEventsLabel")}>
            <div className="event-row event-row-header" role="row">
              <span role="columnheader">{t("ui.time")}</span>
              <span role="columnheader">{t("ui.event")}</span>
              <span role="columnheader">{t("ui.details")}</span>
              <span role="columnheader">{t("ui.source")}</span>
              <span role="columnheader">{t("ui.raw")}</span>
            </div>
            {deferredEvents.map((entry) => (
              <div className="event-row" key={entry.id} role="row">
                <span role="cell">{formatTimestamp(entry.capturedAt, language, t("ui.notYet"))}</span>
                <span role="cell">
                  <span className={`event-chip ${entry.event.type}`}>{formatEventSummary(entry.event, language, t)}</span>
                </span>
                <span role="cell">{formatEventDetail(entry.event, t)}</span>
                <span role="cell">
                  {entry.event.source.name ?? t("ui.unknownInput")}
                  {entry.event.source.manufacturer ? ` (${entry.event.source.manufacturer})` : ""}
                </span>
                <code className="mono" role="cell">
                  {formatRawData(entry.event.rawData)}
                </code>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
