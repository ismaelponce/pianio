import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";

import {
  createPracticeExpectedSequence,
  createPracticeMatcher,
  matchPracticeNote,
  summarizePracticeMatcher,
  type ExpectedNoteEvent,
  type PerformedMidiEvent
} from "./index.ts";

function expectedNote(
  noteNumber: number,
  startBeat: number,
  hand: ExpectedNoteEvent["hand"] = "right"
): ExpectedNoteEvent {
  return {
    noteNumber,
    startBeat,
    durationBeats: 1,
    hand
  };
}

function playedNote(noteNumber: number): PerformedMidiEvent {
  return {
    noteNumber,
    velocity: 96,
    timestampMs: 0,
    kind: "noteon"
  };
}

test("matches the normalized expected sequence in order", () => {
  const sequence = createPracticeExpectedSequence([
    expectedNote(62, 1),
    expectedNote(60, 0),
    expectedNote(64, 2)
  ]);

  deepEqual(
    sequence.events.map((event) => ({
      index: event.index,
      noteNumber: event.noteNumber,
      startBeat: event.startBeat
    })),
    [
      { index: 0, noteNumber: 60, startBeat: 0 },
      { index: 1, noteNumber: 62, startBeat: 1 },
      { index: 2, noteNumber: 64, startBeat: 2 }
    ]
  );

  const first = matchPracticeNote(createPracticeMatcher(sequence), playedNote(60));
  equal(first.kind, "matched");
  equal(first.advanced, true);
  equal(first.complete, false);
  equal(first.expectedEvent?.noteNumber, 60);
  equal(first.nextExpectedEvent?.noteNumber, 62);

  const second = matchPracticeNote(first.state, playedNote(62));
  equal(second.kind, "matched");
  equal(second.advanced, true);
  equal(second.complete, false);
  equal(second.expectedEvent?.noteNumber, 62);
  equal(second.nextExpectedEvent?.noteNumber, 64);

  const third = matchPracticeNote(second.state, playedNote(64));
  equal(third.kind, "matched");
  equal(third.advanced, true);
  equal(third.complete, true);
  equal(third.expectedEvent?.noteNumber, 64);
  equal(third.nextExpectedEvent, null);
  deepEqual(summarizePracticeMatcher(third.state), {
    matched: 3,
    missed: 0,
    extra: 0,
    wrongNotes: 0
  });
});

test("wrong notes do not advance the matcher and are tracked separately", () => {
  const sequence = createPracticeExpectedSequence([expectedNote(60, 0), expectedNote(62, 1)]);

  const wrong = matchPracticeNote(createPracticeMatcher(sequence), playedNote(61));
  equal(wrong.kind, "wrong-note");
  equal(wrong.advanced, false);
  equal(wrong.complete, false);
  equal(wrong.expectedEvent?.noteNumber, 60);
  equal(wrong.nextExpectedEvent?.noteNumber, 60);
  equal(wrong.state.nextEventIndex, 0);

  const recovered = matchPracticeNote(wrong.state, playedNote(60));
  equal(recovered.kind, "matched");
  equal(recovered.state.nextEventIndex, 1);
  deepEqual(summarizePracticeMatcher(recovered.state), {
    matched: 1,
    missed: 1,
    extra: 0,
    wrongNotes: 1
  });
});

test("extra notes after completion are counted without rewinding progress", () => {
  const sequence = createPracticeExpectedSequence([expectedNote(60, 0)]);
  const matched = matchPracticeNote(createPracticeMatcher(sequence), playedNote(60));

  const extra = matchPracticeNote(matched.state, playedNote(67));
  equal(extra.kind, "extra-note");
  equal(extra.advanced, false);
  equal(extra.complete, true);
  equal(extra.expectedEvent, null);
  equal(extra.nextExpectedEvent, null);
  deepEqual(summarizePracticeMatcher(extra.state), {
    matched: 1,
    missed: 0,
    extra: 1,
    wrongNotes: 0
  });
});

test("note-off messages are ignored", () => {
  const sequence = createPracticeExpectedSequence([expectedNote(60, 0)]);
  const ignored = matchPracticeNote(createPracticeMatcher(sequence), {
    noteNumber: 60,
    velocity: 0,
    timestampMs: 0,
    kind: "noteoff"
  });

  equal(ignored.kind, "ignored");
  deepEqual(summarizePracticeMatcher(ignored.state), {
    matched: 0,
    missed: 1,
    extra: 0,
    wrongNotes: 0
  });
});