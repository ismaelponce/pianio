// Read-only HTTP verification against an already running Vite static preview.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(rootDir, 'localization.config.json'), 'utf8'));
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:4173/');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Use a local preview, not production');
async function get(resourcePath) {
  const response = await fetch(new URL(resourcePath, base));
  if (response.status !== 200) throw new Error(`${resourcePath}: HTTP ${response.status}`);
  return response.text();
}
const catalogs = Object.fromEntries(await Promise.all(config.supportedLanguages.map(async locale => [
  locale, JSON.parse(await get(`/generated/${locale}/catalog.json`)),
])));
const source = catalogs[config.sourceLanguage];
const legacy = JSON.parse(await get('/generated/catalog.json'));
if (!source) throw new Error(`Missing source catalog: ${config.sourceLanguage}`);
const identity = catalog => catalog.courses.map(course => [course.id, course.exercises.map(exercise => [exercise.id, exercise.slug])]);
for (const [locale, catalog] of Object.entries(catalogs)) {
  if (catalog.locale !== locale) throw new Error(`Catalog locale mismatch: ${locale}`);
  if (JSON.stringify(identity(source)) !== JSON.stringify(identity(catalog))) throw new Error(`Catalog identity/order mismatch: ${locale}`);
}
if (JSON.stringify(identity(source)) !== JSON.stringify(identity(legacy))) throw new Error('Legacy catalog identity/order mismatch');
const jobs = source.courses.flatMap((course, courseIndex) => course.exercises.map((exercise, exerciseIndex) => async () => {
  const paths = [
    ...Object.values(catalogs).map(catalog => catalog.courses[courseIndex].exercises[exerciseIndex].scorePath),
    legacy.courses[courseIndex].exercises[exerciseIndex].scorePath,
  ];
  const scores = await Promise.all(paths.map(get));
  for (const xml of scores) if (!/<score-partwise\b/.test(xml)) throw new Error(`Invalid MusicXML: ${exercise.scorePath}`);
  if (scores.at(-1) !== scores[config.supportedLanguages.indexOf(config.sourceLanguage)]) throw new Error(`Legacy source score mismatch: ${exercise.scorePath}`);
}));
for (let offset = 0; offset < jobs.length; offset += 12) await Promise.all(jobs.slice(offset, offset + 12).map(job => job()));
console.log(JSON.stringify({
  base: base.href,
  catalogs: Object.keys(catalogs).length + 1,
  coursesPerCatalog: source.courses.length,
  exercisesPerCatalog: jobs.length,
  musicXmlFetched: jobs.length * (Object.keys(catalogs).length + 1),
  result: 'passed',
  hosting: 'Vite preview; does not emulate Firebase rewrites',
}, null, 2));
