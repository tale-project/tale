/**
 * HTTP `Range` header parsing for the static React servers (marketing site +
 * docs).
 *
 * Bun's `new Response(Bun.file(…))` does NOT honor `Range` requests by
 * itself — it always streams the whole file with a 200. For `<video>` that is
 * fatal on WebKit (Safari/iOS probe with `Range: bytes=0-1` and refuse to play
 * without a 206) and makes seeking re-download from byte zero everywhere else,
 * so the server slices the file itself.
 *
 * Kept `bun`-import-free like `security-headers.ts` so the pure logic can be
 * unit-tested under the node vitest runtime.
 */

interface ByteRange {
  /** First byte position, inclusive. */
  start: number;
  /** Last byte position, inclusive (≤ size - 1). */
  end: number;
}

/**
 * Parse a request's `Range` header against a resource of `size` bytes.
 *
 * Returns the single satisfiable range to serve with a 206, the string
 * `'unsatisfiable'` when the header is well-formed but selects nothing
 * (→ 416 with an unsatisfied-range `Content-Range`), or `null` when there is no
 * usable range and the full resource should be served with a 200 — absent
 * header, non-`bytes` unit, malformed spec, or a multi-range request (a
 * server MAY ignore those; browsers request media with single ranges).
 */
export function parseByteRange(
  header: string | null,
  size: number,
): ByteRange | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startDigits, endDigits] = match;
  if (startDigits === '' && endDigits === '') return null;

  // Suffix form `bytes=-n`: the final n bytes.
  if (startDigits === '') {
    const suffixLength = Number(endDigits);
    if (suffixLength === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(startDigits);
  if (start >= size) return 'unsatisfiable';
  const end =
    endDigits === '' ? size - 1 : Math.min(Number(endDigits), size - 1);
  // `bytes=5-2` is syntactically invalid per RFC 9110 — ignore the header.
  if (start > end) return null;
  return { start, end };
}
