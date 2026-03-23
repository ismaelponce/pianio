import React, { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
import type { CatalogExercise } from "@pianio/content-schema";
import { ScoreViewer } from "./ScoreViewer";
import { PianoKeyboard } from "./PianoKeyboard";
import { markExerciseComplete } from "../progress";
import confetti from "canvas-confetti";
import { Check, X as XIcon, Play, ArrowRight, RotateCcw, ChevronDown } from "lucide-react";
import { playNote, releaseNote, startAudio, scheduleExercisePlayback, startMetronome, stopMetronome } from "../audio/pianoSampler";
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
  formatMidiNote,
  requestMidiAccess,
  type MidiAccessLike,
  type MidiInputSummary,
  type ParsedMidiEvent
} from "@pianio/midi-web";

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

export function ExercisePracticePanel({ exercise, courseId, nextExerciseHref, onComplete, resetRef }: { exercise: CatalogExercise; courseId: string; nextExerciseHref?: string; onComplete?: () => void; resetRef?: React.MutableRefObject<(() => void) | null> }) {
  const sequence = createPracticeExpectedSequence(exercise.expectedNotes);
  const beatsPerMeasure = exercise.timeSignature[0];
  const totalMeasures = Math.max(1, Math.ceil(
    exercise.expectedNotes.reduce((max, n) => Math.max(max, n.startBeat + n.durationBeats), 0) / beatsPerMeasure
  ));
  const midiSupport = describeMidiSupport();
  const [access, setAccess] = useState<MidiAccessLike | null>(null);
  const [accessState, setAccessState] = useState<"idle" | "requesting" | "granted" | "error">("idle");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 3000);
  };
  const [lastError, setLastError] = useState<string | null>(null);
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
  const [toolsOpen, setToolsOpen] = useState(() => localStorage.getItem("pianio:tools") === "1");

  const [mode, setMode] = useState<"practice" | "performance">("practice");
  const [sightReading, setSightReading] = useState(false);
  const [noteLabels, setNoteLabels] = useState(false);
  const [tempoMultiplier, setTempoMultiplier] = useState<0.25 | 0.5 | 0.75 | 1>(() => {
    const saved = localStorage.getItem("pianio:tempo");
    return (saved === "0.25" || saved === "0.5" || saved === "0.75" || saved === "1")
      ? (Number(saved) as 0.25 | 0.5 | 0.75 | 1)
      : 1;
  });
  const handleTempoChange = (mult: 0.25 | 0.5 | 0.75 | 1) => {
    localStorage.setItem("pianio:tempo", String(mult));
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
  }, [exercise.id]);

  const handlePreview = async () => {
    if (isPreviewing) return;
    await startAudio();
    setIsPreviewing(true);
    const bpm = exercise.tempoBpm * tempoMultiplier;
    scheduleExercisePlayback(exercise.expectedNotes, bpm);
    const beatMs = 60000 / bpm;
    const lastNoteEndMs = exercise.expectedNotes.reduce(
      (max, n) => Math.max(max, (n.startBeat + n.durationBeats) * beatMs),
      0
    );
    previewTimerRef.current = setTimeout(() => setIsPreviewing(false), lastNoteEndMs + 800);
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
          if (result.complete) {
            const totalWrong = result.state.wrongNoteCount;
            const stars: 1 | 2 | 3 =
              totalWrong === 0 ? 3 : totalWrong <= 3 ? 2 : 1;
            markExerciseComplete(courseId, exercise.slug, stars);
            setCelebrationStars(stars);
            setCelebrationMode("practice");
            setShowCelebration(true);
            confetti({ particleCount: stars === 3 ? 150 : 80, spread: 70, origin: { y: 0.6 } });
            onComplete?.();
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
      setAccess(midiAccess);
      setAccessState("granted");
      showToast("MIDI connected");
    } catch (error) {
      setAccess(null);
      setAccessState("error");
      setLastError(error instanceof Error ? error.message : "Failed to request MIDI access.");
      showToast("MIDI connection failed");
    }
  };

  const resetPerformance = () => {
    setPerformPhase("idle");
    setCountBeat(4);
    performHitsRef.current = new Set();
    setPerformHits(new Set());
    setPerformCursorIndex(0);
    performVelocityRef.current = { correct: 0, total: 0 };
    performPedalRef.current = { correct: 0, total: 0 };
  };

  const handleToolsToggle = () => {
    setToolsOpen((v) => {
      localStorage.setItem("pianio:tools", v ? "0" : "1");
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
    // Ensure audio is started
    await startAudio();

    // Request MIDI access if not already granted
    if (accessState !== "granted") {
      setAccessState("requesting");
      setLastError(null);
      try {
        const midiAccess = await requestMidiAccess();
        setAccess(midiAccess);
        setAccessState("granted");
      } catch (err) {
        setLastError(err instanceof Error ? err.message : "MIDI unavailable");
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

    // Start count-in
    setPerformPhase("counting-in");
    setCountBeat(countInBeats);

    for (let i = countInBeats; i >= 1; i--) {
      const delay = (countInBeats - i) * beatMs;
      setTimeout(() => setCountBeat(i), delay);
    }

    // Piece starts after count-in
    setTimeout(() => {
      playbackStartRef.current = performance.now();
      setPerformPhase("playing");

      // Schedule background audio
      scheduleExercisePlayback(exercise.expectedNotes, bpm);

      // Calculate last note end
      const lastNoteEndMs = exercise.expectedNotes.reduce((max, note) => {
        return Math.max(max, (note.startBeat + note.durationBeats) * beatMs);
      }, 0);

      // Complete after piece ends + 1.5s buffer
      setTimeout(() => {
        setPerformPhase("complete");
        const hits = performHitsRef.current.size;
        const total = expectedTimesRef.current.length;
        const pct = total > 0 ? Math.round((hits / total) * 100) : 0;
        const stars: 1 | 2 | 3 = pct >= 95 ? 3 : pct >= 75 ? 2 : 1;
        markExerciseComplete(courseId, exercise.slug, stars);
        setCelebrationStars(stars);
        setCelebrationMode("performance");
        setShowCelebration(true);
        confetti({ particleCount: stars === 3 ? 150 : 80, spread: 70, origin: { y: 0.6 } });
        onComplete?.();
      }, lastNoteEndMs + 1500);
    }, countInMs);
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
          percentage: expectedTimesRef.current.length > 0
            ? Math.round((performHits.size / expectedTimesRef.current.length) * 100)
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
            Practice
          </button>
          <button
            className={`mode-tab${mode === "performance" ? " active" : ""}`}
            type="button"
            onClick={() => { setMode("performance"); setMetronomeOn(false); resetPerformance(); }}
          >
            Performance
          </button>
        </div>
        <button
          className={`preview-btn${isPreviewing ? " previewing" : ""}`}
          type="button"
          onClick={handlePreview}
          disabled={isPreviewing}
          title="Hear the exercise played through"
        >
          {isPreviewing ? <><Play size={13} /> Listening…</> : <><Play size={13} /> Preview</>}
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
              <span className="pedal-label">Ped</span>
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
              {accessState === "requesting" && "Connecting…"}
              {accessState === "granted" && "● MIDI connected"}
              {accessState === "idle" && "Connect MIDI"}
              {accessState === "error" && "Retry MIDI"}
            </button>
            {inputs.map((input) => (
              <span className="device-chip" key={input.id}>{input.name ?? "Device"}</span>
            ))}
            {lastError && <span className="bar-warn">{lastError}</span>}
            {!midiSupport.available && <span className="bar-warn">{midiSupport.detail}</span>}
          </div>

          <div className="practice-bar-progress">
            <span className="progress-fraction">
              {summary.matched}<span className="progress-sep">/</span>{exercise.expectedNotes.length}
            </span>
            <span className="progress-label">notes</span>
            {exercise.swing && (
              <span className="swing-badge">Swing</span>
            )}
            {session.matcherState.currentDynamic && (
              <span className="dynamic-badge">{session.matcherState.currentDynamic}</span>
            )}
            {loopActive && (
              <span className="loop-badge">Loop: m{loopStart}-m{loopEnd}</span>
            )}
            {summary.wrongNotes > 0 && !practiceComplete && (
              <span className="wrong-tally-chip">{summary.wrongNotes} ✗</span>
            )}
            {nextExpected && !sightReading ? (
              <span className="next-note-chip">
                Next: <strong>{(nextExpected.noteNumbers ?? [nextExpected.noteNumber]).map(n => formatMidiNote(n)).join(" ")}</strong>
                {nextExpected.hand !== "together" && (
                  <span className={`hand-tag hand-tag-${nextExpected.hand}`}>
                    {nextExpected.hand === "left" ? "LH" : "RH"}
                  </span>
                )}
              </span>
            ) : summary.matched === exercise.expectedNotes.length && exercise.expectedNotes.length > 0 ? (
              <>
                <span className="complete-chip">
                  <StarRating stars={summary.wrongNotes === 0 ? 3 : summary.wrongNotes <= 3 ? 2 : 1} size={13} />
                  {summary.wrongNotes === 0 ? " Perfect!" : " Complete"}
                </span>
                {summary.wrongNotes > 0 && (
                  <span className="wrong-count-chip">{summary.wrongNotes} wrong</span>
                )}
                {nextExerciseHref && (
                  <a className="action-link primary next-exercise-btn" href={nextExerciseHref}>
                    Next exercise <ArrowRight size={14} />
                  </a>
                )}
              </>
            ) : null}
            {session.lastResult && session.lastResult.kind !== "ignored" && (
              <span className={`result-chip result-${session.lastResult.kind}`}>
                {session.lastResult.kind === "matched" && <Check size={14} />}
                {session.lastResult.kind === "chord-progress" && <><Check size={14} />…</>}
                {session.lastResult.kind === "wrong-note" && "✗ Wrong note"}
                {session.lastResult.kind === "extra-note" && "Extra"}
              </span>
            )}
            {session.lastResult?.velocityFeedback && (
              <span className="velocity-hint">
                {session.lastResult.velocityFeedback === "too-loud" ? "Too loud" : "Too soft"}
              </span>
            )}
            {session.lastResult?.pedalFeedback && (
              <span className="pedal-hint">
                {session.lastResult.pedalFeedback === "pedal-needed" ? "Press pedal" : "Release pedal"}
              </span>
            )}
            <button
              className={`tools-toggle${toolsOpen ? " open" : ""}`}
              type="button"
              onClick={handleToolsToggle}
              title={toolsOpen ? "Hide tools" : "Show practice tools"}
            >
              Tools <ChevronDown size={13} className="tools-toggle-arrow" />
            </button>
          </div>

          {toolsOpen && (
          <div className="practice-bar-actions practice-bar-tools">
            <div className="tool-group">
              <span className="tool-group-label">Speed</span>
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
                {Math.round(exercise.tempoBpm * tempoMultiplier)} bpm
              </span>
            </div>
            <div className="tool-group">
              <span className="tool-group-label">Features</span>
              <button
                className={`metronome-btn${metronomeOn ? " active" : ""}`}
                type="button"
                onClick={() => setMetronomeOn((v) => !v)}
                title="Toggle metronome"
              >
                Metro
              </button>
              <button
                className={`sight-reading-btn${sightReading ? " active" : ""}`}
                type="button"
                onClick={() => setSightReading((v) => !v)}
                title={sightReading ? "Show next-note hints" : "Hide next-note hints (sight-reading)"}
              >
                Sight
              </button>
              <button
                className={`note-labels-btn${noteLabels ? " active" : ""}`}
                type="button"
                onClick={() => setNoteLabels((v) => !v)}
                title={noteLabels ? "Hide note names" : "Show note names on keyboard"}
              >
                Names
              </button>
              <button
                className={`auto-loop-btn${autoLoop ? " active" : ""}`}
                type="button"
                onClick={() => setAutoLoop((v) => !v)}
                title={autoLoop ? "Disable auto-loop" : "Auto-repeat exercise on completion"}
              >
                Loop
              </button>
            </div>
            <div className="tool-group">
              <span className="tool-group-label">Loop</span>
              <input
                type="number"
                className="loop-input"
                min={1}
                max={loopEnd}
                value={loopStart}
                onChange={(e) => setLoopStart(Math.max(1, Math.min(loopEnd, Number(e.target.value) || 1)))}
                title="Loop start measure"
              />
              <span className="loop-dash">-</span>
              <input
                type="number"
                className="loop-input"
                min={loopStart}
                max={totalMeasures}
                value={loopEnd}
                onChange={(e) => setLoopEnd(Math.max(loopStart, Math.min(totalMeasures, Number(e.target.value) || 1)))}
                title="Loop end measure"
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
                title={loopActive ? "Disable section loop" : "Loop selected measures"}
              >
                {loopActive ? "Stop" : "Section"}
              </button>
            </div>
            <div className="tool-group">
              <span className="tool-group-label">Actions</span>
              <button className="reset-btn" type="button" onClick={handleReset}>
                Reset
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
                <p>The exercise plays in the background. Play along and your notes are graded on accuracy.</p>
              </div>
              <div className="perform-controls">
                <div className="tempo-select-row">
                  <span className="tempo-select-label">Speed</span>
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
                  <span className="tempo-select-bpm">{Math.round(exercise.tempoBpm * tempoMultiplier)} bpm</span>
                </div>
                <button className="start-perform-btn" type="button" onClick={startPerformance}>
                  <Play size={14} /> Start Performance
                </button>
                <div className="perform-midi-row">
                  <button
                    className={`midi-connect-btn${accessState === "granted" ? " connected" : ""}`}
                    type="button"
                    onClick={handleRequestAccess}
                    disabled={!midiSupport.available || accessState === "requesting"}
                  >
                    {accessState === "granted" ? "● MIDI connected" : "Connect MIDI"}
                  </button>
                  {inputs.map((input) => (
                    <span className="device-chip" key={input.id}>{input.name ?? "Device"}</span>
                  ))}
                </div>
              </div>
            </>
          )}

          {performPhase === "counting-in" && (
            <div className="perform-countdown">
              <div className="count-number">{countBeat}</div>
              <p className="count-label">Get ready…</p>
            </div>
          )}

          {performPhase === "playing" && (
            <div className="perform-playing">
              <div className="playing-indicator">● Playing</div>
              <div className="playing-progress">
                <span className="progress-fraction">
                  {performHits.size}<span className="progress-sep">/</span>{expectedTimesRef.current.length}
                </span>
                <span className="progress-label">notes matched</span>
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
                {performScore.percentage >= 95 ? " Perfect!" : " Complete"}
              </span>
              <div className="score-breakdown">
                <span className="score-hit"><Check size={13} /> {performScore.hits} correct</span>
                <span className="score-miss"><XIcon size={13} /> {performScore.total - performScore.hits} missed</span>
                {performVelocityRef.current.total > 0 && (
                  <span className="score-velocity">
                    ♪ Dynamics: {Math.round((performVelocityRef.current.correct / performVelocityRef.current.total) * 100)}%
                  </span>
                )}
                {performPedalRef.current.total > 0 && (
                  <span className="score-pedal">
                    ◎ Pedal: {Math.round((performPedalRef.current.correct / performPedalRef.current.total) * 100)}%
                  </span>
                )}
              </div>
              <div className="perform-score-actions">
                <button className="reset-btn" type="button" onClick={resetPerformance}>
                  Try again
                </button>
                {nextExerciseHref && (
                  <a className="action-link primary next-exercise-btn" href={nextExerciseHref}>
                    Next exercise <ArrowRight size={14} />
                  </a>
                )}
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
              {celebrationStars === 3 ? "Perfect!" : celebrationStars === 2 ? "Great job!" : "Complete!"}
            </h3>
            <p className="celebration-subtitle">
              {celebrationMode === "practice"
                ? (summary.wrongNotes === 0
                    ? "No wrong notes — flawless"
                    : `${summary.wrongNotes} wrong note${summary.wrongNotes > 1 ? "s" : ""}`)
                : `${performScore?.percentage ?? 0}% accuracy`}
            </p>
            {celebrationMode === "performance" && performScore && (
              <div className="celebration-stats">
                <span className="celebration-stat-ok"><Check size={14} /> {performScore.hits} correct</span>
                <span className="celebration-stat-warn"><XIcon size={14} /> {performScore.total - performScore.hits} missed</span>
              </div>
            )}
            <div className="celebration-actions">
              <button className="celebration-btn secondary" type="button"
                onClick={() => { setShowCelebration(false); handleReset(); }}>
                Try again
              </button>
              {nextExerciseHref && (
                <a className="celebration-btn primary" href={nextExerciseHref}
                  onClick={() => setShowCelebration(false)}>
                  Next exercise
                </a>
              )}
            </div>
          </div>
        </div>
      )}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </>
  );
}
