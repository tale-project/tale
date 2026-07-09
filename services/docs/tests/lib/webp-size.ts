import fs from 'node:fs';

/**
 * Minimal WebP dimension reader — no dependencies, header bytes only.
 *
 * Container layout: `RIFF` (4) + riff size (4 LE) + `WEBP` (4), then the
 * first chunk: fourCC (4) at offset 12, chunk size (4 LE) at 16, payload at
 * 20. The three chunk types encode the canvas size differently:
 *
 *   - `VP8X` (extended): payload = flags + reserved (4 bytes), then
 *     canvas width − 1 as a 24-bit LE at 24 and height − 1 at 27.
 *   - `VP8 ` (lossy): payload = frame tag (3 bytes), sync code
 *     `0x9D 0x01 0x2A` at 23–25, then width and height as 16-bit LE values
 *     at 26 and 28, each masked to 14 bits.
 *   - `VP8L` (lossless): payload = signature byte `0x2F` at 20, then a
 *     32-bit LE bitfield at 21: bits 0–13 width − 1, bits 14–27 height − 1.
 *
 * Returns `null` for anything that isn't a well-formed WebP — callers turn
 * that into a finding rather than crashing the suite on a corrupt asset.
 */
interface WebpSize {
  width: number;
  height: number;
}

export function webpSize(filePath: string): WebpSize | null {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch (error) {
    console.warn(`webpSize: cannot read ${filePath}`, error);
    return null;
  }
  if (buf.length < 16) return null;
  if (buf.toString('latin1', 0, 4) !== 'RIFF') return null;
  if (buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const fourCC = buf.toString('latin1', 12, 16);

  if (fourCC === 'VP8X') {
    if (buf.length < 30) return null;
    return {
      width: 1 + buf.readUIntLE(24, 3),
      height: 1 + buf.readUIntLE(27, 3),
    };
  }

  if (fourCC === 'VP8 ') {
    if (buf.length < 30) return null;
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }

  if (fourCC === 'VP8L') {
    if (buf.length < 25) return null;
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }

  return null;
}
