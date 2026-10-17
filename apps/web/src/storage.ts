/** Optional preferences must never prevent practice when browser storage is denied. */
export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

export function savePreference(key: string, value: string): void {
  try { localStorage.setItem(key, value); }
  catch { /* The component retains the preference in memory for this session. */ }
}
