// Compile-time checks (npm run typecheck): each format takes its codec's own options,
// and mistakes are type errors. Every `@ts-expect-error` line must fail to compile.
import type * as ZstdPkg from '@kodespire/zstd-js';
import type * as Lz4Pkg from '@kodespire/lz4-js';

import {
  compress,
  compressSync,
  createCompressStream,
  createDecompressStream,
  decompress,
  decompressSync,
  detectFormat,
  formats,
  init,
  type CompressionErrorCode,
  type DetectedFormat,
  type Format,
} from '../src/index.js';
import type * as Lz4Ns from '../src/lz4.js';
import type * as ZstdNs from '../src/zstd.js';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const assert = <T extends true>() => undefined as unknown as T;

const bytes = new Uint8Array(10);

// compress: the codec's options, or a number.
void compress('zstd', bytes, { level: 19, checksum: false, dictionary: bytes });
void compress('zstd', 'text', 19);
void compress('lz4', bytes, { level: 9, blockSize: 4194304, contentSize: false });
void compress('snappy', bytes, { level: 2 });
void compress('snappy-framed', bytes, 2);
void compress('brotli', bytes, { quality: 5, lgwin: 22, mode: 'font', largeWindow: false, sizeHint: 0 });
void compress('gzip', bytes, { level: 9, memLevel: 9, windowBits: 15, strategy: 'rle' });
void compress('zlib', bytes, { dictionary: bytes });
void compress('deflate-raw', new ArrayBuffer(4), { dictionary: new DataView(new ArrayBuffer(2)) });
compressSync('zstd', bytes, { level: 3 }) satisfies Uint8Array;
// @ts-expect-error brotli has a quality, not a level
void compress('brotli', bytes, { level: 5 });
// @ts-expect-error the gzip format cannot use a dictionary
void compress('gzip', bytes, { dictionary: bytes });
// @ts-expect-error the format is the first argument
void compress('gzip', bytes, { format: 'zlib' });
// @ts-expect-error unknown option
void compress('zstd', bytes, { compressionLevel: 19 });
// @ts-expect-error lz4 block sizes are fixed values
void compress('lz4', bytes, { blockSize: 100 });
// @ts-expect-error unknown format
void compress('xz', bytes);
// @ts-expect-error 'auto' is only for decompression
void compress('auto', bytes);
// @ts-expect-error a format is required
void compress(bytes);

// A Format-typed variable takes the options any format has.
declare const someFormat: Format;
void compress(someFormat, bytes, { level: 1 });

// decompress: auto by default, with only maxOutputSize; or a format and its options.
void decompress(bytes);
void decompress(bytes, { maxOutputSize: 1024 });
void decompress(bytes, { format: 'auto', maxOutputSize: Infinity });
void decompress(bytes, { format: 'zstd', windowLogMax: 31, dictionary: bytes, maxOutputSize: 1 });
void decompress(bytes, { format: 'brotli', largeWindow: true });
void decompress(bytes, { format: 'zlib', dictionary: bytes });
decompressSync(bytes, { format: 'snappy' }) satisfies Uint8Array;
// @ts-expect-error codec options need a format
void decompress(bytes, { windowLogMax: 31 });
// @ts-expect-error codec options need a format, also with 'auto' spelled out
void decompress(bytes, { format: 'auto', dictionary: bytes });
// @ts-expect-error windowLogMax is a zstd option
void decompress(bytes, { format: 'gzip', windowLogMax: 31 });
// @ts-expect-error the gzip format cannot use a dictionary
void decompress(bytes, { format: 'gzip', dictionary: bytes });
// @ts-expect-error strings cannot be decompressed
void decompress('text');
// @ts-expect-error unknown format
void decompress(bytes, { format: 'xz' });

// Streams: every format but raw snappy.
createCompressStream('lz4', { blockSize: 65536, blockChecksum: true }) satisfies TransformStream<ArrayBuffer | ArrayBufferView, Uint8Array>;
createCompressStream('snappy-framed', { level: 2 });
createDecompressStream('auto');
createDecompressStream('auto', { maxOutputSize: 1 });
createDecompressStream('zstd', { windowLogMax: 30 });
createDecompressStream('snappy-framed', { maxOutputSize: 1 });
// @ts-expect-error a stream never knows its size up front
createCompressStream('lz4', { contentSize: true });
// @ts-expect-error raw snappy has no stream form
createCompressStream('snappy');
// @ts-expect-error raw snappy has no stream form
createDecompressStream('snappy');
// @ts-expect-error codec options need a format
createDecompressStream('auto', { dictionary: bytes });
// @ts-expect-error the format is the first argument
createDecompressStream('gzip', { format: 'gzip' });

// The rest of the API.
void init();
void init('gzip', 'zstd');
// @ts-expect-error 'auto' is not a codec to load
void init('auto');
assert<Same<ReturnType<typeof detectFormat>, DetectedFormat | null>>();
assert<Same<DetectedFormat, 'zstd' | 'gzip' | 'zlib' | 'lz4' | 'snappy-framed'>>();
assert<Same<typeof formats, readonly Format[]>>();
assert<Same<CompressionErrorCode, 'ERR_COMPRESSION_UNKNOWN_FORMAT' | 'ERR_COMPRESSION_NOT_INITIALIZED'>>();

// The namespaces are the codec packages' own API.
assert<Same<typeof ZstdNs, typeof ZstdPkg>>();
assert<Same<typeof Lz4Ns, typeof Lz4Pkg>>();
