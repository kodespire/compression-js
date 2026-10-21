// Tests run against the built package in dist/ (what users get).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export * as c from '../dist/index.js';
import type { Format, StreamFormat } from '../dist/index.js';

const fixturesDir = join(import.meta.dirname, 'fixtures');
export const fixture = (name: string): Uint8Array<ArrayBuffer> => new Uint8Array(readFileSync(join(fixturesDir, name)));
export const corpus = fixture('corpus.txt');

export const allFormats: Format[] = ['zstd', 'lz4', 'snappy', 'snappy-framed', 'brotli', 'gzip', 'zlib', 'deflate-raw'];
export const streamFormats: StreamFormat[] = ['zstd', 'lz4', 'snappy-framed', 'brotli', 'gzip', 'zlib', 'deflate-raw'];
export const detectable = ['zstd', 'lz4', 'snappy-framed', 'gzip', 'zlib'] as const;

/** Deterministic pseudo-random bytes (incompressible). */
export function randomBytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A skippable frame (magic 0x184D2A5?) carrying `payload`. */
export function skippableFrame(payload: Uint8Array, nibble = 0): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x184d2a50 + nibble, true);
  view.setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

/**
 * Writes `data` through `stream` in chunks (sizes taken from `chunks` in turn, or one
 * size), and returns everything it produced.
 */
export async function pipe(
  stream: TransformStream<Uint8Array, Uint8Array>,
  data: Uint8Array,
  chunks: number | number[],
): Promise<Uint8Array> {
  const sizes = typeof chunks === 'number' ? [chunks] : chunks;
  const parts: Uint8Array[] = [];
  const reading = (async () => {
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
  })();
  const writer = stream.writable.getWriter();
  try {
    for (let i = 0, k = 0; i < data.length; k++) {
      const size = Math.max(1, sizes[k % sizes.length]!);
      await writer.write(data.subarray(i, i + size));
      i += size;
    }
    await writer.close();
  } catch {
    // The stream errored; `reading` rejects with the reason.
  }
  await reading;
  return concat(...parts);
}

/** The error a promise rejects with (fails the test if it resolves). */
export async function rejection(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await promise;
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error('expected a rejection');
}

/** The error a function throws (fails the test if it returns). */
export function thrown(fn: () => unknown): Error & { code?: string } {
  try {
    fn();
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error('expected an exception');
}
