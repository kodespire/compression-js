// App entry: the umbrella as an app would use it.
import { compress, createDecompressStream, decompress, detectFormat, formats, init } from '@kodespire/compression-js';

export async function selfTest() {
  await init();
  for (const format of formats) {
    const packed = await compress(format, 'react native '.repeat(100));
    await decompress(packed, detectFormat(packed) ? undefined : { format });
  }
  return createDecompressStream('auto');
}
