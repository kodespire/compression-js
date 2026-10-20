export type CompressionErrorCode =
  /**
   * `format: 'auto'` could not identify the data: it does not start with a zstd, LZ4, gzip,
   * zlib or framed snappy signature (or it is empty). Brotli, raw deflate and raw snappy or
   * LZ4 blocks have no signature, so they always need their format named.
   */
  | 'ERR_COMPRESSION_UNKNOWN_FORMAT'
  /** A synchronous call was made before `await init(format)` loaded that format's codec. */
  | 'ERR_COMPRESSION_NOT_INITIALIZED';

/**
 * An error raised by this package itself. Errors from a codec (corrupt or truncated data,
 * output limits) are that codec's own error class, such as `ZstdError`, passed through unchanged.
 */
export class CompressionError extends Error {
  readonly code: CompressionErrorCode;

  constructor(code: CompressionErrorCode, message: string) {
    super(message);
    this.name = 'CompressionError';
    this.code = code;
  }
}

export function unknownFormat(length: number, overLimit = false): CompressionError {
  const what = length === 0
    ? 'the input is empty'
    : overLimit
      ? `no zstd or LZ4 frame follows the skippable frames in the first ${length} bytes`
      : 'it does not start with a zstd, LZ4, gzip, zlib or framed snappy signature';
  return new CompressionError(
    'ERR_COMPRESSION_UNKNOWN_FORMAT',
    `compression-js: could not detect the format: ${what}. Brotli, raw deflate and raw snappy or LZ4 blocks ` +
      'have no signature: pass their format explicitly.',
  );
}
