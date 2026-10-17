import { readPreference, savePreference } from "../storage";
import React, { startTransition, useEffect, useEffectEvent, useRef, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogExercise } from "@pianio/content-schema";
import { useLanguage } from "../i18n/LanguageProvider";
import { ScoreViewer } from "./ScoreViewer";
import { PianoKeyboard } from "./PianoKeyboard";
import { markExerciseComplete } from "../progress";
import confetti from "canvas-confetti";
import { Check, X as XIcon, Play, ArrowRight, RotateCcw, ChevronDown } from "lucide-react";
import { playNote, releaseNote, startAudio, scheduleExercisePlayback, startMetronome, stopMetronome, startPerformanceCountIn } from "../audio/pianoSampler";
import {
  createPracticeExpectedSequence,
  createPracticeMatcher,
  getNextPracticeExpectedEvent,
  matchPracticeNote,
  summarizePracticeMatcher,
  updatePedalState,
  dynamicVelocityRanges,
  type PracticeExpectedSequence,
  type PracticeNoteMatchResult,
  type PracticeMatcherState
} from "@pianio/core-engine";
import {
  createMidiAccessAdapter,
  describeMidiSupport,
  requestMidiAccess,
  type MidiAccessLike,
  type MidiInputSummary,
  type ParsedMidiEvent
} from "@pianio/midi-web";
import { formatNote } from "../i18n/formatNote";
import { midiSupportMessages, nativeErrorMessage, renderMessage, resolveLanguage, type MessageDescriptor } from "../i18n/messages";

const STAR_PATH = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";

function StarIcon({ filled, size = 14 }: { filled: boolean; size?: number }) {
  return (
    <svg className={`star-icon${filled ? " star-icon-filled" : ""}`} width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? "#FFC857" : "none"} stroke={filled ? "none" : "#D9B382"} strokeWidth="1.5">
      <path d={STAR_PATH} />
    </svg>
  );
}

export function StarRating({ stars, size = 14 }: { stars: 1 | 2 | 3; size?: number }) {
  return (
    <span className="star-rating">
      {[1, 2, 3].map((i) => <StarIcon key={i} filled={i <= stars} size={size} />)}
    </span>
  );
}

// Module-level MIDI access cache — survives component unmount/remount
let cachedMidiAccess: MidiAccessLike | null = null;
let cachedMidiAccessState: "idle" | "granted" = "idle";

const PARTICLE_CONFIGS = [
  { left: '18%', top: '30%', size: 7, color: '#FFC857', delay: '0s', dur: '1.3s' },
  { left: '75%', top: '25%', size: 5, color: '#3B9AB2', delay: '0.1s', dur: '1.1s' },
  { left: '30%', top: '50%', size: 6, color: '#0B775E', delay: '0.15s', dur: '1.4s' },
  { left: '65%', top: '40%', size: 8, color: '#E1BD6D', delay: '0.05s', dur: '1.2s' },
  { left: '45%', top: '28%', size: 5, color: '#DD8D29', delay: '0.2s', dur: '1s' },
  { left: '82%', top: '45%', size: 6, color: '#FFC857', delay: '0.12s', dur: '1.5s' },
  { left: '12%', top: '55%', size: 4, color: '#3B9AB2', delay: '0.25s', dur: '1.1s' },
  { left: '55%', top: '35%', size: 7, color: '#E1BD6D', delay: '0.08s', dur: '1.3s' },
  { left: '40%', top: '60%', size: 5, color: '#0B775E', delay: '0.18s', dur: '1.2s' },
  { left: '70%', top: '55%', size: 6, color: '#FFC857', delay: '0.22s', dur: '1.4s' },
];

interface PracticeSessionState {
  matcherState: PracticeMatcherState;
  lastResult: PracticeNoteMatchResult | null;
}

function createSessionState(sequence: PracticeExpectedSequence): PracticeSessionState {
  return {
    matcherState: createPracticeMatcher(sequence),
    lastResult: null
  };
}

export function ExercisePracticePanel({ exercise, courseId, nextExerciseHref, courseHref, onComplete, resetRef }: { exercise: CatalogExercise; courseId: string; nextExerciseHref?: string; courseHref?: string; onComplete?: () => void; resetRef?: React.MutableRefObject<(() => void) | null> }) {
  const { i18n, t: translate } = useTranslation("practice");
  const t = translate as (key: string, options?: Record<string, unknown>) => string;
  const language = resolveLanguage(i18n.resolvedLanguage ?? i18n.language);
  const { beginActivity } = useLanguage();
  const sequence = useMemo(() => createPracticeExpectedSequence(exercise.expectedNotes), [exercise.expectedNotes]);
  const mountedRef = useRef(false);
  const performanceRunRef = useRef(0);
  const performanceActivityRef = useRef<{ release: () => void; playing: boolean } | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ++performanceRunRef.current;
      // Scheduled audio finishes naturally; a count-in must not start a new piece after navigation.
      if (!performanceActivityRef.current?.playing) performanceActivityRef.current?.release();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (wrongNoteTimerRef.current) clearTimeout(wrongNoteTimerRef.current);
    };
  }, []);
  const beatsPerMeasure = exercise.timeSignature[0];
  const totalMeasures = Math.max(1, Math.ceil(
    exercise.expectedNotes.reduce((max, n) => Math.max(max, n.startBeat + n.durationBeats), 0) / beatsPerMeasure
  ));
  const midiSupport = describeMidiSupport();
  const [access, setAccess] = useState<MidiAccessLike | null>(cachedMidiAccess);
  const [accessState, setAccessState] = useState<"idle" | "requesting" | "granted" | "error">(cachedMidiAccessState);
  const [toastMsg, setToastMsg] = useState<MessageDescriptor | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: MessageDescriptor) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 3000);
  };
  const [lastError, setLastError] = useState<MessageDescriptor | null>(null);
  const [inputs, setInputs] = useState<MidiInputSummary[]>([]);
  const [session, setSession] = useState<PracticeSessionState>(() => createSessionState(sequence));
  const [pressedNotes, setPressedNotes] = useState<Set<number>>(new Set());
  const [wrongNote, setWrongNote] = useState<number | null>(null);
  const wrongNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastVelocity, setLastVelocity] = useState(0);
  const [pedalEngaged, setPedalEngaged] = useState(false);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationStars, setCelebrationStars] = useState<1 | 2 | 3>(1);
  const [celebrationMode, setCelebrationMode] = useState<"practice" | "performance">("practice");
  const [toolsOpen, setToolsOpen] = useState(() => readPreference("pianio:tools") === "1");

  const [mode, setMode] = useState<"practice" | "performance">("practice");
  const [sightReading, setSightReading] = useState(false);
  const [noteLabels, setNoteLabels] = useState(false);
  const [tempoMultiplier, setTempoMultiplier] = useState<0.25 | 0.5 | 0.75 | 1>(() => {
    const saved = readPreference("pianio:tempo");
    return (saved === "0.25" || saved === "0.5" || saved === "0.75" || saved === "1")
      ? (Number(saved) as 0.25 | 0.5 | 0.75 | 1)
      : 1;
  });
  const handleTempoChange = (mult: 0.25 | 0.5 | 0.75 | 1) => {
    savePreference("pianio:tempo", String(mult));
    setTempoMultiplier(mult);
  };
  const [autoLoop, setAutoLoop] = useState(false);
  const autoLoopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loopActive, setLoopActive] = useState(false);
  const [loopStart, setLoopStart] = useState(1);
  const [loopEnd, setLoopEnd] = useState(totalMeasures);

  type PerformPhase = "idle" | "counting-in" | "playing" | "complete";
  const [performPhase, setPerformPhase] = useState<PerformPhase>("idle");
  const [countBeat, setCountBeat] = useState<number>(4);
  const [performHits, setPerformHits] = useState<Set<number>>(new Set());
  const performHitsRef = useRef<Set<number>>(new Set());
  const playbackStartRef = useRef<number>(0);
  const expectedTimesRef = useRef<Array<{ noteNumber: number; timeMs: number; index: number; dynamicMarking?: string; pedalState?: string | null }>>([]);
  const performWrongRef = useRef<number>(0);
  const performVelocityRef = useRef<{ correct: number; total: number }>({ correct: 0, total: 0 });
  const performPedalRef = useRef<{ correct: number; total: number }>({ correct: 0, total: 0 });
  const [performCursorIndex, setPerformCursorIndex] = useState(0);
  const performRafRef = useRef<number | null>(null);

  useEffect(() => {
    setSession(createSessionState(sequence));
    setMetronomeOn(false);
    stopMetronome();
    setIsPreviewing(false);
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    setLoopActive(false);
    setLoopStart(1);
    setLoopEnd(totalMeasures);
    setShowCelebration(false);
    resetPerformance();
  }, [exercise.id]);

  const handlePreview = async () => {
    if (isPreviewing) return;
    const release = beginActivity();
    setIsPreviewing(true);
    try { await startAudio(); } catch { release(); setIsPreviewing(false); return; }
    if (!mountedRef.current) { release(); return; }
    const bpm = exercise.tempoBpm * tempoMultiplier;
    scheduleExercisePlayback(exercise.expectedNotes, bpm);
    const beatMs = 60000 / bpm;
    const lastNoteEndMs = exercise.expectedNotes.reduce(
      (max, n) => Math.max(max, (n.startBeat + n.durationBeats) * beatMs),
      0
    );
    previewTimerRef.current = setTimeout(() => {
      release();
      if (mountedRef.current) setIsPreviewing(false);
    }, lastNoteEndMs + 800);
  };

  useEffect(() => {
    if (metronomeOn) {
      startAudio().then(() => startMetronome(exercise.tempoBpm * tempoMultiplier));
    } else {
      stopMetronome();
    }
    return () => { stopMetronome(); };
  }, [metronomeOn, exercise.tempoBpm, tempoMultiplier]);

  // Advance score cursor in real-time during performance playback
  useEffect(() => {
    if (performPhase !== "playing") {
      if (performRafRef.current !== null) {
        cancelAnimationFrame(performRafRef.current);
        performRafRef.current = null;
      }
      return;
    }
    const tick = () => {
      const elapsed = performance.now() - playbackStartRef.current;
      const count = expectedTimesRef.current.filter((n) => n.timeMs <= elapsed).length;
      setPerformCursorIndex(count);
      performRafRef.current = requestAnimationFrame(tick);
    };
    performRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (performRafRef.current !== null) {
        cancelAnimationFrame(performRafRef.current);
        performRafRef.current = null;
      }
    };
  }, [performPhase]);

  const handleInputsChanged = useEffectEvent((nextInputs: MidiInputSummary[]) => {
    startTransition(() => {
      setInputs(nextInputs);
    });
  });

  const handleMidiEvent = useEffectEvent((event: ParsedMidiEvent) => {
    if (event.type === "sustain") {
      const engaged = event.engaged;
      setPedalEngaged(engaged);
      if (mode === "practice") {
        startTransition(() => {
          setSession((current) => ({
            ...current,
            matcherState: updatePedalState(current.matcherState, engaged)
          }));
        });
      }
      return;
    }

    // Always play audio for user's notes
    if (event.type === "note-on") {
      playNote(event.note);
      startTransition(() => {
        setLastVelocity(event.velocity);
        setPressedNotes((prev) => { const s = new Set(prev); s.add(event.note); return s; });
      });
    } else if (event.type === "note-off") {
      releaseNote(event.note);
      startTransition(() => {
        setPressedNotes((prev) => { const s = new Set(prev); s.delete(event.note); return s; });
      });
    }

    if (mode === "practice") {
      startTransition(() => {
        setSession((current) => {
          const result = matchPracticeNote(current.matcherState, {
            noteNumber: event.note,
            velocity: event.velocity,
            timestampMs: Math.round(event.timestamp),
            kind: event.type === "note-on" ? "noteon" : "noteoff"
          });
          // Section loop: reset cursor to loop start when passing loop end
          if (loopActive && result.advanced) {
            const nextIdx = result.state.nextEventIndex;
            const events = result.state.sequence.events;
            const pastEnd = nextIdx >= events.length ||
              Math.floor(events[nextIdx].startBeat / beatsPerMeasure) + 1 > loopEnd;
            if (pastEnd) {
              const startBeat = (loopStart - 1) * beatsPerMeasure;
              const startIdx = events.findIndex(e => e.startBeat >= startBeat);
              if (startIdx >= 0) {
                return {
                  matcherState: { ...result.state, nextEventIndex: startIdx, wrongNoteCount: 0, pendingChord: null },
                  lastResult: result
                };
              }
            }
          }
          if (result.complete && !autoLoop) {
            const totalWrong = result.state.wrongNoteCount;
            const stars: 1 | 2 | 3 =
              totalWrong === 0 ? 3 : totalWrong <= 3 ? 2 : 1;
            // Practice mode does NOT mark completion — only performance does
            setCelebrationStars(stars);
            setCelebrationMode("practice");
            setShowCelebration(true);
            confetti({ particleCount: stars === 3 ? 150 : 80, spread: 70, origin: { y: 0.6 } });
          }
          if (result.kind === "wrong-note") {
            if (wrongNoteTimerRef.current) clearTimeout(wrongNoteTimerRef.current);
            setWrongNote(event.note);
            wrongNoteTimerRef.current = setTimeout(() => setWrongNote(null), 700);
          }
          return { matcherState: result.state, lastResult: result };
        });
      });
    } else if (
      mode === "performance" &&
      performPhase === "playing" &&
      event.type === "note-on" &&
      event.velocity > 0
    ) {
      const elapsedMs = event.timestamp - playbackStartRef.current;
      const WINDOW_MS = 350;

      let bestIndex = -1;
      let bestDelta = Infinity;

      for (const expected of expectedTimesRef.current) {
        if (performHitsRef.current.has(expected.index)) continue;
        if (expected.noteNumber !== event.note) continue;
        const delta = Math.abs(elapsedMs - expected.timeMs);
        if (delta < WINDOW_MS && delta < bestDelta) {
          bestDelta = delta;
          bestIndex = expected.index;
        }
      }

      if (bestIndex >= 0) {
        performHitsRef.current.add(bestIndex);
        // Check velocity for performance scoring
        const hitEntry = expectedTimesRef.current.find(e => e.index === bestIndex);
        if (hitEntry?.dynamicMarking) {
          const range = dynamicVelocityRanges[hitEntry.dynamicMarking];
          if (range) {
            performVelocityRef.current.total++;
            if (event.velocity >= range[0] && event.velocity <= range[1]) {
              performVelocityRef.current.correct++;
            }
          }
        }
        // Check pedal for performance scoring
        if (hitEntry?.pedalState === "down" || hitEntry?.pedalState === "up") {
          performPedalRef.current.total++;
          if ((hitEntry.pedalState === "down" && pedalEngaged) || (hitEntry.pedalState === "up" && !pedalEngaged)) {
            performPedalRef.current.correct++;
          }
        }
        startTransition(() => {
          setPerformHits(new Set(performHitsRef.current));
        });
      } else {
        // Wrong note — no expected note matched
        performWrongRef.current++;
      }
    }
  });

  useEffect(() => {
    if (!access) {
      return undefined;
    }

    const adapter = createMidiAccessAdapter(access);
    setInputs(adapter.getInputs());

    return adapter.subscribe({
      onMidiEvent: handleMidiEvent,
      onInputsChanged: handleInputsChanged
    });
  }, [access]);

  const handleRequestAccess = async () => {
    setAccessState("requesting");
    setLastError(null);

    try {
      await startAudio();
      const midiAccess = await requestMidiAccess();
      cachedMidiAccess = midiAccess;
      cachedMidiAccessState = "granted";
      setAccess(midiAccess);
      setAccessState("granted");
      showToast({ namespace: "practice", key: "midi.connected" });
    } catch (error) {
      setAccess(null);
      setAccessState("error");
      setLastError(nativeErrorMessage(error, "midi"));
      showToast({ namespace: "practice", key: "midi.connection-failed" });
    }
  };

  const resetPerformance = () => {
    ++performanceRunRef.current;
    if (!performanceActivityRef.current?.playing) performanceActivityRef.current?.release();
    setPerformPhase("idle");
    setCountBeat(4);
    performHitsRef.current = new Set();
    setPerformHits(new Set());
    setPerformCursorIndex(0);
    performWrongRef.current = 0;
    performVelocityRef.current = { correct: 0, total: 0 };
    performPedalRef.current = { correct: 0, total: 0 };
  };

  const handleToolsToggle = () => {
    setToolsOpen((v) => {
      savePreference("pianio:tools", v ? "0" : "1");
      return !v;
    });
  };

  const handleReset = () => {
    setShowCelebration(false);
    if (loopActive) {
      const startBeat = (loopStart - 1) * beatsPerMeasure;
      const startIdx = sequence.events.findIndex(e => e.startBeat >= startBeat);
      const matcher = createPracticeMatcher(sequence);
      setSession({
        matcherState: startIdx >= 0 ? { ...matcher, nextEventIndex: startIdx } : matcher,
        lastResult: null
      });
    } else {
      setSession(createSessionState(sequence));
    }
    resetPerformance();
  };

  useEffect(() => {
    if (resetRef) resetRef.current = handleReset;
  });

  const startPerformance = async () => {
    const run = ++performanceRunRef.current;
    const activity = { release: beginActivity(), playing: false };
    performanceActivityRef.current = activity;
    const isCurrent = () => mountedRef.current && run === performanceRunRef.current;
    // Include audio/MIDI initialization in the activity to avoid a switch during setup.
    try { await startAudio(); } catch { activity.release(); return; }
    if (!isCurrent()) { activity.release(); return; }

    // Request MIDI access if not already granted
    if (accessState !== "granted") {
      setAccessState("requesting");
      setLastError(null);
      try {
        const midiAccess = await requestMidiAccess();
        if (!isCurrent()) { activity.release(); return; }
        cachedMidiAccess = midiAccess;
        cachedMidiAccessState = "granted";
        setAccess(midiAccess);
        setAccessState("granted");
      } catch (err) {
        if (!isCurrent()) { activity.release(); return; }
        setLastError(nativeErrorMessage(err, "midi"));
        setAccessState("error");
        // Continue anyway — user can still hear the piece
      }
    }

    const bpm = exercise.tempoBpm * tempoMultiplier;
    const beatMs = 60000 / bpm;
    const countInBeats = 4;
    const countInMs = countInBeats * beatMs;

    // Precompute expected note times (ms from piece start), expanding chords
    // Swing: off-beat eighths (fractional beat = 0.5) shift from 50% to ~67% of beat
    const swingBeat = (sb: number) => {
      if (!exercise.swing) return sb;
      const frac = sb - Math.floor(sb);
      return Math.abs(frac - 0.5) < 0.001 ? Math.floor(sb) + 2 / 3 : sb;
    };
    const expanded: Array<{ noteNumber: number; timeMs: number; index: number; dynamicMarking?: string; pedalState?: string | null }> = [];
    let expandIdx = 0;
    for (const note of exercise.expectedNotes) {
      const timeMs = swingBeat(note.startBeat) * beatMs;
      if (note.noteNumbers) {
        for (const nn of note.noteNumbers) {
          expanded.push({ noteNumber: nn, timeMs, index: expandIdx++, dynamicMarking: note.dynamicMarking, pedalState: note.pedalState });
        }
      } else {
        expanded.push({ noteNumber: note.noteNumber, timeMs, index: expandIdx++, dynamicMarking: note.dynamicMarking, pedalState: note.pedalState });
      }
    }
    expectedTimesRef.current = expanded;

    const freshHits = new Set<number>();
    performHitsRef.current = freshHits;
    setPerformHits(freshHits);

    // Shared logic: start the piece after count-in
    const beginPlayback = () => {
      if (!isCurrent()) { activity.release(); return; }
      activity.playing = true;
      playbackStartRef.current = performance.now();
      setPerformPhase("playing");
      scheduleExercisePlayback(exercise.expectedNotes, bpm);
      const lastNoteEndMs = exercise.expectedNotes.reduce((max, note) => {
        return Math.max(max, (note.startBeat + note.durationBeats) * beatMs);
      }, 0);
      setTimeout(() => {
        activity.release();
        if (!isCurrent()) return;
        stopMetronome();
        setPerformPhase("complete");
        const hits = performHitsRef.current.size;
        const total = expectedTimesRef.current.length;
        const wrongs = performWrongRef.current;
        // Penalize wrong/extra notes: effective = hits - wrongs, clamped to 0
        const effective = Math.max(0, hits - wrongs);
        const pct = total > 0 ? Math.round((effective / total) * 100) : 0;
        const stars: 1 | 2 | 3 = pct >= 95 ? 3 : pct >= 75 ? 2 : 1;
        markExerciseComplete(courseId, exercise.slug, stars);
        setCelebrationStars(stars);
        setCelebrationMode("performance");
        setShowCelebration(true);
        confetti({ particleCount: stars === 3 ? 150 : 80, spread: 70, origin: { y: 0.6 } });
        onComplete?.();
      }, lastNoteEndMs + 1500);
    };

    // Start count-in — synced to metronome transport when metro is on
    setPerformPhase("counting-in");
    setCountBeat(countInBeats);

    if (metronomeOn) {
      // Transport-synced: count-in clicks ARE metronome beats, playback starts on the downbeat
      startPerformanceCountIn(bpm, countInBeats, beat => { if (isCurrent()) setCountBeat(beat); }, beginPlayback);
    } else {
      // Standalone: setTimeout-based count-in (no clicks)
      for (let i = countInBeats; i >= 1; i--) {
        const delay = (countInBeats - i) * beatMs;
        setTimeout(() => { if (isCurrent()) setCountBeat(i); }, delay);
      }
      setTimeout(beginPlayback, countInMs);
    }
  };

  const nextExpected = getNextPracticeExpectedEvent(session.matcherState);
  const summary = summarizePracticeMatcher(session.matcherState);

  const practiceComplete =
    mode === "practice" &&
    summary.matched === exercise.expectedNotes.length &&
    exercise.expectedNotes.length > 0;

  useEffect(() => {
    if (!autoLoop || !practiceComplete) return;
    autoLoopTimerRef.current = setTimeout(() => {
      setSession(createSessionState(createPracticeExpectedSequence(exercise.expectedNotes)));
    }, 1500);
    return () => {
      if (autoLoopTimerRef.current) clearTimeout(autoLoopTimerRef.current);
    };
  }, [autoLoop, practiceComplete, exercise.expectedNotes]);

  const performScore =
    performPhase === "complete"
      ? {
          total: expectedTimesRef.current.length,
          hits: performHits.size,
          wrong: performWrongRef.current,
          percentage: expectedTimesRef.current.length > 0
            ? Math.round((Math.max(0, performHits.size - performWrongRef.current) / expectedTimesRef.current.length) * 100)
            : 0
        }
      : null;

  return (
    <>
      <div className="mode-tabs-row">
        <div className="mode-tabs">
          <button
            className={`mode-tab${mode === "practice" ? " active" : ""}`}
            type="button"
            onClick={() => { setMode("practice"); resetPerformance(); }}
          >
            {t("ui.mode.practice")}
          </button>
          <button
            className={`mode-tab${mode === "performance" ? " active" : ""}`}
            type="button"
            onClick={() => { setMode("performance"); resetPerformance(); }}
          >
            {t("ui.mode.performance")}
          </button>
        </div>
        <button
          className={`preview-btn${isPreviewing ? " previewing" : ""}`}
          type="button"
          onClick={handlePreview}
          disabled={isPreviewing || performPhase === "counting-in" || performPhase === "playing"}
          title={t("ui.preview.title")}
        >
          {isPreviewing ? <><Play size={13} /> {t("ui.preview.listening")}</> : <><Play size={13} /> {t("ui.preview.action")}</>}
        </button>
      </div>

      <ScoreViewer
        scorePath={exercise.scorePath}
        matchedCount={mode === "practice" ? session.matcherState.nextEventIndex : performCursorIndex}
      />

      <div className="keyboard-area">
        <PianoKeyboard
          nextNoteNumbers={mode === "practice" && !sightReading && nextExpected
            ? (nextExpected.noteNumbers ?? [nextExpected.noteNumber])
            : undefined}
          nextNoteHand={mode === "practice" && !sightReading ? nextExpected?.hand : undefined}
          pressedNotes={pressedNotes}
          wrongNote={wrongNote}
          noteLabels={noteLabels}
        />
        {(() => {
          const hasPedal = exercise.expectedNotes.some(n => n.pedalState === "down" || n.pedalState === "up");
          const expectedPedalDown = mode === "practice" && nextExpected?.pedalState === "down";
          const pedalMismatch = mode === "practice" && hasPedal && nextExpected?.pedalState != null &&
            ((nextExpected.pedalState === "down" && !pedalEngaged) || (nextExpected.pedalState === "up" && pedalEngaged));
          if (!hasPedal && !pedalEngaged) return null;
          return (
            <div className={`pedal-indicator${pedalEngaged ? " engaged" : ""}${pedalMismatch ? " mismatch" : expectedPedalDown && pedalEngaged ? " correct" : ""}`}>
              <span className="pedal-label">{t("ui.tools.pedalShort")}</span>
              <div className="pedal-bar">
                <div className="pedal-bar-fill" style={{ width: pedalEngaged ? "100%" : "0%" }} />
              </div>
            </div>
          );
        })()}
        {session.matcherState.currentDynamic && mode === "practice" && (() => {
          const range = dynamicVelocityRanges[session.matcherState.currentDynamic];
          if (!range) return null;
          return (
            <div className="velocity-meter">
              <div className="velocity-bar-track">
                <div
                  className="velocity-zone"
                  style={{
                    bottom: `${(range[0] / 127) * 100}%`,
                    height: `${((range[1] - range[0]) / 127) * 100}%`
                  }}
                />
                <div
                  className="velocity-marker"
                  style={{ bottom: `${(lastVelocity / 127) * 100}%` }}
                />
              </div>
              <span className="velocity-dynamic-label">{session.matcherState.currentDynamic}</span>
            </div>
          );
        })()}
      </div>

      {mode === "practice" ? (
        <div className="practice-bar-wrap">
        <div
          className="practice-bar-fill"
          style={{
            width: exercise.expectedNotes.length > 0
              ? `${Math.round((summary.matched / exercise.expectedNotes.length) * 100)}%`
              : "0%"
          }}
        />
      <div className="practice-bar">
          <div className="practice-bar-midi">
            <button
              className={`midi-connect-btn${accessState === "granted" ? " connected" : ""}`}
              type="button"
              onClick={handleRequestAccess}
              disabled={!midiSupport.available || accessState === "requesting"}
            >
              {accessState === "requesting" && t("ui.midi.connecting")}
              {accessState === "granted" && `● ${t("midi.connected")}`}
              {accessState === "idle" && t("ui.midi.connect")}
              {accessState === "error" && t("ui.midi.retry")}
            </button>
            {inputs.map((input) => (
              <span className="device-chip" key={input.id}>{input.name ?? t("ui.midi.device")}</span>
            ))}
            {lastError && <span className="bar-warn">{renderMessage(lastError)}</span>}
            {!midiSupport.available && <span className="bar-warn">{renderMessage(midiSupportMessages(midiSupport).detail)}</span>}
          </div>

          <div className="practice-bar-progress">
            <span className="progress-fraction">
              {summary.matched}<span className="progress-sep">/</span>{exercise.expectedNotes.length}
            </span>
              <span className="progress-label">{t("ui.unit.notes", { count: exercise.expectedNotes.length })}</span>
            {exercise.swing && (
              <span className="swing-badge">{t("ui.tools.swing")}</span>
            )}
            {session.matcherState.currentDynamic && (
              <span className="dynamic-badge">{session.matcherState.currentDynamic}</span>
            )}
            {loopActive && (
                <span className="loop-badge">{t("ui.loop.badge", { start: loopStart, end: loopEnd })}</span>
            )}
            {summary.wrongNotes > 0 && !practiceComplete && (
              <span className="wrong-tally-chip">{summary.wrongNotes} ✗</span>
            )}
            {nextExpected && !sightReading ? (
              <span className="next-note-chip">
                {t("ui.feedback.next")}: <strong>{(nextExpected.noteNumbers ?? [nextExpected.noteNumber]).map(n => formatNote(n, language)).join(" ")}</strong>
                {nextExpected.hand !== "together" && (
                  <span className={`hand-tag hand-tag-${nextExpected.hand}`}>
                    {t(nextExpected.hand === "left" ? "ui.hand.leftShort" : "ui.hand.rightShort")}
                  </span>
                )}
              </span>
            ) : summary.matched === exercise.expectedNotes.length && exercise.expectedNotes.length > 0 ? (
              <>
                <span className="complete-chip">
                  <StarRating stars={summary.wrongNotes === 0 ? 3 : summary.wrongNotes <= 3 ? 2 : 1} size={13} />
                  {summary.wrongNotes === 0 ? ` ${t("ui.result.perfect")}` : ` ${t("ui.result.complete")}`}
                </span>
                {summary.wrongNotes > 0 && (
                  <span className="wrong-count-chip">{t("ui.result.wrong", { count: summary.wrongNotes })}</span>
                )}
                  <span className="practice-hint">{t("ui.feedback.unlockNext")}</span>
              </>
            ) : null}
            {session.lastResult && session.lastResult.kind !== "ignored" && (
              <span className={`result-chip result-${session.lastResult.kind}`}>
                {session.lastResult.kind === "matched" && <Check size={14} />}
                {session.lastResult.kind === "chord-progress" && <><Check size={14} />…</>}
                {session.lastResult.kind === "wrong-note" && `✗ ${t("ui.result.wrongNote")}`}
                {session.lastResult.kind === "extra-note" && t("ui.result.extra")}
              </span>
            )}
            {session.lastResult?.velocityFeedback && (
              <span className="velocity-hint">
                {session.lastResult.velocityFeedback === "too-loud" ? t("ui.feedback.tooLoud") : t("ui.feedback.tooSoft")}
              </span>
            )}
            {session.lastResult?.pedalFeedback && (
              <span className="pedal-hint">
                {session.lastResult.pedalFeedback === "pedal-needed" ? t("ui.feedback.pressPedal") : t("ui.feedback.releasePedal")}
              </span>
            )}
            <button
              className={`tools-toggle${toolsOpen ? " open" : ""}`}
              type="button"
              onClick={handleToolsToggle}
              title={toolsOpen ? t("ui.tools.hide") : t("ui.tools.show")}
            >
              {t("ui.tools.title")} <ChevronDown size={13} className="tools-toggle-arrow" />
            </button>
          </div>

          {toolsOpen && (
          <div className="practice-bar-actions practice-bar-tools">
            <div className="tool-group">
              <span className="tool-group-label">{t("ui.tools.speed")}</span>
              {([0.25, 0.5, 0.75, 1] as const).map((mult) => (
                <button
                  key={mult}
                  type="button"
                  className={`tempo-select-btn${tempoMultiplier === mult ? " active" : ""}`}
                  onClick={() => handleTempoChange(mult)}
                >
                  {mult === 1 ? "100%" : mult === 0.75 ? "75%" : mult === 0.5 ? "50%" : "25%"}
                </button>
              ))}
              <span className="tempo-display">
                {t("ui.unit.bpm", { bpm: new Intl.NumberFormat(language).format(Math.round(exercise.tempoBpm * tempoMultiplier)) })}
              </span>
            </div>
            <div className="tool-group">
              <span className="tool-group-label">{t("ui.tools.features")}</span>
              <button
                className={`metronome-btn${metronomeOn ? " active" : ""}`}
                type="button"
                onClick={() => setMetronomeOn((v) => !v)}
                title={t("ui.tools.metronome")}
              >
                {t("ui.tools.metroShort")}
              </button>
              <button
                className={`sight-reading-btn${sightReading ? " active" : ""}`}
                type="button"
                onClick={() => setSightReading((v) => !v)}
                title={sightReading ? t("ui.tools.showHints") : t("ui.tools.hideHints")}
              >
                {t("ui.tools.sightShort")}
              </button>
              <button
                className={`note-labels-btn${noteLabels ? " active" : ""}`}
                type="button"
                onClick={() => setNoteLabels((v) => !v)}
                title={noteLabels ? t("ui.tools.hideNoteNames") : t("ui.tools.showNoteNames")}
              >
                {t("ui.tools.namesShort")}
              </button>
              <button
                className={`auto-loop-btn${autoLoop ? " active" : ""}`}
                type="button"
                onClick={() => setAutoLoop((v) => !v)}
                title={autoLoop ? t("ui.tools.disableLoop") : t("ui.tools.autoLoop")}
              >
                {t("ui.tools.loop")}
              </button>
            </div>
            <div className="tool-group">
              <span className="tool-group-label">{t("ui.tools.loop")}</span>
              <input
                type="number"
                className="loop-input"
                min={1}
                max={loopEnd}
                value={loopStart}
                onChange={(e) => setLoopStart(Math.max(1, Math.min(loopEnd, Number(e.target.value) || 1)))}
                title={t("ui.loop.start")}
              />
              <span className="loop-dash">-</span>
              <input
                type="number"
                className="loop-input"
                min={loopStart}
                max={totalMeasures}
                value={loopEnd}
                onChange={(e) => setLoopEnd(Math.max(loopStart, Math.min(totalMeasures, Number(e.target.value) || 1)))}
                title={t("ui.loop.end")}
              />
              <button
                className={`loop-section-btn${loopActive ? " active" : ""}`}
                type="button"
                onClick={() => {
                  if (!loopActive) {
                    const startBeat = (loopStart - 1) * beatsPerMeasure;
                    const startIdx = sequence.events.findIndex(e => e.startBeat >= startBeat);
                    if (startIdx >= 0) {
                      setSession((prev) => ({
                        matcherState: { ...createPracticeMatcher(sequence), nextEventIndex: startIdx },
                        lastResult: null
                      }));
                    }
                  }
                  setLoopActive((v) => !v);
                }}
                title={loopActive ? t("ui.loop.disable") : t("ui.loop.selected")}
              >
                {loopActive ? t("ui.tools.stop") : t("ui.loop.section")}
              </button>
            </div>
            <div className="tool-group">
              <span className="tool-group-label">{t("ui.tools.actions")}</span>
              <button className="reset-btn" type="button" onClick={handleReset}>
                <RotateCcw size={13} /> {t("ui.reset")}
              </button>
            </div>
          </div>
          )}
        </div>
      </div>
      ) : (
        <div className="perform-panel">
          {performPhase === "idle" && (
            <>
              <div className="perform-intro">
                <p>{t("ui.performance.intro")}</p>
              </div>
              <div className="perform-controls">
                <div className="tempo-select-row">
                  <span className="tempo-select-label">{t("ui.tools.speed")}</span>
                  {([0.25, 0.5, 0.75, 1] as const).map((mult) => (
                    <button
                      key={mult}
                      type="button"
                      className={`tempo-select-btn${tempoMultiplier === mult ? " active" : ""}`}
                      onClick={() => handleTempoChange(mult)}
                    >
                      {mult === 1 ? "100%" : mult === 0.75 ? "75%" : mult === 0.5 ? "50%" : "25%"}
                    </button>
                  ))}
                  <span className="tempo-select-bpm">{t("ui.unit.bpm", { bpm: new Intl.NumberFormat(language).format(Math.round(exercise.tempoBpm * tempoMultiplier)) })}</span>
                </div>
                <div className="perform-options-row">
                  <button
                    className={`metronome-btn${metronomeOn ? " active" : ""}`}
                    type="button"
                    onClick={() => setMetronomeOn((v) => !v)}
                    title={t("ui.tools.metronome")}
                  >
                    {t("ui.tools.metroShort")}
                  </button>
                </div>
                <button className="start-perform-btn" type="button" onClick={startPerformance}>
                <Play size={14} /> {t("ui.performance.start")}
                </button>
                <div className="perform-midi-row">
                  <button
                    className={`midi-connect-btn${accessState === "granted" ? " connected" : ""}`}
                    type="button"
                    onClick={handleRequestAccess}
                    disabled={!midiSupport.available || accessState === "requesting"}
                  >
                    {accessState === "granted" ? `● ${t("midi.connected")}` : t("ui.midi.connect")}
                  </button>
                  {inputs.map((input) => (
                    <span className="device-chip" key={input.id}>{input.name ?? t("ui.midi.device")}</span>
                  ))}
                </div>
              </div>
            </>
          )}

          {performPhase === "counting-in" && (
            <div className="perform-countdown">
              <div className="count-number">{countBeat}</div>
              <p className="count-label">{t("ui.performance.getReady")}</p>
            </div>
          )}

          {performPhase === "playing" && (
            <div className="perform-playing">
              <div className="playing-indicator">● {t("ui.performance.playing")}</div>
              <div className="playing-progress">
                <span className="progress-fraction">
                  {performHits.size}<span className="progress-sep">/</span>{expectedTimesRef.current.length}
                </span>
                <span className="progress-label">{t("ui.performance.notesMatched")}</span>
              </div>
            </div>
          )}

          {performPhase === "complete" && performScore !== null && (
            <div className="perform-score">
              <div className="score-circle">
                <span className="score-number">{performScore.percentage}</span>
                <span className="score-pct">%</span>
              </div>
              <span className="complete-chip perform-stars">
                <StarRating stars={performScore.percentage >= 95 ? 3 : performScore.percentage >= 75 ? 2 : 1} size={15} />
                {performScore.percentage >= 95 ? ` ${t("ui.result.perfect")}` : ` ${t("ui.result.complete")}`}
              </span>
              <div className="score-breakdown">
                <span className="score-hit"><Check size={13} /> {t("ui.result.correct", { count: performScore.hits })}</span>
                <span className="score-miss"><XIcon size={13} /> {t("ui.result.missed", { count: performScore.total - performScore.hits })}</span>
                {performScore.wrong > 0 && (
                  <span className="score-wrong"><XIcon size={13} /> {t("ui.result.wrong", { count: performScore.wrong })}</span>
                )}
                {performVelocityRef.current.total > 0 && (
                  <span className="score-velocity">
                    ♪ {t("ui.result.dynamics")}: {new Intl.NumberFormat(language).format(Math.round((performVelocityRef.current.correct / performVelocityRef.current.total) * 100))}%
                  </span>
                )}
                {performPedalRef.current.total > 0 && (
                  <span className="score-pedal">
                    ◎ {t("ui.result.pedal")}: {new Intl.NumberFormat(language).format(Math.round((performPedalRef.current.correct / performPedalRef.current.total) * 100))}%
                  </span>
                )}
              </div>
              <div className="perform-score-actions">
                <button className="reset-btn" type="button" onClick={resetPerformance}>
                  <RotateCcw size={13} /> {t("ui.action.tryAgain")}
                </button>
                {nextExerciseHref ? (
                  <a className="action-link primary next-exercise-btn" href={nextExerciseHref}>
                    {t("ui.navigation.nextExercise")} <ArrowRight size={14} />
                  </a>
                ) : courseHref ? (
                  <a className="action-link primary next-exercise-btn" href={courseHref}>
                    {t("ui.navigation.courseComplete")} <ArrowRight size={14} />
                  </a>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}

      {showCelebration && (
        <div className="celebration-overlay" onClick={() => setShowCelebration(false)}>
          <div className="celebration-card" onClick={(e) => e.stopPropagation()}>
            {celebrationStars === 3 && <div className="celebration-glow" />}
            {celebrationStars === 3 && (
              <div className="celebration-particles">
                {PARTICLE_CONFIGS.map((p, i) => (
                  <span key={i} className="celebration-particle" style={{
                    left: p.left, top: p.top,
                    width: `${p.size}px`, height: `${p.size}px`,
                    background: p.color,
                    animationDelay: p.delay, animationDuration: p.dur,
                  }} />
                ))}
              </div>
            )}
            <div className="celebration-stars">
              {[1, 2, 3].map((i) => (
                <svg key={i}
                  className={`celebration-star${i <= celebrationStars ? " filled" : " empty"}`}
                  style={{ animationDelay: `${(i - 1) * 0.15}s` }}
                  viewBox="0 0 24 24" width="64" height="64"
                >
                  <path d={STAR_PATH} />
                </svg>
              ))}
            </div>
            <h3 className="celebration-title">
              {celebrationStars === 3 ? t("ui.celebration.perfect") : celebrationStars === 2 ? t("ui.celebration.great") : t("ui.result.complete")}
            </h3>
            <p className="celebration-subtitle">
              {celebrationMode === "practice"
                ? (summary.wrongNotes === 0
                    ? t("ui.celebration.flawless")
                    : t("ui.result.wrongNotes", { count: summary.wrongNotes }))
                : t("ui.result.accuracy", { percent: performScore?.percentage ?? 0 })}
            </p>
            {celebrationMode === "performance" && performScore && (
              <div className="celebration-stats">
                <span className="celebration-stat-ok"><Check size={14} /> {t("ui.result.correct", { count: performScore.hits })}</span>
                <span className="celebration-stat-warn"><XIcon size={14} /> {t("ui.result.missed", { count: performScore.total - performScore.hits })}</span>
                {performScore.wrong > 0 && (
                  <span className="celebration-stat-warn"><XIcon size={14} /> {t("ui.result.wrong", { count: performScore.wrong })}</span>
                )}
              </div>
            )}
            <div className="celebration-actions">
              <button className="celebration-btn secondary" type="button"
                onClick={() => { setShowCelebration(false); handleReset(); }}>
                {t("ui.action.tryAgain")}
              </button>
              {celebrationMode === "performance" && nextExerciseHref ? (
                <a className="celebration-btn primary" href={nextExerciseHref}
                  onClick={() => setShowCelebration(false)}>
                  {t("ui.navigation.nextExercise")}
                </a>
              ) : celebrationMode === "performance" && !nextExerciseHref && courseHref ? (
                <a className="celebration-btn primary" href={courseHref}
                  onClick={() => setShowCelebration(false)}>
                  {t("ui.navigation.courseComplete")}
                </a>
              ) : celebrationMode === "practice" ? (
                <button className="celebration-btn primary" type="button"
                  onClick={() => { setShowCelebration(false); setMode("performance"); resetPerformance(); }}>
                  {t("ui.celebration.tryPerformance")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
      {toastMsg && <div className="toast">{renderMessage(toastMsg)}</div>}
    </>
  );
}
