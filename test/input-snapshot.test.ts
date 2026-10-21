// Async calls must use the caller's bytes as they were when the call was made, even if the
// caller reuses its buffer before the promise settles: the codecs promise this, and the
// umbrella awaits an import() before calling a codec for the first time.
// Nothing is loaded when this file starts (vitest gives each file its own copy).
import * as brotli from '@kodespire/brotli-js';
import * as gzip from '@kodespire/gzip-js';
import * as lz4 from '@kodespire/lz4-js';
import * as snappy from '@kodespire/snappy-js';
import * as zstd from '@kodespire/zstd-js';
import { describe, expect, it } from 'vitest';

import type { Format } from '../dist/index.js';
import { allFormats, c, corpus } from './helpers.js';

const original = new Uint8Array(200_000).map((_, i) => corpus[i % corpus.length]!);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0;

async function checkCompress(format: Format) {
  const buf = Buffer.from(original);
  const pending = c.compress(format, buf);
  buf.fill(0);
  return same(await c.decompress(await pending, { format }), original);
}

async function checkDecompress(format: Format, packed: Uint8Array) {
  const buf = Buffer.from(packed);
  const pending = c.decompress(buf, { format });
  buf.fill(0);
  return same(await pending, original);
}

describe('while the codec is being imported', () => {
  const packages = { zstd, lz4, snappy, brotli, gzip };

  it.each(['zstd', 'lz4', 'snappy', 'brotli', 'gzip'] as const)('%s: compress and decompress', async (format) => {
    // Made with the codec package itself, which does not load it into the umbrella.
    const packed = Buffer.from(await packages[format].compress(original));
    const input = Buffer.from(original);
    // Both calls start before the umbrella has the codec.
    const compressing = c.compress(format, input);
    const decompressing = c.decompress(packed, { format });
    input.fill(0);
    packed.fill(0);
    expect(same(await decompressing, original)).toBe(true);
    expect(same(await c.decompress(await compressing, { format }), original)).toBe(true);
    // The async calls loaded the codec, so synchronous calls work now.
    expect(c.compressSync(format, 'x').length).toBeGreaterThan(0);
  });
});

describe.each(allFormats)('%s, codec loaded', (format) => {
  it('compress', async () => {
    expect(await checkCompress(format)).toBe(true);
  });

  it('decompress, given the format and detected', async () => {
    const packed = await c.compress(format, original);
    expect(await checkDecompress(format, packed)).toBe(true);
    if (c.detectFormat(packed)) {
      const buf = Buffer.from(packed);
      const pending = c.decompress(buf);
      buf.fill(0);
      expect(same(await pending, original)).toBe(true);
    }
  });
});

describe.each(['zstd', 'lz4', 'zlib', 'deflate-raw'] as const)('%s dictionaries', (format) => {
  it('are captured at call time', async () => {
    // Compare compressed bytes: a frame made with a zeroed dictionary might still decode.
    const dictCopy = corpus.slice(0, 4096);
    const expected = await c.compress(format, original, { dictionary: dictCopy });
    const dictionary = Buffer.from(dictCopy);
    const pending = c.compress(format, original, { dictionary });
    dictionary.fill(0);
    expect(same(await pending, expected)).toBe(true);
  });
});
