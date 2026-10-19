/** Keep an in-page fallback when browser storage is blocked; never claim it survives reload. */
const values = new Map<string, string>();
export function rememberDraft(key: string, value: string | null) { if (value === null) values.delete(key); else values.set(key, value); }
export function memoryDraft(key: string) { return values.get(key) ?? null; }
export function forgetMatchingDrafts(matches: (key: string) => boolean) { for (const key of values.keys()) if (matches(key)) values.delete(key); }
