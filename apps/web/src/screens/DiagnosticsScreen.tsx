import { startTransition, useDeferredValue, useEffect, useEffectEvent, useRef, useState } from "react";
import {
  createMidiAccessAdapter,
  describeMidiSupport,
  formatMidiNote,
  requestMidiAccess,
  type MidiAccessLike,
  type MidiInputSummary,
  type ParsedMidiEvent
} from "@pianio/midi-web";

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
  lastError: string | null;
  inputs: MidiInputSummary[];
  events: LoggedMidiEvent[];
}

type AccessState = "idle" | "requesting" | "granted" | "error";

const MAX_DEBUG_EVENTS = 40;
const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

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

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Not yet";
  }

  return timestampFormatter.format(new Date(value));
}

function formatRawData(data: readonly number[]): string {
  return data.map((value) => value.toString(16).padStart(2, "0")).join(" ");
}

function formatEventSummary(event: ParsedMidiEvent): string {
  if (event.type === "sustain") {
    return event.engaged ? "Sustain pedal engaged" : "Sustain pedal released";
  }

  const action = event.type === "note-on" ? "Note on" : "Note off";
  return `${action} ${formatMidiNote(event.note)}`;
}

function formatEventDetail(event: ParsedMidiEvent): string {
  if (event.type === "sustain") {
    return `Channel ${event.channel} | value ${event.value}`;
  }

  return `Channel ${event.channel} | velocity ${event.velocity}`;
}

export function DiagnosticsScreen() {
  const midiSupport = describeMidiSupport();
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
      const message = error instanceof Error ? error.message : "Failed to request MIDI access.";

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

  const requestButtonLabel = access ? "Re-request MIDI access" : "Request MIDI access";

  return (
    <div className="screen-stack diagnostics-page">
      <section className="diagnostics-header">
        <div>
          <span className="eyebrow">Diagnostics</span>
          <h1>MIDI check</h1>
          <p>
            Request Web MIDI access, verify connected inputs, and capture note and sustain
            pedal traffic without leaving the browser.
          </p>
          <div className="button-row">
            <button
              className="action-button"
              type="button"
              onClick={handleRequestAccess}
              disabled={!midiSupport.available || accessState === "requesting"}
            >
              {accessState === "requesting" ? "Requesting access..." : requestButtonLabel}
            </button>
            <button className="secondary-button" type="button" onClick={handleResetSession}>
              Reset session
            </button>
          </div>
        </div>
        <div className="panel status-card">
          <h2>Browser readiness</h2>
          <p className={midiSupport.available ? "status ok" : "status warn"}>
            {midiSupport.summary}
          </p>
          <p>{midiSupport.detail}</p>
          <p className="hint">
            Primary validation target: desktop Chrome over HTTPS. This screen remains useful
            even when no keyboard is connected.
          </p>
        </div>
      </section>

      <section className="diagnostics-grid">
        <article className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">Session</span>
              <h2>Debug state</h2>
            </div>
            <p className={accessState === "error" ? "status warn" : "status ok"}>
              {accessState === "idle" && "Permission not requested"}
              {accessState === "requesting" && "Waiting for permission"}
              {accessState === "granted" && "Access granted"}
              {accessState === "error" && "Request failed"}
            </p>
          </div>

          <div className="session-grid">
            <div>
              <span className="meta-label">Session started</span>
              <strong>{formatTimestamp(session.startedAt)}</strong>
            </div>
            <div>
              <span className="meta-label">Last update</span>
              <strong>{formatTimestamp(session.lastUpdatedAt)}</strong>
            </div>
            <div>
              <span className="meta-label">Access requested</span>
              <strong>{formatTimestamp(session.accessRequestedAt)}</strong>
            </div>
            <div>
              <span className="meta-label">Access granted</span>
              <strong>{formatTimestamp(session.accessGrantedAt)}</strong>
            </div>
            <div>
              <span className="meta-label">Request count</span>
              <strong>{session.requestCount}</strong>
            </div>
            <div>
              <span className="meta-label">Captured events</span>
              <strong>{session.events.length}</strong>
            </div>
          </div>

          {session.lastError ? <p className="status warn">{session.lastError}</p> : null}
        </article>

        <article className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">Inputs</span>
              <h2>Detected MIDI devices</h2>
            </div>
            <p>{session.inputs.length} visible</p>
          </div>

          {session.inputs.length === 0 ? (
            <div className="empty-state">
              <strong>No MIDI inputs detected</strong>
              <p>
                After permission is granted, compatible devices should appear here automatically.
                You can keep this page open while connecting a keyboard.
              </p>
            </div>
          ) : (
            <ul className="input-list">
              {session.inputs.map((input) => (
                <li className="input-card" key={input.id}>
                  <div>
                    <strong>{input.name ?? "Unnamed input"}</strong>
                    <p>{input.manufacturer ?? "Unknown manufacturer"}</p>
                  </div>
                  <div className="input-meta">
                    <span className="pill">{input.state}</span>
                    <span className="pill muted">{input.connection}</span>
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
            <span className="eyebrow">Events</span>
            <h2>Recent MIDI traffic</h2>
          </div>
          <p>Logging note on, note off, and sustain pedal messages only.</p>
        </div>

        {deferredEvents.length === 0 ? (
          <div className="empty-state">
            <strong>No matching MIDI events yet</strong>
            <p>
              Press keys or move the sustain pedal after granting access. Unsupported message
              types are ignored so the log stays focused.
            </p>
          </div>
        ) : (
          <div className="event-table" role="table" aria-label="Recent MIDI events">
            <div className="event-row event-row-header" role="row">
              <span role="columnheader">Time</span>
              <span role="columnheader">Event</span>
              <span role="columnheader">Details</span>
              <span role="columnheader">Source</span>
              <span role="columnheader">Raw</span>
            </div>
            {deferredEvents.map((entry) => (
              <div className="event-row" key={entry.id} role="row">
                <span role="cell">{formatTimestamp(entry.capturedAt)}</span>
                <span role="cell">
                  <span className={`event-chip ${entry.event.type}`}>{formatEventSummary(entry.event)}</span>
                </span>
                <span role="cell">{formatEventDetail(entry.event)}</span>
                <span role="cell">
                  {entry.event.source.name ?? "Unknown input"}
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
