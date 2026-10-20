// format: 'auto', one-shot and streamed: fixtures from the official tools, tiny chunks,
// and inputs made of several frames, members or streams.
import { GzipError } from '@kodespire/gzip-js';
import { ZstdError } from '@kodespire/zstd-js';
import { beforeAll, describe, expect, it } from 'vitest';

import { c, concat, corpus, fixture, pipe, rejection, skippableFrame } from './helpers.js';

beforeAll(() => c.init());

const halves = concat(corpus.subarray(0, 4096), corpus.subarray(4096));
const empty = new Uint8Array(0);

const fixtures: [string, Uint8Array][] = [
  ['corpus.zst', corpus],
  ['corpus.nocheck.zst', corpus],
  ['corpus.multi.zst', halves],
  ['corpus.pzstd.zst', corpus],
  ['empty.zst', empty],
  ['corpus.lz4', corpus],
  ['corpus.multi.lz4', halves],
  ['empty.lz4', empty],
  ['corpus.gz', corpus],
  ['corpus.multi.gz', halves],
  ['empty.gz', empty],
  ['corpus.1.zlib', corpus],
  ['corpus.2.zlib', corpus],
  ['corpus.6.zlib', corpus],
  ['corpus.9.zlib', corpus],
  ['corpus.stored.zlib', corpus],
  ['corpus.w9.zlib', corpus],
  ['empty.zlib', empty],
  ['corpus.sz', corpus],
];

const chunkings: [string, number | number[]][] = [
  ['1-byte chunks', 1],
  ['2-byte chunks', 2],
  ['3-byte chunks', 3],
  ['uneven chunks', [1, 2, 3, 5, 8, 13, 21]],
  ['one chunk', 1 << 30],
];

describe.each(fixtures)('%s', (name, expected) => {
  const data = fixture(name);

  it('decompress and decompressSync', async () => {
    expect(await c.decompress(data)).toEqualBytes(expected);
    expect(await c.decompress(data, { format: 'auto' })).toEqualBytes(expected);
    expect(c.decompressSync(data)).toEqualBytes(expected);
  });

  it.each(chunkings)('stream in %s', async (_name, chunks) => {
    expect(await pipe(c.createDecompressStream('auto'), data, chunks)).toEqualBytes(expected);
  });
});

describe('several frames, members or streams in one input', () => {
  const cases: [string, () => Promise<Uint8Array>, Uint8Array][] = [
    ['zstd frames', async () => concat(await c.compress('zstd', corpus), await c.compress('zstd', 'tail')), concat(corpus, new TextEncoder().encode('tail'))],
    ['zstd frames with skippable frames between', async () => concat(skippableFrame(corpus.subarray(0, 9)), await c.compress('zstd', corpus), skippableFrame(new Uint8Array(3), 9), await c.compress('zstd', corpus)), concat(corpus, corpus)],
    ['LZ4 frames', async () => concat(await c.compress('lz4', corpus), await c.compress('lz4', corpus, { contentSize: false })), concat(corpus, corpus)],
    ['LZ4 frames after a skippable frame', async () => concat(skippableFrame(new Uint8Array(100), 15), await c.compress('lz4', corpus)), corpus],
    ['gzip members', async () => concat(await c.compress('gzip', corpus), await c.compress('gzip', corpus, 1)), concat(corpus, corpus)],
    ['gzip members with zero padding after', async () => concat(await c.compress('gzip', corpus), new Uint8Array(512)), corpus],
    ['framed snappy streams', async () => concat(await c.compress('snappy-framed', corpus), await c.compress('snappy-framed', corpus)), concat(corpus, corpus)],
  ];

  it.each(cases)('%s: joined, as the codec does', async (_name, make, expected) => {
    const data = await make();
    expect(await c.decompress(data)).toEqualBytes(expected);
    expect(c.decompressSync(data)).toEqualBytes(expected);
    expect(await pipe(c.createDecompressStream('auto'), data, 1)).toEqualBytes(expected);
    expect(await pipe(c.createDecompressStream('auto'), data, [3, 1000])).toEqualBytes(expected);
  });

  it('two zlib streams: the codec\'s trailing-data error', async () => {
    const data = concat(await c.compress('zlib', corpus), await c.compress('zlib', corpus));
    const error = await rejection(c.decompress(data));
    expect(error).toBeInstanceOf(GzipError);
    expect(error.code).toBe('ERR_GZIP_TRAILING_DATA');
    const streamError = await rejection(pipe(c.createDecompressStream('auto'), data, 7));
    expect(streamError).toBeInstanceOf(GzipError);
    expect(streamError.code).toBe('ERR_GZIP_TRAILING_DATA');
  });

  it('mixed formats: the first decides, and the codec rejects the rest', async () => {
    const gzThenZstd = concat(await c.compress('gzip', corpus), await c.compress('zstd', corpus));
    expect((await rejection(c.decompress(gzThenZstd))).code).toBe('ERR_GZIP_TRAILING_DATA');
    const zstdThenGz = concat(await c.compress('zstd', corpus), await c.compress('gzip', corpus));
    const error = await rejection(c.decompress(zstdThenGz));
    expect(error).toBeInstanceOf(ZstdError);
    expect((await rejection(pipe(c.createDecompressStream('auto'), zstdThenGz, 1))).code).toBe(error.code);
  });
});

describe('auto streams', () => {
  it('copy the first bytes they hold, so writers can reuse their buffer', async () => {
    const packed = await c.compress('zstd', corpus);
    const stream = c.createDecompressStream('auto');
    const reading = new Response(stream.readable).arrayBuffer();
    const writer = stream.writable.getWriter();
    const buffer = new Uint8Array(3);
    for (let i = 0; i < packed.length; i += 3) {
      const part = packed.subarray(i, i + 3);
      buffer.set(part);
      await writer.write(buffer.subarray(0, part.length));
      buffer.fill(0xee);
    }
    await writer.close();
    expect(new Uint8Array(await reading)).toEqualBytes(corpus);
  });

  it('accept ArrayBuffer and DataView chunks', async () => {
    const packed = await c.compress('gzip', corpus);
    const stream = c.createDecompressStream('auto');
    const reading = new Response(stream.readable).arrayBuffer();
    const writer = stream.writable.getWriter();
    await writer.write(packed.slice(0, 2).buffer);
    await writer.write(new DataView(packed.slice(2, 50).buffer));
    await writer.write(packed.subarray(50));
    await writer.close();
    expect(new Uint8Array(await reading)).toEqualBytes(corpus);
  });

  it('look past skippable frames up to 1 MiB', async () => {
    const frame = await c.compress('zstd', corpus);
    const big = concat(skippableFrame(new Uint8Array((1 << 20) - 100)), frame);
    expect(await pipe(c.createDecompressStream('auto'), big, 64 * 1024)).toEqualBytes(corpus);
  });

  it('pass cancellation on to the codec\'s stream', async () => {
    const stream = c.createDecompressStream('auto');
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    void writer.write(await c.compress('zstd', corpus)).catch(() => {});
    await reader.read();
    await reader.cancel(new Error('stop'));
    await expect(writer.write(new Uint8Array(1))).rejects.toThrow();
  });

  it('respect maxOutputSize in total', async () => {
    const packed = await c.compress('lz4', concat(corpus, corpus, corpus));
    expect((await pipe(c.createDecompressStream('auto', { maxOutputSize: 3 * corpus.length }), packed, 50)).length).toBe(3 * corpus.length);
    const error = await rejection(pipe(c.createDecompressStream('auto', { maxOutputSize: 3 * corpus.length - 1 }), packed, 50));
    expect(error.code).toBe('ERR_LZ4_OUTPUT_LIMIT');
  });
});
