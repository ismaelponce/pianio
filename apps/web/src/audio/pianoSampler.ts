import * as Tone from "tone";

const SALAMANDER_URLS = {
  A0: "A0.mp3", C1: "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3",
  A1: "A1.mp3", C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3",
  A2: "A2.mp3", C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3",
  A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3",
  A4: "A4.mp3", C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3",
  A5: "A5.mp3", C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3",
  A6: "A6.mp3", C7: "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3",
  A7: "A7.mp3", C8: "C8.mp3",
};

let sampler: Tone.Sampler | null = null;

function getSampler(): Tone.Sampler {
  if (!sampler) {
    sampler = new Tone.Sampler({
      urls: SALAMANDER_URLS,
      release: 1,
      baseUrl: "https://tonejs.github.io/audio/salamander/",
    }).toDestination();
  }
  return sampler;
}

let backgroundSampler: Tone.Sampler | null = null;

function getBackgroundSampler(): Tone.Sampler {
  if (!backgroundSampler) {
    const gain = new Tone.Gain(0.4).toDestination();
    backgroundSampler = new Tone.Sampler({
      urls: SALAMANDER_URLS,
      release: 1,
      baseUrl: "https://tonejs.github.io/audio/salamander/",
    }).connect(gain);
  }
  return backgroundSampler;
}

export async function startAudio(): Promise<void> {
  await Tone.start();
  getSampler();
  getBackgroundSampler();
}

export function isSamplerReady(): boolean {
  return getBackgroundSampler().loaded;
}

let metronomeLoop: Tone.Loop | null = null;
let metronomeSynth: Tone.Synth | null = null;

function getMetronomeSynth(): Tone.Synth {
  if (!metronomeSynth) {
    metronomeSynth = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 },
      volume: -6
    }).toDestination();
  }
  return metronomeSynth;
}

export function startMetronome(bpm: number): void {
  stopMetronome();
  Tone.getTransport().bpm.value = bpm;
  const synth = getMetronomeSynth();
  let beat = 0;
  metronomeLoop = new Tone.Loop((time) => {
    const freq = beat === 0 ? "C6" : "G5";
    synth.triggerAttackRelease(freq, "32n", time);
    beat = (beat + 1) % 4;
  }, "4n");
  metronomeLoop.start(0);
  Tone.getTransport().start();
}

export function stopMetronome(): void {
  if (metronomeLoop) {
    metronomeLoop.stop();
    metronomeLoop.dispose();
    metronomeLoop = null;
  }
  Tone.getTransport().stop();
}

export function playNote(midiNote: number): void {
  const s = getSampler();
  if (!s.loaded) return;
  try {
    const noteName = Tone.Frequency(midiNote, "midi").toNote();
    s.triggerAttack(noteName, Tone.now());
  } catch {
    // ignore if note is out of range
  }
}

export function releaseNote(midiNote: number): void {
  const s = getSampler();
  if (!s.loaded) return;
  try {
    const noteName = Tone.Frequency(midiNote, "midi").toNote();
    s.triggerRelease(noteName, Tone.now());
  } catch {
    // ignore
  }
}

// ── Hover note playback (musical navigation) ──

let lastHoverTime = 0;
const HOVER_DEBOUNCE_MS = 150;

const prefersReducedMotion = typeof window !== "undefined"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function playHoverNote(midiNote: number): void {
  if (prefersReducedMotion) return;
  const now = performance.now();
  if (now - lastHoverTime < HOVER_DEBOUNCE_MS) return;
  lastHoverTime = now;

  const s = getBackgroundSampler();
  if (!s.loaded) return;
  try {
    const noteName = Tone.Frequency(midiNote, "midi").toNote();
    s.triggerAttackRelease(noteName, 0.3, Tone.now());
  } catch {
    // ignore
  }
}

export function playChord(midiNotes: number[]): void {
  const s = getBackgroundSampler();
  if (!s.loaded) return;
  const now = Tone.now();
  for (const note of midiNotes) {
    try {
      const noteName = Tone.Frequency(note, "midi").toNote();
      s.triggerAttackRelease(noteName, 0.6, now);
    } catch {
      // ignore
    }
  }
}

export interface ScheduledNote {
  noteNumber: number;
  startBeat: number;
  durationBeats: number;
}

export function scheduleExercisePlayback(notes: readonly ScheduledNote[], bpm: number): void {
  const s = getBackgroundSampler();
  const beatS = 60 / bpm;
  const now = Tone.now();

  for (const note of notes) {
    const startS = note.startBeat * beatS;
    const durationS = Math.max(0.1, note.durationBeats * beatS);
    try {
      const noteName = Tone.Frequency(note.noteNumber, "midi").toNote();
      s.triggerAttackRelease(noteName, durationS, now + startS);
    } catch {
      // ignore out-of-range notes
    }
  }
}
