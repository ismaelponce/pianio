import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";
import { collectMidiInputs, formatMidiNote, parseMidiMessage } from "../src/index.js";

const source = {
  id: "launchkey-1",
  name: "Launchkey 49",
  manufacturer: "Novation"
};

test("parseMidiMessage maps note-on messages", () => {
  const event = parseMidiMessage({
    source,
    data: [0x90, 60, 99],
    receivedTime: 1234
  });

  deepEqual(event, {
    type: "note-on",
    channel: 1,
    note: 60,
    velocity: 99,
    timestamp: 1234,
    source,
    rawData: [0x90, 60, 99]
  });
});

test("parseMidiMessage converts zero-velocity note-on into note-off", () => {
  const event = parseMidiMessage({
    source,
    data: [0x91, 64, 0],
    receivedTime: 222
  });

  deepEqual(event, {
    type: "note-off",
    channel: 2,
    note: 64,
    velocity: 0,
    timestamp: 222,
    source,
    rawData: [0x91, 64, 0]
  });
});

test("parseMidiMessage captures sustain pedal events", () => {
  const event = parseMidiMessage({
    source,
    data: [0xb2, 64, 127],
    receivedTime: 500
  });

  deepEqual(event, {
    type: "sustain",
    channel: 3,
    controller: 64,
    value: 127,
    engaged: true,
    timestamp: 500,
    source,
    rawData: [0xb2, 64, 127]
  });
});

test("parseMidiMessage ignores unrelated controller traffic", () => {
  const event = parseMidiMessage({
    source,
    data: [0xb0, 1, 80],
    receivedTime: 80
  });

  equal(event, null);
});

test("collectMidiInputs normalizes and sorts visible inputs", () => {
  const inputs = collectMidiInputs([
    {
      id: "b",
      manufacturer: "Yamaha",
      name: "P-145",
      state: "connected",
      connection: "open",
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    },
    {
      id: "a",
      manufacturer: null,
      name: "USB MIDI",
      state: "connected",
      connection: "closed",
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
  ]);

  deepEqual(inputs, [
    {
      id: "a",
      manufacturer: null,
      name: "USB MIDI",
      state: "connected",
      connection: "closed"
    },
    {
      id: "b",
      manufacturer: "Yamaha",
      name: "P-145",
      state: "connected",
      connection: "open"
    }
  ]);
});

test("formatMidiNote renders common piano note labels", () => {
  equal(formatMidiNote(60), "C4");
  equal(formatMidiNote(73), "C#5");
});