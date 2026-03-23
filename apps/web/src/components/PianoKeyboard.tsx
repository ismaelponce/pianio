/**
 * A visual piano keyboard spanning C2–B5.
 * Highlights the next expected note and any currently pressed keys.
 */

const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10]); // C# D# F# G# A#

// Black key x-offset (as fraction of white-key width) from octave start
const BLACK_OFFSET: Record<number, number> = {
  1: 0.65,  // C#
  3: 1.63,  // D#
  6: 3.63,  // F#
  8: 4.63,  // G#
  10: 5.60, // A#
};

const START_NOTE = 36; // C2
const END_NOTE = 83;   // B5

const WW = 18; // white key width
const WH = 80; // white key height
const BW = 11; // black key width
const BH = 52; // black key height

function buildKeys() {
  const whites: Array<{ midi: number; x: number }> = [];
  const blacks: Array<{ midi: number; x: number }> = [];

  let whiteIdx = 0;
  // Track white key x per octave start
  const octaveWhiteStart: Record<number, number> = {};

  for (let n = START_NOTE; n <= END_NOTE; n++) {
    const semi = n % 12;
    const octave = Math.floor(n / 12) - 1;

    if (WHITE_SEMITONES.includes(semi)) {
      if (semi === 0) octaveWhiteStart[octave] = whiteIdx;
      whites.push({ midi: n, x: whiteIdx * WW });
      whiteIdx++;
    }
  }

  for (let n = START_NOTE; n <= END_NOTE; n++) {
    const semi = n % 12;
    const octave = Math.floor(n / 12) - 1;
    if (BLACK_SEMITONES.has(semi)) {
      const octaveStart = octaveWhiteStart[octave] ?? 0;
      const offset = BLACK_OFFSET[semi] ?? 0;
      blacks.push({ midi: n, x: (octaveStart + offset) * WW - BW / 2 });
    }
  }

  return { whites, blacks, totalWidth: whiteIdx * WW };
}

const { whites, blacks, totalWidth } = buildKeys();

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function fullNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}

/** Always-visible label: only on C keys */
function cLabel(midi: number): string | null {
  return midi % 12 === 0 ? fullNoteName(midi) : null;
}

// Colour palette for hand highlights — Wes Anderson palette
const RIGHT_FILL = "#c8e2ea";    // Seafoam tint – right hand
const RIGHT_STROKE = "#3B9AB2";  // Zissou Blue
const RIGHT_TEXT = "#2d7a8f";
const RIGHT_DOT = "#3B9AB2";
const RIGHT_BLACK_FILL = "#3B9AB2";

const LEFT_FILL = "#f5dfc5";    // Golden Pastry tint – left hand
const LEFT_STROKE = "#DD8D29";   // Fox Orange
const LEFT_TEXT = "#c47a1a";
const LEFT_DOT = "#DD8D29";
const LEFT_BLACK_FILL = "#DD8D29";

interface Props {
  /** MIDI note numbers of the next expected note(s) — single-element array for single notes, multi for chords */
  nextNoteNumbers?: number[];
  /** Which hand plays the next note(s); determines highlight colour */
  nextNoteHand?: "left" | "right" | "together" | null;
  /** MIDI note numbers currently pressed */
  pressedNotes?: Set<number>;
  /** MIDI note number of the last wrong note (flashes red) */
  wrongNote?: number | null;
  /** When true, show note letter on every white key */
  noteLabels?: boolean;
}

export function PianoKeyboard({ nextNoteNumbers, nextNoteHand, pressedNotes, wrongNote, noteLabels }: Props) {
  const isLeft = nextNoteHand === "left";
  const nFill   = isLeft ? LEFT_FILL   : RIGHT_FILL;
  const nStroke = isLeft ? LEFT_STROKE : RIGHT_STROKE;
  const nText   = isLeft ? LEFT_TEXT   : RIGHT_TEXT;
  const nDot    = isLeft ? LEFT_DOT    : RIGHT_DOT;
  const nBFill  = isLeft ? LEFT_BLACK_FILL : RIGHT_BLACK_FILL;
  const svgHeight = WH + 4;

  return (
    <div className="piano-keyboard-wrap">
      <svg
        viewBox={`0 0 ${totalWidth} ${svgHeight}`}
        width={totalWidth}
        height={svgHeight}
        className="piano-keyboard-svg"
        aria-label="Piano keyboard"
      >
        <defs>
          <linearGradient id="black-key-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3a3a3a" />
            <stop offset="100%" stopColor="#1a1a1a" />
          </linearGradient>
        </defs>
        {/* White keys */}
        {whites.map(({ midi, x }) => {
          const isNext = nextNoteNumbers?.includes(midi) ?? false;
          const isWrong = midi === wrongNote;
          const isPressed = pressedNotes?.has(midi);
          const isChordHeld = isNext && isPressed;
          const staticLabel = cLabel(midi);
          const fill = isWrong ? "#fdd5cc" : isChordHeld ? (isLeft ? "#e5c8a0" : "#8ec5d0") : isNext ? nFill : isPressed ? "#F5CDB4" : "var(--piano-key-white, #fff)";
          const stroke = isWrong ? "#C93312" : isNext ? nStroke : "#c5bdb5";
          return (
            <g key={midi} transform={isPressed ? "translate(0, 1)" : undefined}>
              {/* Shadow beneath key */}
              <rect
                x={x + 0.5}
                y={1.5}
                width={WW - 1}
                height={WH - 1}
                rx={3}
                ry={3}
                fill="rgba(0,0,0,0.06)"
              />
              <rect
                x={x + 0.5}
                y={0.5}
                width={WW - 1}
                height={WH - 1}
                rx={3}
                ry={3}
                fill={fill}
                stroke={stroke}
                strokeWidth={isNext || isWrong ? 1.5 : 1}
              />
              {/* Highlighted label: full note name on next/wrong keys */}
              {(isNext || isWrong) ? (
                <text
                  x={x + WW / 2}
                  y={WH - 5}
                  textAnchor="middle"
                  fontSize={8}
                  fill={isWrong ? "#C93312" : nText}
                  fontFamily="inherit"
                  fontWeight="700"
                >
                  {fullNoteName(midi)}
                </text>
              ) : noteLabels ? (
                /* Note-labels mode: letter on every white key */
                <text
                  x={x + WW / 2}
                  y={WH - 5}
                  textAnchor="middle"
                  fontSize={8}
                  fill={midi % 12 === 0 ? "#a09890" : "#c5bdb5"}
                  fontFamily="inherit"
                  fontWeight={midi % 12 === 0 ? "700" : "400"}
                >
                  {NOTE_NAMES[midi % 12]}
                </text>
              ) : staticLabel ? (
                /* Default: C labels only */
                <text
                  x={x + WW / 2}
                  y={WH - 5}
                  textAnchor="middle"
                  fontSize={8}
                  fill="#c5bdb5"
                  fontFamily="inherit"
                >
                  {staticLabel}
                </text>
              ) : null}
              {isNext && !isChordHeld && (
                <circle
                  cx={x + WW / 2}
                  cy={WH - 18}
                  r={3}
                  fill={nDot}
                />
              )}
            </g>
          );
        })}

        {/* Black keys (rendered on top) */}
        {blacks.map(({ midi, x }) => {
          const isNext = nextNoteNumbers?.includes(midi) ?? false;
          const isWrong = midi === wrongNote;
          const isPressed = pressedNotes?.has(midi);
          const isChordHeld = isNext && isPressed;
          const fill = isWrong ? "#C93312" : isChordHeld ? (isLeft ? "#c47a1a" : "#2d7a8f") : isNext ? nBFill : isPressed ? "#0B775E" : "url(#black-key-grad)";
          const stroke = isWrong ? "#8a2510" : isNext ? nStroke : "#1a1a1a";
          return (
            <g key={midi} transform={isPressed ? "translate(0, 1)" : undefined}>
              <rect
                x={x + 0.5}
                y={0.5}
                width={BW - 1}
                height={BH - 1}
                rx={2}
                ry={2}
                fill={fill}
                stroke={stroke}
                strokeWidth={1}
              />
              {(isNext || isWrong) && (
                <text
                  x={x + BW / 2}
                  y={BH - 6}
                  textAnchor="middle"
                  fontSize={7}
                  fill={isWrong ? "#fdd5cc" : nFill}
                  fontFamily="inherit"
                  fontWeight="700"
                >
                  {fullNoteName(midi).replace(/\d/, "")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
