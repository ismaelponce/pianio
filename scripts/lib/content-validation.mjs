import { validateExercise } from './music.mjs';

export function object(value, label, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label}: unknown field ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label}: missing ${key}`);
  }
}
export function text(value, label, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new Error(`${label}: expected ${allowEmpty ? '' : 'nonempty '}string`);
  // JSON accepts control characters and lone surrogates that cannot be emitted as XML 1.0.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value)) {
    throw new Error(`${label}: invalid XML character`);
  }
}
const safeId = (value, label) => {
  text(value, label);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error(`${label}: invalid ID/slug`);
};
const exerciseKeys = ['id', 'slug', 'title', 'summary', 'goal', 'hands', 'clef', 'tempoBpm', 'timeSignature', 'keySignature', 'sourceKind', 'license', 'category', 'measures', 'measuresLeft', 'dynamics', 'pedal', 'swing'];
export function validateSourceCourse(course) {
  const label = `source ${course?.courseId ?? '?'}`;
  object(course, label, ['courseId', 'title', 'level', 'summary', 'sourcePolicy', 'exercises'], ['courseId', 'title', 'level', 'summary', 'sourcePolicy', 'exercises']);
  safeId(course.courseId, label);
  for (const key of ['title', 'summary', 'sourcePolicy']) text(course[key], `${label}.${key}`);
  if (!Number.isInteger(course.level) || course.level < 0) throw new Error(`${label}: invalid level`);
  if (!Array.isArray(course.exercises) || !course.exercises.length) throw new Error(`${label}: expected exercises array`);
  const ids = new Set(), slugs = new Set();
  for (const exercise of course.exercises) {
    const at = `${label}/${exercise?.id ?? '?'}`;
    object(exercise, at, exerciseKeys, ['id', 'slug', 'title', 'summary', 'goal', 'hands', 'clef', 'tempoBpm', 'timeSignature', 'sourceKind', 'license', 'measures']);
    for (const key of ['id', 'slug']) safeId(exercise[key], `${at}.${key}`);
    if (ids.has(exercise.id) || slugs.has(exercise.slug)) throw new Error(`${at}: duplicate exercise ID/slug`);
    ids.add(exercise.id); slugs.add(exercise.slug);
    for (const key of ['title', 'summary', 'goal']) text(exercise[key], `${at}.${key}`);
    object(exercise.license, `${at}.license`, ['type', 'attribution', 'notes'], ['type', 'attribution', 'notes']);
    for (const key of ['type', 'attribution', 'notes']) text(exercise.license[key], `${at}.license.${key}`, key !== 'type');
    // GF already exists in song sources. Preserve the legacy token and renderer behavior.
    if (!['left', 'right', 'together'].includes(exercise.hands) || !['G', 'F', 'GF'].includes(exercise.clef) || !['original', 'public_domain', 'open_license'].includes(exercise.sourceKind)) throw new Error(`${at}: invalid enum`);
    if (!Number.isFinite(exercise.tempoBpm) || exercise.tempoBpm <= 0) throw new Error(`${at}: invalid tempo`);
    if (!Array.isArray(exercise.timeSignature) || exercise.timeSignature.length !== 2 || !exercise.timeSignature.every(n => Number.isInteger(n) && n > 0)) throw new Error(`${at}: invalid timeSignature`);
    if (exercise.keySignature !== undefined && (!Number.isInteger(exercise.keySignature) || Math.abs(exercise.keySignature) > 7)) throw new Error(`${at}: invalid keySignature`);
    if (exercise.swing !== undefined && typeof exercise.swing !== 'boolean') throw new Error(`${at}: invalid swing`);
    for (const key of ['measures', 'measuresLeft']) {
      if (key === 'measuresLeft' && exercise[key] === undefined) continue;
      if (!Array.isArray(exercise[key]) || !exercise[key].length || !exercise[key].every(m => Array.isArray(m) && m.length && m.every(t => typeof t === 'string'))) throw new Error(`${at}: invalid ${key}`);
    }
    for (const key of ['dynamics', 'pedal']) {
      if (exercise[key] === undefined) continue;
      if (!Array.isArray(exercise[key])) throw new Error(`${at}: invalid ${key}`);
      for (const event of exercise[key]) {
        const dynamic = key === 'dynamics';
        object(event, `${at}.${key}`, dynamic ? ['measure', 'beat', 'marking'] : ['measure', 'beat', 'type'], dynamic ? ['measure', 'marking'] : ['measure', 'beat', 'type']);
        if (!Number.isInteger(event.measure) || (event.beat !== undefined && !Number.isFinite(event.beat))) throw new Error(`${at}: invalid event position`);
      }
    }
    validateExercise(exercise, course.courseId);
  }
  return course;
}

/** Partial documents require only courseId. Full coverage requires title, summary,
 * exercises and every source exercise's title, summary, goal and nonempty source license.notes.
 * Omitted/blank strings are fallback; provided non-string values are malformed.
 */
export function validateCourseTranslation(doc, course, { full = false } = {}) {
  object(doc, 'translation', ['courseId', 'title', 'summary', 'exercises'], ['courseId']);
  if (doc.courseId !== course.courseId) throw new Error(`Orphan/mismatched courseId ${doc.courseId}`);
  for (const key of ['title', 'summary']) if (Object.hasOwn(doc, key)) text(doc[key], key, true);
  if (Object.hasOwn(doc, 'exercises')) {
    object(doc.exercises, 'exercises', course.exercises.map(e => e.id));
    for (const [id, entry] of Object.entries(doc.exercises)) {
      object(entry, id, ['title', 'summary', 'goal', 'license']);
      for (const key of ['title', 'summary', 'goal']) if (Object.hasOwn(entry, key)) text(entry[key], `${id}.${key}`, true);
      if (Object.hasOwn(entry, 'license')) {
        object(entry.license, `${id}.license`, ['notes']);
        if (Object.hasOwn(entry.license, 'notes')) {
          text(entry.license.notes, `${id}.license.notes`, true);
          if (!course.exercises.find(e => e.id === id).license.notes.trim() && isTranslated(entry.license.notes)) {
            throw new Error(`${id}.license.notes: no source note to translate`);
          }
        }
      }
    }
  }
  if (full) {
    const missing = editableFields(course, doc).filter(f => !isTranslated(f.translation));
    if (missing.length) throw new Error(`${course.courseId}: missing translations: ${missing.map(f => f.path).join(', ')}`);
  }
  return doc;
}
export const isTranslated = value => typeof value === 'string' && value.trim().length > 0;
export function editableFields(course, translation) {
  return [
    ...['title', 'summary'].map(key => ({ path: key, source: course[key], translation: translation?.[key] })),
    ...course.exercises.flatMap(e => [
      ...['title', 'summary', 'goal'].map(key => ({ path: `exercises.${e.id}.${key}`, source: e[key], translation: translation?.exercises?.[e.id]?.[key] })),
      ...(e.license.notes.trim() ? [{ path: `exercises.${e.id}.license.notes`, source: e.license.notes, translation: translation?.exercises?.[e.id]?.license?.notes }] : [])
    ])
  ];
}
