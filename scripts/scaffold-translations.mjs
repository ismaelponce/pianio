import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadContent } from './lib/content-pipeline.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function scaffoldTranslations({ rootDir, locale }) {
  if (typeof locale !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(locale)) {
    throw new Error('Provide a valid locale with --locale, for example --locale fr');
  }
  const content = await loadContent({ rootDir });
  if (!content.config.supportedLanguages.includes(locale) || locale === content.config.sourceLanguage) {
    throw new Error(`${locale} must be listed in localization.config.json and cannot be the source language`);
  }

  const outputDir = path.join(rootDir, 'content-locales', locale);
  await mkdir(outputDir, { recursive: true });
  let created = 0;
  let skipped = 0;
  for (const course of content.courses) {
    const translation = {
      courseId: course.courseId,
      title: '',
      summary: '',
      exercises: Object.fromEntries(course.exercises.map(exercise => [exercise.id, {
        title: '',
        summary: '',
        goal: '',
        ...(exercise.license.notes.trim() ? { license: { notes: '' } } : {}),
      }])),
    };
    const file = path.join(outputDir, `${course.courseId}.json`);
    try {
      await writeFile(file, `${JSON.stringify(translation, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      created++;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      skipped++;
    }
  }
  return { created, skipped, outputDir };
}

async function main() {
  const args = process.argv.slice(2);
  const localeIndex = args.indexOf('--locale');
  if (localeIndex < 0 || !args[localeIndex + 1] || args.some((arg, index) => arg.startsWith('--') && arg !== '--locale' || arg === '--locale' && index !== localeIndex)) {
    throw new Error('Usage: pnpm i18n:scaffold --locale <language>');
  }
  const { created, skipped, outputDir } = await scaffoldTranslations({ rootDir: repoRoot, locale: args[localeIndex + 1] });
  console.log(`Created ${created} course translation template${created === 1 ? '' : 's'}; left ${skipped} existing file${skipped === 1 ? '' : 's'} unchanged in ${path.relative(repoRoot, outputDir)}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
