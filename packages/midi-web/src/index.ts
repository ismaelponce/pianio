export type MidiPortDeviceState = "connected" | "disconnected";
export type MidiPortConnectionState = "open" | "closed" | "pending";

export interface MidiSupportDescription {
  available: boolean;
  summary: string;
  detail: string;
}

export interface MidiInputSummary {
  id: string;
  manufacturer: string | null;
  name: string | null;
  state: MidiPortDeviceState;
  connection: MidiPortConnectionState;
}

export interface MidiMessageSource {
  id: string;
  name: string | null;
  manufacturer: string | null;
}

export interface MidiMessageContext {
  source: MidiMessageSource;
  data: ArrayLike<number>;
  receivedTime: number;
}

export interface MidiMessageEventLike {
  data: ArrayLike<number>;
  receivedTime?: number;
  timeStamp?: number;
}

export interface MidiInputLike {
  id: string;
  manufacturer: string | null;
  name: string | null;
  state: MidiPortDeviceState;
  connection: MidiPortConnectionState;
  addEventListener: (type: "midimessage", listener: (event: MidiMessageEventLike) => void) => void;
  removeEventListener: (type: "midimessage", listener: (event: MidiMessageEventLike) => void) => void;
}

export interface MidiAccessLike {
  inputs: {
    values: () => IterableIterator<MidiInputLike>;
  };
  addEventListener: (type: "statechange", listener: () => void) => void;
  removeEventListener: (type: "statechange", listener: () => void) => void;
}

export interface MidiRequestOptions {
  sysex?: boolean;
  software?: boolean;
}

interface BaseMidiEvent {
  type: "note-on" | "note-off" | "sustain";
  channel: number;
  timestamp: number;
  source: MidiMessageSource;
  rawData: readonly number[];
}

export interface NoteOnMidiEvent extends BaseMidiEvent {
  type: "note-on";
  note: number;
  velocity: number;
}

export interface NoteOffMidiEvent extends BaseMidiEvent {
  type: "note-off";
  note: number;
  velocity: number;
}

export interface SustainPedalMidiEvent extends BaseMidiEvent {
  type: "sustain";
  controller: 64;
  value: number;
  engaged: boolean;
}

export type ParsedMidiEvent = NoteOnMidiEvent | NoteOffMidiEvent | SustainPedalMidiEvent;

export interface MidiAdapterSubscription {
  onMidiEvent: (event: ParsedMidiEvent) => void;
  onInputsChanged?: (inputs: MidiInputSummary[]) => void;
}

export interface MidiAccessAdapter {
  readonly access: MidiAccessLike;
  getInputs: () => MidiInputSummary[];
  subscribe: (subscription: MidiAdapterSubscription) => () => void;
}

type NavigatorWithMidi = Navigator & {
  requestMIDIAccess?: (options?: MidiRequestOptions) => Promise<MidiAccessLike>;
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

function getMidiNavigator(): NavigatorWithMidi | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  return navigator as NavigatorWithMidi;
}

export function isWebMidiSupported(): boolean {
  const midiNavigator = getMidiNavigator();
  return Boolean(midiNavigator?.requestMIDIAccess);
}

export function describeMidiSupport(): MidiSupportDescription {
  if (typeof window === "undefined") {
    return {
      available: false,
      summary: "Browser APIs unavailable",
      detail: "This check only runs meaningfully in the browser."
    };
  }

  if (!window.isSecureContext) {
    return {
      available: false,
      summary: "Secure context required",
      detail: "Web MIDI access needs HTTPS on hosted environments."
    };
  }

  if (!isWebMidiSupported()) {
    return {
      available: false,
      summary: "Web MIDI not exposed",
      detail: "The current browser does not expose navigator.requestMIDIAccess."
    };
  }

  return {
    available: true,
    summary: "Web MIDI available",
    detail: "This browser can request MIDI access and enumerate compatible devices."
  };
}

export function requestMidiAccess(options: MidiRequestOptions = {}): Promise<MidiAccessLike> {
  const midiNavigator = getMidiNavigator();

  if (!midiNavigator?.requestMIDIAccess) {
    return Promise.reject(new Error(describeMidiSupport().detail));
  }

  return midiNavigator.requestMIDIAccess(options);
}

export function summarizeMidiInput(input: MidiInputLike): MidiInputSummary {
  return {
    id: input.id,
    manufacturer: input.manufacturer ?? null,
    name: input.name ?? null,
    state: input.state,
    connection: input.connection
  };
}

export function collectMidiInputs(inputs: Iterable<MidiInputLike>): MidiInputSummary[] {
  return Array.from(inputs, summarizeMidiInput).sort((left, right) => {
    const leftLabel = `${left.manufacturer ?? ""} ${left.name ?? ""}`.trim();
    const rightLabel = `${right.manufacturer ?? ""} ${right.name ?? ""}`.trim();

    return leftLabel.localeCompare(rightLabel);
  });
}

export function listMidiInputs(access: Pick<MidiAccessLike, "inputs">): MidiInputSummary[] {
  return collectMidiInputs(access.inputs.values());
}

export function formatMidiNote(note: number): string {
  if (!Number.isInteger(note) || note < 0 || note > 127) {
    return `Note ${note}`;
  }

  const octave = Math.floor(note / 12) - 1;
  const name = NOTE_NAMES[note % NOTE_NAMES.length];

  return `${name}${octave}`;
}

export function parseMidiMessage(message: MidiMessageContext): ParsedMidiEvent | null {
  const rawData = Array.from(message.data, (value) => value & 0xff);

  if (rawData.length < 3) {
    return null;
  }

  const statusByte = rawData[0];
  const data1 = rawData[1];
  const data2 = rawData[2];
  const channel = (statusByte & 0x0f) + 1;
  const command = statusByte & 0xf0;
  const baseEvent: Omit<BaseMidiEvent, "type"> = {
    channel,
    timestamp: message.receivedTime,
    source: message.source,
    rawData
  };

  if (command === 0x90) {
    if (data2 === 0) {
      return {
        ...baseEvent,
        type: "note-off",
        note: data1,
        velocity: data2
      };
    }

    return {
      ...baseEvent,
      type: "note-on",
      note: data1,
      velocity: data2
    };
  }

  if (command === 0x80) {
    return {
      ...baseEvent,
      type: "note-off",
      note: data1,
      velocity: data2
    };
  }

  if (command === 0xb0 && data1 === 64) {
    return {
      ...baseEvent,
      type: "sustain",
      controller: 64,
      value: data2,
      engaged: data2 >= 64
    };
  }

  return null;
}

export function createMidiAccessAdapter(access: MidiAccessLike): MidiAccessAdapter {
  return {
    access,
    getInputs: () => listMidiInputs(access),
    subscribe: ({ onMidiEvent, onInputsChanged }) => {
      const inputHandlers = new Map<
        string,
        { input: MidiInputLike; handler: (event: MidiMessageEventLike) => void }
      >();

      const syncInputBindings = () => {
        const nextInputIds = new Set<string>();

        for (const input of access.inputs.values()) {
          nextInputIds.add(input.id);

          if (inputHandlers.has(input.id)) {
            continue;
          }

          const handler = (event: MidiMessageEventLike) => {
            const parsedEvent = parseMidiMessage({
              source: {
                id: input.id,
                name: input.name ?? null,
                manufacturer: input.manufacturer ?? null
              },
              data: event.data,
              receivedTime: event.timeStamp ?? event.receivedTime ?? performance.now()
            });

            if (parsedEvent) {
              onMidiEvent(parsedEvent);
            }
          };

          input.addEventListener("midimessage", handler);
          inputHandlers.set(input.id, { input, handler });
        }

        for (const [inputId, boundInput] of inputHandlers) {
          if (nextInputIds.has(inputId)) {
            continue;
          }

          boundInput.input.removeEventListener("midimessage", boundInput.handler);
          inputHandlers.delete(inputId);
        }
      };

      const handleStateChange = () => {
        syncInputBindings();
        if (onInputsChanged) {
          onInputsChanged(listMidiInputs(access));
        }
      };

      syncInputBindings();
      if (onInputsChanged) {
        onInputsChanged(listMidiInputs(access));
      }
      access.addEventListener("statechange", handleStateChange);

      return () => {
        access.removeEventListener("statechange", handleStateChange);

        for (const { input, handler } of inputHandlers.values()) {
          input.removeEventListener("midimessage", handler);
        }

        inputHandlers.clear();
      };
    }
  };
}