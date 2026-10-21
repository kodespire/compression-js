// Cloudflare Workers smoke test: the package resolves the codecs through their "workerd"
// export condition, which imports each .wasm statically. Run with run.mjs.
import * as c from '@kodespire/compression-js';

const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

export default {
  async fetch() {
    const result = { formats: {} };
    try {
      const src = new TextEncoder().encode('workerd '.repeat(20_000));
      for (const format of c.formats) {
        const packed = await c.compress(format, src);
        let ok = equal(await c.decompress(packed, { format }), src);
        if (c.detectFormat(packed)) {
          ok &&= equal(await c.decompress(packed), src);
          const body = new Response(packed).body.pipeThrough(c.createDecompressStream('auto'));
          ok &&= equal(new Uint8Array(await new Response(body).arrayBuffer()), src);
        }
        result.formats[format] = ok;
      }
      await c.init();
      result.sync = c.formats.every((format) => equal(c.decompressSync(c.compressSync(format, src), { format }), src));
      try {
        await c.decompress(new Uint8Array(10));
        result.unknown = 'no error';
      } catch (error) {
        result.unknown = error.code;
      }
      result.backends = [...new Set(c.formats.map((f) => c.activeBackend(f)))];
    } catch (error) {
      result.error = String(error?.stack ?? error);
    }
    return Response.json(result);
  },
};
