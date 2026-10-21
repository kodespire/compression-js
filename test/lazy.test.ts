// Only the codecs a program uses are loaded. A child process records every @kodespire/*
// package resolved, through a module resolve hook.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { expect, it } from 'vitest';

function run(...steps: string[]): Record<string, string[]> {
  const out = execFileSync(process.execPath, [join(import.meta.dirname, 'lazy', 'child.mjs'), ...steps], { encoding: 'utf8' });
  return JSON.parse(out) as Record<string, string[]>;
}

it('importing the package loads no codec, and each call loads only its own', () => {
  const r = run('detect', 'gzip', 'zlibSync', 'autoZstd');
  expect(r['import']).toEqual([]);
  expect(r['detect']).toEqual([]);
  expect(r['gzip']).toEqual(['@kodespire/gzip-js']);
  expect(r['zlibSync']).toEqual(['@kodespire/gzip-js']);
  // The step imports zstd-js itself to make a frame; decompressing it loads nothing else.
  expect(r['autoZstd']).toEqual(['@kodespire/gzip-js', '@kodespire/zstd-js']);
});

it('an auto stream loads only the detected codec', () => {
  const r = run('autoLz4Stream');
  expect(r['autoLz4Stream']).toEqual(['@kodespire/lz4-js']);
});

it('a namespace loads only its codec', () => {
  const r = run('brotliNamespace');
  expect(r['brotliNamespace']).toEqual(['@kodespire/brotli-js']);
});
