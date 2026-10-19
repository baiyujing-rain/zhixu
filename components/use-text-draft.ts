'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { recordOrigin } from '@/lib/dates';
import { memoryDraft, rememberDraft } from '@/lib/draft-memory';
import { ownedDraftKey, previousDraftKey } from '@/lib/draft-owner';

type DraftItem = { id: number; created_at?: string };
export type TextDraftConfig<T> = { key: (item: T) => string; value: (item: T) => string; payload: (item: T, text: string, base: string) => unknown; mergeRemote: (server: T, captured: T) => T; replace: (item: T, text: string) => T; maxLength: number; label: string };
type Status = 'saved' | 'unsaved' | 'saving' | 'offline' | 'conflict';
type Buffer<T> = { item: T; code: string; base: string; revision: number; epoch: number };
export type ForeignDraft = { key: string; code: string; base: string; updatedAt: string };
type Cached = { version: 1; code: string; base: string; updatedAt: string; origin?: string };
const origin = (item: DraftItem) => recordOrigin(item.created_at);
const matchesOrigin = (saved: { origin?: string } | null, item: DraftItem) => !saved?.origin || !origin(item) || saved.origin === origin(item);

export function useTextDraft<T extends DraftItem>(onSaved: (item: T) => void, config: TextDraftConfig<T>) {
  const key = (item: T) => ownedDraftKey(config.key(item));
  const candidateKeys = (item: T) => [key(item), previousDraftKey(config.key(item)), config.key(item)].filter((value): value is string => Boolean(value));
  const [code, setValue] = useState(''), [dirty, setDirty] = useState(false), [status, setStatus] = useState<Status>('saved');
  const [error, setError] = useState(''), [remoteCode, setRemoteCode] = useState<string | null>(null), [cacheAvailable, setCacheAvailable] = useState(true), [hasRecovery, setHasRecovery] = useState(false);
  const buffer = useRef<Buffer<T> | null>(null), epoch = useRef(0), flight = useRef<Promise<T | null> | null>(null), alive = useRef(true);
  const remoteRef = useRef<string | null>(null);
  const remoteKnown = useRef(true);
  const [canResolve, setCanResolve] = useState(true);
  const [foreignDrafts, setForeignDrafts] = useState<ForeignDraft[]>([]);
  const onSavedRef = useRef(onSaved); onSavedRef.current = onSaved;
  function remote(value: string | null, known = true) { remoteRef.current = value; setRemoteCode(value); remoteKnown.current = known; setCanResolve(known); }
  function cache(current: Buffer<T>) {
    try {
      const encoded = current.code === current.base && remoteRef.current === null ? null : JSON.stringify({ version: 1, code: current.code, base: current.base, updatedAt: new Date().toISOString(), origin: origin(current.item) } satisfies Cached);
      rememberDraft(key(current.item), encoded);
      if (encoded === null) localStorage.removeItem(key(current.item));
      else localStorage.setItem(key(current.item), encoded);
      setCacheAvailable(true);
    } catch { setCacheAvailable(false); }
  }
  function foreign(current: Buffer<T>) {
    const candidates: ForeignDraft[] = [];
    try {
      const prefix = config.key(current.item) + ':';
      for (let index = 0; index < localStorage.length; index++) {
        const candidate = localStorage.key(index);
        if (!candidate || !candidate.startsWith(prefix) || candidate === key(current.item) || candidate.endsWith('-recovery')) continue;
        let saved;
        try { saved = JSON.parse(memoryDraft(candidate) || localStorage.getItem(candidate) || 'null'); } catch { continue; }
        if (saved?.version !== 1 || !matchesOrigin(saved, current.item) || typeof saved.code !== 'string' || saved.code.length > 1000000 || typeof saved.base !== 'string' || saved.base.length > config.maxLength || saved.code === config.value(current.item) || saved.code === current.code) continue;
        candidates.push({ key: candidate, code: saved.code, base: saved.base, updatedAt: typeof saved.updatedAt === 'string' ? saved.updatedAt : '' });
      }
    } catch {}
    setForeignDrafts(candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  function accept(item: T, recover = false, restored?: Cached) {
    const base = config.value(item);
    let text = base, conflict = false, originalBase = base;
    if (recover) {
      try {
        const saved = restored || candidateKeys(item).map(candidate => { try { return JSON.parse(memoryDraft(candidate) || localStorage.getItem(candidate) || 'null'); } catch { return null; } }).find(value => value?.version === 1 && matchesOrigin(value, item));
        if (matchesOrigin(saved, item) && saved?.version === 1 && typeof saved.code === 'string' && saved.code.length <= 1000000 && typeof saved.base === 'string' && saved.base.length <= config.maxLength && saved.code !== base) {
          text = saved.code; conflict = saved.base !== base; originalBase = saved.base;
        }
      } catch { /* A malformed cache never replaces the server draft. */ }
    }
    buffer.current = { item, code: text, base: conflict ? originalBase : base, revision: 0, epoch: ++epoch.current };
    setValue(text); setDirty(text !== base); setStatus(conflict ? 'conflict' : text.length > config.maxLength ? 'offline' : text === base ? 'saved' : 'unsaved');
    setError(conflict ? '本地草稿与服务器版本不同，请比较后选择。' : text.length > config.maxLength ? `${config.label}超过 ${config.maxLength.toLocaleString('en-US')} 字符，完整内容保留在编辑器中，请精简后保存。` : ''); remote(conflict ? base : null);
    try { const saved = candidateKeys(item).map(candidate => { try { return JSON.parse(localStorage.getItem(`${candidate}-recovery`) || 'null'); } catch { return null; } }).find(value => value && matchesOrigin(value, item)); if (saved) localStorage.setItem(`${key(item)}-recovery`, JSON.stringify(saved)); setHasRecovery(Boolean(saved)); } catch { setHasRecovery(false); }
    // Every owner copy retains the original comparison base until the user chooses.
    cache(buffer.current);
    foreign(buffer.current);
  }
  function edit(text: string) {
    const current = buffer.current;
    if (!current || current.code === text) return;
    current.code = text; current.revision++; setValue(text); setDirty(text !== current.base || remoteRef.current !== null); setError('');
    setStatus(remoteRef.current !== null ? 'conflict' : text.length > config.maxLength ? 'offline' : text === current.base ? 'saved' : 'unsaved');
    if (text.length > config.maxLength) setError(`${config.label}超过 ${config.maxLength.toLocaleString('en-US')} 字符，暂不能保存到后端。完整内容仍在当前编辑器，请精简后重试。`);
    cache(current);
  }
  function acknowledged(captured: Buffer<T>, result: T) {
    const latest = buffer.current;
    if (!alive.current || !latest || latest.epoch !== captured.epoch) return result;
    latest.item = config.mergeRemote(result, captured.item); latest.base = captured.code;
    const pending = latest.code !== latest.base;
    setDirty(pending); setStatus(pending ? 'unsaved' : 'saved'); remote(null); cache(latest); foreign(latest); onSavedRef.current(latest.item);
    return latest.item;
  }
  async function persist(attempt = 0, force = false): Promise<T | null> {
    const current = buffer.current;
    if (!current || (!force && current.code === current.base)) return current?.item || null;
    const captured = { ...current };
    setStatus('saving'); setError('');
    try {
      const result = await api<T>(`/sessions/${captured.item.id}`, 'PATCH', config.payload(captured.item, captured.code, captured.base), undefined, captured.item.created_at);
      return acknowledged(captured, result);
    } catch (e) {
      const latest = buffer.current;
      if (alive.current && latest?.epoch === captured.epoch) {
        let message = (e as Error).message;
        if (e instanceof ApiError && [0, 409, 500, 502, 503, 504].includes(e.status)) {
          let server: T | null = null;
          try { server = await api<T>(`/sessions/${captured.item.id}`); } catch {}
          if (!alive.current || buffer.current?.epoch !== captured.epoch) throw e;
          if (server && origin(server) && origin(captured.item) && origin(server) !== origin(captured.item)) {
            message = '原题已删除或记录已改变，请重新打开。本地编辑没有写入其他题目。'; server = null;
          }
          if (server) {
            latest.item = config.mergeRemote(server, captured.item);
            const value = config.value(latest.item);
            if (value === captured.code) return acknowledged(captured, latest.item);
            if (e.status !== 409) { setStatus('offline'); setError(message); setDirty(true); cache(latest); throw e; }
            if (value === captured.base) {
              // A different field changed. Retry only while our field and record
              // still match the captured baseline; true conflicts stay explicit.
              remote(null);
              if (attempt < 2) return persist(attempt + 1, force);
              setStatus('offline'); setError('服务器仍在保存其他内容，请稍后再保存。本地编辑仍然保留。'); setDirty(true); cache(latest); throw e;
            }
            remote(value);
          } else { if (e.status !== 409) { setStatus('offline'); setError(message); setDirty(true); cache(latest); throw e; } remote(captured.base, false); }
          setStatus('conflict');
        } else setStatus('offline');
        setError(message); setDirty(true); cache(latest);
      }
      throw e;
    }
  }
  async function save(allowConflict = false, flush = true, force = false): Promise<T | null> {
    while (flight.current) { await flight.current; }
    const current = buffer.current;
    if (!current) return null;
    if (current.code.length > config.maxLength) { const message = `${config.label}超过 ${config.maxLength.toLocaleString('en-US')} 字符，请精简后保存；当前内容仍保留。`; setStatus('offline'); setError(message); cache(current); throw new ApiError(message, 422); }
    if (remoteRef.current !== null && !allowConflict) throw new ApiError('请先比较并处理版本冲突，本地编辑仍然保留。', 409);
    if (allowConflict && !remoteKnown.current) throw new ApiError('尚未读取到最新服务器版本，请先重新读取。', 409);
    if (allowConflict && remoteRef.current !== null) current.base = remoteRef.current;
    if (!force && current.code === current.base) {
      if (remoteRef.current !== null) { accept(current.item, false); onSavedRef.current(current.item); }
      return current.item;
    }
    const promise = persist(0, force); flight.current = promise;
    let result: T | null;
    try { result = await promise; }
    finally { if (flight.current === promise) flight.current = null; }
    if (flush && buffer.current?.epoch === current.epoch && buffer.current.code !== buffer.current.base) return save(false, true);
    return result;
  }
  function useRemote() {
    const current = buffer.current;
    if (!current || remoteRef.current === null || !remoteKnown.current) return;
    // Retain the discarded local version as a recoverable copy on this browser.
    try { localStorage.setItem(`${key(current.item)}-recovery`, JSON.stringify({ code: current.code, updatedAt: new Date().toISOString(), origin: origin(current.item) })); } catch {}
    accept(config.replace(current.item, remoteRef.current), false);
    onSavedRef.current(buffer.current!.item);
  }
  function restoreRecovery() {
    const current = buffer.current;
    if (!current) return;
    try {
      const saved = candidateKeys(current.item).map(candidate => { try { return JSON.parse(localStorage.getItem(`${candidate}-recovery`) || 'null'); } catch { return null; } }).find(value => value && matchesOrigin(value, current.item));
      if (matchesOrigin(saved, current.item) && typeof saved?.code === 'string' && saved.code.length <= 1000000) edit(saved.code);
    } catch {}
  }
  async function refreshRemote() {
    const current = buffer.current;
    if (!current) return;
    const result = await api<T>(`/sessions/${current.item.id}`);
    if (buffer.current?.epoch !== current.epoch) return;
    if (origin(result) && origin(current.item) && origin(result) !== origin(current.item)) throw new ApiError('原题已删除或记录已改变，请重新打开。本地内容仍在编辑器中。', 409);
    current.item = config.mergeRemote(result, current.item); remote(config.value(current.item));
  }
  function restoreForeign(candidate: string) {
    const current = buffer.current;
    if (!current) return;
    if (current.code !== current.base || remoteRef.current !== null) { setError('请先保存或处理当前编辑，再恢复其他窗口的草稿。'); return; }
    try {
      const saved = JSON.parse(memoryDraft(candidate) || localStorage.getItem(candidate) || 'null');
      if (!candidate.startsWith(config.key(current.item) + ':') || !matchesOrigin(saved, current.item) || saved?.version !== 1 || typeof saved.code !== 'string' || saved.code.length > 1000000 || typeof saved.base !== 'string' || saved.base.length > config.maxLength) throw new Error('这份草稿已改变或不属于当前题目，请刷新后重新选择。');
      accept(current.item, true, saved);
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => {
    function changed(event: StorageEvent) {
      const current = buffer.current;
      if (!current) return;
      const base = config.key(current.item);
      if (event.key === null || event.key === base || event.key.startsWith(base + ':')) {
        if (current.code !== current.base && (event.key === null || event.key === key(current.item)) && event.newValue === null) setCacheAvailable(false);
        foreign(current);
      }
    }
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!dirty || status !== 'unsaved') return;
    const timer = setTimeout(() => { void save(false, false).catch(() => {}); }, 900);
    return () => clearTimeout(timer);
    // The versioned buffer, not a captured render, supplies the data sent to the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, dirty, status]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; }; }, []);
  function clear() { buffer.current = null; epoch.current++; setValue(''); setDirty(false); setStatus('saved'); setError(''); remote(null); setHasRecovery(false); setForeignDrafts([]); }
  return { foreignDrafts, restoreForeign, code, dirty, status, error, remoteCode, cacheAvailable, hasRecovery, canResolve, edit, accept, save, useRemote, restoreRecovery, refreshRemote, clear };
}
