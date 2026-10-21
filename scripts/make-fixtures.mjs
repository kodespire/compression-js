// Writes test/fixtures with the official command-line tools and libraries, so the
// detection and auto-decompression tests read what other encoders write.
//   PYTHON=<python with cramjam and brotli> node scripts/make-fixtures.mjs
// Needs zstd, pzstd, lz4 and gzip on PATH. test/fixtures/README.md lists the versions used.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'test', 'fixtures');
const python = process.env['PYTHON'] ?? 'python3';
const tmp = mkdtempSync(join(tmpdir(), 'compression-js-fixtures-'));

// Deterministic text, 8 KiB.
const words = ['alpha', 'beta', 'gamma', 'delta', 'zstd', 'gzip', 'brotli', 'snappy', 'frame', 'block'];
let x = 7;
let text = '';
while (text.length < 8192) {
  x = (x * 1103515245 + 12345) >>> 0;
  text += words[(x >>> 16) % words.length] + ((x >>> 8) % 13 === 0 ? '\n' : ' ');
}
const corpus = Buffer.from(text.slice(0, 8192));
const halves = [corpus.subarray(0, 4096), corpus.subarray(4096)];

const write = (name, data) => writeFileSync(join(out, name), data);
// Runs a tool on `input` through temp files (piping stdin can hang on macOS, see snappy-js).
function tool(command, args, input) {
  const inFile = join(tmp, 'in');
  writeFileSync(inFile, input);
  return execFileSync(command, [...args, '-c', inFile], { maxBuffer: 1 << 26 });
}
function py(code, input) {
  const inFile = join(tmp, 'in');
  writeFileSync(inFile, input);
  return execFileSync(python, ['-I', '-c', `import sys\ndata = open(sys.argv[1], 'rb').read()\n${code}`, inFile], {
    maxBuffer: 1 << 26,
  });
}
const zlibPy = (level, wbits = 15) =>
  py(`import zlib\nc = zlib.compressobj(${level}, zlib.DEFLATED, ${wbits})\nsys.stdout.buffer.write(c.compress(data) + c.flush())`, corpus);

write('corpus.txt', corpus);

write('corpus.zst', tool('zstd', ['-19', '-q'], corpus));
write('corpus.nocheck.zst', tool('zstd', ['--no-check', '-q'], corpus));
write('corpus.multi.zst', Buffer.concat(halves.map((h) => tool('zstd', ['-q'], h))));
// pzstd puts a skippable frame (its frame size) before every zstd frame.
writeFileSync(join(tmp, 'p'), corpus);
execFileSync('pzstd', ['-q', '-f', '-p', '2', join(tmp, 'p'), '-o', join(tmp, 'p.zst')]);
write('corpus.pzstd.zst', readFileSync(join(tmp, 'p.zst')));
write('empty.zst', tool('zstd', ['-q'], Buffer.alloc(0)));

write('corpus.lz4', tool('lz4', ['-9', '-q'], corpus));
write('corpus.multi.lz4', Buffer.concat(halves.map((h) => tool('lz4', ['-q'], h))));
write('corpus.legacy.lz4', tool('lz4', ['-l', '-q'], corpus));
write('empty.lz4', tool('lz4', ['-q'], Buffer.alloc(0)));

write('corpus.gz', tool('gzip', ['-9', '-n'], corpus));
write('corpus.multi.gz', Buffer.concat(halves.map((h) => tool('gzip', ['-n'], h))));
write('empty.gz', tool('gzip', ['-n'], Buffer.alloc(0)));

for (const level of [1, 2, 6, 9]) write(`corpus.${level}.zlib`, zlibPy(level));
write('corpus.stored.zlib', zlibPy(0));
write('corpus.w9.zlib', zlibPy(6, 9));
write('empty.zlib', py('import zlib\nsys.stdout.buffer.write(zlib.compress(data))', Buffer.alloc(0)));
write('corpus.deflate', zlibPy(6, -15));

write('corpus.sz', py('import cramjam\nsys.stdout.buffer.write(bytes(cramjam.snappy.compress(data)))', corpus));
write('corpus.snappy', py('import cramjam\nsys.stdout.buffer.write(bytes(cramjam.snappy.compress_raw(data)))', corpus));

write('corpus.br', py('import brotli\nsys.stdout.buffer.write(brotli.compress(data))', corpus));
write('corpus.q1.br', py('import brotli\nsys.stdout.buffer.write(brotli.compress(data, quality=1))', corpus));
write('empty.br', py('import brotli\nsys.stdout.buffer.write(brotli.compress(data))', Buffer.alloc(0)));

rmSync(tmp, { recursive: true, force: true });
console.log('wrote test/fixtures');
