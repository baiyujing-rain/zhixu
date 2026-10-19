/**
 * 知序 · 离线优先读缓存（只读、不回写）。
 *
 * 用浏览器原生 IndexedDB 保存 GET 只读数据的快照，网络失败（status === 0）
 * 时回退到缓存，让题目列表、学习记录、题库和偏好在后端未启动时仍可读。
 * 本模块只负责「已落库数据」的离线可读，与 localStorage 的写侧草稿
 * （use-text-draft.ts / use-local-input.ts）使用不同命名空间，互不覆盖。
 *
 * 兼容性：SSR / 隐私模式 / 极老浏览器下 `indexedDB` 不存在或打开失败时，
 * 自动退化为进程内 Map（接口签名不变、静默 no-op），绝不抛错、绝不白屏。
 */

export type ApiSource = 'network' | 'cache' | 'none';
export type CachedEntry = { key: string; data: unknown; cachedAt: number };

const DB_NAME = 'zhixu-read-cache';
const STORE_NAME = 'entries';
const MAX_ENTRIES = 200;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const hasIndexedDB = typeof indexedDB !== 'undefined';
const memory = new Map<string, CachedEntry>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (!hasIndexedDB) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>(resolve => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => { if (!settled) { settled = true; resolve(db); } };
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('cachedAt', 'cachedAt');
        }
      };
      request.onsuccess = () => finish(request.result);
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch { finish(null); }
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** Normalize an app-level path (e.g. `/sessions/1?x`) for stable cache keys. */
export function normalizePath(path: string): string {
  const cleaned = path.split('?')[0].split('#')[0].replace(/\/+$/, '');
  if (!cleaned) return '/';
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

/** Canonical cache key: `METHOD:/api/<normalized-path>`（去 query、去尾斜杠）。 */
export function cacheKey(method: string, path: string): string {
  const normalized = normalizePath(path);
  const withApi = normalized.startsWith('/api') ? normalized : (normalized === '/' ? '/api' : `/api${normalized}`);
  return `${method.toUpperCase()}:${withApi}`;
}

const CACHEABLE_ROUTES: RegExp[] = [
  /^\/sessions$/,
  /^\/sessions\/[^/]+$/,
  /^\/library$/,
  /^\/library\/[^/]+$/,
  /^\/examples$/,
  /^\/profile$/,
];

/** Only cache read-only reference data; never instant/remote-dependent endpoints. */
export function isCacheable(path: string, method: string): boolean {
  if (method.toUpperCase() !== 'GET') return false;
  const normalized = normalizePath(path);
  return CACHEABLE_ROUTES.some(pattern => pattern.test(normalized));
}

/** Minimal invalidation mapping for writes that change cached read data. */
export function invalidationPrefixes(path: string, method: string): string[] {
  const normalized = normalizePath(path);
  const m = method.toUpperCase();
  const out: string[] = [];
  if (m === 'POST' && normalized === '/sessions') out.push('GET:/api/sessions');
  if ((m === 'PATCH' || m === 'DELETE') && /^\/sessions\/[^/]+$/.test(normalized)) {
    out.push('GET:/api/sessions', cacheKey('GET', normalized));
  }
  if (m === 'POST' && normalized === '/library') out.push('GET:/api/library');
  if (m === 'DELETE' && /^\/library\/[^/]+$/.test(normalized)) {
    out.push('GET:/api/library', cacheKey('GET', normalized));
  }
  if (m === 'POST' && /^\/library\/[^/]+\/practice$/.test(normalized)) {
    const id = normalized.split('/').filter(Boolean)[1];
    out.push('GET:/api/library', cacheKey('GET', `/library/${id}`));
  }
  if (m === 'PUT' && normalized === '/profile') out.push('GET:/api/profile');
  return out;
}

function pruneMemory() {
  if (memory.size <= MAX_ENTRIES) return;
  const sorted = [...memory.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt);
  for (let i = 0; i < sorted.length - MAX_ENTRIES; i++) memory.delete(sorted[i][0]);
}

/** Delete expired entries first, then oldest-first until the LRU bound holds. */
async function pruneDatabase(db: IDBDatabase): Promise<void> {
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const count = await requestToPromise(store.count());
    const expireBefore = Date.now() - MAX_AGE_MS;
    await new Promise<void>(resolve => {
      const request = store.index('cachedAt').openCursor();
      let toDelete = Math.max(0, count - MAX_ENTRIES);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        const entry = cursor.value as CachedEntry;
        if (entry.cachedAt < expireBefore) { cursor.delete(); cursor.continue(); return; }
        if (toDelete > 0) { cursor.delete(); toDelete--; cursor.continue(); return; }
        resolve();
      };
      request.onerror = () => resolve();
    });
  } catch { /* Never let maintenance break the caller. */ }
}

async function readEntry(key: string): Promise<CachedEntry | null> {
  let fromDb: CachedEntry | null = null;
  const db = await openDB();
  if (db) {
    try {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key) as IDBRequest<CachedEntry | undefined>;
      fromDb = (await requestToPromise(request)) ?? null;
    } catch { fromDb = null; }
  }
  return fromDb ?? memory.get(key) ?? null;
}

async function deleteEntry(key: string): Promise<void> {
  memory.delete(key);
  const db = await openDB();
  if (!db) return;
  try {
    await requestToPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key));
  } catch { /* Best effort. */ }
}

export async function cacheGet(key: string): Promise<CachedEntry | null> {
  const entry = await readEntry(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > MAX_AGE_MS) {
    void deleteEntry(key);
    return null;
  }
  return entry;
}

export async function cachePut(key: string, data: unknown): Promise<void> {
  const entry: CachedEntry = { key, data, cachedAt: Date.now() };
  memory.set(key, entry);
  pruneMemory();
  const db = await openDB();
  if (!db) return;
  try {
    await requestToPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(entry));
    void pruneDatabase(db);
  } catch { /* The in-memory copy still serves this session. */ }
}

export async function cacheInvalidate(prefix: string): Promise<void> {
  for (const key of [...memory.keys()]) if (key.startsWith(prefix)) memory.delete(key);
  const db = await openDB();
  if (!db) return;
  try {
    const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
    const keys = await requestToPromise(store.getAllKeys() as IDBRequest<IDBValidKey[]>);
    await Promise.all(keys.filter(key => typeof key === 'string' && key.startsWith(prefix)).map(key => requestToPromise(store.delete(key))));
  } catch { /* Best effort. */ }
}

type SourceListener = (source: ApiSource) => void;
let currentSource: ApiSource = 'none';
const listeners = new Set<SourceListener>();

export function readSource(): ApiSource { return currentSource; }

export function setSource(source: ApiSource): void {
  if (source === currentSource) return;
  currentSource = source;
  for (const listener of listeners) listener(source);
}

export function subscribeApiSource(listener: SourceListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
