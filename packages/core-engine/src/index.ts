export interface ExpectedNoteEvent {
  noteNumber: number;
  /** When present, this is a chord — array of MIDI note numbers to play simultaneously. */
  noteNumbers?: number[];
  startBeat: number;
  durationBeats: number;
  hand: "left" | "right" | "together";
  /** Active dynamic marking at this note's position (e.g. 'mf', 'p'). */
  dynamicMarking?: string;
  /** Expected pedal state when this note is played. */
  pedalState?: 'down' | 'up' | null;
}

export const dynamicVelocityRanges: Record<string, [number, number]> = {
  pp: [20, 45],
  p: [35, 65],
  mp: [50, 80],
  mf: [65, 95],
  f: [80, 110],
  ff: [100, 127]
};

export interface PerformedMidiEvent {
  noteNumber: number;
  velocity: number;
  timestampMs: number;
  kind: "noteon" | "noteoff";
}

export interface TimingWindow {
  earlyMs: number;
  lateMs: number;
}

export interface MatchSummary {
  matched: number;
  missed: number;
  extra: number;
}

export interface PracticeSummary extends MatchSummary {
  wrongNotes: number;
  velocityScore: number | null;
  pedalScore: number | null;
}

export const defaultPracticeWindow: TimingWindow = {
  earlyMs: 180,
  lateMs: 220
};

export function summarizeMatch(matched: number, missed: number, extra: number): MatchSummary {
  return { matched, missed, extra };
}

export interface PracticeExpectedEvent extends ExpectedNoteEvent {
  index: number;
}

export interface PracticeExpectedSequence {
  mode: "practice";
  staff: "single";
  events: readonly PracticeExpectedEvent[];
}

export interface PendingChord {
  expectedNoteNumbers: readonly number[];
  heldNoteNumbers: readonly number[];
}

export interface PracticeMatcherState {
  sequence: PracticeExpectedSequence;
  nextEventIndex: number;
  extraCount: number;
  wrongNoteCount: number;
  pendingChord: PendingChord | null;
  currentDynamic: string | null;
  velocityCorrect: number;
  velocityTotal: number;
  pedalDown: boolean;
  pedalCorrect: number;
  pedalTotal: number;
}

export interface PracticeNoteMatchResult {
  kind: "matched" | "wrong-note" | "extra-note" | "ignored" | "chord-progress";
  expectedEvent: PracticeExpectedEvent | null;
  nextExpectedEvent: PracticeExpectedEvent | null;
  advanced: boolean;
  complete: boolean;
  state: PracticeMatcherState;
  velocityFeedback: "too-loud" | "too-soft" | null;
  pedalFeedback: "pedal-needed" | "release-pedal" | null;
}

function assertExpectedNoteEvent(note: ExpectedNoteEvent): void {
  if (!Number.isInteger(note.noteNumber) || note.noteNumber < 0 || note.noteNumber > 127) {
    throw new Error("Expected noteNumber to be a MIDI note between 0 and 127.");
  }

  if (!Number.isFinite(note.startBeat) || note.startBeat < 0) {
    throw new Error("Expected startBeat to be a finite non-negative number.");
  }

  if (!Number.isFinite(note.durationBeats) || note.durationBeats <= 0) {
    throw new Error("Expected durationBeats to be a finite positive number.");
  }
}

export function createPracticeExpectedSequence(
  expectedNotes: readonly ExpectedNoteEvent[]
): PracticeExpectedSequence {
  const events = expectedNotes
    .map((note, originalIndex) => {
      assertExpectedNoteEvent(note);

      return {
        ...note,
        originalIndex
      };
    })
    .sort((left, right) => left.startBeat - right.startBeat || left.originalIndex - right.originalIndex)
    .map(({ originalIndex: _originalIndex, ...event }, index) => ({
      ...event,
      index
    }));

  return {
    mode: "practice",
    staff: "single",
    events
  };
}

export function createPracticeMatcher(sequence: PracticeExpectedSequence): PracticeMatcherState {
  return {
    sequence,
    nextEventIndex: 0,
    extraCount: 0,
    wrongNoteCount: 0,
    pendingChord: null,
    currentDynamic: null,
    velocityCorrect: 0,
    velocityTotal: 0,
    pedalDown: false,
    pedalCorrect: 0,
    pedalTotal: 0
  };
}

export function updatePedalState(state: PracticeMatcherState, pedalDown: boolean): PracticeMatcherState {
  return { ...state, pedalDown };
}

export function getNextPracticeExpectedEvent(
  state: PracticeMatcherState
): PracticeExpectedEvent | null {
  return state.sequence.events[state.nextEventIndex] ?? null;
}

export function isPracticeMatcherComplete(state: PracticeMatcherState): boolean {
  return state.nextEventIndex >= state.sequence.events.length;
}

function createPracticeMatchResult(
  kind: PracticeNoteMatchResult["kind"],
  state: PracticeMatcherState,
  expectedEvent: PracticeExpectedEvent | null,
  advanced: boolean,
  velocityFeedback: "too-loud" | "too-soft" | null = null,
  pedalFeedback: "pedal-needed" | "release-pedal" | null = null
): PracticeNoteMatchResult {
  return {
    kind,
    expectedEvent,
    nextExpectedEvent: getNextPracticeExpectedEvent(state),
    advanced,
    complete: isPracticeMatcherComplete(state),
    state,
    velocityFeedback,
    pedalFeedback
  };
}

function checkPedalFeedback(
  state: PracticeMatcherState,
  expectedEvent: PracticeExpectedEvent
): { pedalFeedback: "pedal-needed" | "release-pedal" | null; pedalCorrect: number; pedalTotal: number } {
  let pedalFeedback: "pedal-needed" | "release-pedal" | null = null;
  let pedalCorrect = state.pedalCorrect;
  let pedalTotal = state.pedalTotal;

  if (expectedEvent.pedalState === "down" || expectedEvent.pedalState === "up") {
    pedalTotal++;
    if (expectedEvent.pedalState === "down" && !state.pedalDown) {
      pedalFeedback = "pedal-needed";
    } else if (expectedEvent.pedalState === "up" && state.pedalDown) {
      pedalFeedback = "release-pedal";
    } else {
      pedalCorrect++;
    }
  }

  return { pedalFeedback, pedalCorrect, pedalTotal };
}

// Practice mode: advances on note-on for single notes.
// For chords: waits for ALL noteNumbers to be held simultaneously.
// Note-off events are tracked for chord release detection.
export function matchPracticeNote(
  state: PracticeMatcherState,
  performedEvent: PerformedMidiEvent
): PracticeNoteMatchResult {
  const expectedEvent = getNextPracticeExpectedEvent(state);

  // --- CHORD PATH ---
  if (expectedEvent?.noteNumbers) {
    const pending: PendingChord = state.pendingChord ?? {
      expectedNoteNumbers: expectedEvent.noteNumbers,
      heldNoteNumbers: []
    };

    const isNoteOff = performedEvent.kind === "noteoff" ||
      (performedEvent.kind === "noteon" && performedEvent.velocity <= 0);

    // Note-off: remove from held (student released a key)
    if (isNoteOff) {
      if (pending.heldNoteNumbers.includes(performedEvent.noteNumber)) {
        const nextHeld = pending.heldNoteNumbers.filter(n => n !== performedEvent.noteNumber);
        const nextState: PracticeMatcherState = {
          ...state,
          pendingChord: { ...pending, heldNoteNumbers: nextHeld }
        };
        return createPracticeMatchResult("ignored", nextState, expectedEvent, false);
      }
      return createPracticeMatchResult("ignored", state, expectedEvent, false);
    }

    // Note-on: is it a correct chord note?
    if (pending.expectedNoteNumbers.includes(performedEvent.noteNumber)) {
      const nextHeld = pending.heldNoteNumbers.includes(performedEvent.noteNumber)
        ? pending.heldNoteNumbers
        : [...pending.heldNoteNumbers, performedEvent.noteNumber];

      const allHeld = pending.expectedNoteNumbers.every(n => nextHeld.includes(n));

      if (allHeld) {
        // Chord complete — advance + check velocity + check pedal
        let velocityFeedback: "too-loud" | "too-soft" | null = null;
        let velocityCorrect = state.velocityCorrect;
        let velocityTotal = state.velocityTotal;
        let currentDynamic = state.currentDynamic;

        if (expectedEvent.dynamicMarking) {
          const range = dynamicVelocityRanges[expectedEvent.dynamicMarking];
          if (range) {
            velocityTotal++;
            currentDynamic = expectedEvent.dynamicMarking;
            if (performedEvent.velocity >= range[0] && performedEvent.velocity <= range[1]) {
              velocityCorrect++;
            } else if (performedEvent.velocity < range[0]) {
              velocityFeedback = "too-soft";
            } else {
              velocityFeedback = "too-loud";
            }
          }
        }

        const pedal = checkPedalFeedback(state, expectedEvent);

        const nextState: PracticeMatcherState = {
          ...state,
          nextEventIndex: state.nextEventIndex + 1,
          pendingChord: null,
          currentDynamic,
          velocityCorrect,
          velocityTotal,
          pedalCorrect: pedal.pedalCorrect,
          pedalTotal: pedal.pedalTotal
        };
        return createPracticeMatchResult("matched", nextState, expectedEvent, true, velocityFeedback, pedal.pedalFeedback);
      }

      // Partial progress — some chord notes held but not all
      const nextState: PracticeMatcherState = {
        ...state,
        pendingChord: { ...pending, heldNoteNumbers: nextHeld }
      };
      return createPracticeMatchResult("chord-progress", nextState, expectedEvent, false);
    }

    // Wrong note during chord collection
    const nextState: PracticeMatcherState = {
      ...state,
      wrongNoteCount: state.wrongNoteCount + 1,
      pendingChord: pending
    };
    return createPracticeMatchResult("wrong-note", nextState, expectedEvent, false);
  }

  // --- SINGLE NOTE PATH (unchanged) ---
  if (performedEvent.kind !== "noteon" || performedEvent.velocity <= 0) {
    return createPracticeMatchResult("ignored", state, expectedEvent, false);
  }

  if (expectedEvent === null) {
    const nextState: PracticeMatcherState = {
      ...state,
      extraCount: state.extraCount + 1
    };

    return createPracticeMatchResult("extra-note", nextState, null, false);
  }

  if (performedEvent.noteNumber !== expectedEvent.noteNumber) {
    const nextState: PracticeMatcherState = {
      ...state,
      wrongNoteCount: state.wrongNoteCount + 1
    };

    return createPracticeMatchResult("wrong-note", nextState, expectedEvent, false);
  }

  // Single-note match — check velocity against dynamic range
  let velocityFeedback: "too-loud" | "too-soft" | null = null;
  let velocityCorrect = state.velocityCorrect;
  let velocityTotal = state.velocityTotal;
  let currentDynamic = state.currentDynamic;

  if (expectedEvent.dynamicMarking) {
    const range = dynamicVelocityRanges[expectedEvent.dynamicMarking];
    if (range) {
      velocityTotal++;
      currentDynamic = expectedEvent.dynamicMarking;
      if (performedEvent.velocity >= range[0] && performedEvent.velocity <= range[1]) {
        velocityCorrect++;
      } else if (performedEvent.velocity < range[0]) {
        velocityFeedback = "too-soft";
      } else {
        velocityFeedback = "too-loud";
      }
    }
  }

  const pedal = checkPedalFeedback(state, expectedEvent);

  const nextState: PracticeMatcherState = {
    ...state,
    nextEventIndex: state.nextEventIndex + 1,
    currentDynamic,
    velocityCorrect,
    velocityTotal,
    pedalCorrect: pedal.pedalCorrect,
    pedalTotal: pedal.pedalTotal
  };

  return createPracticeMatchResult("matched", nextState, expectedEvent, true, velocityFeedback, pedal.pedalFeedback);
}

export function summarizePracticeMatcher(state: PracticeMatcherState): PracticeSummary {
  return {
    matched: state.nextEventIndex,
    missed: state.sequence.events.length - state.nextEventIndex,
    extra: state.extraCount,
    wrongNotes: state.wrongNoteCount,
    velocityScore: state.velocityTotal > 0
      ? state.velocityCorrect / state.velocityTotal
      : null,
    pedalScore: state.pedalTotal > 0
      ? state.pedalCorrect / state.pedalTotal
      : null
  };
}