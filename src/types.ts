import type * as Brotli from '@kodespire/brotli-js';
import type * as Gzip from '@kodespire/gzip-js';
import type * as Lz4 from '@kodespire/lz4-js';
import type * as Snappy from '@kodespire/snappy-js';
import type * as Zstd from '@kodespire/zstd-js';

/** Binary input accepted everywhere: any ArrayBuffer, typed array, DataView or Node Buffer. */
export type Bytes = ArrayBuffer | ArrayBufferView;

/**
 * Every format this package reads and writes:
 * - `'zstd'`: Zstandard frames.
 * - `'lz4'`: LZ4 frames, as the `lz4` command-line tool writes. Raw LZ4 blocks are in the `lz4` namespace.
 * - `'snappy'`: one raw snappy block, as Parquet, LevelDB and Prometheus store. No stream form.
 * - `'snappy-framed'`: the snappy framing format (`sNaPpY` stream identifier, CRC-32C per chunk).
 * - `'brotli'`: one brotli stream (RFC 7932).
 * - `'gzip'`: gzip members (RFC 1952).
 * - `'zlib'`: one zlib stream (RFC 1950), as in HTTP `Content-Encoding: deflate`.
 * - `'deflate-raw'`: one raw deflate stream (RFC 1951), with no header or checksum.
 */
export type Format = 'zstd' | 'lz4' | 'snappy' | 'snappy-framed' | 'brotli' | 'gzip' | 'zlib' | 'deflate-raw';

/** Formats with a stream form: every format except raw snappy blocks. */
export type StreamFormat = Exclude<Format, 'snappy'>;

/**
 * Formats {@link detectFormat} can recognise from their first bytes. Brotli, raw deflate, raw
 * snappy blocks and raw LZ4 blocks start with no signature, so they are never detected.
 */
export type DetectedFormat = 'zstd' | 'gzip' | 'zlib' | 'lz4' | 'snappy-framed';

/** Options for {@link compress}, by format. Each is the codec's own options type. */
export interface CompressOptionsByFormat {
  zstd: Zstd.CompressOptions;
  lz4: Lz4.CompressOptions;
  snappy: Omit<Snappy.CompressOptions, 'format'>;
  'snappy-framed': Omit<Snappy.CompressOptions, 'format'>;
  brotli: Brotli.CompressOptions;
  /** The gzip format has no way to use a dictionary. */
  gzip: Omit<Gzip.CompressOptions, 'format' | 'dictionary'>;
  zlib: Omit<Gzip.CompressOptions, 'format'>;
  'deflate-raw': Omit<Gzip.CompressOptions, 'format'>;
}

/** Options for {@link createCompressStream}, by format. */
export interface CompressStreamOptionsByFormat {
  zstd: Zstd.CompressOptions;
  lz4: Lz4.CompressStreamOptions;
  'snappy-framed': Omit<Snappy.CompressStreamOptions, 'format'>;
  brotli: Brotli.CompressOptions;
  gzip: Omit<Gzip.CompressOptions, 'format' | 'dictionary'>;
  zlib: Omit<Gzip.CompressOptions, 'format'>;
  'deflate-raw': Omit<Gzip.CompressOptions, 'format'>;
}

/** Options for {@link decompress}, by format (without `format` itself). */
export interface DecompressOptionsByFormat {
  zstd: Zstd.DecompressOptions;
  lz4: Lz4.DecompressOptions;
  snappy: Omit<Snappy.DecompressOptions, 'format'>;
  'snappy-framed': Omit<Snappy.DecompressOptions, 'format'>;
  brotli: Brotli.DecompressOptions;
  gzip: Omit<Gzip.DecompressOptions, 'format' | 'dictionary'>;
  zlib: Omit<Gzip.DecompressOptions, 'format'>;
  'deflate-raw': Omit<Gzip.DecompressOptions, 'format'>;
}

/** Options for {@link createDecompressStream}, by format. */
export interface DecompressStreamOptionsByFormat {
  zstd: Zstd.DecompressOptions;
  lz4: Lz4.DecompressOptions;
  'snappy-framed': Omit<Snappy.DecompressStreamOptions, 'format'>;
  brotli: Brotli.DecompressOptions;
  gzip: Omit<Gzip.DecompressOptions, 'format' | 'dictionary'>;
  zlib: Omit<Gzip.DecompressOptions, 'format'>;
  'deflate-raw': Omit<Gzip.DecompressOptions, 'format'>;
}

/**
 * Options for automatic detection. The format is not known until the data arrives, so only
 * `maxOutputSize`, which every codec has, is accepted. For codec-specific options (a
 * dictionary, `windowLogMax`), pass the format.
 */
export interface AutoDecompressOptions {
  /**
   * Throw the codec's OUTPUT_LIMIT error instead of producing more than this many bytes.
   * Set it whenever the input is untrusted. Defaults to Infinity.
   */
  maxOutputSize?: number;
}

/** Options for {@link compress} and {@link compressSync} with format `F`. */
export type CompressOptions<F extends Format = Format> = F extends Format ? CompressOptionsByFormat[F] : never;

/** Options for {@link createCompressStream} with format `F`. */
export type CompressStreamOptions<F extends StreamFormat = StreamFormat> = F extends StreamFormat
  ? CompressStreamOptionsByFormat[F]
  : never;

/**
 * Options for {@link decompress} and {@link decompressSync}: a `format` and that codec's options,
 * or `format: 'auto'` (the default) and only `maxOutputSize`.
 */
export type DecompressOptions =
  | ({ format?: 'auto' } & AutoDecompressOptions)
  | { [F in Format]: { format: F } & DecompressOptionsByFormat[F] }[Format];

/** Options for {@link createDecompressStream} with format `F` (or `'auto'`). */
export type DecompressStreamOptions<F extends StreamFormat | 'auto' = StreamFormat | 'auto'> = F extends 'auto'
  ? AutoDecompressOptions
  : F extends StreamFormat
    ? DecompressStreamOptionsByFormat[F]
    : never;

export type BackendKind = 'native' | 'wasm';
