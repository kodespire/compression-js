// Which codec package handles each format, and loading those packages on first use.
import { CompressionError } from './errors.js';
import type { BackendKind, Bytes, Format } from './types.js';

export type Codec = 'zstd' | 'lz4' | 'snappy' | 'brotli' | 'gzip';

/** The part of a codec package's API this package calls. Every codec has these. */
export interface CodecApi {
  compress(data: Bytes | string, options?: unknown): Promise<Uint8Array>;
  compressSync(data: Bytes | string, options?: unknown): Uint8Array;
  decompress(data: Bytes, options?: unknown): Promise<Uint8Array>;
  decompressSync(data: Bytes, options?: unknown): Uint8Array;
  createCompressStream(options?: unknown): TransformStream<Bytes, Uint8Array>;
  createDecompressStream(options?: unknown): TransformStream<Bytes, Uint8Array>;
  init(): Promise<void>;
  activeBackend(): BackendKind;
}

interface FormatInfo {
  codec: Codec;
  /** The value of the codec's own `format` option, for codecs that handle several formats. */
  codecFormat?: string;
  /** False for raw snappy blocks: snappy-js streams always use the framing format. */
  stream: boolean;
}

const FORMAT_INFO: Record<Format, FormatInfo> = {
  zstd: { codec: 'zstd', stream: true },
  lz4: { codec: 'lz4', stream: true },
  snappy: { codec: 'snappy', codecFormat: 'raw', stream: false },
  'snappy-framed': { codec: 'snappy', codecFormat: 'framed', stream: true },
  brotli: { codec: 'brotli', stream: true },
  gzip: { codec: 'gzip', codecFormat: 'gzip', stream: true },
  zlib: { codec: 'gzip', codecFormat: 'zlib', stream: true },
  'deflate-raw': { codec: 'gzip', codecFormat: 'deflate-raw', stream: true },
};

export const formats: readonly Format[] = Object.freeze(Object.keys(FORMAT_INFO) as Format[]);

export const codecs: readonly Codec[] = ['zstd', 'lz4', 'snappy', 'brotli', 'gzip'];

/**
 * Codecs whose async functions take their input after an internal await (snappy-js,
 * brotli-js and gzip-js 0.1.0), so a caller that reuses its buffer right after the call
 * changes what gets compressed. Their inputs are copied before the call. zstd-js 0.1.1
 * and lz4-js 0.1.0 read the input before returning.
 */
export const readsInputLate: ReadonlySet<Codec> = new Set(['snappy', 'brotli', 'gzip']);

export function formatInfo(format: unknown, fn: string, stream = false): FormatInfo {
  const info = typeof format === 'string' && Object.hasOwn(FORMAT_INFO, format)
    ? FORMAT_INFO[format as Format]
    : undefined;
  if (!info) {
    throw new TypeError(
      `${fn}: unknown format ${JSON.stringify(format) ?? String(format)}. Valid formats: ${formats.join(', ')}.`,
    );
  }
  if (stream && !info.stream) {
    throw new TypeError(`${fn}: raw snappy blocks have no stream form; use "snappy-framed"`);
  }
  return info;
}

// One literal import() per codec, so bundlers (Vite, webpack, esbuild, wrangler) can see
// each one and split it into its own chunk, loaded only when that codec is first used.
function importCodec(codec: Codec): Promise<CodecApi> {
  switch (codec) {
    case 'zstd':
      return import('@kodespire/zstd-js');
    case 'lz4':
      return import('@kodespire/lz4-js');
    case 'snappy':
      return import('@kodespire/snappy-js');
    case 'brotli':
      return import('@kodespire/brotli-js');
    case 'gzip':
      return import('@kodespire/gzip-js');
  }
}

const loaded: Partial<Record<Codec, CodecApi>> = {};
const loading: Partial<Record<Codec, Promise<CodecApi>>> = {};

/** The codec's module if it has been loaded, without loading it. */
export function loadedCodec(codec: Codec): CodecApi | undefined {
  return loaded[codec];
}

/** Loads the codec's module (only the JavaScript; the codec loads its backend itself). */
export function loadCodec(codec: Codec): Promise<CodecApi> {
  return (loading[codec] ??= importCodec(codec).then(
    (api) => (loaded[codec] = api),
    (error: unknown) => {
      delete loading[codec];
      throw error;
    },
  ));
}

/** The codec's module for a synchronous call, which cannot load it. */
export function codecForSync(format: Format, fn: string): CodecApi {
  const { codec } = FORMAT_INFO[format];
  const api = loaded[codec];
  if (!api) {
    throw new CompressionError(
      'ERR_COMPRESSION_NOT_INITIALIZED',
      `compression-js: ${fn} needs the ${codec} codec, which is not loaded yet. ` +
        `Call \`await init('${format}')\` first.`,
    );
  }
  return api;
}
