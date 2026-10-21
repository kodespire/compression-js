// Calls made before a codec is loaded. Vitest gives every test file its own copy of the
// package, so nothing is loaded when this file starts, and the tests run in order.
import * as lz4 from '@kodespire/lz4-js';
import * as snappy from '@kodespire/snappy-js';
import { describe, expect, it } from 'vitest';

import { CompressionError, type Format } from '../dist/index.js';
import { allFormats, c, corpus, pipe, rejection, thrown } from './helpers.js';

const notLoaded = (error: unknown, fn: string, format: string, codec: string) => {
  expect(error).toBeInstanceOf(CompressionError);
  expect(error).toMatchObject({ code: 'ERR_COMPRESSION_NOT_INITIALIZED' });
  expect((error as Error).message).toBe(
    `compression-js: ${fn} needs the ${codec} codec, which is not loaded yet. Call \`await init('${format}')\` first.`,
  );
};
const codecOf = (format: Format) => (format === 'snappy-framed' ? 'snappy' : ['zlib', 'deflate-raw'].includes(format) ? 'gzip' : format);

describe('before init', () => {
  it('synchronous calls throw ERR_COMPRESSION_NOT_INITIALIZED, naming the format', () => {
    for (const format of allFormats) {
      notLoaded(thrown(() => c.compressSync(format, 'x')), 'compressSync', format, codecOf(format));
      notLoaded(thrown(() => c.decompressSync(new Uint8Array(10), { format })), 'decompressSync', format, codecOf(format));
      notLoaded(thrown(() => c.activeBackend(format)), 'activeBackend', format, codecOf(format));
    }
  });

  it('decompressSync in auto mode names the detected format', () => {
    const zlibbed = new Uint8Array([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]);
    notLoaded(thrown(() => c.decompressSync(zlibbed)), 'decompressSync', 'zlib', 'gzip');
  });

  it('arguments are still checked first', () => {
    expect(() => c.compressSync('xz' as Format, 'x')).toThrow(TypeError);
    expect(() => c.decompressSync(new Uint8Array(1), { windowLogMax: 30 } as never)).toThrow(TypeError);
  });
});

describe('init', () => {
  it('loads only the codecs asked for', async () => {
    await c.init('gzip');
    expect(c.compressSync('deflate-raw', 'x').length).toBeGreaterThan(0);
    notLoaded(thrown(() => c.compressSync('zstd', 'x')), 'compressSync', 'zstd', 'zstd');
  });
});

// Each test uses a codec that nothing has loaded yet.
describe('streams load their codec when they start', () => {
  it('compress stream (zstd): options are taken when the stream is made', async () => {
    const options = { dictionary: corpus.slice(0, 2048), level: 19 };
    const stream = c.createCompressStream('zstd', options);
    options.dictionary.fill(0);
    options.level = 1;
    const packed = await pipe(stream, corpus, 4096);
    const expected = await pipe(c.createCompressStream('zstd', { dictionary: corpus.subarray(0, 2048), level: 19 }), corpus, 4096);
    expect(packed).toEqualBytes(expected);
  });

  it('decompress stream (lz4), after which sync calls work', async () => {
    const packed = await lz4.compress(corpus);
    expect(await pipe(c.createDecompressStream('lz4', { maxOutputSize: corpus.length }), packed, 7)).toEqualBytes(corpus);
    expect(c.decompressSync(c.compressSync('lz4', corpus))).toEqualBytes(corpus);
  });

  it('auto stream (snappy-framed)', async () => {
    const framed = await snappy.compress(corpus, { format: 'framed' });
    expect(await pipe(c.createDecompressStream('auto'), framed, 1)).toEqualBytes(corpus);
  });

  it('an invalid option (brotli) errors the stream, since the codec checks it once loaded', async () => {
    const error = await rejection(pipe(c.createCompressStream('brotli', { quality: 99 }), corpus, 4096));
    expect(error).toBeInstanceOf(RangeError);
    // Once the codec is loaded, the same mistake throws right away.
    expect(() => c.createCompressStream('brotli', { quality: 99 })).toThrow(RangeError);
  });
});
