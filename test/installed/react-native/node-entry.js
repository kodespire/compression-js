// Entry for the bundle run by Node.js (see run.mjs). The namespaces are imported lazily
// too, so that only the codec a call needs is loaded.
import * as umbrella from '@kodespire/compression-js';

globalThis.__umbrella = umbrella;
globalThis.__namespaces = {
  zstd: () => import('@kodespire/compression-js/zstd'),
  lz4: () => import('@kodespire/compression-js/lz4'),
  snappy: () => import('@kodespire/compression-js/snappy'),
  brotli: () => import('@kodespire/compression-js/brotli'),
  gzip: () => import('@kodespire/compression-js/gzip'),
};
