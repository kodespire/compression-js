// The zstd codec's own API, re-exported so it can be imported from this package:
//   import * as zstd from '@kodespire/compression-js/zstd';
// Loading this module loads @kodespire/zstd-js; the main entry does not.
export * from '@kodespire/zstd-js';
