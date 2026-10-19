"use client";
import { useEffect, useRef, useState } from 'react';
import { memoryDraft, rememberDraft } from '@/lib/draft-memory';
import { ownedDraftKey, previousDraftKey } from '@/lib/draft-owner';
import type { ForeignDraft } from './use-text-draft';
type Stored = { version: 1; value: string; updatedAt: string };
export function useLocalInput(base: string | null, maxLength: number) {
  const [state, setState] = useState<{ key: string | null; value: string }>({ key: null, value: '' });
  const [cacheAvailable, setCacheAvailable] = useState(true), [foreign, setForeign] = useState<ForeignDraft[]>([]);
  const buffer = useRef<{ key: string | null; value: string }>({ key: null, value: '' }), scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scan(key: string, value: string) {
    const found: ForeignDraft[] = [];
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const candidate = localStorage.key(index);
        if (!candidate?.startsWith(key + ':') || candidate === ownedDraftKey(key)) continue;
        let saved; try { saved = JSON.parse(localStorage.getItem(candidate) || 'null'); } catch { continue; }
        if (saved?.version === 1 && typeof saved.value === 'string' && saved.value.length <= 1000000 && saved.value !== value && saved.value.trim()) found.push({ key: candidate, code: saved.value, base: '', updatedAt: typeof saved.updatedAt === 'string' ? saved.updatedAt : '' });
      }
    } catch {}
    setForeign(found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  function write(value: string, key = base) {
    if (!key) return;
    buffer.current = { key, value }; setState(buffer.current);
    const encoded = value ? JSON.stringify({ version: 1, value, updatedAt: new Date().toISOString() } satisfies Stored) : null;
    rememberDraft(ownedDraftKey(key), encoded);
    try {
      if (encoded) localStorage.setItem(ownedDraftKey(key), encoded);
      else localStorage.removeItem(ownedDraftKey(key));
      setCacheAvailable(true);
    } catch { setCacheAvailable(false); }
    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => scan(key, value), 200);
  }
  useEffect(() => () => { if (scanTimer.current) clearTimeout(scanTimer.current); }, []);
  useEffect(() => {
    if (!base) { buffer.current = { key: null, value: '' }; setState(buffer.current); setForeign([]); return; }
    let value = '';
    try {
      for (const key of [ownedDraftKey(base), previousDraftKey(base)]) {
        if (!key) continue;
        let raw = memoryDraft(key); if (raw === null) { try { raw = localStorage.getItem(key); } catch { setCacheAvailable(false); } }
        let saved; try { saved = JSON.parse(raw || 'null'); } catch { continue; }
        if (saved?.version === 1 && typeof saved.value === 'string' && saved.value.length <= 1000000) { value = saved.value; break; }
      }
    } catch { setCacheAvailable(false); }
    write(value, base); scan(base, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  useEffect(() => {
    function changed(event: StorageEvent) { if (base && (event.key === null || event.key.startsWith(base + ':'))) scan(base, buffer.current.value); }
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  function clearIfEqual(value: string) { if (base && buffer.current.key === base && buffer.current.value === value) { write(''); return true; } return false; }
  function restore(key: string) {
    if (!base || buffer.current.value.trim() || !key.startsWith(base + ':')) return;
    try {
      const raw = memoryDraft(key) || localStorage.getItem(key);
      const saved = JSON.parse(raw || 'null');
      if (saved?.version === 1 && typeof saved.value === 'string' && saved.value.length <= 1000000) { write(saved.value); scan(base, saved.value); }
    } catch {}
  }
  const value = state.key === base ? state.value : '';
  return { value, set: write, clearIfEqual, cacheAvailable, foreign: foreign.filter(item => item.code !== value), restore, tooLong: value.length > maxLength };
}
