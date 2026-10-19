export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'ApiError'; }
}

/** Handle plain-text proxy failures as well as the backend's JSON errors. */
export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, expectedCreatedAt?: string): Promise<T> {
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
