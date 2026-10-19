import { forgetMatchingDrafts } from './draft-memory';
/** Delete only this record's browser data, including retained recovery copies. */
export function removeLearningCache(id: number) {
  const exact = new Set([`zhixu-animation-${id}`, `zhixu-review-note-${id}`, `zhixu-notes-${id}`, `zhixu-notes-${id}-recovery`]);
  const prefixes = [`zhixu-code-${id}-`, `zhixu-review-note-${id}:`, `zhixu-notes-${id}:`, `zhixu-question-${id}:`];
  const matches = (key: string) => exact.has(key) || prefixes.some(prefix => key.startsWith(prefix));
  forgetMatchingDrafts(matches);
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key): key is string => Boolean(key));
    for (const key of keys) if (matches(key)) localStorage.removeItem(key);
  } catch { /* Blocked browser storage does not prevent deleting server records. */ }
}
