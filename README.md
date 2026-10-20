# compression-js

Compression libraries for JavaScript that use the official C implementations, with one API on
Node.js, Bun, Deno, browsers and edge runtimes.

Each codec lives in its own repository and npm package. This repository will hold:
- **the umbrella package:** one API across every codec, with format detection
- **the shared build and release workflows** that the codec repositories use (see [WORKFLOWS.md](WORKFLOWS.md))
- **cross-codec benchmarks**

## The family

| Codec | Repository | npm | Upstream library | Status |
| --- | --- | --- | --- | --- |
| Zstandard | [zstd-js](https://github.com/kodespire/zstd-js) | `@kodespire/zstd-js` | [facebook/zstd](https://github.com/facebook/zstd) | 0.1 in progress |
| LZ4 | [lz4-js](https://github.com/kodespire/lz4-js) | `@kodespire/lz4-js` | [lz4/lz4](https://github.com/lz4/lz4) | planned |
| Snappy | [snappy-js](https://github.com/kodespire/snappy-js) | `@kodespire/snappy-js` | [google/snappy](https://github.com/google/snappy) | planned |
| Brotli | [brotli-js](https://github.com/kodespire/brotli-js) | `@kodespire/brotli-js` | [google/brotli](https://github.com/google/brotli) | planned |
| Gzip / zlib / deflate | [gzip-js](https://github.com/kodespire/gzip-js) | `@kodespire/gzip-js` | [madler/zlib](https://github.com/madler/zlib) | planned |
| All of the above | compression-js | `@kodespire/compression-js` | | planned |

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

## License

MIT. Each package ships the license notices of the library it bundles.
