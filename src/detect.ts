// Format detection from the first bytes. Written here rather than calling the codecs'
// isZstdFrame / isGzip / ..., which would load every codec just to look at a header.
import type { DetectedFormat } from './types.js';

/**
 * The verdict on a prefix of the data: a format, `null` when no format can match, or
 * `undefined` when the bytes so far fit a signature but end before it is complete.
 */
export type Verdict = DetectedFormat | null | undefined;

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const LZ4_MAGIC = [0x04, 0x22, 0x4d, 0x18];
// Stream identifier chunk: type 0xff, length 6, "sNaPpY".
const SNAPPY_STREAM_ID = [0xff, 0x06, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50, 0x70, 0x59];

// true: `magic` is at `pos`. false: a byte differs. undefined: the data ends first.
function magicAt(b: Uint8Array, pos: number, magic: readonly number[]): boolean | undefined {
  for (let i = 0; i < magic.length; i++) {
    if (pos + i >= b.length) return undefined;
    if (b[pos + i] !== magic[i]) return false;
  }
  return true;
}

// Skippable frames (magic 0x184D2A50 to 0x184D2A5F) are shared by zstd and LZ4, and both
// decoders skip them. pzstd starts every frame with one. Returns the offset after the frame,
// false if there is none at `pos`, or undefined if the header is cut off.
function skippableFrameAt(b: Uint8Array, pos: number): number | false | undefined {
  if (pos >= b.length) return undefined;
  if ((b[pos]! & 0xf0) !== 0x50) return false;
  const rest = magicAt(b, pos + 1, [0x2a, 0x4d, 0x18]);
  if (rest !== true) return rest;
  if (pos + 8 > b.length) return undefined;
  const size = (b[pos + 4]! | (b[pos + 5]! << 8) | (b[pos + 6]! << 16) | (b[pos + 7]! << 24)) >>> 0;
  return pos + 8 + size;
}

// gzip (RFC 1952): ID1 ID2 = 1f 8b, CM = 8 (deflate), and FLG's reserved bits 5 to 7 clear.
function gzipAt(b: Uint8Array): boolean | undefined {
  const magic = magicAt(b, 0, [0x1f, 0x8b, 0x08]);
  if (magic !== true) return magic;
  if (b.length < 4) return undefined;
  return (b[3]! & 0xe0) === 0;
}

// zlib (RFC 1950) has only a 2-byte header with a 5-bit check, so ordinary data can pass the
// header test by chance (text starting "x^", for one). Every test below must hold:
// - CMF: CM = 8 (deflate) and CINFO <= 7 (window up to 32 KiB).
// - FLG: (CMF * 256 + FLG) % 31 == 0, and FDICT clear. A preset dictionary cannot be
//   supplied in auto mode, and the FDICT bit is what lets text such as "x?" and "x}" pass.
// - The first deflate block header: BTYPE is not the reserved value 3. A stored block
//   (BTYPE 0) must also have zero padding bits and LEN equal to the one's complement of NLEN.
// Random bytes still pass about once in 4000; decoding then fails on the Adler-32 or
// earlier, with the zlib error, so a false match never returns wrong data.
function zlibAt(b: Uint8Array): boolean | undefined {
  if (b.length < 1) return undefined;
  const cmf = b[0]!;
  if ((cmf & 0x0f) !== 8 || cmf >> 4 > 7) return false;
  if (b.length < 2) return undefined;
  const flg = b[1]!;
  if ((cmf * 256 + flg) % 31 !== 0 || (flg & 0x20) !== 0) return false;
  if (b.length < 3) return undefined;
  const block = b[2]!;
  const btype = (block >> 1) & 3;
  if (btype === 3) return false;
  if (btype !== 0) return true;
  if (block >> 3 !== 0) return false;
  if (b.length < 7) return undefined;
  const len = b[3]! | (b[4]! << 8);
  const nlen = b[5]! | (b[6]! << 8);
  return (len ^ nlen) === 0xffff;
}

/** Detects the format from a prefix of the data. See {@link Verdict}. */
export function sniff(b: Uint8Array): Verdict {
  let pos = 0;
  for (;;) {
    const next = skippableFrameAt(b, pos);
    if (next === undefined) return undefined;
    if (next === false) break;
    pos = next;
  }
  if (pos > 0) {
    // After skippable frames, only a zstd or LZ4 frame can follow.
    const zstd = magicAt(b, pos, ZSTD_MAGIC);
    const lz4 = magicAt(b, pos, LZ4_MAGIC);
    if (zstd) return 'zstd';
    if (lz4) return 'lz4';
    return zstd === undefined || lz4 === undefined ? undefined : null;
  }

  const checks: [DetectedFormat, boolean | undefined][] = [
    ['zstd', magicAt(b, 0, ZSTD_MAGIC)],
    ['lz4', magicAt(b, 0, LZ4_MAGIC)],
    ['gzip', gzipAt(b)],
    ['snappy-framed', magicAt(b, 0, SNAPPY_STREAM_ID)],
    ['zlib', zlibAt(b)],
  ];
  // The signatures cannot overlap (zlib's header check fails on every other one), so at most
  // one matches.
  const match = checks.find(([, result]) => result === true);
  if (match) return match[0];
  return checks.some(([, result]) => result === undefined) ? undefined : null;
}
