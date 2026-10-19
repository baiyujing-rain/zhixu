import { cacheGet, cacheInvalidate, cacheKey, cachePut, invalidationPrefixes, isCacheable, setSource } from './api-cache';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'ApiError'; }
}

/** Original fetch logic, unchanged. Only `api()` decorates this with the read cache. */
async function rawApi<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, expectedCreatedAt?: string): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(expectedCreatedAt ? { 'X-Zhixu-Record-Created-At': expectedCreatedAt } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal }); }
  catch (e) { if ((e as Error).name === 'AbortError') throw e; throw new ApiError('连接中断，请确认服务已启动后重试。', 0); }
  if (response.status === 204 && response.ok) return undefined as T;
  let text: string;
  try { text = await response.text(); }
  catch (e) { if ((e as Error).name === 'AbortError') throw e; throw new ApiError('连接中断，未收到完整结果。本地编辑仍然保留，请重试。', 0); }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new ApiError(`服务返回了无效结果（HTTP ${response.status}），请确认后端已启动后重试。`, response.status); }
  if (!response.ok) {
    const detail = value && typeof value === 'object' && 'detail' in value ? (value as { detail: unknown }).detail : undefined;
    throw new ApiError(typeof detail === 'string' ? detail : response.status === 422 ? '请检查输入内容是否完整。' : '请求未完成，请稍后重试。', response.status);
  }
  return value as T;
}

/**
 * Public request entry point. Signature and exception semantics are unchanged:
 * read-through caching for cacheable GETs, write-through + background
 * invalidation for writes. Cache fallback only triggers on network failure
 * (`ApiError.status === 0`), never on HTTP error responses.
 */
export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, expectedCreatedAt?: string): Promise<T> {
  const upper = method.toUpperCase();
  if (upper === 'GET' && isCacheable(path, upper)) {
    try {
      const result = await rawApi<T>(path, method, body, signal, expectedCreatedAt);
      setSource('network');
      void cachePut(cacheKey(upper, path), result).catch(() => {});
      return result;
    } catch (error) {
      if ((error as ApiError).status === 0) {
        let cached: { data: unknown } | null = null;
        try { cached = await cacheGet(cacheKey(upper, path)); } catch { /* A cache failure never replaces the original error. */ }
        if (cached) { setSource('cache'); return cached.data as T; }
      }
      throw error;
    }
  }
  const result = await rawApi<T>(path, method, body, signal, expectedCreatedAt);
  for (const prefix of invalidationPrefixes(path, upper)) void cacheInvalidate(prefix).catch(() => {});
  return result;
}
