// React Native check without a device: bundles the package with Metro as a release build
// does, for iOS and Android, and checks that
// - each lazy import() resolves to the codec's "react-native" entry (its JSI module), and
//   nothing pulls in a Node.js or WebAssembly-fetch entry or a node: module;
// - Hermes compiles the bundle, as release builds do (hermesc from hermes-compiler);
// - in a bundle run by Node.js (react-native stubbed out, so the codecs fall back to
//   WebAssembly), Metro's import() loads only the codec a call needs, when it needs it,
//   and every format round-trips through the codecs' react-native entries.
// Run from a project with @kodespire/compression-js, react-native, react and
// @react-native/metro-config installed and this directory's files copied in.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { runInThisContext } from 'node:vm';

const project = process.cwd();
const require = createRequire(join(project, 'package.json'));
const Metro = require('metro');
const codecs = ['zstd', 'lz4', 'snappy', 'brotli', 'gzip'];
const out = join(project, 'out');
mkdirSync(out, { recursive: true });
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok' : 'FAIL'}: ${message}`);
  if (!ok) failures.push(message);
};

async function bundle(configFile, entry, platform, dev) {
  const config = await Metro.loadConfig({ cwd: project, config: join(project, configFile) });
  const file = join(out, `${entry.replace(/\.js$/, '')}.${platform}.js`);
  await Metro.runBuild(config, { entry: `./${entry}`, platform, dev, minify: false, out: file, sourceMap: true });
  return file;
}

/** The modules in a bundle: paths from its (sectioned) source map, from node_modules on. */
function modulesOf(file) {
  const map = JSON.parse(readFileSync(file.replace(/\.js$/, '.map'), 'utf8'));
  const sources = map.sections ? map.sections.flatMap((s) => s.map.sources) : map.sources;
  return sources.map((s) => s.replace(/^.*node_modules\//, ''));
}

const hermesc = join(
  project,
  'node_modules/hermes-compiler/hermesc',
  { darwin: 'osx-bin/hermesc', linux: 'linux64-bin/hermesc', win32: 'win64-bin/hermesc.exe' }[process.platform],
);

for (const platform of ['ios', 'android']) {
  const file = await bundle('metro.config.js', 'index.js', platform, false);
  const modules = modulesOf(file);
  for (const codec of codecs) {
    check(modules.includes(`@kodespire/${codec}-js/dist/entry-react-native.js`), `${platform}: ${codec}-js resolves to its react-native entry`);
  }
  const unwanted = modules.filter((m) =>
    /^node:/.test(m) ||
    /^@kodespire\/[\w-]+\/dist\/(entry-(node|wasm|workerd)|load-wasm-(node|fetch)|native-backend)\.js$/.test(m) ||
    /^node-gyp-build\//.test(m));
  check(unwanted.length === 0, `${platform}: no Node.js, WebAssembly-fetch or node: modules${unwanted.length ? `: ${unwanted.join(', ')}` : ''}`);
  try {
    execFileSync(hermesc, ['-emit-binary', '-O', '-w', '-out', file.replace(/\.js$/, '.hbc'), file], { stdio: 'pipe' });
    check(true, `${platform}: hermesc compiles the bundle`);
  } catch (error) {
    check(false, `${platform}: hermesc compiles the bundle: ${error.stderr}`);
  }
}

// Run a bundle in Node.js. A dev bundle keeps module names, so __r.getModules() shows
// which modules have run.
runInThisContext(readFileSync(await bundle('metro.node.config.js', 'node-entry.js', 'ios', true), 'utf8'));
const c = globalThis.__umbrella;
const loadedCodecs = () =>
  [...globalThis.__r.getModules().values()]
    .filter((m) => m.isInitialized)
    .map((m) => /@kodespire\/([a-z0-9]+)-js\/dist\/entry-react-native\.js$/.exec(m.verboseName ?? '')?.[1])
    .filter(Boolean)
    .sort();

check(loadedCodecs().length === 0, 'Metro: importing the package runs no codec');
const error = await c.compress('gzip', 'x').then(() => undefined, (e) => e);
check(error?.code === 'ERR_GZIP_NOT_INITIALIZED' && /Metro does not bundle gzip\.wasm/.test(error.message),
  `Metro: the first gzip call loads gzip-js's react-native entry, whose error passes through (${error?.code})`);
check(loadedCodecs().join() === 'gzip', `Metro: only gzip-js has run (${loadedCodecs()})`);

const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const src = new TextEncoder().encode('react native '.repeat(5000));
for (const codec of codecs) {
  // With no native module, the react-native entry needs the .wasm passed to init().
  const ns = await globalThis.__namespaces[codec]();
  await ns.init(readFileSync(require.resolve(`@kodespire/${codec}-js/${codec}.wasm`)));
  const formats = c.formats.filter((f) => f === codec || f.startsWith(`${codec}-`) || (codec === 'gzip' && ['zlib', 'deflate-raw'].includes(f)));
  for (const format of formats) {
    const packed = await c.compress(format, src);
    let ok = equal(await c.decompress(packed, { format }), src);
    if (c.detectFormat(packed)) {
      ok &&= equal(await c.decompress(packed), src);
      const body = new Response(packed).body.pipeThrough(c.createDecompressStream('auto'));
      ok &&= equal(new Uint8Array(await new Response(body).arrayBuffer()), src);
    }
    await c.init(format);
    ok &&= equal(c.decompressSync(c.compressSync(format, src), { format }), src) && c.activeBackend(format) === 'wasm';
    check(ok, `Metro: ${format} round trip through ${codec}-js's react-native entry`);
  }
}
check(loadedCodecs().join() === 'brotli,gzip,lz4,snappy,zstd', 'Metro: each codec ran once it was used');

console.log(failures.length ? `FAIL: react-native (${failures.length})` : 'ok: react-native');
process.exit(failures.length ? 1 : 0);
