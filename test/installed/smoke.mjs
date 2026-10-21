// Smoke test for an installed copy of the package, runnable under Node, Bun and Deno:
//   EXPECT_BACKEND=native node smoke.mjs
//   EXPECT_BACKEND=native bun smoke.mjs
//   EXPECT_BACKEND=wasm deno run -A --node-modules-dir=manual smoke.mjs
// Copy it next to a node_modules that has @kodespire/compression-js installed.
import * as c from '@kodespire/compression-js';
import { ZstdError } from '@kodespire/compression-js/zstd';

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  globalThis.process?.exit?.(1);
  globalThis.Deno?.exit?.(1);
  throw new Error(message);
};
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const env = (name) => globalThis.process?.env?.[name] ?? globalThis.Deno?.env.get(name);

const runtime = globalThis.Deno ? `deno ${Deno.version.deno}` : globalThis.Bun ? `bun ${Bun.version}` : `node ${process.version}`;
const src = new TextEncoder().encode('smoke test for every codec '.repeat(4000));

async function pipe(stream, data, chunk) {
  const parts = new ReadableStream({
    start(controller) {
      for (let i = 0; i < data.length; i += chunk) controller.enqueue(data.subarray(i, i + chunk));
      controller.close();
    },
  });
  return new Uint8Array(await new Response(parts.pipeThrough(stream)).arrayBuffer());
}

// Sync calls need init() first, everywhere.
let code;
try {
  c.compressSync('gzip', src);
} catch (error) {
  code = error.code;
}
if (code !== 'ERR_COMPRESSION_NOT_INITIALIZED') fail(`compressSync before init gave ${code}`);

const sizes = [];
for (const format of c.formats) {
  const packed = await c.compress(format, src);
  if (!equal(await c.decompress(packed, { format }), src)) fail(`${format}: round trip`);
  const detected = c.detectFormat(packed);
  if (detected !== null && detected !== format) fail(`${format}: detected as ${detected}`);
  if (detected && !equal(await c.decompress(packed), src)) fail(`${format}: auto round trip`);
  if (format !== 'snappy') {
    const streamed = await pipe(c.createCompressStream(format), src, 10_000);
    const back = await pipe(c.createDecompressStream(detected ? 'auto' : format), streamed, detected ? 1 : 997);
    if (!equal(back, src)) fail(`${format}: stream round trip`);
  }
  sizes.push(`${format} ${packed.length}`);
}

await c.init();
for (const format of c.formats) {
  if (!equal(c.decompressSync(c.compressSync(format, src), { format }), src)) fail(`${format}: sync round trip`);
}

try {
  await c.decompress(new TextEncoder().encode('not compressed'));
  code = 'no error';
} catch (error) {
  code = error.code;
}
if (code !== 'ERR_COMPRESSION_UNKNOWN_FORMAT') fail(`undetectable input gave ${code}`);
const frame = await c.compress('zstd', src);
try {
  await c.decompress(frame.subarray(0, frame.length - 3));
} catch (error) {
  code = error instanceof ZstdError ? error.code : `not a ZstdError: ${error}`;
}
if (code !== 'ERR_ZSTD_TRUNCATED') fail(`truncated zstd gave ${code}`);

const backends = [...new Set(c.formats.map((f) => c.activeBackend(f)))];
const expected = env('EXPECT_BACKEND');
if (expected && (backends.length !== 1 || backends[0] !== expected)) fail(`backends are ${backends}, expected ${expected}`);

console.log(`ok: ${runtime}, backend=${backends}, ${src.length} bytes -> ${sizes.join(', ')}`);
