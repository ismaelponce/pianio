import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseJsonStrict, readJsonStrict } from '../lib/json.mjs';
import { validateCourseTranslation, validateSourceCourse, editableFields } from '../lib/content-validation.mjs';
import { loadContent, contentReport, compileMusic, buildCatalog, resolveCourse, generateContent } from '../lib/content-pipeline.mjs';
import { renderMusicXml, localizeMusicXml } from '../lib/music.mjs';
import { scaffoldTranslations } from '../scaffold-translations.mjs';
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = await readJsonStrict(path.join(rootDir, 'scripts/test/fixtures/rich-course.json'));
const require = createRequire(path.join(rootDir, 'apps/web/package.json'));
const { JSDOM } = require('jsdom');
const { DOMParser } = new JSDOM().window;
const clone = value => structuredClone(value);
function complete(course = fixture) {
  return { courseId: course.courseId, title: 'Localized course title & < sample', summary: "Localized course summary & sample.",
    exercises: Object.fromEntries(course.exercises.map(e => [e.id, { title: "Localized exercise & < sample", summary: 'Localized summary.', goal: "Localized goal & count < four's worth.", license: { notes: 'Original exercise.' } }])) };
}
async function sandbox(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pianio-content-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'content/a'), { recursive: true });
  await mkdir(path.join(dir, 'content-locales/fr'), { recursive: true });
  await writeFile(path.join(dir, 'localization.config.json'), JSON.stringify({ supportedLanguages: ['en', 'fr'], sourceLanguage: 'en', fallbackLanguage: 'en' }));
  await writeFile(path.join(dir, 'content/a/course.json'), JSON.stringify(fixture));
  return dir;
}
async function saveTranslation(dir, value, name = 'fixture-course.json') {
  await writeFile(path.join(dir, 'content-locales/fr', name), typeof value === 'string' ? value : JSON.stringify(value));
}
function xmlTree(xml, normalizeEditorial = false) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  assert.equal(doc.querySelector('parsererror'), null);
  if (normalizeEditorial) for (const selector of ['score-partwise > work > work-title', 'score-partwise > movement-title', 'score-partwise > part > measure:first-child > direction[placement="above"] > direction-type > words']) {
    const nodes = doc.querySelectorAll(selector);
    assert.equal(nodes.length, 1, selector);
    nodes[0].textContent = 'AUTHORIZED_EDITORIAL_TEXT';
  }
  const visit = node => node.nodeType === 1 ? { name: node.nodeName,
    attributes: [...node.attributes].map(a => [a.name, a.value]).sort(),
    children: [...node.childNodes].filter(n => n.nodeType !== 3 || n.textContent.trim()).map(visit) }
    : { type: node.nodeType, name: node.nodeName, text: node.textContent };
  return {
    declaration: xml.match(/^<\?xml[^?]*\?>/)?.[0],
    doctype: doc.doctype ? { name: doc.doctype.name, publicId: doc.doctype.publicId, systemId: doc.doctype.systemId } : null,
    document: [...doc.childNodes].filter(n => n.nodeType !== 10 && (n.nodeType !== 3 || n.textContent.trim())).map(visit)
  };
}

test('strict JSON detects duplicates at every depth, including escaped keys', () => {
  for (const raw of ['{"a":1,"a":2}', '{"exercises":{"x":{"title":"a","ti\\u0074le":"b"}}}', '{"x":[{"notes":"a","notes":"b"}]}']) assert.throws(() => parseJsonStrict(raw), /Duplicate key/);
  for (const raw of ['{"a":1,}', '[1,]', '{"x":01}', '{"x":"bad\n"}', 'true false', '']) assert.throws(() => parseJsonStrict(raw));
  assert.deepEqual(parseJsonStrict('{"a":[{"x":"è & < \\""},null,true,1e2]}'), { a: [{ x: 'è & < "' }, null, true, 100] });
});
test('complete/partial documents, blanks, required fields and strict field allowlist', () => {
  assert.equal(validateSourceCourse(clone(fixture)).courseId, fixture.courseId);
  validateCourseTranslation(complete(), fixture, { full: true });
  validateCourseTranslation({ courseId: fixture.courseId }, fixture);
  assert.throws(() => validateCourseTranslation({ courseId: fixture.courseId }, fixture, { full: true }), /missing translations/);
  for (const field of editableFields(fixture, complete())) {
    const partial = complete();
    const parts = field.path.split('.');
    let target = partial;
    for (const key of parts.slice(0, -1)) target = target[key];
    delete target[parts.at(-1)];
    assert.throws(() => validateCourseTranslation(partial, fixture, { full: true }), /missing translations/);
    target[parts.at(-1)] = '  ';
    validateCourseTranslation(partial, fixture);
    assert.throws(() => validateCourseTranslation(partial, fixture, { full: true }), /missing translations/);
  }
  for (const mutation of [d => { d.courseId = 'orphan'; }, d => { d.exercises.unknown = {}; }, d => { d.title = 4; }, d => { d.title = null; }, d => { d.exercises = []; }, d => { d.exercises['fixture-001'] = null; }, d => { d.exercises['fixture-001'].license.notes = []; }, d => { d.title = '\u0000'; }]) {
    const d = complete(); mutation(d); assert.throws(() => validateCourseTranslation(d, fixture));
  }
  for (const key of ['id', 'slug', 'tempoBpm', 'measures', 'expectedNotes', 'clef', 'swing', 'licenseType', '__proto__']) {
    const d = complete(); Object.defineProperty(d.exercises['fixture-001'], key, { value: 'override', enumerable: true });
    assert.throws(() => validateCourseTranslation(d, fixture), /unknown field/);
  }
  for (const key of ['type', 'attribution']) {
    const d = complete(); d.exercises['fixture-001'].license[key] = 'override';
    assert.throws(() => validateCourseTranslation(d, fixture), /unknown field/);
  }
  assert.throws(() => validateCourseTranslation({ ...complete(), sourcePolicy: 'override' }, fixture), /unknown field/);
});
test('fallback is per field, empty is not translated, source is never mutated', () => {
  const d = { courseId: fixture.courseId, title: 'Translated title', summary: ' ', exercises: { 'fixture-001': { goal: 'Translated goal', title: '', license: { notes: '' } } } };
  const before = clone(fixture), resolved = resolveCourse(fixture, d);
  assert.equal(resolved.title, 'Translated title'); assert.equal(resolved.summary, fixture.summary);
  assert.equal(resolved.exercises[0].goal, 'Translated goal');
  for (const key of ['title', 'summary']) assert.equal(resolved.exercises[0][key], fixture.exercises[0][key]);
  assert.deepEqual(resolved.exercises[0].license, fixture.exercises[0].license);
  assert.deepEqual(fixture, before);
});
test('absent contents allowed ordinarily, malformed present files and duplicate source courses rejected', async t => {
  const dir = await sandbox(t);
  let content = await loadContent({ rootDir: dir });
  assert.equal(contentReport(content).issues.length, 0);
  assert.ok(contentReport(content, { full: true }).issues.length);
  for (const raw of ['{"courseId":"fixture-course","title":false}', '{"courseId":"fixture-course","title":"a","title":"b"}', '{"courseId":"fixture-course","exercises":{"no-such-id":{}}}', '{"courseId":"unknown"}', 'null', '{broken']) {
    await saveTranslation(dir, raw);
    await assert.rejects(loadContent({ rootDir: dir }));
  }
  await saveTranslation(dir, complete());
  await saveTranslation(dir, complete(), 'copy.json');
  await assert.rejects(loadContent({ rootDir: dir }), /Duplicate|filename/);
  await rm(path.join(dir, 'content-locales/fr/copy.json'));
  await mkdir(path.join(dir, 'content/b'));
  await writeFile(path.join(dir, 'content/b/course.json'), JSON.stringify(fixture));
  await assert.rejects(loadContent({ rootDir: dir }), /Duplicate course/);
});
test('coverage counts source, translated and fallback fields separately', async t => {
  const dir = await sandbox(t); await saveTranslation(dir, { courseId: fixture.courseId, title: 'Localized title', summary: '', exercises: { 'fixture-001': { goal: 'Translated goal' } } });
  const rows = contentReport(await loadContent({ rootDir: dir })).rows;
  assert.equal(rows[0].sourceFields, 6); assert.equal(rows[0].fallbackFields, 0);
  assert.equal(rows[1].translatedFields, 2); assert.equal(rows[1].fallbackFields, 4);
  assert.equal(rows[1].fields.summary, 'fallback'); assert.equal(rows[1].fields.title, 'translated');
});
test('incomplete course translations warn without blocking ordinary validation', async t => {
  const dir = await sandbox(t);
  const content = await loadContent({ rootDir: dir });
  const report = contentReport(content);
  assert.deepEqual(report.issues, []);
  assert.ok(report.warnings.some(warning => warning.includes('fields missing; using en fallback')));
  assert.ok(contentReport(content, { full: true }).issues.some(issue => issue.includes('fields missing')));
  const completeDir = await sandbox(t);
  await saveTranslation(completeDir, complete());
  assert.deepEqual(contentReport(await loadContent({ rootDir: completeDir }), { full: true }).issues, []);
});
test('translation scaffolding creates source-aligned empty files and preserves existing translations', async t => {
  const dir = await sandbox(t);
  const first = await scaffoldTranslations({ rootDir: dir, locale: 'fr' });
  assert.equal(first.created, 1);
  assert.equal(first.skipped, 0);
  const file = path.join(dir, 'content-locales/fr', `${fixture.courseId}.json`);
  const template = await readJsonStrict(file);
  assert.equal(template.courseId, fixture.courseId);
  assert.equal(template.title, '');
  assert.deepEqual(Object.keys(template.exercises), fixture.exercises.map(exercise => exercise.id));
  assert.equal(template.exercises['fixture-001'].title, '');
  assert.equal(template.exercises['fixture-001'].license.notes, '');
  template.title = 'My existing translation';
  await writeFile(file, JSON.stringify(template));
  const second = await scaffoldTranslations({ rootDir: dir, locale: 'fr' });
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 1);
  assert.equal((await readJsonStrict(file)).title, 'My existing translation');
});
test('generation isolated in temp dirs; source/translation identity, order, music, credits and legacy URLs', async t => {
  const dir = await sandbox(t); await saveTranslation(dir, complete());
  const outputDir = path.join(dir, 'output');
  const { catalogs, legacy } = await generateContent({ rootDir: dir, outputDir });
  const en = catalogs.en.courses[0], translated = catalogs.fr.courses[0];
  assert.equal(catalogs.en.locale, 'en'); assert.equal(catalogs.fr.locale, 'fr');
  const invariant = c => ({ ...c, title: '', summary: '', coverage: undefined, exercises: c.exercises.map(e => ({ ...e, title: '', summary: '', goal: '', scorePath: '', license: { ...e.license, notes: '' } })) });
  assert.deepEqual(invariant(translated), invariant(en));
  assert.strictEqual(en.exercises[0].expectedNotes, translated.exercises[0].expectedNotes);
  const e = en.exercises[0];
  assert.equal(legacy.courses[0].exercises[0].scorePath, '/generated/scores/fixture-course/rich-score.musicxml');
  assert.equal(e.scorePath, '/generated/en/scores/fixture-course/rich-score.musicxml');
  const oldXml = await readFile(path.join(outputDir, 'scores/fixture-course/rich-score.musicxml'), 'utf8');
  assert.equal(oldXml, await readFile(path.join(outputDir, 'en/scores/fixture-course/rich-score.musicxml'), 'utf8'));
  assert.deepEqual(xmlTree(oldXml, true), xmlTree(await readFile(path.join(outputDir, 'fr/scores/fixture-course/rich-score.musicxml'), 'utf8'), true));
  assert.equal(legacy.generatedAt, catalogs.fr.generatedAt);
  // Reject bad inputs before clearing even a caller-selected directory.
  await writeFile(path.join(outputDir, 'sentinel'), 'keep');
  await saveTranslation(dir, '{bad');
  await assert.rejects(generateContent({ rootDir: dir, outputDir }));
  assert.equal(await readFile(path.join(outputDir, 'sentinel'), 'utf8'), 'keep');
  await saveTranslation(dir, complete());
  await assert.rejects(generateContent({ rootDir: dir, outputDir: dir }), /Unsafe outputDir/);
});
test('structural MusicXML baseline preserves chords, two staves, ties, dots, swing data, dynamics and pedal', async () => {
  const xml = renderMusicXml(fixture, fixture.exercises[0]);
  const baseline = await readFile(path.join(rootDir, 'scripts/test/fixtures/rich-score.baseline.musicxml'), 'utf8');
  assert.deepEqual(xmlTree(xml), xmlTree(baseline));
  const content = { courses: [fixture], config: { sourceLanguage: 'en', supportedLanguages: ['en', 'fr'] }, translations: { fr: new Map([[fixture.courseId, complete()]]) } };
  const music = compileMusic(content.courses);
  assert.deepEqual(music.get(fixture.courseId).get('fixture-001').expectedNotes, await readJsonStrict(path.join(rootDir, 'scripts/test/fixtures/rich-score.baseline-notes.json')));
  const localized = localizeMusicXml(xml, resolveCourse(fixture, complete()).exercises[0]);
  assert.deepEqual(xmlTree(xml, true), xmlTree(localized, true));
  // Credits, rights, declarations and musical changes cannot be hidden by normalization.
  for (const changed of [
    localized.replace('Pianio original curriculum', 'Different credit'),
    localized.replace('CC0-1.0', 'Different rights'),
    localized.replace('<step>C</step>', '<step>D</step>'),
    localized.replace('http://www.musicxml.org/dtds/partwise.dtd', 'different.dtd'),
    localized.replace('<encoding>', '<encoding><!-- additional metadata -->')
  ]) assert.notDeepEqual(xmlTree(xml, true), xmlTree(changed, true));
  for (const marker of ['<chord/>', '<staves>2</staves>', '<tie type="start"/>', '<tie type="stop"/>', '<dot/>', '<dynamics', '<pedal']) assert.ok(localized.includes(marker), marker);
  assert.equal(buildCatalog(content, 'fr', music).courses[0].exercises[0].swing, true);
  const doc = new DOMParser().parseFromString(localized, 'application/xml');
  assert.equal(doc.querySelector('work-title').textContent, complete().exercises['fixture-001'].title);
  assert.equal(doc.querySelector('words').textContent, complete().exercises['fixture-001'].goal);
  assert.ok(localized.includes('&amp;')); assert.ok(localized.includes('&lt;')); assert.ok(localized.includes('&apos;'));
});
test('real source catalog retains every course, exercise and musical field', async () => {
  const content = await loadContent({ rootDir });
  const music = compileMusic(content.courses), source = buildCatalog(content, 'en', music);
  const report = contentReport(content);
  assert.equal(report.issues.length, 0);
  assert.equal(source.courses.length, 80);
  assert.equal(report.rows.length, 80);
  assert.ok(report.rows.every(row => row.locale === 'en'));
  for (const [index, course] of content.courses.entries()) {
    assert.equal(source.courses[index].id, course.courseId);
    assert.deepEqual(source.courses[index].exercises.map(e => [e.id, e.slug]), course.exercises.map(e => [e.id, e.slug]));
    for (let j = 0; j < course.exercises.length; j++) {
      const original = course.exercises[j], generated = source.courses[index].exercises[j];
      assert.deepEqual(generated.expectedNotes, music.get(course.courseId).get(original.id).expectedNotes);
      assert.equal(generated.license.type, original.license.type);
      assert.equal(generated.license.attribution, original.license.attribution);
    }
  }
});
test('empty source license notes require no invented translation; legacy source clef is preserved', () => {
  const course = clone(fixture); course.exercises[0].license.notes = ''; course.exercises[0].license.attribution = '';
  course.exercises[0].clef = 'GF'; validateSourceCourse(course);
  const d = complete(course); delete d.exercises['fixture-001'].license;
  validateCourseTranslation(d, course, { full: true });
  assert.equal(editableFields(course, d).length, 5);
  d.exercises['fixture-001'].license = { notes: 'Invented' };
  assert.throws(() => validateCourseTranslation(d, course), /no source note/);
});
test('every legacy English score URL remains readable and byte-identical to localized EN', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pianio-all-output-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { catalogs, legacy } = await generateContent({ rootDir, outputDir: path.join(dir, 'generated') });
  for (const [i, course] of legacy.courses.entries()) for (const [j, exercise] of course.exercises.entries()) {
    const legacyXml = await readFile(path.join(dir, exercise.scorePath), 'utf8');
    const localizedEnXml = await readFile(path.join(dir, catalogs.en.courses[i].exercises[j].scorePath), 'utf8');
    assert.equal(legacyXml, localizedEnXml);
  }
});
