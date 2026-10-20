import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import * as brotli from '@kodespire/brotli-js';
import * as gzip from '@kodespire/gzip-js';
import * as lz4 from '@kodespire/lz4-js';
import * as snappy from '@kodespire/snappy-js';
import * as zstd from '@kodespire/zstd-js';
import { describe, expect, it } from 'vitest';

import type { DetectedFormat } from '../dist/index.js';
import { c, concat, corpus, fixture, randomBytes, skippableFrame } from './helpers.js';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe('detectFormat on files from the official tools', () => {
  const cases: [string, DetectedFormat | null, number][] = [
    // [file, format, bytes needed to tell]
    ['corpus.zst', 'zstd', 4],
    ['corpus.nocheck.zst', 'zstd', 4],
    ['corpus.multi.zst', 'zstd', 4],
    ['corpus.pzstd.zst', 'zstd', 16],
    ['empty.zst', 'zstd', 4],
    ['corpus.lz4', 'lz4', 4],
    ['corpus.multi.lz4', 'lz4', 4],
    ['empty.lz4', 'lz4', 4],
    ['corpus.gz', 'gzip', 4],
    ['corpus.multi.gz', 'gzip', 4],
    ['empty.gz', 'gzip', 4],
    ['corpus.1.zlib', 'zlib', 3],
    ['corpus.2.zlib', 'zlib', 3],
    ['corpus.6.zlib', 'zlib', 3],
    ['corpus.9.zlib', 'zlib', 3],
    ['corpus.stored.zlib', 'zlib', 7],
    ['corpus.w9.zlib', 'zlib', 3],
    ['empty.zlib', 'zlib', 3],
    ['corpus.sz', 'snappy-framed', 10],
    // No signature: never detected.
    ['corpus.legacy.lz4', null, 0],
    ['corpus.snappy', null, 0],
    ['corpus.deflate', null, 0],
    ['corpus.br', null, 0],
    ['corpus.q1.br', null, 0],
    ['empty.br', null, 0],
    ['corpus.txt', null, 0],
  ];

  it.each(cases)('%s: %s', (name, expected) => {
    expect(c.detectFormat(fixture(name))).toBe(expected);
  });

  it.each(cases.filter(([, format]) => format))('%s: null until %s can be told, from byte %i', (name, expected, needed) => {
    const data = fixture(name);
    for (let n = 0; n < needed; n++) expect(c.detectFormat(data.subarray(0, n))).toBeNull();
    for (let n = needed; n <= Math.min(data.length, needed + 32); n++) expect(c.detectFormat(data.subarray(0, n))).toBe(expected);
  });

  it('agrees with each codec package\'s own check', () => {
    const names = readdirSync(join(import.meta.dirname, 'fixtures')).filter((n) => n !== 'README.md');
    expect(names.length).toBe(cases.length);
    for (const name of names) {
      const data = fixture(name);
      const detected = c.detectFormat(data);
      const skippable = data.length >= 4 && (data[0]! & 0xf0) === 0x50 && data[1] === 0x2a;
      expect(gzip.isGzip(data), name).toBe(detected === 'gzip');
      expect(snappy.isSnappyFramed(data), name).toBe(detected === 'snappy-framed');
      // The codecs report true for any skippable frame; detectFormat decides on the frame after it.
      expect(zstd.isZstdFrame(data), name).toBe(detected === 'zstd' || (skippable && detected !== null));
      expect(lz4.isLz4Frame(data), name).toBe(detected === 'lz4' || (skippable && detected !== null));
    }
  });

  it('accepts every binary input type', () => {
    const frame = fixture('corpus.zst');
    const padded = new Uint8Array(frame.length + 3);
    padded.set(frame, 3);
    expect(c.detectFormat(frame.slice().buffer)).toBe('zstd');
    expect(c.detectFormat(new DataView(padded.buffer, 3))).toBe('zstd');
    expect(c.detectFormat(Buffer.from(frame))).toBe('zstd');
    expect(c.detectFormat(new Uint8Array(padded.buffer, 3, 4))).toBe('zstd');
    expect(c.detectFormat(new Uint16Array(padded.slice(3, 11).buffer))).toBe('zstd');
  });
});

describe('detectFormat: skippable frames', () => {
  const zstdFrame = fixture('empty.zst');
  const lz4Frame = fixture('empty.lz4');

  it('decides on the frame after them', () => {
    expect(c.detectFormat(concat(skippableFrame(ascii('meta')), zstdFrame))).toBe('zstd');
    expect(c.detectFormat(concat(skippableFrame(ascii('meta'), 15), lz4Frame))).toBe('lz4');
    expect(c.detectFormat(concat(skippableFrame(bytes()), skippableFrame(ascii('x'), 7), zstdFrame))).toBe('zstd');
    expect(c.detectFormat(concat(skippableFrame(randomBytes(70_000)), lz4Frame))).toBe('lz4');
  });

  it('give null when nothing, or anything but a zstd or LZ4 frame, follows', () => {
    expect(c.detectFormat(skippableFrame(ascii('only metadata')))).toBeNull();
    expect(c.detectFormat(concat(skippableFrame(ascii('meta')), fixture('corpus.gz')))).toBeNull();
    expect(c.detectFormat(concat(skippableFrame(ascii('meta')), fixture('corpus.6.zlib')))).toBeNull();
    expect(c.detectFormat(concat(skippableFrame(ascii('meta')), ascii('plain text')))).toBeNull();
  });

  it('give null when cut off', () => {
    const whole = concat(skippableFrame(ascii('meta')), zstdFrame);
    for (let n = 0; n < 16; n++) expect(c.detectFormat(whole.subarray(0, n))).toBeNull();
    expect(c.detectFormat(whole.subarray(0, 16))).toBe('zstd');
    // The size field says more bytes follow than there are.
    expect(c.detectFormat(bytes(0x50, 0x2a, 0x4d, 0x18, 0xff, 0xff, 0, 0, 0x28, 0xb5, 0x2f, 0xfd))).toBeNull();
  });
});

describe('detectFormat: near misses', () => {
  it.each([
    ['zstd magic, last byte off', bytes(0x28, 0xb5, 0x2f, 0xfe, 0, 0, 0, 0)],
    ['zstd magic, big-endian', bytes(0xfd, 0x2f, 0xb5, 0x28, 0, 0, 0, 0)],
    ['LZ4 legacy magic', bytes(0x02, 0x21, 0x4c, 0x18, 0, 0, 0, 0)],
    ['LZ4 magic, one byte off', bytes(0x04, 0x22, 0x4d, 0x19, 0x64, 0x40, 0xa7)],
    ['skippable magic, one byte off', concat(bytes(0x50, 0x2a, 0x4d, 0x19, 0, 0, 0, 0), fixture('empty.zst'))],
    ['gzip with CM 7', bytes(0x1f, 0x8b, 0x07, 0x00, 0, 0, 0, 0, 0, 3)],
    ['gzip with reserved flag bits', bytes(0x1f, 0x8b, 0x08, 0xe0, 0, 0, 0, 0, 0, 3)],
    ['gzip ID2 off', bytes(0x1f, 0x8c, 0x08, 0x00, 0, 0, 0, 0, 0, 3)],
    ['snappy identifier, wrong letter', bytes(0xff, 0x06, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50, 0x70, 0x5a)],
    ['snappy identifier, wrong length', bytes(0xff, 0x07, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50, 0x70, 0x59, 0)],
    ['snappy data chunk first', bytes(0x01, 0x09, 0x00, 0x00, 0, 0, 0, 0, 0x61)],
    ['zlib header check off by one', bytes(0x78, 0x9d, 0x4b, 0x4c, 0x04, 0)],
    ['zlib with a preset dictionary (FDICT)', bytes(0x78, 0xbb, 0, 0, 0, 1, 0x4b, 0x4c)],
    ['zlib with CINFO 8', bytes(0x88, 0x1c, 0x4b, 0x4c, 0x04, 0)],
    ['zlib with CM 7', bytes(0x77, 0x01, 0x4b, 0x4c)],
    ['zlib header, reserved block type 3', bytes(0x78, 0x9c, 0x07, 0x00)],
    ['zlib header, stored block with LEN != ~NLEN', bytes(0x78, 0x01, 0x01, 0x05, 0x00, 0xfa, 0xfe, 0x61)],
    ['zlib header, stored block with padding bits set', bytes(0x78, 0x01, 0x09, 0x05, 0x00, 0xfa, 0xff, 0x61)],
    ['text "x?" (FDICT set)', ascii('x?yz')],
    ['text "x}" (FDICT set)', ascii('x} done')],
    ['text "x^a" (stored block with padding bits set)', ascii('x^abcdef')],
  ])('%s', (_name, data) => {
    expect(c.detectFormat(data)).toBeNull();
  });
});

describe('detectFormat: data that is not compressed', () => {
  it.each([
    ['empty', bytes()],
    ['one byte', bytes(0x28)],
    ['plain text', ascii('hello world, this is not compressed')],
    ['JSON', ascii('{"format":"zstd","level":19}')],
    ['HTML', ascii('<!doctype html><title>x</title>')],
    ['UTF-8 BOM', ascii('﻿hello')],
    ['PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ['PDF', ascii('%PDF-1.7\n')],
    ['ZIP', bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0x08, 0)],
    ['bzip2', ascii('BZh91AY&SY')],
    ['xz', bytes(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, 0x00, 0x04)],
    ['zeros', new Uint8Array(64)],
    ['0xff bytes', new Uint8Array(64).fill(0xff)],
  ])('%s gives null', (_name, data) => {
    expect(c.detectFormat(data)).toBeNull();
  });

  it('random bytes: never a 4-byte or longer signature; zlib about once in 4000', () => {
    const counts: Record<string, number> = {};
    const n = 100_000;
    const pool = randomBytes(n * 16, 99);
    for (let i = 0; i < n; i++) {
      const detected = c.detectFormat(pool.subarray(i * 16, i * 16 + 16));
      if (detected) counts[detected] = (counts[detected] ?? 0) + 1;
    }
    expect(Object.keys(counts).filter((f) => f !== 'zlib')).toEqual([]);
    // A header alone would pass about once in 500 (1/16 * 1/2 * 1/31 * 2); FDICT and the
    // block-type check bring it to about once in 4000.
    expect(counts['zlib'] ?? 0).toBeGreaterThan(n / 8000);
    expect(counts['zlib'] ?? 0).toBeLessThan(n / 2500);
  });

  it('random printable text: only six two-letter starts can pass the zlib check', () => {
    // The printable pairs with a valid zlib header and FDICT clear (computed, then listed).
    const pairs = ['(S', '8O', 'HK', 'XG', 'hC', 'x^'];
    const r = randomBytes(200_000 * 8, 7);
    let hits = 0;
    for (let i = 0; i < 200_000; i++) {
      const text = r.subarray(i * 8, i * 8 + 8).map((v) => 0x20 + (v % 95));
      // Start every other sample with one of the pairs, so the third-byte checks are exercised.
      if (i % 2 === 0) text.set(ascii(pairs[i % pairs.length]!));
      const detected = c.detectFormat(text);
      if (detected) {
        hits++;
        expect(detected).toBe('zlib');
        expect(pairs).toContain(String.fromCharCode(text[0]!, text[1]!));
      }
    }
    // Of the samples that start with a pair, the third byte rules out about half.
    expect(hits).toBeGreaterThan(30_000);
    expect(hits).toBeLessThan(70_000);
  });

  it('a false zlib match fails with the zlib error, never wrong output', async () => {
    // "x^b" passes every zlib check (fixed Huffman block): documented in the README.
    const text = ascii('x^b is not compressed');
    expect(c.detectFormat(text)).toBe('zlib');
    const error = await c.decompress(text).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(gzip.GzipError);
  });

  it('output of the formats without a signature: never matched, except by the zlib check\'s chance rate', async () => {
    const outputs: Uint8Array[] = [];
    for (let size = 0; size < 3000; size += 97) {
      const input = size % 2 ? corpus.subarray(size, size * 2) : randomBytes(size, size + 1);
      for (const quality of [0, 1, 5, 11]) outputs.push(brotli.compressSync(input, quality));
      for (const level of [0, 1, 6, 9]) outputs.push(gzip.compressSync(input, { format: 'deflate-raw', level }));
      outputs.push(snappy.compressSync(input), lz4.compressBlockSync(input));
    }
    const matched = outputs.map((o) => c.detectFormat(o)).filter((f) => f !== null);
    expect(matched.every((f) => f === 'zlib')).toBe(true);
    expect(matched.length).toBeLessThan(outputs.length / 100);
  });

  it('rejects non-binary input like the codecs do', () => {
    expect(() => c.detectFormat('28b52ffd' as never)).toThrow(TypeError);
    expect(() => c.detectFormat(undefined as never)).toThrow('data must be an ArrayBuffer, a typed array, a DataView or a Buffer');
  });
});
