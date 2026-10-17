export function validateTranslationResources(
  resources: Record<string, Record<string, unknown>>,
  supportedLanguages: readonly string[],
  sourceLanguage: string,
  requiredNamespaces?: readonly string[],
  options?: { allowFallbacks?: boolean; warnings?: string[] },
): string[];
export function translationResourceCoverage(
  resources: Record<string, Record<string, unknown>>,
  supportedLanguages: readonly string[],
  sourceLanguage: string,
): Array<{ language: string; translated: number; total: number }>;
