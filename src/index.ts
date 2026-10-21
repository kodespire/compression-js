// One API over the five codec packages. Each codec is imported the first time a call
// needs it (see codecs.ts), so an application that only uses gzip never loads zstd.
// Nothing here may touch Node built-ins, import.meta or stream globals at load time:
// this one entry serves every runtime.
import {
  type Codec,
  type CodecApi,
  codecForSync,
  codecs,
  formatInfo,
  formats,
  loadCodec,
  loadedCodec,
  readsInputLate,
} from './codecs.js';
import { sniff } from './detect.js';
import { unknownFormat } from './errors.js';
import type {
  AutoDecompressOptions,
  BackendKind,
  Bytes,
  CompressOptions,
  CompressStreamOptions,
  DecompressOptions,
  DecompressStreamOptions,
  DetectedFormat,
  Format,
  StreamFormat,
} from './types.js';

export { CompressionError, type CompressionErrorCode } from './errors.js';
export { formats };
export type {
  AutoDecompressOptions,
  BackendKind,
  Bytes,
  CompressOptions,
  CompressOptionsByFormat,
  CompressStreamOptions,
  CompressStreamOptionsByFormat,
  DecompressOptions,
  DecompressOptionsByFormat,
  DecompressStreamOptions,
  DecompressStreamOptionsByFormat,
  DetectedFormat,
  Format,
  StreamFormat,
} from './types.js';

type FormatInfo = ReturnType<typeof formatInfo>;

const EMPTY = new Uint8Array(0);

/** With `format: 'auto'`, at most this many bytes are held while looking past skippable frames. */
const SNIFF_LIMIT = 1 << 20;

function isArrayBufferLike(value: unknown): value is ArrayBufferLike {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]';
}

/** A Uint8Array view over the caller's bytes (no copy). Same rules and message as the codecs. */
function toBytes(input: unknown, name: string): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (isArrayBufferLike(input)) return new Uint8Array(input);
  throw new TypeError(`${name} must be an ArrayBuffer, a typed array, a DataView or a Buffer`);
}

/** A copy of binary input; anything else (strings, or values the codec will reject) as is. */
function copyIfBytes(value: unknown): unknown {
  return ArrayBuffer.isView(value) || isArrayBufferLike(value) ? new Uint8Array(toBytes(value, '')) : value;
}

/** Options as they are now: a shallow copy with the dictionary copied. */
function copyOptions(options: unknown): unknown {
  if (options === null || typeof options !== 'object') return options;
  const copy: Record<string, unknown> = { ...options };
  if (Object.hasOwn(copy, 'dictionary')) copy['dictionary'] = copyIfBytes(copy['dictionary']);
  return copy;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function checkOptionsObject(options: unknown, fn: string): asserts options is Record<string, unknown> | undefined {
  if (options !== undefined && !isObject(options)) throw new TypeError(`${fn}: options must be an object`);
}

/** Adds the codec's own `format` option for codecs that handle several formats. */
function withCodecFormat(options: Record<string, unknown> | undefined, info: FormatInfo): unknown {
  if (info.codecFormat === undefined) return options;
  return { ...options, format: info.codecFormat };
}

/**
 * The options to pass to the codec when the format is an argument. The codec checks them;
 * this only turns a bare number into `{ level }` where a `format` has to be added, and
 * rejects `format`, which the codec would otherwise take as its own.
 */
function argumentOptions(options: unknown, info: FormatInfo, fn: string, levelShortcut: boolean): unknown {
  if (isObject(options)) {
    if (Object.hasOwn(options, 'format')) {
      throw new TypeError(`${fn}: the format is the first argument, so "format" is not an option`);
    }
    return withCodecFormat(options, info);
  }
  if (options === undefined) return withCodecFormat(undefined, info);
  if (levelShortcut && typeof options === 'number' && info.codecFormat !== undefined) {
    return withCodecFormat({ level: options }, info);
  }
  return options; // a number the codec takes as its level or quality, or a value it rejects
}

/** Checks the options for `format: 'auto'` before looking at the data, so errors never depend on it. */
function autoOptions(options: Record<string, unknown>, fn: string): AutoDecompressOptions {
  for (const key of Object.keys(options)) {
    if (key !== 'maxOutputSize') {
      throw new TypeError(
        `${fn}: option "${key}" needs a format; with format "auto" only maxOutputSize can be given`,
      );
    }
  }
  const maxOutputSize = options['maxOutputSize'];
  if (maxOutputSize === undefined) return {};
  if (typeof maxOutputSize !== 'number' || Number.isNaN(maxOutputSize) || maxOutputSize < 0 ||
      (Number.isFinite(maxOutputSize) && !Number.isInteger(maxOutputSize))) {
    throw new RangeError(`${fn}: maxOutputSize must be a non-negative integer or Infinity`);
  }
  return { maxOutputSize };
}

interface Target {
  format: Format;
  info: FormatInfo;
  codecOptions: unknown;
}

/** Splits `decompress` options into the format (detected for `'auto'`) and the codec's options. */
function decompressTarget(options: unknown, fn: string, data: unknown): Target {
  checkOptionsObject(options, fn);
  const { format = 'auto', ...rest } = options ?? {};
  if (format !== 'auto') {
    const info = formatInfo(format, fn);
    return { format: format as Format, info, codecOptions: withCodecFormat(rest, info) };
  }
  const auto = autoOptions(rest, fn);
  const bytes = toBytes(data, 'data');
  const detected = sniff(bytes);
  if (!detected) throw unknownFormat(bytes.length);
  const info = formatInfo(detected, fn);
  return { format: detected, info, codecOptions: withCodecFormat({ ...auto }, info) };
}

/**
 * Calls an async codec function with the caller's bytes as they are now. A loaded codec
 * that reads its input before returning is called at once; otherwise (the codec still has
 * to be imported, or reads its input late) the data and dictionary are copied first, so a
 * caller can reuse its buffers as soon as the call returns.
 */
function withCodec<T>(
  codec: Codec,
  data: unknown,
  options: unknown,
  call: (api: CodecApi, data: never, options: unknown) => Promise<T>,
): Promise<T> {
  const api = loadedCodec(codec);
  if (api && !readsInputLate.has(codec)) return call(api, data as never, options);
  const dataCopy = copyIfBytes(data) as never;
  const optionsCopy = copyOptions(options);
  if (api) return call(api, dataCopy, optionsCopy);
  return loadCodec(codec).then((loaded) => call(loaded, dataCopy, optionsCopy));
}

/**
 * Compresses `data` in the given format, with that codec's options.
 *
 * @param format One of {@link formats}.
 * @param data Bytes to compress. Strings are encoded as UTF-8.
 * @param options The codec's options, or just a level (brotli: a quality).
 * @example
 * const packed = await compress('zstd', data, { level: 19 });
 * const body = await compress('gzip', text);
 */
export async function compress<F extends Format>(
  format: F,
  data: Bytes | string,
  options?: CompressOptions<F> | number,
): Promise<Uint8Array> {
  const info = formatInfo(format, 'compress');
  const codecOptions = argumentOptions(options, info, 'compress', true);
  return withCodec(info.codec, data, codecOptions, (api, d, o) => api.compress(d, o));
}

/**
 * Synchronous {@link compress}. `await init(format)` must have run first, on every runtime:
 * the codec is loaded on first use, which a synchronous call cannot wait for.
 */
export function compressSync<F extends Format>(
  format: F,
  data: Bytes | string,
  options?: CompressOptions<F> | number,
): Uint8Array {
  const info = formatInfo(format, 'compressSync');
  const codecOptions = argumentOptions(options, info, 'compressSync', true);
  return codecForSync(format, 'compressSync').compressSync(data, codecOptions);
}

/**
 * Decompresses `data`. With `format: 'auto'` (the default), the format is detected from the
 * first bytes (see {@link detectFormat}); data that matches no signature throws
 * `ERR_COMPRESSION_UNKNOWN_FORMAT`. Otherwise pass the format and that codec's options.
 *
 * The codec's own rules apply: concatenated zstd and LZ4 frames, gzip members and snappy
 * streams are joined, and zlib, raw deflate and brotli must be exactly one stream. Corrupt,
 * truncated or oversized data throws the codec's error (`ZstdError`, `GzipError`, ...).
 * It never returns partial output.
 *
 * @example
 * const data = await decompress(body, { maxOutputSize: 64 * 1024 * 1024 });
 * const text = await decompress(packed, { format: 'brotli' });
 */
export async function decompress(data: Bytes, options?: DecompressOptions): Promise<Uint8Array> {
  const { info, codecOptions } = decompressTarget(options, 'decompress', data);
  return withCodec(info.codec, data, codecOptions, (api, d, o) => api.decompress(d, o));
}

/** Synchronous {@link decompress}. `await init(format)` must have run first, on every runtime. */
export function decompressSync(data: Bytes, options?: DecompressOptions): Uint8Array {
  const { format, codecOptions } = decompressTarget(options, 'decompressSync', data);
  return codecForSync(format, 'decompressSync').decompressSync(data, codecOptions);
}

interface Link {
  writer: WritableStreamDefaultWriter<Bytes>;
  /** Closes the codec's stream and waits for its last output. */
  finish(): Promise<void>;
  cancel(reason: unknown): void;
}

/**
 * Feeds a codec's stream from inside our own transformer and forwards its output. A codec
 * error rejects the pending write or close, so it reaches the caller as the same object.
 */
function connect(inner: TransformStream<Bytes, Uint8Array>, controller: TransformStreamDefaultController<Uint8Array>): Link {
  const writer = inner.writable.getWriter();
  const reader = inner.readable.getReader();
  const forwarded = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      controller.enqueue(value);
    }
  })();
  forwarded.catch(() => {}); // the failed write or close reports the error
  return {
    writer,
    async finish() {
      await writer.close();
      await forwarded;
    },
    cancel(reason) {
      writer.abort(reason).catch(() => {});
      reader.cancel(reason).catch(() => {});
    },
  };
}

/**
 * Bare React Native has no TransformStream (Expo installs one). Say so, as the codecs do,
 * instead of failing with a ReferenceError.
 */
function checkStreams(fn: string): void {
  if (typeof TransformStream === 'undefined') {
    throw new TypeError(
      `${fn}: this runtime has no TransformStream. On React Native, install a polyfill such as ` +
        "web-streams-polyfill and import 'web-streams-polyfill/polyfill' before using streams.",
    );
  }
}

/** A stream that imports the codec when it starts, then passes everything through the codec's stream. */
function deferredStream(codec: Codec, open: (api: CodecApi) => TransformStream<Bytes, Uint8Array>): TransformStream<Bytes, Uint8Array> {
  let link: Link | undefined;
  let canceled = false;
  return new TransformStream<Bytes, Uint8Array>({
    async start(controller) {
      const api = await loadCodec(codec);
      // Canceled while the codec loaded: don't open a codec stream nobody will close.
      if (!canceled) link = connect(open(api), controller);
    },
    transform: (chunk) => link!.writer.write(chunk),
    flush: () => link!.finish(),
    cancel(reason: unknown) {
      canceled = true;
      link?.cancel(reason);
    },
  } as Transformer<Bytes, Uint8Array>);
}

/**
 * A TransformStream that compresses everything written to it in the given format (every
 * format except raw `'snappy'` blocks, which have no stream form).
 *
 * If the codec is not loaded yet, the stream loads it when it starts. Until then the codec
 * cannot check the options, so an invalid option errors the stream instead of throwing here.
 *
 * @example
 * const compressed = file.stream().pipeThrough(createCompressStream('zstd', { level: 9 }));
 */
export function createCompressStream<F extends StreamFormat>(
  format: F,
  options?: CompressStreamOptions<F> | number,
): TransformStream<Bytes, Uint8Array> {
  checkStreams('createCompressStream');
  const info = formatInfo(format, 'createCompressStream', true);
  const codecOptions = argumentOptions(options, info, 'createCompressStream', true);
  const api = loadedCodec(info.codec);
  if (api) return api.createCompressStream(codecOptions);
  const copy = copyOptions(codecOptions);
  return deferredStream(info.codec, (loaded) => loaded.createCompressStream(copy));
}

/**
 * A TransformStream that decompresses. Pass a stream format with that codec's options, or
 * `'auto'` to detect the format from the first bytes: it holds the first chunks until it
 * has seen enough of them (a few bytes, even with 1-byte chunks), then decompresses.
 * Data that matches no signature errors the stream with `ERR_COMPRESSION_UNKNOWN_FORMAT`.
 * Corrupt, truncated or oversized data errors it with the codec's own error.
 *
 * @example
 * const body = response.body.pipeThrough(createDecompressStream('auto', { maxOutputSize: 1 << 30 }));
 */
export function createDecompressStream<F extends StreamFormat | 'auto'>(
  format: F,
  options?: DecompressStreamOptions<F>,
): TransformStream<Bytes, Uint8Array> {
  checkStreams('createDecompressStream');
  if (format === 'auto') {
    checkOptionsObject(options, 'createDecompressStream');
    return autoDecompressStream(autoOptions(options ?? {}, 'createDecompressStream'));
  }
  const info = formatInfo(format, 'createDecompressStream', true);
  const codecOptions = argumentOptions(options, info, 'createDecompressStream', false);
  const api = loadedCodec(info.codec);
  if (api) return api.createDecompressStream(codecOptions);
  const copy = copyOptions(codecOptions);
  return deferredStream(info.codec, (loaded) => loaded.createDecompressStream(copy));
}

function autoDecompressStream(auto: AutoDecompressOptions): TransformStream<Bytes, Uint8Array> {
  // The first bytes, copied, while there are too few to tell the format: the caller may
  // reuse a chunk as soon as its write settles.
  let head = EMPTY;
  let headLength = 0;
  let link: Link | undefined;
  let canceled = false;

  function hold(bytes: Uint8Array): void {
    if (headLength + bytes.length > head.length) {
      const grown = new Uint8Array(Math.max(64, 2 * head.length, headLength + bytes.length));
      grown.set(head.subarray(0, headLength));
      head = grown;
    }
    head.set(bytes, headLength);
    headLength += bytes.length;
  }

  // Starts the codec's stream once `data` (everything so far) shows the format.
  // False: too few bytes to tell yet.
  async function begin(data: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>, final: boolean): Promise<boolean> {
    const verdict = sniff(data);
    if (verdict === undefined && !final && data.length <= SNIFF_LIMIT) return false;
    if (!verdict) throw unknownFormat(data.length, verdict === undefined && !final);
    const info = formatInfo(verdict, 'createDecompressStream');
    const api = loadedCodec(info.codec) ?? (await loadCodec(info.codec));
    if (canceled) return true;
    link = connect(api.createDecompressStream(withCodecFormat({ ...auto }, info)), controller);
    head = EMPTY;
    headLength = 0;
    await link.writer.write(data);
    return true;
  }

  return new TransformStream<Bytes, Uint8Array>({
    async transform(chunk, controller) {
      if (link) return link.writer.write(chunk);
      const bytes = toBytes(chunk, 'chunk');
      // Usually the first chunk shows the format, and goes to the codec without a copy.
      if (headLength === 0) {
        if (!(await begin(bytes, controller, false))) hold(bytes);
        return;
      }
      hold(bytes);
      await begin(head.subarray(0, headLength), controller, false);
    },
    async flush(controller) {
      if (!link) await begin(head.subarray(0, headLength), controller, true);
      await link!.finish();
    },
    cancel(reason: unknown) {
      canceled = true;
      link?.cancel(reason);
    },
  } as Transformer<Bytes, Uint8Array>);
}

/**
 * Identifies compressed data from its first bytes: `'zstd'`, `'lz4'` (frames), `'gzip'`,
 * `'zlib'`, `'snappy-framed'`, or `null`. Only the signature is checked, not the rest.
 *
 * Brotli, raw deflate, raw snappy blocks and raw LZ4 blocks have no signature, and give
 * `null`. zstd and LZ4 frames may start with skippable frames (as pzstd writes); the frame
 * after them decides. The zlib header has only a 5-bit check, so zlib is reported only when
 * the first deflate block header is valid too; random data still passes about once in 4000.
 * Too few bytes to tell give `null`.
 */
export function detectFormat(data: Bytes): DetectedFormat | null {
  return sniff(toBytes(data, 'data')) ?? null;
}

/**
 * Loads the codecs for the given formats (all five with no arguments), and their
 * WebAssembly modules where they use them. Needed before any synchronous call, on every
 * runtime; optional before async calls and streams, which load codecs on first use.
 *
 * To load a codec's WebAssembly from a custom location, call that codec's own `init(source)`
 * first, through its namespace: `import { init } from '@kodespire/compression-js/zstd'`.
 *
 * @example
 * await init('gzip', 'zstd');
 * const packed = compressSync('gzip', data);
 */
export async function init(...formatList: Format[]): Promise<void> {
  const wanted = formatList.length === 0 ? codecs : [...new Set(formatList.map((f) => formatInfo(f, 'init').codec))];
  await Promise.all(wanted.map(async (codec) => (await loadCodec(codec)).init()));
}

/**
 * Which implementation the format's codec is running: `'native'` (Node-API addon) or
 * `'wasm'`. Like the synchronous functions, it needs `await init(format)` first.
 */
export function activeBackend(format: Format): BackendKind {
  formatInfo(format, 'activeBackend');
  return codecForSync(format, 'activeBackend').activeBackend();
}
