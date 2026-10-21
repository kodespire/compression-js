// Packs this package, installs the tarball into an empty project, and runs it there on
// Node.js (native and forced WebAssembly), Bun, Deno, Cloudflare Workers (wrangler dev)
// and browsers (a Vite build and the Vite dev server, through Playwright).
//   npm run build && npm run test:installed
// Environment:
//   RUNTIMES        which to run, default node,node-wasm,bun,deno,workerd,browser
//   BROWSERS        for the browser test, default chromium (CI: chromium,firefox,webkit)
//   BUN, DENO       the binaries, default bun and deno on PATH
//   CODEC_TARBALLS  a directory of codec tarballs (searched recursively) to install
//                   instead of the versions on npm
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const runtimes = (process.env['RUNTIMES'] ?? 'node,node-wasm,bun,deno,workerd,browser').split(',');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const version = (name) => JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;

const project = mkdtempSync(join(tmpdir(), 'compression-js-installed-'));
console.log(`project: ${project}`);

const packed = JSON.parse(execFileSync(npm, ['pack', '--json', '--pack-destination', project], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' }));
const tarball = join(project, packed[0].filename);
console.log(`packed ${packed[0].filename}: ${packed[0].entryCount} files, ${(packed[0].size / 1024).toFixed(1)} KiB`);

function findTarballs(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? findTarballs(path) : name.endsWith('.tgz') ? [path] : [];
  });
}
const codecTarballs = process.env['CODEC_TARBALLS'] ? findTarballs(process.env['CODEC_TARBALLS']) : [];

const tools = [];
if (runtimes.includes('browser')) tools.push(`vite@${version('vite')}`, `playwright@${version('playwright')}`);
if (runtimes.includes('workerd')) tools.push('wrangler@4');
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
execFileSync(npm, ['install', '--no-audit', '--no-fund', tarball, ...codecTarballs, ...tools], {
  cwd: project,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

copyFileSync(join(here, 'smoke.mjs'), join(project, 'smoke.mjs'));
for (const name of ['worker.mjs', 'wrangler.toml', 'run.mjs']) {
  copyFileSync(join(here, 'workerd', name), join(project, name === 'run.mjs' ? 'run-workerd.mjs' : name));
}
mkdirSync(join(project, 'browser-app'));
for (const name of ['index.html', 'main.js']) copyFileSync(join(here, 'browser', name), join(project, 'browser-app', name));
copyFileSync(join(here, 'browser', 'run.mjs'), join(project, 'run-browser.mjs'));

const forceWasm = Object.fromEntries(['ZSTD', 'LZ4', 'SNAPPY', 'BROTLI', 'GZIP'].map((c) => [`${c}_JS_BACKEND`, 'wasm']));
const steps = {
  node: [process.execPath, ['smoke.mjs'], { EXPECT_BACKEND: 'native' }],
  'node-wasm': [process.execPath, ['smoke.mjs'], { EXPECT_BACKEND: 'wasm', ...forceWasm }],
  bun: [process.env['BUN'] ?? 'bun', ['smoke.mjs'], { EXPECT_BACKEND: 'native' }],
  deno: [process.env['DENO'] ?? 'deno', ['run', '-A', '--node-modules-dir=manual', 'smoke.mjs'], { EXPECT_BACKEND: 'wasm' }],
  workerd: [process.execPath, ['run-workerd.mjs'], {}],
  browser: [process.execPath, ['run-browser.mjs'], {}],
};

const failed = [];
for (const name of runtimes) {
  const [command, args, env] = steps[name];
  console.log(`\n--- ${name}`);
  const run = spawnSync(command, args, { cwd: project, stdio: 'inherit', env: { ...process.env, ...env } });
  if (run.status !== 0) failed.push(name);
}

console.log(failed.length ? `\nFAILED: ${failed.join(', ')}` : `\nall passed: ${runtimes.join(', ')}`);
if (!failed.length) rmSync(project, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
