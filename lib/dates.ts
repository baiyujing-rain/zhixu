/** SQLite returns naive UTC timestamps; API writes may return an explicit offset. */
export function utcDate(value: string): Date {
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`);
}
export function localDateTime(value: string): string {
  const date = utcDate(value);
  return Number.isNaN(date.getTime()) ? '日期未知' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** The server creates records in UTC; preserve microseconds while normalizing its two encodings. */
export function recordOrigin(value?: string): string | undefined {
  return value ? value.replace(/(?:Z|[+]00:00)$/, '') : undefined;
}
