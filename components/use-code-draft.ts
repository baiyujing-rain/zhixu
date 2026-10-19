"use client";
import { useTextDraft } from './use-text-draft';
type Item = { id: number; created_at?: string; language: 'cpp' | 'python'; drafts: Record<string, string> };
export function useCodeDraft<T extends Item>(onSaved: (item: T) => void) {
  return useTextDraft(onSaved, {
    key: item => `zhixu-code-${item.id}-${item.language}`,
    value: item => item.drafts[item.language] || '',
    payload: (item, code, base) => ({ language: item.language, code, expected_code: base }),
    mergeRemote: (server, captured) => ({ ...server, language: captured.language }),
    replace: (item, code) => ({ ...item, drafts: { ...item.drafts, [item.language]: code } }),
    maxLength: 50000, label: '代码',
  });
}
