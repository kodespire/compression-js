# compression-js

[![CI](https://github.com/kodespire/compression-js/actions/workflows/ci.yml/badge.svg)](https://github.com/kodespire/compression-js/actions/workflows/ci.yml)

Compression libraries for JavaScript that use the official C implementations, with one API on
Node.js, Bun, Deno, browsers, edge runtimes and React Native.

Each codec lives in its own repository and npm package. This repository holds:
- **`@kodespire/compression-js`:** one API across every codec, with format detection (below)
- **the shared build and release workflows** that the codec repositories use (see [WORKFLOWS.md](WORKFLOWS.md))
- **cross-codec benchmarks** (planned)

## The family

| Codec | Repository | npm | Upstream library | Status |
| --- | --- | --- | --- | --- |
| Zstandard | [zstd-js](https://github.com/kodespire/zstd-js) | `@kodespire/zstd-js` | [facebook/zstd](https://github.com/facebook/zstd) | 0.2 |
| LZ4 | [lz4-js](https://github.com/kodespire/lz4-js) | `@kodespire/lz4-js` | [lz4/lz4](https://github.com/lz4/lz4) | 0.2 |
| Snappy | [snappy-js](https://github.com/kodespire/snappy-js) | `@kodespire/snappy-js` | [google/snappy](https://github.com/google/snappy) | 0.2 |
| Brotli | [brotli-js](https://github.com/kodespire/brotli-js) | `@kodespire/brotli-js` | [google/brotli](https://github.com/google/brotli) | 0.2 |
| Gzip / zlib / deflate | [gzip-js](https://github.com/kodespire/gzip-js) | `@kodespire/gzip-js` | [madler/zlib](https://github.com/madler/zlib) | 0.2 |
| All of the above | compression-js | `@kodespire/compression-js` | | 0.2 |

## @kodespire/compression-js

```sh
npm install @kodespire/compression-js
```

```js
import { compress, decompress } from '@kodespire/compression-js';

const packed = await compress('zstd', data, { level: 19 });
const unpacked = await decompress(packed); // the format is detected
const body = await decompress(input, { format: 'brotli', maxOutputSize: 64 * 1024 * 1024 });
```

- **The codec packages do the work.** Each format's options are that codec's own options, with the same names and checks, and its output is byte for byte what the codec writes.
- **Only the codecs you use are loaded.** Each codec is imported the first time a call needs it. An app that only uses gzip never loads, fetches or compiles zstd.
- **Formats can be detected.** `decompress(data)` and `createDecompressStream('auto')` recognise zstd, LZ4, gzip, zlib and framed snappy from their first bytes. They never guess: data with no signature throws.
- **Errors are the codecs' own.** Corrupt, truncated or oversized data throws the codec's typed error (`ZstdError`, `GzipError`, ...) unchanged. Nothing returns partial data.

### Formats

| Format | Codec | Detected | Streams | Notes |
| --- | --- | --- | --- | --- |
| `'zstd'` | zstd-js | yes | yes | Concatenated frames are joined; skippable frames skipped. |
| `'lz4'` | lz4-js | yes | yes | LZ4 frames, as the `lz4` tool writes. Raw blocks: see [Codec namespaces](#codec-namespaces). |
| `'snappy'` | snappy-js | no | no | One raw block (Parquet, LevelDB, Prometheus). |
| `'snappy-framed'` | snappy-js | yes | yes | The snappy framing format. |
| `'brotli'` | brotli-js | no | yes | One brotli stream. |
| `'gzip'` | gzip-js | yes | yes | Members are joined, as `gunzip` does. |
| `'zlib'` | gzip-js | yes | yes | One zlib stream (HTTP `Content-Encoding: deflate`). |
| `'deflate-raw'` | gzip-js | no | yes | One raw deflate stream. |

`formats` lists them. TypeScript checks each format's options: `compress('brotli', data, { level: 5 })`
is a type error (brotli has `quality`), and so is a dictionary with `'gzip'`.

### API

| Function | |
| --- | --- |
| `compress(format, data, options?)` | Compresses. `options` is the codec's options, or a number: the level (brotli: the quality). Strings are encoded as UTF-8. |
| `decompress(data, options?)` | Decompresses. `options.format` is a format, or `'auto'` (the default) to detect it. |
| `compressSync`, `decompressSync` | The same, synchronously. Need `await init(format)` first (below). |
| `createCompressStream(format, options?)` | A `TransformStream` that compresses. |
| `createDecompressStream(format, options?)` | A `TransformStream` that decompresses. `format` can be `'auto'`. |
| `detectFormat(bytes)` | `'zstd'`, `'lz4'`, `'gzip'`, `'zlib'`, `'snappy-framed'` or `null`. |
| `init(...formats)` | Loads those formats' codecs (all of them with no arguments) and their WebAssembly where needed. |
| `activeBackend(format)` | `'native'` or `'wasm'`: which implementation that format's codec is running. Needs `init` first. |
| `formats` | Every format name. |
| `CompressionError` | The error for this package's own failures (below). |

With a format, `decompress` takes that codec's options: `{ format: 'zstd', windowLogMax: 31 }`.
With `'auto'`, only `maxOutputSize` is accepted, since every codec has it: name the format to use
anything else, such as a dictionary. Always set `maxOutputSize` for untrusted input.

### Format detection

`detectFormat`, `decompress` and `createDecompressStream('auto')` look only at the first bytes:

- **zstd and LZ4 frames:** their 4-byte magic numbers. Skippable frames (which both formats use, and which pzstd puts before every frame) are skipped, and the frame after them decides.
- **gzip:** `1f 8b 08`, with the reserved flag bits clear.
- **framed snappy:** the 10-byte stream identifier.
- **zlib:** the 2-byte header has only a 5-bit check, so detection also requires no preset dictionary and a valid first deflate block header (and, for a stored block, a matching length check). Random data still passes about once in 4000, and text starting with one of `(S` `8O` `HK` `XG` `hC` `x^` can pass too. Decoding such data then fails with the zlib error, so a false match never returns wrong data.

What cannot be detected: **brotli, raw deflate, raw snappy blocks and raw LZ4 blocks** have no
signature, and the LZ4 legacy format (`lz4 -l`) is not read by lz4-js. `detectFormat` returns
`null` for them, and `'auto'` throws `ERR_COMPRESSION_UNKNOWN_FORMAT`. Name their format instead.

The first frame or member decides the codec, and that codec's rules apply to the rest: zstd
frames, LZ4 frames, gzip members and snappy streams may follow each other; zlib must be one
stream. Input that mixes formats fails with the codec's error.

An auto stream holds the first chunks until it can tell the format (a few bytes, or up to
1 MiB of leading skippable frames), so splitting the input into 1-byte chunks works.

### Streams

```js
const response = await fetch(url);
const body = response.body.pipeThrough(createDecompressStream('auto', { maxOutputSize: 1 << 30 }));

const upload = file.stream().pipeThrough(createCompressStream('zstd', { level: 9 }));
```

Raw `'snappy'` blocks have no stream form: use `'snappy-framed'`. If the codec is not loaded yet,
the stream loads it when it starts; until then the codec cannot check the options, so an invalid
option errors the stream rather than throwing from `createCompressStream`.

### Synchronous calls

A codec is loaded on first use, which a synchronous call cannot wait for. So on every runtime,
call `init` for the formats you need before `compressSync`, `decompressSync` or `activeBackend`:

```js
await init('gzip', 'zstd'); // or init() for all five
const packed = compressSync('gzip', data);
```

Before that they throw `ERR_COMPRESSION_NOT_INITIALIZED`. An async call or stream that has loaded a codec also makes it available.

### Errors

- **The codecs' errors pass through unchanged:** data errors (`ERR_ZSTD_TRUNCATED`, `ERR_GZIP_LIBRARY`, `ERR_BROTLI_OUTPUT_LIMIT`, ...) and option errors (`TypeError`, `RangeError`). Import the classes from the [codec namespaces](#codec-namespaces) to test with `instanceof`.
- **This package's own failures** are a `CompressionError`:
  - `ERR_COMPRESSION_UNKNOWN_FORMAT`: `'auto'` found no signature, or the input is empty.
  - `ERR_COMPRESSION_NOT_INITIALIZED`: a synchronous call before `init`.
- **Bad arguments** throw `TypeError`: an unknown format, `'snappy'` for a stream, `format` given as an option when it is the first argument, or codec options in auto mode.

### Codec namespaces

Each codec's full API is available from a subpath, for what the shared API leaves out
(raw LZ4 blocks, `getFrameContentSize`, version constants, error classes):

```js
import { compressBlock } from '@kodespire/compression-js/lz4';
import { ZstdError, getFrameContentSize } from '@kodespire/compression-js/zstd';
```

`/zstd`, `/lz4`, `/snappy`, `/brotli` and `/gzip` re-export the codec package as is, so they
share its state with the main entry. They are subpaths, not exports of the main entry, so that
importing the main entry loads no codec. To load a codec's WebAssembly from your own URL, call
its `init(source)` through the namespace before using it.

### Runtimes and bundlers

It runs wherever the codecs do:
- **Node.js 22.12 and later, and Bun:** native addons, with WebAssembly as a fallback.
- **Deno, browsers and Cloudflare Workers:** WebAssembly.
- **React Native:** each codec's C++ TurboModule (see [React Native](#react-native)).

CI installs the packed tarball and tests it on Node.js (native and forced WebAssembly), Bun, Deno,
Workers (`wrangler dev`), and Chromium, Firefox and WebKit through Vite, both `vite build` and the
dev server. It also bundles it with Metro for React Native.

- **Browsers:** each codec becomes its own chunk with its own `.wasm`, fetched on first use. With Vite the entry chunk is about 10 KiB, and an app that only uses gzip downloads only gzip's 70 KiB module. Vite needs no configuration.
- **Workers:** wrangler bundles every codec the package can import, so a Worker carries all five modules even if it uses one: about 1.5 MiB (540 KiB gzipped), where gzip-js alone is 87 KiB. That fits Workers' limits; for the smallest Worker, use a codec package directly.
- **Install size:** the package depends on all five codecs, which ship native binaries for 8 platforms (and, since 0.2, their React Native sources): about 11 MB to download and 28 MB on disk. The binaries are never bundled for the web. If disk size matters, install only the codec packages you need.

### React Native

On iOS and Android (React Native 0.84 or later, New Architecture), Metro resolves each codec to
its `react-native` entry: a C++ TurboModule built from the same C code. Codecs still load on first use.

```sh
npm install @kodespire/compression-js @kodespire/zstd-js @kodespire/gzip-js   # the codecs you use
cd ios && pod install
```

Then rebuild the app.

- **List the codecs you use in your app's dependencies.** The React Native CLI only links native code from an app's direct dependencies. A codec that is only installed through this package has its JavaScript bundled but no native module, so its calls throw the codec's `ERR_<CODEC>_NOT_INITIALIZED`, with a message saying the native module is not in the app. Expo's autolinking (current `expo-modules-autolinking`) also follows dependencies of dependencies, so there the umbrella alone is enough. Expo Go cannot load native code: use a development build.
- **Use codec versions in this package's ranges** (`@kodespire/zstd-js@^0.2.1`, the others `^0.2.0`), so npm installs one copy of each: `npm ls @kodespire/zstd-js` should list one version. With two copies, the app's native module and this package's JavaScript would not be the same codec.
- **Synchronous calls need `init` first**, as everywhere: `await init('zstd')` once, then `compressSync('zstd', data)` runs on the native module.
- **Streams need a `TransformStream`**, which Hermes doesn't have. Expo installs one. In bare React Native, `import 'web-streams-polyfill/polyfill'` once at startup. Without it, `createCompressStream` and `createDecompressStream` throw a `TypeError` that says so.
- **Bundle size:** Metro puts all five codecs' JavaScript in the bundle (about 165 KiB before minification), whichever you use. Native code is only in the app for the codecs it lists.
- **Web (Expo web, react-native-web):** the codecs use WebAssembly, as in any browser. Metro doesn't copy `.wasm` files: serve each codec's `dist/<codec>.wasm` and call its `init(url)` through its [namespace](#codec-namespaces) first.

CI bundles an app that uses this package with Metro for iOS and Android, on React Native 0.84 and 0.88. It checks that every codec resolves to its `react-native` entry, with no Node.js modules, and that Hermes compiles the bundle. It also runs a bundle in Node.js with the native modules stubbed out, and checks that each codec is loaded only when first used. Device tests are in each codec's repository.

## Design

Every codec package works the same way:

- **One C layer per codec.** It wraps the upstream library, pinned as a git submodule to a release tag. All compress and decompress loops live in this layer, once.
- **Two builds of that same C code.** A Node-API addon for Node.js and Bun, and a WebAssembly module for browsers, Deno and Workers. If no prebuilt binary matches the platform, the package switches to WebAssembly on its own.
- **No install scripts.** Prebuilt binaries for macOS, Linux (glibc and musl) and Windows ship inside the package, for x64 and arm64.
- **The same API shape everywhere:**
  - `compress` and `decompress` (plus sync versions)
  - streams as `TransformStream`s
  - `init()` and `activeBackend()`
  - errors as typed objects with a `code`
- **Never returns partial data.** Cut-off input, corrupt input and output over the caller's limit all throw. They never return what was decoded so far.
- **Tested against the official tools.** Both backends run the same tests, including decoding the official CLI's output and having the CLI decode ours.
- **Kept current.** A weekly job opens a pull request when upstream publishes a release.

The umbrella package adds no compression code of its own: it maps formats to codecs, detects
formats, and loads codecs on demand. It is plain JavaScript, so its CI ([ci.yml](.github/workflows/ci.yml))
and release ([release.yml](.github/workflows/release.yml)) build no WebAssembly or native code.

## Development

```sh
npm install
npm run build
npm test                  # unit tests (vitest) against dist/
npm run typecheck         # includes the type tests in test/types.test-d.ts
npm run test:installed    # packs, installs and runs on Node, Bun, Deno, Workers, Chromium and Metro
```

`test:installed` uses `bun` and `deno` from `PATH` and installs Vite, Playwright, wrangler and
React Native in temporary projects. `RUNTIMES`, `BROWSERS` and `RN_VERSIONS` choose what runs. `CODEC_TARBALLS=<dir>` installs codec
tarballs from a directory instead of npm. The fixtures in `test/fixtures` come from the official
tools: see its [README](test/fixtures/README.md).

## Releasing

[release.yml](.github/workflows/release.yml) runs on a `v*` tag that matches `version` in
package.json. It tests, packs, installs the tarball and runs it on Node.js (Linux, macOS, Windows),
then stages the release on npm with `npm stage publish --provenance`. The release waits on npmjs.com
until a maintainer approves it with 2FA. Pull requests that change the workflow run it with
`--dry-run`.

npm trusted publishing must be set up once, on npmjs.com under the package's Settings > Trusted
publishing > GitHub Actions:

| Field | Value |
| --- | --- |
| Organization or user | `kodespire` |
| Repository | `compression-js` |
| Workflow filename | `release.yml` |
| Environment | (blank) |
| Allow npm publish, Allow npm dist-tag | both unchecked (staging needs neither) |

## License

MIT. Each codec package ships the license notices of the library it bundles.
