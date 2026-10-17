import { mkdir, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { readJsonStrict } from './json.mjs';
import { object, validateSourceCourse, validateCourseTranslation, editableFields, isTranslated } from './content-validation.mjs';
import { buildExpectedNotes, renderMusicXml, localizeMusicXml } from './music.mjs';

export async function findCourseFiles(dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await findCourseFiles(full));
    else if (entry.name === 'course.json') files.push(full);
  }
  return files;
}
export function validateLanguageConfig(config) {
  object(config, 'localization config', ['supportedLanguages', 'sourceLanguage', 'fallbackLanguage'], ['supportedLanguages', 'sourceLanguage', 'fallbackLanguage']);
  if (!Array.isArray(config.supportedLanguages) || !config.supportedLanguages.length ||
      !config.supportedLanguages.every(l => typeof l === 'string' && /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(l)) ||
      new Set(config.supportedLanguages).size !== config.supportedLanguages.length ||
      !config.supportedLanguages.includes(config.sourceLanguage) || config.fallbackLanguage !== config.sourceLanguage) {
    throw new Error('Invalid localization config: fallback must be the supported source language');
  }
  return config;
}
export async function loadContent({ rootDir, contentDir = path.join(rootDir, 'content'), localesDir = path.join(rootDir, 'content-locales'), configPath = path.join(rootDir, 'localization.config.json') }) {
  const config = validateLanguageConfig(await readJsonStrict(configPath));
  const courses = [], ids = new Set();
  // Deliberately traverse only the canonical content root, never content-locales.
  for (const file of await findCourseFiles(contentDir)) {
    const course = validateSourceCourse(await readJsonStrict(file));
    if (ids.has(course.courseId)) throw new Error(`Duplicate course ${course.courseId}: ${file}`);
    ids.add(course.courseId); courses.push(course);
  }
  if (!courses.length) throw new Error('No source courses');
  const translations = {};
  let localeEntries = [];
  try { localeEntries = await readdir(localesDir, { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const entry of localeEntries) {
    if (!entry.isDirectory() || !config.supportedLanguages.includes(entry.name) || entry.name === config.sourceLanguage) throw new Error(`Unexpected content locale entry ${entry.name}`);
  }
  for (const locale of config.supportedLanguages.filter(l => l !== config.sourceLanguage)) {
    translations[locale] = new Map();
    const dir = path.join(localesDir, locale);
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const filenameIssues = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) throw new Error(`Unexpected translation file ${locale}/${entry.name}`);
      const file = path.join(dir, entry.name), doc = await readJsonStrict(file);
      if (translations[locale].has(doc?.courseId)) throw new Error(`Duplicate translated course ${doc.courseId}`);
      const course = courses.find(c => c.courseId === doc?.courseId);
      if (!course) throw new Error(`Orphan courseId ${doc?.courseId}: ${file}`);
      validateCourseTranslation(doc, course);
      translations[locale].set(doc.courseId, doc);
      if (entry.name !== `${doc.courseId}.json`) filenameIssues.push(`Translation filename must be ${doc.courseId}.json`);
    }
    if (filenameIssues.length) throw new Error(filenameIssues.join('; '));
  }
  return { config, courses, translations };
}
export function resolveCourse(course, translation) {
  const resolve = (original, translated) => isTranslated(translated) ? translated : original;
  return { ...course, title: resolve(course.title, translation?.title), summary: resolve(course.summary, translation?.summary),
    exercises: course.exercises.map(e => {
      const t = translation?.exercises?.[e.id];
      return { ...e, title: resolve(e.title, t?.title), summary: resolve(e.summary, t?.summary), goal: resolve(e.goal, t?.goal),
        license: { ...e.license, notes: resolve(e.license.notes, t?.license?.notes) } };
    }) };
}
export function contentReport(content, { full = false } = {}) {
  const { config, courses, translations } = content;
  const rows = [], issues = [], warnings = [];
  for (const locale of config.supportedLanguages) for (const course of courses) {
    const coverage = contentCoverage(course, translations[locale]?.get(course.courseId), locale, config.sourceLanguage);
    rows.push({ courseId: course.courseId, ...coverage });
    if (locale === config.sourceLanguage) continue;
    if (coverage.fallbackFields) warnings.push(`${locale}/${course.courseId}: ${coverage.fallbackFields}/${coverage.totalFields} fields missing; using ${config.sourceLanguage} fallback`);
    if (full && coverage.fallbackFields) issues.push(`${locale}/${course.courseId}: ${coverage.fallbackFields}/${coverage.totalFields} fields missing`);
  }
  return { rows, issues, warnings };
}
function contentCoverage(course, translation, locale, sourceLanguage) {
  const source = locale === sourceLanguage;
  const fields = editableFields(course, translation);
  const translatedFields = source ? 0 : fields.filter(field => isTranslated(field.translation)).length;
  const fallbackFields = source ? 0 : fields.length - translatedFields;
  return { locale, sourceLanguage, totalFields: fields.length, sourceFields: source ? fields.length : 0,
    translatedFields, fallbackFields,
    fields: Object.fromEntries(fields.map(field => [field.path, source ? 'source' : isTranslated(field.translation) ? 'translated' : 'fallback'])) };
}
/** Compute once from source; expectedNotes arrays and XML bodies are reused by every locale. */
export function compileMusic(courses) {
  return new Map(courses.map(c => [c.courseId, new Map(c.exercises.map(e => [e.id, {
    expectedNotes: buildExpectedNotes(e), xml: renderMusicXml(c, e)
  }]))]));
}
export function buildCatalog(content, locale, music, { generatedAt = new Date().toISOString(), legacy = false } = {}) {
  const { config, courses, translations } = content;
  if (!config.supportedLanguages.includes(locale)) throw new Error(`Unsupported locale ${locale}`);
  return { generatedAt, locale, courses: courses.map(source => {
    const translation = translations[locale]?.get(source.courseId);
    const course = resolveCourse(source, translation);
    return { id: course.courseId, title: course.title, level: course.level, summary: course.summary,
      sourcePolicy: course.sourcePolicy, exerciseCount: course.exercises.length,
      coverage: contentCoverage(source, translation, locale, config.sourceLanguage),
      exercises: course.exercises.map(e => ({
        id: e.id, slug: e.slug, title: e.title, summary: e.summary, goal: e.goal,
        hands: e.hands, clef: e.clef, sourceKind: e.sourceKind, tempoBpm: e.tempoBpm,
        timeSignature: e.timeSignature, keySignature: e.keySignature, license: e.license, category: e.category,
        scorePath: `/generated/${legacy ? '' : `${locale}/`}scores/${course.courseId}/${e.slug}.musicxml`,
        expectedNotes: music.get(course.courseId).get(e.id).expectedNotes,
        ...(e.swing ? { swing: true } : {})
      })) };
  }) };
}
export async function generateContent(options) {
  const { rootDir, outputDir = path.join(rootDir, 'apps/web/public/generated') } = options;
  // Validate everything and compile before touching the chosen output directory.
  const content = await loadContent(options);
  const music = compileMusic(content.courses), catalogs = {};
  const generatedAt = new Date().toISOString();
  for (const locale of content.config.supportedLanguages) catalogs[locale] = buildCatalog(content, locale, music, { generatedAt });
  const legacy = buildCatalog(content, content.config.sourceLanguage, music, { generatedAt, legacy: true });
  // Caller must explicitly select an output outside input roots; protect destructive typos.
  const output = path.resolve(outputDir);
  const protectedPaths = [rootDir, options.contentDir ?? path.join(rootDir, 'content'), options.localesDir ?? path.join(rootDir, 'content-locales')].map(p => path.resolve(p));
  if (protectedPaths.some(p => output === p || p.startsWith(output + path.sep) || output.startsWith(p + path.sep) && p !== path.resolve(rootDir))) throw new Error(`Unsafe outputDir ${output}`);
  await rm(output, { recursive: true, force: true });
  for (const [locale, catalog] of [...Object.entries(catalogs), ['', legacy]]) {
    const dir = path.join(output, locale);
    await mkdir(dir, { recursive: true });
    for (const course of catalog.courses) {
      const scoreDir = path.join(dir, 'scores', course.id);
      await mkdir(scoreDir, { recursive: true });
      for (const e of course.exercises) {
        const canonical = music.get(course.id).get(e.id).xml;
        const xml = !locale || locale === content.config.sourceLanguage ? canonical : localizeMusicXml(canonical, e);
        await writeFile(path.join(scoreDir, `${e.slug}.musicxml`), xml, 'utf8');
      }
    }
    await writeFile(path.join(dir, 'catalog.json'), JSON.stringify(catalog, null, 2), 'utf8');
  }
  await writeFile(path.join(output, 'i18n-coverage.json'), JSON.stringify(contentReport(content), null, 2), 'utf8');
  return { catalogs, legacy, content };
}
