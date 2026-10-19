import { ALGORITHMS, DEFAULT_INPUTS, buildTrace, type Algorithm, type DemoInput } from './algorithm-traces';

/** State that can be encoded into a shareable demo URL hash. */
export type DemoShare = {
  algorithm: Algorithm;
  input: DemoInput;
  index: number;
};

/**
 * Only these DemoInput fields participate in a share. Unknown fields are
 * ignored on parse so a hash from a newer client degrades gracefully.
 */
const INPUT_KEYS = ['values', 'target', 'brackets', 'stairs', 'window', 'grid', 'intervals'] as const;
const MAX_HASH_LENGTH = 2000;

function isAlgorithm(value: unknown): value is Algorithm {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ALGORITHMS, value);
}

/**
 * Serialize demo state into the compact hash format:
 *   alg=<id>&<key>=<encodeURIComponent(value)>&step=<N>
 * Only input fields that differ from DEFAULT_INPUTS are included, so the
 * default scenario stays as short as possible. `step` appears only when > 0.
 * Returns an empty string when the share cannot be represented safely.
 */
export function serializeDemoHash(share: DemoShare): string {
  if (!share || !isAlgorithm(share.algorithm)) return '';
  const input = (share.input || {}) as DemoInput;
  const defaults = DEFAULT_INPUTS[share.algorithm];
  const parts: string[] = [`alg=${encodeURIComponent(share.algorithm)}`];
  for (const key of INPUT_KEYS) {
    const value = input[key];
    const defaultValue = defaults[key];
    if (typeof value === 'string' && value !== defaultValue) {
      parts.push(`${key}=${encodeURIComponent(value)}`);
    }
  }
  if (Number.isInteger(share.index) && share.index > 0) parts.push(`step=${share.index}`);
  const hash = parts.join('&');
  return hash.length > MAX_HASH_LENGTH ? '' : hash;
}

/**
 * Parse a share hash back into demo state. This function never throws:
 * any malformed hash, unknown algorithm, invalid input, or oversize payload
 * returns `null` so callers can fall back to the gallery. `step` is clamped
 * to the trace's valid frame range.
 */
export function parseDemoHash(hash: string): DemoShare | null {
  if (typeof hash !== 'string') return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw || raw.length > MAX_HASH_LENGTH) return null;

  const entries = new Map<string, string>();
  for (const part of raw.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    if (!key) return null;
    const encoded = eq < 0 ? '' : part.slice(eq + 1);
    let value: string;
    try { value = decodeURIComponent(encoded); } catch { return null; }
    if (entries.has(key)) return null;
    entries.set(key, value);
  }

  const algorithm = entries.get('alg');
  if (!isAlgorithm(algorithm)) return null;

  const defaults = DEFAULT_INPUTS[algorithm];
  const input: DemoInput = {
    values: entries.get('values') ?? defaults.values,
    target: entries.get('target') ?? defaults.target,
    brackets: entries.get('brackets') ?? defaults.brackets,
    stairs: entries.get('stairs') ?? defaults.stairs,
    window: entries.get('window') ?? defaults.window,
    grid: entries.get('grid') ?? defaults.grid,
    intervals: entries.get('intervals') ?? defaults.intervals,
  };

  let framesLength: number;
  try { framesLength = buildTrace(algorithm, input).frames.length; } catch { return null; }

  let index = 0;
  const step = entries.get('step');
  if (step !== undefined) {
    const parsed = Number(step);
    index = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
    index = Math.max(0, Math.min(index, framesLength - 1));
  }

  return { algorithm, input, index };
}
