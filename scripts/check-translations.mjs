import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from './lib/json.mjs';
import { loadContent, contentReport } from './lib/content-pipeline.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const namespaceDir = path.join(repoRoot, 'apps/web/src/i18n/locales');
const REQUIRED_NAMESPACES = ['common', 'catalog', 'practice', 'diagnostics', 'progress'];
const INTERPOLATION = /{{\s*-?\s*([\w.]+)\s*-?\s*}}/g;
const PLURAL_SUFFIX = /^(.*)_(zero|one|two|few|many|other)$/;

function flattenStrings(value, prefix = '', result = new Map()) {
  if (typeof value === 'string') {
    result.set(prefix, value);
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenStrings(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

function interpolationParameters(value) {
  return [...value.matchAll(INTERPOLATION)].map((match) => match[1]).sort();
}

function requiredPluralCategories(language) {
  try {
    return new Intl.PluralRules(language).resolvedOptions().pluralCategories;
  } catch {
    return ['one', 'other'];
  }
}

function pluralGroups(flattened) {
  const groups = new Map();
  for (const [key, value] of flattened) {
    const match = key.match(PLURAL_SUFFIX);
    if (!match || !interpolationParameters(value).includes('count')) continue;
    const [, base, form] = match;
    const forms = groups.get(base) ?? new Set();
    forms.add(form);
    groups.set(base, forms);
  }
  return groups;
}

function pluralBase(key) {
  return key.match(PLURAL_SUFFIX)?.[1];
}

/** Validate translation resources without requiring Node to import application TypeScript. */
export function validateTranslationResources(resources, supportedLanguages, sourceLanguage, requiredNamespaces, { allowFallbacks = false, warnings = [] } = {}) {
  const issues = [];
  const missing = (language, message, warningMessage = message) => {
    if (allowFallbacks && language !== sourceLanguage) warnings.push(`${language}: ${warningMessage}`);
    else issues.push(`${language}: ${message}`);
  };
  const source = resources[sourceLanguage];
  if (!source || typeof source !== 'object') {
    return [`Missing source-language resources: ${sourceLanguage}`];
  }
  const namespaces = Object.keys(source).sort();
  if (namespaces.length === 0) issues.push(`No namespaces found for source language ${sourceLanguage}`);
  for (const namespace of requiredNamespaces ?? []) {
    if (!namespaces.includes(namespace)) issues.push(`${sourceLanguage}: missing namespace "${namespace}"`);
  }
  for (const namespace of namespaces) {
    if (requiredNamespaces && !requiredNamespaces.includes(namespace)) {
      issues.push(`${sourceLanguage}: unexpected namespace "${namespace}"`);
    }
  }

  for (const language of supportedLanguages) {
    const locale = resources[language];
    if (!locale || typeof locale !== 'object') {
      missing(language, 'missing language resources; all messages will use the source-language fallback');
      continue;
    }
    for (const namespace of namespaces) {
      if (!Object.hasOwn(locale, namespace)) {
        missing(language, `missing namespace "${namespace}"`);
      }
    }
    for (const namespace of Object.keys(locale)) {
      if (!namespaces.includes(namespace)) {
        issues.push(`${language}: unexpected namespace "${namespace}"`);
      }
    }

    const sourceFlat = new Map();
    const languageFlat = new Map();
    for (const namespace of namespaces) {
      const sourceResource = source[namespace];
      const languageResource = locale[namespace];
      if (!languageResource || typeof languageResource !== 'object') continue;
      flattenStrings(sourceResource, namespace, sourceFlat);
      flattenStrings(languageResource, namespace, languageFlat);
    }

    const sourcePluralGroups = pluralGroups(sourceFlat);
    const languagePluralGroups = pluralGroups(languageFlat);
    for (const base of sourcePluralGroups.keys()) {
      if (!languagePluralGroups.has(base)) missing(language, `missing plural key "${base}"`);
    }
    for (const base of languagePluralGroups.keys()) {
      if (!sourcePluralGroups.has(base)) issues.push(`${language}: unexpected plural key "${base}"`);
    }

    for (const [key, sourceValue] of sourceFlat) {
      const base = pluralBase(key);
      if (base && (sourcePluralGroups.has(base) || languagePluralGroups.has(base))) continue;
      if (!languageFlat.has(key)) {
        missing(language, `missing key "${key}"`);
        continue;
      }
      const translation = languageFlat.get(key);
      if (JSON.stringify(interpolationParameters(sourceValue)) !== JSON.stringify(interpolationParameters(translation))) {
        issues.push(`${language}: interpolation parameters differ at "${key}"`);
      }
    }
    for (const [key, value] of languageFlat) {
      const base = pluralBase(key);
      if (!sourceFlat.has(key) && !(base && (sourcePluralGroups.has(base) || languagePluralGroups.has(base)))) {
        issues.push(`${language}: unexpected key "${key}"`);
      }
      if (!value.trim()) missing(language, `empty string at "${key}"`, `empty string at "${key}"; using the source-language fallback`);
    }

    for (const [base, forms] of languagePluralGroups) {
      const sourceForms = sourcePluralGroups.get(base);
      if (sourceForms) {
        const sourceForm = sourceForms.has('other') ? 'other' : [...sourceForms][0];
        const reference = sourceFlat.get(`${base}_${sourceForm}`);
        for (const form of forms) {
          const translation = languageFlat.get(`${base}_${form}`);
          if (JSON.stringify(interpolationParameters(reference)) !== JSON.stringify(interpolationParameters(translation))) {
            issues.push(`${language}: interpolation parameters differ at plural key "${base}_${form}"`);
          }
        }
      }
    }

    const categories = requiredPluralCategories(language);
    for (const [base, forms] of languagePluralGroups) {
      for (const category of categories) {
        if (!forms.has(category)) missing(language, `plural key "${base}" is missing form "${category}"`);
      }
    }
  }
  return issues;
}

/** Count populated UI messages per locale; locale-specific plural forms make one message unit. */
export function translationResourceCoverage(resources, supportedLanguages, sourceLanguage) {
  const source = resources[sourceLanguage] ?? {};
  const sourceFlat = new Map();
  for (const [namespace, resource] of Object.entries(source)) flattenStrings(resource, namespace, sourceFlat);
  const sourcePluralGroups = pluralGroups(sourceFlat);
  const pluralFormKeys = new Set([...sourcePluralGroups].flatMap(([base, forms]) => [...forms].map(form => `${base}_${form}`)));
  const messageKeys = [...sourceFlat.keys()].filter(key => !pluralFormKeys.has(key));
  const total = messageKeys.length + sourcePluralGroups.size;

  return supportedLanguages.map(language => {
    const locale = resources[language] ?? {};
    const localeFlat = new Map();
    for (const [namespace, resource] of Object.entries(locale)) flattenStrings(resource, namespace, localeFlat);
    let translated = messageKeys.filter(key => typeof localeFlat.get(key) === 'string' && localeFlat.get(key).trim()).length;
    for (const base of sourcePluralGroups.keys()) {
      const categories = requiredPluralCategories(language);
      if (categories.every(category => {
        const value = localeFlat.get(`${base}_${category}`);
        return typeof value === 'string' && value.trim();
      })) translated++;
    }
    return { language, translated, total };
  });
}

function percent(translated, total) {
  return total ? `${(translated / total * 100).toFixed(1)}%` : 'n/a';
}

async function readJson(filePath) {
  return readJsonStrict(filePath);
}

async function main() {
  const config = await readJson(path.join(repoRoot, 'localization.config.json'));
  const { readdir } = await import('node:fs/promises');
  const namespaces = new Set();
  for (const language of config.supportedLanguages) {
    try {
      for (const file of await readdir(path.join(namespaceDir, language))) {
        if (file.endsWith('.json')) namespaces.add(file.slice(0, -'.json'.length));
      }
    } catch {
      // The validator below reports a language with no resources.
    }
  }
  const namespaceNames = [...namespaces].sort();
  const loadIssues = [];
  const resources = {};
  for (const language of config.supportedLanguages) {
    resources[language] = {};
    for (const namespace of namespaceNames) {
      const filePath = path.join(namespaceDir, language, `${namespace}.json`);
      try {
        resources[language][namespace] = await readJson(filePath);
      } catch (error) {
        if (error?.code !== 'ENOENT') loadIssues.push(`${language}/${namespace}: ${error.message}`);
      }
    }
  }
  const warnings = [];
  const full = process.argv.includes('--full');
  const issues = [...loadIssues, ...validateTranslationResources(resources, config.supportedLanguages, config.sourceLanguage, REQUIRED_NAMESPACES, {
    allowFallbacks: !full,
    warnings,
  })];
  try {
    const report = contentReport(await loadContent({ rootDir: repoRoot }), { full });
    for (const row of report.rows) {
      console.log(`${row.locale}/${row.courseId}: translated=${row.translatedFields}/${row.totalFields}, fallback=${row.fallbackFields}, source=${row.sourceFields}`);
    }
    const uiCoverage = translationResourceCoverage(resources, config.supportedLanguages, config.sourceLanguage);
    for (const ui of uiCoverage) {
      const courses = report.rows.filter(row => row.locale === ui.language);
      const fields = courses.reduce((total, row) => total + row.totalFields, 0);
      const translatedFields = courses.reduce((total, row) => total + row.translatedFields + row.sourceFields, 0);
      console.log(`${ui.language}: UI ${percent(ui.translated, ui.total)} (${ui.translated}/${ui.total} messages); course content ${percent(translatedFields, fields)} (${translatedFields}/${fields} fields)`);
    }
    warnings.push(...report.warnings);
    issues.push(...report.issues);
  } catch (error) { issues.push(`Content: ${error.message}`); }
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
  if (issues.length) {
    console.error(`Translation validation failed (${issues.length} issue${issues.length === 1 ? '' : 's'}):`);
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Translation resources valid: ${config.supportedLanguages.join(', ')}; ${namespaceNames.length} namespaces.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Translation validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
