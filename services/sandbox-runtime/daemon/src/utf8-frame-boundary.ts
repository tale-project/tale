const EMPTY_BYTES = Buffer.alloc(0);

/** Keep valid UTF-8 characters together for consumers that decode each frame.
 * Bytes are never decoded or rewritten: binary output and incomplete EOFs
 * remain exact. Only a potentially valid suffix of at most three bytes waits. */
export class Utf8FrameBoundary {
  private pending: Buffer = EMPTY_BYTES;

  push(chunk: Buffer): Buffer {
    const bytes = this.pending.length
      ? Buffer.concat([this.pending, chunk])
      : chunk;
    const trailing = incompleteSuffixLength(bytes);
    const end = bytes.length - trailing;
    // Copy only the suffix so it cannot retain a large pipe chunk.
    this.pending = trailing ? Buffer.from(bytes.subarray(end)) : EMPTY_BYTES;
    return bytes.subarray(0, end);
  }

  flush(): Buffer {
    const bytes = this.pending;
    this.pending = EMPTY_BYTES;
    return bytes;
  }
}

function incompleteSuffixLength(bytes: Buffer): number {
  let start = bytes.length - 1;
  while (start >= 0 && start >= bytes.length - 3) {
    const byte = bytes[start];
    if (byte === undefined || byte < 0x80 || byte > 0xbf) break;
    start -= 1;
  }
  const lead = bytes[start];
  if (lead === undefined) return 0;
  const width =
    lead >= 0xc2 && lead <= 0xdf
      ? 2
      : lead >= 0xe0 && lead <= 0xef
        ? 3
        : lead >= 0xf0 && lead <= 0xf4
          ? 4
          : 0;
  const length = bytes.length - start;
  if (width === 0 || length >= width) return 0;
  const second = bytes[start + 1];
  // Exclude overlong encodings, surrogate code points and values > U+10FFFF.
  if (
    second !== undefined &&
    ((lead === 0xe0 && second < 0xa0) ||
      (lead === 0xed && second > 0x9f) ||
      (lead === 0xf0 && second < 0x90) ||
      (lead === 0xf4 && second > 0x8f))
  )
    return 0;
  return length;
}
