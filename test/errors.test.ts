import * as brotliPkg from '@kodespire/brotli-js';
import * as gzipPkg from '@kodespire/gzip-js';
import * as lz4Pkg from '@kodespire/lz4-js';
import * as snappyPkg from '@kodespire/snappy-js';
import * as zstdPkg from '@kodespire/zstd-js';
import { beforeAll, describe, expect, it } from 'vitest';

import * as brotliNs from '../dist/brotli.js';
import { CompressionError, type Format } from '../dist/index.js';
import * as zstdNs from '../dist/zstd.js';
import { c, concat, corpus, pipe, randomBytes, rejection, skippableFrame, thrown } from './helpers.js';

beforeAll(() => c.init());

const data = corpus.subarray(0, 4000);

describe('arguments', () => {
  it('an unknown format is a TypeError that lists the formats', async () => {
    const message = /unknown format "xz". Valid formats: zstd, lz4, snappy, snappy-framed, brotli, gzip, zlib, deflate-raw\./;
    await expect(c.compress('xz' as Format, data)).rejects.toThrow(TypeError);
    await expect(c.compress('xz' as Format, data)).rejects.toThrow(message);
    expect(() => c.compressSync('xz' as Format, data)).toThrow(message);
    await expect(c.decompress(data, { format: 'xz' } as never)).rejects.toThrow(message);
    expect(() => c.decompressSync(data, { format: 'xz' } as never)).toThrow(message);
    expect(() => c.createCompressStream('xz' as never)).toThrow(message);
    expect(() => c.createDecompressStream('xz' as never)).toThrow(message);
    await expect(c.init('xz' as Format)).rejects.toThrow(message);
    expect(() => c.activeBackend('xz' as Format)).toThrow(message);
    // 'auto' is only for decompression; inherited names are not formats.
    await expect(c.compress('auto' as Format, data)).rejects.toThrow(/unknown format "auto"/);
    expect(() => c.compressSync('toString' as Format, data)).toThrow(/unknown format "toString"/);
    expect(() => c.compressSync(undefined as never, data)).toThrow(/unknown format undefined/);
  });

  it('raw snappy has no stream form', () => {
    expect(() => c.createCompressStream('snappy' as never)).toThrow(/raw snappy blocks have no stream form; use "snappy-framed"/);
    expect(() => c.createDecompressStream('snappy' as never)).toThrow(TypeError);
  });

  it('"format" is not an option when the format is an argument', async () => {
    const message = /the format is the first argument, so "format" is not an option/;
    await expect(c.compress('gzip', data, { format: 'zlib' } as never)).rejects.toThrow(message);
    await expect(c.compress('zstd', data, { format: 'zstd' } as never)).rejects.toThrow(message);
    expect(() => c.compressSync('snappy', data, { format: 'framed' } as never)).toThrow(message);
    expect(() => c.createCompressStream('gzip', { format: 'gzip' } as never)).toThrow(message);
    expect(() => c.createDecompressStream('snappy-framed', { format: 'framed' } as never)).toThrow(message);
  });

  it('decompress options must be an object', async () => {
    await expect(c.decompress(data, 'zstd' as never)).rejects.toThrow('decompress: options must be an object');
    expect(() => c.decompressSync(data, null as never)).toThrow('decompressSync: options must be an object');
    expect(() => c.createDecompressStream('auto', 5 as never)).toThrow('createDecompressStream: options must be an object');
  });

  it('auto mode takes only maxOutputSize, checked before the data is looked at', async () => {
    const garbage = randomBytes(100);
    const needsFormat = /option "dictionary" needs a format; with format "auto" only maxOutputSize can be given/;
    await expect(c.decompress(garbage, { dictionary: data } as never)).rejects.toThrow(needsFormat);
    expect(() => c.decompressSync(garbage, { format: 'auto', dictionary: data } as never)).toThrow(needsFormat);
    expect(() => c.createDecompressStream('auto', { windowLogMax: 30 } as never)).toThrow(/option "windowLogMax" needs a format/);
    for (const maxOutputSize of [-1, 1.5, NaN, '10', null]) {
      await expect(c.decompress(garbage, { maxOutputSize } as never)).rejects.toThrow(
        new RangeError('decompress: maxOutputSize must be a non-negative integer or Infinity'),
      );
      expect(() => c.createDecompressStream('auto', { maxOutputSize } as never)).toThrow(RangeError);
    }
    expect(await c.decompress(await c.compress('zstd', data), { maxOutputSize: Infinity })).toEqualBytes(data);
  });

  it('codec option errors pass through unchanged', async () => {
    const umbrella = await rejection(c.compress('zstd', data, { compressionLevel: 19 } as never));
    const codec = await rejection(zstdPkg.compress(data, { compressionLevel: 19 } as never));
    expect(umbrella).toBeInstanceOf(TypeError);
    expect(umbrella.message).toBe(codec.message);
    expect(umbrella.message).toMatch(/Did you mean "level"\?/);

    expect(thrown(() => c.compressSync('brotli', data, { quality: 12 }))).toEqual(thrown(() => brotliPkg.compressSync(data, { quality: 12 })));
    expect(thrown(() => c.compressSync('lz4', data, 13))).toEqual(thrown(() => lz4Pkg.compressSync(data, 13)));
    expect(thrown(() => c.compressSync('zlib', data, 10))).toEqual(thrown(() => gzipPkg.compressSync(data, { format: 'zlib', level: 10 })));
    expect(thrown(() => c.compressSync('gzip', data, { dictionary: data } as never)).message).toMatch(/the gzip format cannot use a dictionary/);
    expect(thrown(() => c.compressSync('snappy', data, 'fast' as never))).toEqual(thrown(() => snappyPkg.compressSync(data, 'fast' as never)));
    expect(thrown(() => c.createCompressStream('lz4', { contentSize: true } as never))).toBeInstanceOf(TypeError);
    expect(thrown(() => c.createDecompressStream('zstd', 5 as never)).message).toBe('createDecompressStream: options must be an object');
  });

  it('streams without a TransformStream (bare React Native) say so', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'TransformStream')!;
    delete (globalThis as { TransformStream?: unknown }).TransformStream;
    try {
      expect(() => c.createCompressStream('zstd')).toThrow(
        new TypeError(
          "createCompressStream: this runtime has no TransformStream. On React Native, install a polyfill such as web-streams-polyfill and import 'web-streams-polyfill/polyfill' before using streams.",
        ),
      );
      expect(() => c.createDecompressStream('auto')).toThrow(/^createDecompressStream: this runtime has no TransformStream/);
      expect(() => c.createDecompressStream('gzip')).toThrow(TypeError);
    } finally {
      Object.defineProperty(globalThis, 'TransformStream', saved);
    }
  });

  it('non-binary data is a TypeError, as in the codecs', async () => {
    await expect(c.compress('zstd', 123 as never)).rejects.toThrow('data must be an ArrayBuffer, a typed array, a DataView or a Buffer');
    await expect(c.decompress('28b52ffd' as never)).rejects.toThrow(TypeError);
    await expect(c.decompress('28b52ffd' as never, { format: 'zstd' })).rejects.toThrow(TypeError);
    expect(() => c.decompressSync({} as never)).toThrow(TypeError);
    const stream = c.createDecompressStream('auto');
    expect((await rejection(pipeValues(stream, ['not bytes']))).message).toBe('chunk must be an ArrayBuffer, a typed array, a DataView or a Buffer');
  });
});

/** Writes raw values to a stream (to test chunk validation), and reads it to the end. */
async function pipeValues(stream: TransformStream<never, Uint8Array>, values: unknown[]): Promise<void> {
  const writer = stream.writable.getWriter();
  for (const value of values) writer.write(value as never).catch(() => {});
  writer.close().catch(() => {});
  await new Response(stream.readable as ReadableStream<Uint8Array>).arrayBuffer();
}

describe('format detection failures', () => {
  const isUnknown = (error: unknown, detail: RegExp) => {
    expect(error).toBeInstanceOf(CompressionError);
    expect(error).toMatchObject({ name: 'CompressionError', code: 'ERR_COMPRESSION_UNKNOWN_FORMAT' });
    expect((error as Error).message).toMatch(detail);
    expect((error as Error).message).toMatch(/Brotli, raw deflate and raw snappy or LZ4 blocks have no signature: pass their format explicitly\./);
  };

  it('one-shot', async () => {
    isUnknown(await rejection(c.decompress(randomBytes(1000))), /does not start with a zstd, LZ4, gzip, zlib or framed snappy signature/);
    isUnknown(await rejection(c.decompress(await c.compress('brotli', data))), /signature/);
    isUnknown(await rejection(c.decompress(new Uint8Array(0))), /the input is empty/);
    isUnknown(thrown(() => c.decompressSync(new Uint8Array([0x78, 0x9c]))), /signature/);
    isUnknown(thrown(() => c.decompressSync(skippableFrame(data))), /signature/);
  });

  it('streams: on the first chunk that rules every format out', async () => {
    const stream = c.createDecompressStream('auto');
    const writer = stream.writable.getWriter();
    const reading = new Response(stream.readable).arrayBuffer();
    isUnknown(await rejection(writer.write(new TextEncoder().encode('plain text'))), /signature/);
    isUnknown(await rejection(reading), /signature/);
  });

  it('streams: at the end, when the input is empty or too short to tell', async () => {
    isUnknown(await rejection(pipe(c.createDecompressStream('auto'), new Uint8Array(0), 1)), /the input is empty/);
    isUnknown(await rejection(pipe(c.createDecompressStream('auto'), new Uint8Array([0x28, 0xb5, 0x2f]), 1)), /signature/);
    isUnknown(await rejection(pipe(c.createDecompressStream('auto'), skippableFrame(data), 100)), /signature/);
  });

  it('streams: past 1 MiB of skippable frames', async () => {
    const big = concat(skippableFrame(new Uint8Array(2 << 20)), await c.compress('zstd', data));
    isUnknown(await rejection(pipe(c.createDecompressStream('auto'), big, 64 * 1024)), /no zstd or LZ4 frame follows the skippable frames in the first \d+ bytes/);
    // One-shot calls have the whole input, so there is no limit.
    expect(await c.decompress(big)).toEqualBytes(data);
  });
});

// Each case: compressed data made bad in some way, and the format to name. The umbrella
// must throw exactly what the codec throws for the same input.
describe('codec errors pass through unchanged', () => {
  const codecFor = { zstd: zstdPkg, lz4: lz4Pkg, snappy: snappyPkg, brotli: brotliPkg, gzip: gzipPkg } as const;
  const formats: [Format, keyof typeof codecFor, string | undefined, string][] = [
    ['zstd', 'zstd', undefined, 'ZstdError'],
    ['lz4', 'lz4', undefined, 'Lz4Error'],
    ['snappy', 'snappy', 'raw', 'SnappyError'],
    ['snappy-framed', 'snappy', 'framed', 'SnappyError'],
    ['brotli', 'brotli', undefined, 'BrotliError'],
    ['gzip', 'gzip', 'gzip', 'GzipError'],
    ['zlib', 'gzip', 'zlib', 'GzipError'],
    ['deflate-raw', 'gzip', 'deflate-raw', 'GzipError'],
  ];
  const damages: [string, (packed: Uint8Array) => Uint8Array, number | undefined][] = [
    ['truncated', (p) => p.subarray(0, p.length - 5), undefined],
    ['corrupt', (p) => p.map((v, i) => (i > 12 && i % 7 === 0 ? v ^ 0x5a : v)), undefined],
    ['over maxOutputSize', (p) => p, data.length - 1],
  ];

  describe.each(formats)('%s', (format, codecName, codecFormat, errorName) => {
    const codec = codecFor[codecName];
    const codecOptions = (max: number | undefined) => ({ ...(codecFormat && { format: codecFormat }), ...(max !== undefined && { maxOutputSize: max }) });

    it.each(damages)('%s', async (_name, damage, max) => {
      const bad = damage(await c.compress(format, data));
      const expected = await rejection(codec.decompress(bad, codecOptions(max) as never));
      expect(expected.name).toBe(errorName);

      const options = { format, ...(max !== undefined && { maxOutputSize: max }) } as never;
      const async = await rejection(c.decompress(bad, options));
      expect(async).toBeInstanceOf(expected.constructor);
      expect(async).toEqual(expected);
      expect(async.message).toBe(expected.message);
      expect(thrown(() => c.decompressSync(bad, options))).toEqual(expected);

      if (format !== 'snappy') {
        const streamOptions = max !== undefined ? { maxOutputSize: max } : undefined;
        const streamed = await rejection(pipe(c.createDecompressStream(format as never, streamOptions as never), bad, 3));
        expect(streamed.name).toBe(errorName);
        expect(streamed.code).toBe(expected.code);
      }
      if (c.detectFormat(bad) === format) {
        const detected = await rejection(c.decompress(bad, max !== undefined ? { maxOutputSize: max } : undefined));
        expect(detected).toEqual(expected);
        const streamed = await rejection(pipe(c.createDecompressStream('auto', max !== undefined ? { maxOutputSize: max } : undefined), bad, 1));
        expect(streamed.name).toBe(errorName);
        expect(streamed.code).toBe(expected.code);
      }
    });
  });

  it('error classes are the ones the namespaces export', async () => {
    const zstdError = await rejection(c.decompress((await c.compress('zstd', data)).subarray(0, 20)));
    expect(zstdError).toBeInstanceOf(zstdNs.ZstdError);
    expect(zstdError.code).toBe('ERR_ZSTD_TRUNCATED');
    const brotliError = await rejection(c.decompress(new Uint8Array([0x1b]), { format: 'brotli' }));
    expect(brotliError).toBeInstanceOf(brotliNs.BrotliError);
    expect(brotliError.code).toBe('ERR_BROTLI_TRUNCATED');
  });
});
