// Browser smoke test, bundled by Vite from the installed package (see run.mjs).
// Puts its findings in window.__result.
import * as c from '@kodespire/compression-js';

const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
// The codecs whose WebAssembly module has been fetched so far ("gzip-<hash>.wasm" -> gzip).
const wasmFetched = () =>
  [...new Set(performance.getEntriesByType('resource').map((e) => e.name.split('/').pop())
    .filter((name) => name.endsWith('.wasm')).map((name) => name.replace(/(-[\w-]+)?\.wasm$/, '')))].sort();

async function pipe(stream, data, chunk) {
  const parts = new ReadableStream({
    start(controller) {
      for (let i = 0; i < data.length; i += chunk) controller.enqueue(data.subarray(i, i + chunk));
      controller.close();
    },
  });
  return new Uint8Array(await new Response(parts.pipeThrough(stream)).arrayBuffer());
}

async function run() {
  const result = { formats: {} };
  const src = new TextEncoder().encode('browser test '.repeat(20_000));
  result.atStart = wasmFetched();

  // Only gzip is used at first: only its module may be fetched.
  const gz = await c.compress('gzip', src);
  result.gzip = equal(await c.decompress(gz), src);
  result.afterGzip = wasmFetched();

  for (const format of c.formats) {
    const packed = await c.compress(format, src);
    let ok = equal(await c.decompress(packed, { format }), src);
    const detected = c.detectFormat(packed);
    if (detected) ok &&= detected === format && equal(await c.decompress(packed), src);
    if (format !== 'snappy') {
      const streamed = await pipe(c.createCompressStream(format), src, 7000);
      ok &&= equal(await pipe(c.createDecompressStream(detected ? 'auto' : format), streamed, detected ? 1 : 1000), src);
    }
    result.formats[format] = ok;
  }
  await c.init();
  result.sync = c.formats.every((format) => equal(c.decompressSync(c.compressSync(format, src), { format }), src));
  try {
    await c.decompress(new Uint8Array(10));
  } catch (error) {
    result.unknown = error.code;
  }
  result.backends = [...new Set(c.formats.map((f) => c.activeBackend(f)))];
  result.afterAll = wasmFetched();
  return result;
}

run().then(
  (result) => (window.__result = result),
  (error) => (window.__result = { error: String(error?.stack ?? error) }),
);
