import * as brotliPkg from '@kodespire/brotli-js';
import * as gzipPkg from '@kodespire/gzip-js';
import * as lz4Pkg from '@kodespire/lz4-js';
import * as snappyPkg from '@kodespire/snappy-js';
import * as zstdPkg from '@kodespire/zstd-js';
import { beforeAll, describe, expect, it } from 'vitest';

import * as brotliNs from '../dist/brotli.js';
import * as gzipNs from '../dist/gzip.js';
import * as lz4Ns from '../dist/lz4.js';
import * as snappyNs from '../dist/snappy.js';
import * as zstdNs from '../dist/zstd.js';
import { allFormats, c, corpus, pipe, randomBytes, streamFormats } from './helpers.js';

beforeAll(() => c.init());

const dictionary = corpus.subarray(0, 2048);

const packages = {
  zstd: zstdPkg,
  lz4: lz4Pkg,
  snappy: snappyPkg,
  'snappy-framed': snappyPkg,
  brotli: brotliPkg,
  gzip: gzipPkg,
  zlib: gzipPkg,
  'deflate-raw': gzipPkg,
};

describe.each(allFormats)('%s', (format) => {
  it('round trip, async and sync', async () => {
    const packed = await c.compress(format, corpus);
    expect(packed.length).toBeLessThan(corpus.length / 2);
    expect(await c.decompress(packed, { format })).toEqualBytes(corpus);
    expect(c.decompressSync(c.compressSync(format, corpus), { format })).toEqualBytes(corpus);
    expect(c.compressSync(format, corpus)).toEqualBytes(packed);
  });

  it('empty and incompressible input', async () => {
    for (const input of [new Uint8Array(0), randomBytes(70_000, 3)]) {
      expect(await c.decompress(await c.compress(format, input), { format })).toEqualBytes(input);
    }
  });

  it('accepts strings, ArrayBuffers, DataViews and Buffers', async () => {
    const text = 'Grüße, 世界 '.repeat(50);
    const utf8 = new TextEncoder().encode(text);
    expect(await c.decompress(await c.compress(format, text), { format })).toEqualBytes(utf8);
    const packed = await c.compress(format, utf8.slice().buffer);
    expect(await c.decompress(new DataView(packed.slice().buffer), { format })).toEqualBytes(utf8);
    expect(await c.decompress(Buffer.from(packed), { format })).toEqualBytes(utf8);
  });

  it('activeBackend is the codec\'s', () => {
    expect(c.activeBackend(format)).toBe(packages[format].activeBackend());
  });
});

describe('the codec does the work: same bytes as calling it directly', () => {
  const direct: [string, () => Promise<Uint8Array>, () => Promise<Uint8Array>][] = [
    ['zstd level 19, no checksum', () => c.compress('zstd', corpus, { level: 19, checksum: false }), () => zstdPkg.compress(corpus, { level: 19, checksum: false })],
    ['zstd level as a number', () => c.compress('zstd', corpus, 7), () => zstdPkg.compress(corpus, 7)],
    ['zstd with a dictionary', () => c.compress('zstd', corpus, { dictionary }), () => zstdPkg.compress(corpus, { dictionary })],
    ['lz4 HC, block size, checksums', () => c.compress('lz4', corpus, { level: 9, blockSize: 262144, blockChecksum: true }), () => lz4Pkg.compress(corpus, { level: 9, blockSize: 262144, blockChecksum: true })],
    ['lz4 level as a number', () => c.compress('lz4', corpus, 3), () => lz4Pkg.compress(corpus, 3)],
    ['raw snappy level 2', () => c.compress('snappy', corpus, { level: 2 }), () => snappyPkg.compress(corpus, { level: 2 })],
    ['raw snappy level as a number', () => c.compress('snappy', corpus, 2), () => snappyPkg.compress(corpus, 2)],
    ['framed snappy', () => c.compress('snappy-framed', corpus, 2), () => snappyPkg.compress(corpus, { format: 'framed', level: 2 })],
    ['brotli quality and window', () => c.compress('brotli', corpus, { quality: 5, lgwin: 16, mode: 'text' }), () => brotliPkg.compress(corpus, { quality: 5, lgwin: 16, mode: 'text' })],
    ['brotli quality as a number', () => c.compress('brotli', corpus, 4), () => brotliPkg.compress(corpus, 4)],
    ['gzip level 1', () => c.compress('gzip', corpus, { level: 1, strategy: 'rle' }), () => gzipPkg.compress(corpus, { level: 1, strategy: 'rle' })],
    ['zlib level as a number', () => c.compress('zlib', corpus, 9), () => gzipPkg.compress(corpus, { format: 'zlib', level: 9 })],
    ['zlib with a dictionary', () => c.compress('zlib', corpus, { dictionary }), () => gzipPkg.compress(corpus, { format: 'zlib', dictionary })],
    ['raw deflate, small window', () => c.compress('deflate-raw', corpus, { windowBits: 9, memLevel: 1 }), () => gzipPkg.compress(corpus, { format: 'deflate-raw', windowBits: 9, memLevel: 1 })],
  ];

  it.each(direct)('%s', async (_name, viaUmbrella, viaCodec) => {
    expect(await viaUmbrella()).toEqualBytes(await viaCodec());
  });
});

describe('decompression options reach the codec', () => {
  it('dictionaries', async () => {
    for (const format of ['zstd', 'lz4', 'zlib', 'deflate-raw'] as const) {
      const packed = await c.compress(format, corpus, { dictionary });
      expect(await c.decompress(packed, { format, dictionary })).toEqualBytes(corpus);
      expect(c.decompressSync(packed, { format, dictionary })).toEqualBytes(corpus);
      const stream = c.createDecompressStream(format, { dictionary });
      expect(await pipe(stream, packed, 100)).toEqualBytes(corpus);
    }
  });

  it('zstd windowLogMax', async () => {
    // A streamed frame records no content size, so the decoder must hold a full window.
    const packed = await pipe(zstdPkg.createCompressStream(1), randomBytes(1 << 20, 5), 1 << 20);
    await expect(c.decompress(packed, { format: 'zstd', windowLogMax: 10 })).rejects.toMatchObject({ code: 'ERR_ZSTD_LIBRARY' });
    await expect(c.decompress(packed, { format: 'zstd', windowLogMax: 5 })).rejects.toThrow(RangeError);
    expect((await c.decompress(packed, { format: 'zstd', windowLogMax: 27 })).length).toBe(1 << 20);
  });

  it('brotli largeWindow', async () => {
    const packed = await c.compress('brotli', corpus, { quality: 5, lgwin: 26, largeWindow: true });
    await expect(c.decompress(packed, { format: 'brotli' })).rejects.toMatchObject({ code: 'ERR_BROTLI_LIBRARY' });
    expect(await c.decompress(packed, { format: 'brotli', largeWindow: true })).toEqualBytes(corpus);
  });

  it('maxOutputSize, given a format and in auto mode', async () => {
    for (const format of allFormats) {
      const packed = await c.compress(format, corpus);
      expect(await c.decompress(packed, { format, maxOutputSize: corpus.length })).toEqualBytes(corpus);
      await expect(c.decompress(packed, { format, maxOutputSize: corpus.length - 1 })).rejects.toMatchObject({
        code: expect.stringMatching(/_OUTPUT_LIMIT$/),
      });
    }
    const gz = await c.compress('gzip', corpus);
    expect(await c.decompress(gz, { maxOutputSize: corpus.length })).toEqualBytes(corpus);
    await expect(c.decompress(gz, { format: 'auto', maxOutputSize: 10 })).rejects.toMatchObject({ code: 'ERR_GZIP_OUTPUT_LIMIT' });
  });
});

describe.each(streamFormats)('%s streams', (format) => {
  it('round trip in small and uneven chunks', async () => {
    for (const chunks of [1, 7, [1, 300, 2, 5000]]) {
      const input = chunks === 1 ? corpus.subarray(0, 1500) : corpus;
      const packed = await pipe(c.createCompressStream(format), input, chunks);
      expect(await c.decompress(packed, { format })).toEqualBytes(input);
      expect(await pipe(c.createDecompressStream(format), packed, chunks)).toEqualBytes(input);
    }
  });

  it('options and levels as numbers', async () => {
    const packed = await pipe(c.createCompressStream(format, format === 'brotli' ? 3 : 2), corpus, 1000);
    expect(await pipe(c.createDecompressStream(format, { maxOutputSize: corpus.length }), packed, 1000)).toEqualBytes(corpus);
  });

  it('works with pipeThrough and Response', async () => {
    const body = new Blob([corpus]).stream().pipeThrough(c.createCompressStream(format)).pipeThrough(c.createDecompressStream(format));
    expect(new Uint8Array(await new Response(body).arrayBuffer())).toEqualBytes(corpus);
  });
});

describe('init', () => {
  it('takes formats, and loads each codec once', async () => {
    await c.init('gzip', 'zlib', 'deflate-raw', 'gzip');
    await c.init();
    expect(c.compressSync('zlib', 'x').length).toBeGreaterThan(0);
  });
});

describe('formats', () => {
  it('lists every format, frozen', () => {
    expect(c.formats).toEqual(allFormats);
    expect(Object.isFrozen(c.formats)).toBe(true);
  });
});

describe('codec namespaces', () => {
  it.each([
    ['zstd', zstdNs, zstdPkg],
    ['lz4', lz4Ns, lz4Pkg],
    ['snappy', snappyNs, snappyPkg],
    ['brotli', brotliNs, brotliPkg],
    ['gzip', gzipNs, gzipPkg],
  ])('%s re-exports the codec package as is', (_name, ns, pkg) => {
    expect(Object.keys(ns).sort()).toEqual(Object.keys(pkg).sort());
    for (const key of Object.keys(pkg)) expect((ns as Record<string, unknown>)[key]).toBe((pkg as Record<string, unknown>)[key]);
  });

  it('give what the umbrella leaves out, such as raw LZ4 blocks', async () => {
    const block = await lz4Ns.compressBlock(corpus);
    expect(await lz4Ns.decompressBlock(block, corpus.length)).toEqualBytes(corpus);
    expect(zstdNs.getFrameContentSize(await c.compress('zstd', corpus))).toBe(corpus.length);
  });
});
