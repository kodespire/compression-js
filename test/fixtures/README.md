# Test fixtures

Written by `scripts/make-fixtures.mjs` from `corpus.txt` (8 KiB of generated text) with the
official tools, so detection and `format: 'auto'` are tested on what other encoders write:

| Files | Written by |
| --- | --- |
| `*.zst` | zstd CLI 1.5.7 (`-19`, `--no-check`, two frames concatenated, empty input) |
| `corpus.pzstd.zst` | pzstd 1.5.7: a skippable frame, then the zstd frame |
| `*.lz4` | lz4 CLI 1.10.0 (`-9`, two frames concatenated, empty input, and `-l`: the legacy format, which has no frame and is not detected) |
| `*.gz` | Apple gzip 487.0.1 (`-9 -n`, two members concatenated, empty input) |
| `*.zlib`, `corpus.deflate` | zlib 1.2.12 through Python: levels 1, 2, 6, 9 (headers `78 01`, `78 5e`, `78 9c`, `78 da`), level 0 (stored blocks), a 512-byte window (`18 95`), empty input, and raw deflate |
| `corpus.sz`, `corpus.snappy` | cramjam 2.14.0 (Rust `snap`): the framing format, and one raw block |
| `*.br` | brotli 1.2.0 through Python (google/brotli's bindings): quality 11 and 1, empty input |

The files are binary (see `.gitattributes`): never let git convert their line endings.
