import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const contentDir = path.join(rootDir, "content");
const outputDir = path.join(rootDir, "apps", "web", "public", "generated");

async function findCourseFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findCourseFiles(full)));
    } else if (entry.name === "course.json") {
      files.push(full);
    }
  }
  return files;
}
const divisions = 4;
const durationUnits = {
  e: 0.5,
  q: 1,
  h: 2,
  w: 4,
  de: 0.75,
  dq: 1.5,
  dh: 3
};
const xmlDurations = {
  e: 2,
  q: 4,
  h: 8,
  w: 16,
  de: 3,
  dq: 6,
  dh: 12
};
const typeNames = {
  e: "eighth",
  q: "quarter",
  h: "half",
  w: "whole",
  de: "eighth",
  dq: "quarter",
  dh: "half"
};
const dottedDurations = new Set(["de", "dq", "dh"]);
const pitchOffsets = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

const validDynamicMarkings = new Set(['pp', 'p', 'mp', 'mf', 'f', 'ff']);

function renderDynamicDirection(marking) {
  return [
    '      <direction placement="below">',
    '        <direction-type>',
    '          <dynamics default-y="-80">',
    `            <${marking}/>`,
    '          </dynamics>',
    '        </direction-type>',
    '      </direction>'
  ].join('\n');
}

function renderPedalDirection(type) {
  const pedalType = type === 'down' ? 'start' : 'stop';
  return [
    '      <direction placement="below">',
    '        <direction-type>',
    `          <pedal type="${pedalType}" line="yes"/>`,
    '        </direction-type>',
    '      </direction>'
  ].join('\n');
}

const songCategories = new Set([
  "classical",
  "folk",
  "festive",
  "christian",
  "children",
  "patriotic",
  "film-tv",
  "jazz-blues",
  "ragtime",
  "latin",
  "celtic",
  "world",
  "romantic-era",
  "baroque",
  "waltz",
  "march",
  "lullaby",
  "dance",
  "opera",
  "sea-shanty",
  "musical-theater",
  "meditation"
]);
function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseToken(token) {
  // Chord token: [C4,E4,G4]:q or [C4,E4,G4]:dq or [C4,E4,G4]:q~ (tied)
  const chordMatch = /^\[([^\]]+)\]:(dh|dq|de|e|q|h|w)(~?)$/.exec(token);
  if (chordMatch) {
    const [, noteList, duration, tilde] = chordMatch;
    const noteStrings = noteList.split(",");
    if (noteStrings.length < 2 || noteStrings.length > 4) {
      throw new Error(`Chord must have 2–4 notes: ${token}`);
    }
    const notes = noteStrings.map((ns) => {
      const m = /^([A-G])([#b]?)(\d)$/.exec(ns.trim());
      if (!m) throw new Error(`Invalid note in chord: ${ns} (token: ${token})`);
      return { step: m[1], accidental: m[2], octave: Number(m[3]) };
    });
    return {
      isChord: true,
      notes,
      duration,
      units: durationUnits[duration],
      dotted: dottedDurations.has(duration),
      tied: tilde === "~"
    };
  }

  const match = /^([A-GR])([#b]?)(\d)?:(dh|dq|de|e|q|h|w)(~?)$/.exec(token);
  if (!match) {
    throw new Error(`Unsupported note token: ${token}`);
  }

  const [, step, accidental, octave, duration, tilde] = match;

  return {
    isChord: false,
    step,
    accidental,
    octave: octave ? Number(octave) : null,
    duration,
    units: durationUnits[duration],
    dotted: dottedDurations.has(duration),
    tied: tilde === "~"
  };
}

/** Parse all tokens across measures, annotate each with tieStart/tieStop for MusicXML rendering. */
function annotateHandTies(measures) {
  const annotated = [];
  const pendingTies = new Set();

  for (const measure of measures) {
    const measureTokens = [];
    for (const raw of measure) {
      const token = parseToken(raw);
      token.tieStart = false;
      token.tieStop = false;

      if (token.isChord) {
        for (const note of token.notes) {
          const key = `${note.step}${note.accidental}${note.octave}`;
          if (pendingTies.has(key)) {
            token.tieStop = true;
            pendingTies.delete(key);
          }
        }
        if (token.tied) {
          token.tieStart = true;
          for (const note of token.notes) {
            pendingTies.add(`${note.step}${note.accidental}${note.octave}`);
          }
        }
      } else if (token.step !== "R") {
        const key = `${token.step}${token.accidental}${token.octave}`;
        if (pendingTies.has(key)) {
          token.tieStop = true;
          pendingTies.delete(key);
        }
        if (token.tied) {
          token.tieStart = true;
          pendingTies.add(key);
        }
      }

      measureTokens.push(token);
    }
    annotated.push(measureTokens);
  }

  return annotated;
}

function toMidiNoteNumber(note) {
  if (note.step === "R") {
    return null;
  }

  const accidentalOffset = note.accidental === "#" ? 1 : note.accidental === "b" ? -1 : 0;
  return (note.octave + 1) * 12 + pitchOffsets[note.step] + accidentalOffset;
}

function buildExpectedNotesFromMeasures(measures, hand) {
  const notes = [];
  let startBeat = 0;
  let tieAccumulator = null;

  for (const measure of measures) {
    for (const rawToken of measure) {
      const token = parseToken(rawToken);
      if (token.isChord) {
        const noteNumbers = token.notes.map((n) => toMidiNoteNumber(n));
        if (tieAccumulator) {
          notes.push(tieAccumulator);
          tieAccumulator = null;
        }
        notes.push({
          noteNumber: noteNumbers[0],
          noteNumbers,
          startBeat,
          durationBeats: token.units,
          hand
        });
      } else {
        const noteNumber = toMidiNoteNumber(token);
        if (noteNumber !== null) {
          if (tieAccumulator) {
            // Continue tie chain (validation ensures same pitch)
            tieAccumulator.durationBeats += token.units;
            if (!token.tied) {
              notes.push(tieAccumulator);
              tieAccumulator = null;
            }
          } else if (token.tied) {
            tieAccumulator = { noteNumber, startBeat, durationBeats: token.units, hand };
          } else {
            notes.push({ noteNumber, startBeat, durationBeats: token.units, hand });
          }
        } else {
          // Rest — flush any pending tie accumulator
          if (tieAccumulator) {
            notes.push(tieAccumulator);
            tieAccumulator = null;
          }
        }
      }
      startBeat += token.units;
    }
  }

  if (tieAccumulator) {
    notes.push(tieAccumulator);
  }

  return notes;
}

function buildExpectedNotes(exercise) {
  const rhHand = exercise.measuresLeft ? "right" : exercise.hands;
  const expectedNotes = buildExpectedNotesFromMeasures(exercise.measures, rhHand);

  if (exercise.measuresLeft) {
    const lhNotes = buildExpectedNotesFromMeasures(exercise.measuresLeft, "left");
    expectedNotes.push(...lhNotes);
    expectedNotes.sort((a, b) => a.startBeat - b.startBeat || (a.hand === "right" ? -1 : 1));
  }

  const [beats, beatType] = exercise.timeSignature;
  const measureUnits = beats * (4 / beatType);

  // Annotate each expected note with the active dynamic marking
  if (exercise.dynamics && exercise.dynamics.length > 0) {
    const dynamicEvents = exercise.dynamics
      .map(d => ({
        absoluteBeat: (d.measure - 1) * measureUnits + ((d.beat ?? 1) - 1) * (4 / beatType),
        marking: d.marking
      }))
      .sort((a, b) => a.absoluteBeat - b.absoluteBeat);

    for (const note of expectedNotes) {
      let active = null;
      for (const de of dynamicEvents) {
        if (de.absoluteBeat <= note.startBeat) {
          active = de.marking;
        } else {
          break;
        }
      }
      if (active) {
        note.dynamicMarking = active;
      }
    }
  }

  // Annotate each expected note with pedal state
  if (exercise.pedal && exercise.pedal.length > 0) {
    const pedalEvents = exercise.pedal
      .map(p => ({
        absoluteBeat: (p.measure - 1) * measureUnits + (p.beat - 1) * (4 / beatType),
        type: p.type
      }))
      .sort((a, b) => a.absoluteBeat - b.absoluteBeat);

    for (const note of expectedNotes) {
      let state = null;
      for (const pe of pedalEvents) {
        if (pe.absoluteBeat <= note.startBeat) {
          state = pe.type;
        } else {
          break;
        }
      }
      if (state) {
        note.pedalState = state;
      }
    }
  }

  // Merge simultaneous notes (same startBeat) into chord events for hands-together
  if (exercise.measuresLeft) {
    const merged = [];
    let i = 0;
    while (i < expectedNotes.length) {
      const current = expectedNotes[i];
      const group = [current];
      while (i + 1 < expectedNotes.length && expectedNotes[i + 1].startBeat === current.startBeat) {
        i++;
        group.push(expectedNotes[i]);
      }
      if (group.length === 1) {
        merged.push(current);
      } else {
        const allNoteNumbers = [];
        let hasRight = false, hasLeft = false;
        for (const note of group) {
          if (note.noteNumbers) {
            allNoteNumbers.push(...note.noteNumbers);
          } else {
            allNoteNumbers.push(note.noteNumber);
          }
          if (note.hand === "right") hasRight = true;
          if (note.hand === "left") hasLeft = true;
        }
        merged.push({
          noteNumber: allNoteNumbers[0],
          noteNumbers: allNoteNumbers,
          startBeat: current.startBeat,
          durationBeats: Math.max(...group.map(n => n.durationBeats)),
          hand: (hasRight && hasLeft) ? "together" : current.hand,
          dynamicMarking: current.dynamicMarking,
          pedalState: current.pedalState
        });
      }
      i++;
    }
    return merged;
  }

  return expectedNotes;
}

const MIDI_MIN = 36; // C2
const MIDI_MAX = 83; // B5

function validateMeasureList(measures, expectedUnits, label) {
  for (const [index, measure] of measures.entries()) {
    const tokens = measure.map(parseToken);
    const totalUnits = tokens.reduce((sum, token) => sum + token.units, 0);
    if (totalUnits !== expectedUnits) {
      throw new Error(
        `Invalid duration sum in ${label} measure ${index + 1}: expected ${expectedUnits}, received ${totalUnits}`
      );
    }
    for (const token of tokens) {
      if (token.isChord) {
        if (token.notes.length > 4) {
          throw new Error(`Chord exceeds 4-note limit in ${label} measure ${index + 1}`);
        }
        for (const note of token.notes) {
          const midi = toMidiNoteNumber(note);
          if (midi < MIDI_MIN || midi > MIDI_MAX) {
            throw new Error(
              `Chord note ${note.step}${note.accidental}${note.octave} (MIDI ${midi}) out of keyboard range ` +
              `${MIDI_MIN}-${MIDI_MAX} in ${label} measure ${index + 1}`
            );
          }
        }
      } else {
        const midi = toMidiNoteNumber(token);
        if (midi !== null && (midi < MIDI_MIN || midi > MIDI_MAX)) {
          throw new Error(
            `Note ${token.step}${token.accidental}${token.octave} (MIDI ${midi}) out of keyboard range ` +
            `${MIDI_MIN}-${MIDI_MAX} in ${label} measure ${index + 1}`
          );
        }
      }
    }
  }
}

function validateTies(measures, label) {
  const allTokens = [];
  for (const measure of measures) {
    for (const raw of measure) {
      allTokens.push(parseToken(raw));
    }
  }
  for (let i = 0; i < allTokens.length; i++) {
    const token = allTokens[i];
    if (!token.tied) continue;
    if (token.step === "R") {
      throw new Error(`Rest cannot be tied in ${label}`);
    }
    if (i + 1 >= allTokens.length) {
      throw new Error(`Tied note at end of ${label} with no continuation`);
    }
    const next = allTokens[i + 1];
    if (!token.isChord) {
      if (next.isChord || next.step !== token.step || next.accidental !== token.accidental || next.octave !== token.octave) {
        throw new Error(
          `Tied note ${token.step}${token.accidental}${token.octave} not followed by same pitch in ${label}`
        );
      }
    }
  }
}

function validatePedal(exercise, courseId) {
  if (!exercise.pedal || exercise.pedal.length === 0) return;
  const [beats] = exercise.timeSignature;
  const totalMeasures = exercise.measures.length;
  let openCount = 0;
  for (const p of exercise.pedal) {
    if (p.type !== 'down' && p.type !== 'up') {
      throw new Error(`Invalid pedal type "${p.type}" in ${courseId}/${exercise.id}`);
    }
    if (p.measure < 1 || p.measure > totalMeasures) {
      throw new Error(`Pedal measure ${p.measure} out of range (1-${totalMeasures}) in ${courseId}/${exercise.id}`);
    }
    if (p.beat < 1 || p.beat > beats) {
      throw new Error(`Pedal beat ${p.beat} out of range (1-${beats}) in ${courseId}/${exercise.id}`);
    }
    if (p.type === 'down') openCount++;
    else openCount--;
    if (openCount < 0) {
      throw new Error(`Pedal up without matching down in ${courseId}/${exercise.id}`);
    }
  }
  if (openCount !== 0) {
    throw new Error(`Unbalanced pedal events (${openCount} unclosed) in ${courseId}/${exercise.id}`);
  }
}

function validateDynamics(exercise, courseId) {
  if (!exercise.dynamics || exercise.dynamics.length === 0) return;
  const [beats] = exercise.timeSignature;
  const totalMeasures = exercise.measures.length;
  for (const d of exercise.dynamics) {
    if (!validDynamicMarkings.has(d.marking)) {
      throw new Error(`Invalid dynamic marking "${d.marking}" in ${courseId}/${exercise.id}`);
    }
    if (d.measure < 1 || d.measure > totalMeasures) {
      throw new Error(`Dynamic measure ${d.measure} out of range (1-${totalMeasures}) in ${courseId}/${exercise.id}`);
    }
    if (d.beat !== undefined) {
      if (d.beat < 1 || d.beat > beats) {
        throw new Error(`Dynamic beat ${d.beat} out of range (1-${beats}) in ${courseId}/${exercise.id}`);
      }
    }
  }
}

function validateExercise(exercise, courseId) {
  const [beats, beatType] = exercise.timeSignature;
  const expectedUnits = beats * (4 / beatType);
  validateMeasureList(exercise.measures, expectedUnits, `${courseId}/${exercise.id} RH`);
  validateTies(exercise.measures, `${courseId}/${exercise.id} RH`);
  if (exercise.measuresLeft) {
    if (exercise.measuresLeft.length !== exercise.measures.length) {
      throw new Error(
        `measuresLeft length (${exercise.measuresLeft.length}) must match measures length (${exercise.measures.length}) in ${courseId}/${exercise.id}`
      );
    }
    validateMeasureList(exercise.measuresLeft, expectedUnits, `${courseId}/${exercise.id} LH`);
    validateTies(exercise.measuresLeft, `${courseId}/${exercise.id} LH`);
  }
  validateDynamics(exercise, courseId);
  validatePedal(exercise, courseId);
  if (courseId.startsWith("songs-")) {
    if (!exercise.category) {
      throw new Error(`Missing category for ${courseId}/${exercise.id}`);
    }
    if (!songCategories.has(exercise.category)) {
      throw new Error(`Invalid category \"${exercise.category}\" for ${courseId}/${exercise.id}`);
    }
  }
}

function clefLine(clef) {
  return clef === "F" ? 4 : 2;
}

function renderChord(token, staff = null, tieStart = false, tieStop = false) {
  const parts = [];
  for (let i = 0; i < token.notes.length; i++) {
    const note = token.notes[i];
    const isChordMember = i > 0;

    const pitchLines = [
      "        <pitch>",
      `          <step>${note.step}</step>`
    ];
    if (note.accidental === "#") pitchLines.push("          <alter>1</alter>");
    if (note.accidental === "b") pitchLines.push("          <alter>-1</alter>");
    pitchLines.push(`          <octave>${note.octave}</octave>`);
    pitchLines.push("        </pitch>");

    const accidentalLine = note.accidental === "#"
      ? "        <accidental>sharp</accidental>"
      : note.accidental === "b"
      ? "        <accidental>flat</accidental>"
      : null;

    const dotLine = token.dotted ? "        <dot/>" : null;
    const staffLine = staff !== null ? `        <staff>${staff}</staff>` : null;

    const tieLines = [];
    if (tieStop) tieLines.push('        <tie type="stop"/>');
    if (tieStart) tieLines.push('        <tie type="start"/>');

    let notationsBlock = null;
    if (tieStart || tieStop) {
      const tied = [];
      if (tieStop) tied.push('          <tied type="stop"/>');
      if (tieStart) tied.push('          <tied type="start"/>');
      notationsBlock = ["        <notations>", ...tied, "        </notations>"].join("\n");
    }

    parts.push([
      "      <note>",
      isChordMember ? "        <chord/>" : null,
      ...pitchLines,
      `        <duration>${xmlDurations[token.duration]}</duration>`,
      ...tieLines,
      `        <type>${typeNames[token.duration]}</type>`,
      dotLine,
      accidentalLine,
      staffLine,
      notationsBlock,
      "      </note>"
    ].filter(Boolean).join("\n"));
  }
  return parts.join("\n");
}

function renderNote(token, staff = null, tieStart = false, tieStop = false) {
  const staffLine = staff !== null ? `        <staff>${staff}</staff>` : null;

  const dotLine = token.dotted ? "        <dot/>" : null;

  if (token.step === "R") {
    return [
      "      <note>",
      "        <rest/>",
      `        <duration>${xmlDurations[token.duration]}</duration>`,
      `        <type>${typeNames[token.duration]}</type>`,
      dotLine,
      staffLine,
      "      </note>"
    ].filter(Boolean).join("\n");
  }

  const pitchLines = [
    "        <pitch>",
    `          <step>${token.step}</step>`
  ];

  if (token.accidental === "#") {
    pitchLines.push("          <alter>1</alter>");
  }

  if (token.accidental === "b") {
    pitchLines.push("          <alter>-1</alter>");
  }

  pitchLines.push(`          <octave>${token.octave}</octave>`);
  pitchLines.push("        </pitch>");

  // Explicit <accidental> forces OSMD to always print the sharp/flat symbol,
  // regardless of what the key signature implies.
  const accidentalLine = token.accidental === "#"
    ? "        <accidental>sharp</accidental>"
    : token.accidental === "b"
    ? "        <accidental>flat</accidental>"
    : null;

  const tieLines = [];
  if (tieStop) tieLines.push('        <tie type="stop"/>');
  if (tieStart) tieLines.push('        <tie type="start"/>');

  let notationsBlock = null;
  if (tieStart || tieStop) {
    const tied = [];
    if (tieStop) tied.push('          <tied type="stop"/>');
    if (tieStart) tied.push('          <tied type="start"/>');
    notationsBlock = ["        <notations>", ...tied, "        </notations>"].join("\n");
  }

  return [
    "      <note>",
    ...pitchLines,
    `        <duration>${xmlDurations[token.duration]}</duration>`,
    ...tieLines,
    `        <type>${typeNames[token.duration]}</type>`,
    dotLine,
    accidentalLine,
    staffLine,
    notationsBlock,
    "      </note>"
  ].filter(Boolean).join("\n");
}

function renderMusicXml(course, exercise) {
  const [beats, beatType] = exercise.timeSignature;
  const grandStaff = !!exercise.measuresLeft;
  // Backup duration: total XML divisions in one measure (used to rewind for LH in grand-staff)
  const backupDuration = Math.round((beats * 4 / beatType) * divisions);

  // Pre-annotate ties across measures for proper start/stop MusicXML elements
  const rhAnnotated = annotateHandTies(exercise.measures);
  const lhAnnotated = grandStaff ? annotateHandTies(exercise.measuresLeft) : null;

  // Build dynamics lookup per measure (0-indexed)
  const dynamicsMap = new Map();
  if (exercise.dynamics) {
    for (const d of exercise.dynamics) {
      const idx = d.measure - 1;
      if (!dynamicsMap.has(idx)) dynamicsMap.set(idx, []);
      dynamicsMap.get(idx).push({ beat: d.beat ?? 1, marking: d.marking });
    }
    for (const arr of dynamicsMap.values()) {
      arr.sort((a, b) => a.beat - b.beat);
    }
  }

  // Build pedal lookup per measure (0-indexed)
  const pedalMap = new Map();
  if (exercise.pedal) {
    for (const p of exercise.pedal) {
      const idx = p.measure - 1;
      if (!pedalMap.has(idx)) pedalMap.set(idx, []);
      pedalMap.get(idx).push({ beat: p.beat, type: p.type });
    }
    for (const arr of pedalMap.values()) {
      arr.sort((a, b) => a.beat - b.beat);
    }
  }

  const measures = exercise.measures
    .map((rhMeasure, index) => {
      // Interleave dynamics and pedal <direction> elements at correct beat positions
      const measureDynamics = (dynamicsMap.get(index) || []).slice();
      const measurePedals = (pedalMap.get(index) || []).slice();
      const rhParts = [];
      let beatOffset = 0;
      for (const token of rhAnnotated[index]) {
        while (measureDynamics.length > 0) {
          const triggerOffset = (measureDynamics[0].beat - 1) * (4 / beatType);
          if (triggerOffset <= beatOffset) {
            rhParts.push(renderDynamicDirection(measureDynamics.shift().marking));
          } else {
            break;
          }
        }
        while (measurePedals.length > 0) {
          const triggerOffset = (measurePedals[0].beat - 1) * (4 / beatType);
          if (triggerOffset <= beatOffset) {
            rhParts.push(renderPedalDirection(measurePedals.shift().type));
          } else {
            break;
          }
        }
        rhParts.push(
          token.isChord
            ? renderChord(token, grandStaff ? 1 : null, token.tieStart, token.tieStop)
            : renderNote(token, grandStaff ? 1 : null, token.tieStart, token.tieStop)
        );
        beatOffset += token.units;
      }
      // Flush remaining dynamics/pedal (e.g., at end of measure)
      for (const dyn of measureDynamics) {
        rhParts.push(renderDynamicDirection(dyn.marking));
      }
      for (const ped of measurePedals) {
        rhParts.push(renderPedalDirection(ped.type));
      }
      const rhNotes = rhParts.join("\n");

      let lhPart = "";
      if (grandStaff && lhAnnotated[index]) {
        const lhNotes = lhAnnotated[index]
          .map((token) => {
            return token.isChord
              ? renderChord(token, 2, token.tieStart, token.tieStop)
              : renderNote(token, 2, token.tieStart, token.tieStop);
          })
          .join("\n");
        lhPart = [
          `      <backup>`,
          `        <duration>${backupDuration}</duration>`,
          `      </backup>`,
          lhNotes
        ].join("\n");
      }

      const attributes =
        index === 0
          ? [
              "      <attributes>",
              `        <divisions>${divisions}</divisions>`,
              "        <key>",
              `          <fifths>${exercise.keySignature ?? 0}</fifths>`,
              "        </key>",
              "        <time>",
              `          <beats>${beats}</beats>`,
              `          <beat-type>${beatType}</beat-type>`,
              "        </time>",
              `        <staves>${grandStaff ? 2 : 1}</staves>`,
              grandStaff
                ? [
                    `        <clef number="1">`,
                    `          <sign>${exercise.clef}</sign>`,
                    `          <line>${clefLine(exercise.clef)}</line>`,
                    `        </clef>`,
                    `        <clef number="2">`,
                    `          <sign>F</sign>`,
                    `          <line>4</line>`,
                    `        </clef>`
                  ].join("\n")
                : [
                    "        <clef>",
                    `          <sign>${exercise.clef}</sign>`,
                    `          <line>${clefLine(exercise.clef)}</line>`,
                    "        </clef>"
                  ].join("\n"),
              "      </attributes>",
              "      <direction placement=\"above\">",
              "        <direction-type>",
              `          <words>${escapeXml(exercise.goal)}</words>`,
              "        </direction-type>",
              `        <sound tempo=\"${exercise.tempoBpm}\"/>`,
              "      </direction>"
            ].join("\n")
          : "";

      return [
        `    <measure number=\"${index + 1}\">`,
        attributes,
        rhNotes,
        lhPart,
        "    </measure>"
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>${escapeXml(exercise.title)}</work-title>
  </work>
  <identification>
    <creator type="composer">Pianio original curriculum</creator>
    <rights>${escapeXml(exercise.license.type)}</rights>
    <encoding>
      <software>Pianio content generator</software>
    </encoding>
  </identification>
  <movement-title>${escapeXml(exercise.title)}</movement-title>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
${measures}
  </part>
</score-partwise>
`;
}

async function loadCourse(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function main() {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(path.join(outputDir, "scores"), { recursive: true });

  const catalog = {
    generatedAt: new Date().toISOString(),
    courses: []
  };

  const contentRoots = await findCourseFiles(contentDir);

  for (const filePath of contentRoots) {
    const course = await loadCourse(filePath);
    const courseScoreDir = path.join(outputDir, "scores", course.courseId);
    await mkdir(courseScoreDir, { recursive: true });

    for (const exercise of course.exercises) {
      validateExercise(exercise, course.courseId);
      const xml = renderMusicXml(course, exercise);
      const scoreFileName = `${exercise.slug}.musicxml`;
      await writeFile(path.join(courseScoreDir, scoreFileName), xml, "utf8");
    }

    catalog.courses.push({
      id: course.courseId,
      title: course.title,
      level: course.level,
      summary: course.summary,
      sourcePolicy: course.sourcePolicy,
      exerciseCount: course.exercises.length,
      exercises: course.exercises.map((exercise) => ({
        id: exercise.id,
        slug: exercise.slug,
        title: exercise.title,
        summary: exercise.summary,
        goal: exercise.goal,
        hands: exercise.hands,
        clef: exercise.clef,
        sourceKind: exercise.sourceKind,
        tempoBpm: exercise.tempoBpm,
        timeSignature: exercise.timeSignature,
        keySignature: exercise.keySignature,
        license: exercise.license,
        category: exercise.category,
        scorePath: `/generated/scores/${course.courseId}/${exercise.slug}.musicxml`,
        expectedNotes: buildExpectedNotes(exercise),
        ...(exercise.swing ? { swing: true } : {})
      }))
    });
  }

  await writeFile(
    path.join(outputDir, "catalog.json"),
    JSON.stringify(catalog, null, 2),
    "utf8"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
