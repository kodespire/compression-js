// Bundles main.js with Vite from the installed package, serves the build, and runs it in
// Chromium, Firefox and WebKit through Playwright. Also loads it from the Vite dev server.
// Run from a project with @kodespire/compression-js, vite and playwright installed, with
// index.html and main.js in ./browser-app:
//   BROWSERS=chromium,firefox,webkit node run.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { extname, join } from 'node:path';

import { chromium, firefox, webkit } from 'playwright';
import { build, createServer } from 'vite';

const app = join(process.cwd(), 'browser-app');
const outDir = join(app, 'dist');
const browsers = (process.env['BROWSERS'] ?? 'chromium').split(',');
const engines = { chromium, firefox, webkit };
let failed = false;

await build({ root: app, logLevel: 'warn', build: { outDir, emptyOutDir: true } });

// The entry chunk must not contain the codecs: each is a chunk of its own, with its .wasm.
const assets = readdirSync(join(outDir, 'assets')).map((name) => ({ name, size: statSync(join(outDir, 'assets', name)).size }));
const entry = assets.find((a) => a.name.startsWith('index-') && a.name.endsWith('.js'));
const wasm = assets.filter((a) => a.name.endsWith('.wasm'));
console.log('bundle:', assets.map((a) => `${a.name} ${(a.size / 1024).toFixed(1)} KiB`).join(', '));
if (!entry || entry.size > 20 * 1024 || wasm.length !== 5 || assets.filter((a) => a.name.endsWith('.js')).length < 6) {
  console.log('FAIL: expected a small entry chunk, one chunk per codec and five .wasm files');
  failed = true;
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = createHttpServer((req, res) => {
  const path = join(outDir, new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html'));
  try {
    const body = readFileSync(path);
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const built = `http://127.0.0.1:${server.address().port}/`;

const dev = await createServer({ root: app, logLevel: 'warn', server: { port: 0, host: '127.0.0.1' } });
await dev.listen();
const devUrl = dev.resolvedUrls.local[0];

function check(result) {
  const formats = Object.values(result?.formats ?? {});
  return !result?.error && result.gzip && formats.length === 8 && formats.every(Boolean) && result.sync &&
    result.unknown === 'ERR_COMPRESSION_UNKNOWN_FORMAT' && result.backends?.join() === 'wasm' &&
    result.atStart.length === 0 && result.afterGzip.join() === 'gzip' &&
    result.afterAll.join() === 'brotli,gzip,lz4,snappy,zstd';
}

async function visit(browserName, label, url) {
  const browser = await engines[browserName].launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(url);
    await page.waitForFunction(() => window.__result, null, { timeout: 120_000 });
    const result = await page.evaluate(() => window.__result);
    const ok = check(result) && errors.length === 0;
    console.log(`${ok ? 'ok' : 'FAIL'}: ${browserName} (${label})`, JSON.stringify(result), errors.join(' '));
    if (!ok) failed = true;
  } finally {
    await browser.close();
  }
}

try {
  for (const name of browsers) await visit(name, 'vite build', built);
  await visit(browsers[0], 'vite dev server', devUrl);
} finally {
  server.close();
  await dev.close();
}
process.exit(failed ? 1 : 0);
