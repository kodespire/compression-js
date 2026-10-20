// Run by lazy.test.ts: node child.mjs <step>... Prints, as JSON, the @kodespire/* packages
// resolved after each step.
import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';

const { port1, port2 } = new MessageChannel();
const seen = new Set();
port1.on('message', (specifier) => seen.add(specifier));
port1.unref();
register('./hook.mjs', { parentURL: import.meta.url, data: { port: port2 }, transferList: [port2] });

// Messages from the hooks thread arrive asynchronously.
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const dist = new URL('../../dist/', import.meta.url);
const snapshot = async () => {
  await settle();
  return [...seen].sort();
};

const result = {};
const c = await import(new URL('index.js', dist).href);
result.import = await snapshot();
const steps = {
  gzip: () => c.compress('gzip', 'hello'),
  zlibSync: () => c.init('zlib').then(() => c.compressSync('zlib', 'hello')),
  autoZstd: async () => c.decompress(await (await import('@kodespire/zstd-js')).compress('hello')),
  autoLz4Stream: async () => {
    const lz4 = await import('@kodespire/lz4-js');
    const body = new Blob([await lz4.compress('hello')]).stream().pipeThrough(c.createDecompressStream('auto'));
    return new Response(body).arrayBuffer();
  },
  brotliNamespace: () => import(new URL('brotli.js', dist).href),
  detect: () => c.detectFormat(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd])),
};
for (const step of process.argv.slice(2)) {
  await steps[step]();
  result[step] = await snapshot();
}
console.log(JSON.stringify(result));
