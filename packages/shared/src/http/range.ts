/**
 * HTTP byte ranges, per RFC 9110 §14 — ONE reading of a `Range` request
 * and of the `If-Range` precondition that guards it, for every door that
 * serves a stored blob (the REST file lanes, the WebDAV GET). A second
 * parser is how two doors end up disagreeing about which range is
 * "unsatisfiable" — and a door that answers 416 for one of them while
 * promising a body it does not have kills the connection at the edge.
 *
 *   Range        = "bytes=" first-pos "-" [ last-pos ]   (a single range)
 *                | "bytes=" "-" suffix-length
 *
 * Only a single byte range is understood. A multi-range request
 * (`bytes=0-99,200-299`) or a spec the parser cannot read is answered as
 * if no `Range` had been sent — the whole representation with 200 — which
 * RFC 9110 §14.2 permits ("MAY ignore"). A well-formed range whose first
 * byte lies at or past the end of the representation is `unsatisfiable`
 * (§14.1.2), which the caller answers 416 with an EMPTY body and a
 * `Content-Range` naming the size alone (`unsatisfiableContentRange`).
 *
 * Layer A: no imports, runs anywhere a string does.
 */

/** The inclusive byte positions a satisfiable range selects, clamped to
 * the representation: `end` never exceeds `size - 1`. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Parse a `Range` field value against a representation of `size` bytes.
 *
 * - `null` — no header, or one this parser does not read (another unit, a
 *   multi-range, a malformed spec, `bytes=-`, a suffix of zero): the caller
 *   ignores the header and serves the whole representation.
 * - `'unsatisfiable'` — a well-formed range that selects no byte: the first
 *   position is at or past the end (`bytes=<size>-`, what a resumed
 *   download sends once its copy is complete), or the representation is
 *   empty. The caller answers 416.
 * - a `ByteRange` — the bytes to serve, last position clamped to the end.
 *   A suffix range (`bytes=-100`) is the LAST hundred bytes, or the whole
 *   representation when it is shorter.
 */
export function parseRangeHeader(
  header: string | null | undefined,
  size: number,
): ByteRange | 'unsatisfiable' | null {
  if (header === null || header === undefined) return null;
  const match = SINGLE_RANGE.exec(header.trim());
  if (!match) return null;
  const [, startText = '', endText = ''] = match;
  if (startText === '' && endText === '') return null;
  if (!Number.isFinite(size) || size <= 0) return 'unsatisfiable';

  if (startText === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(endText);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  if (!Number.isFinite(start) || start < 0) return null;
  let end = size - 1;
  if (endText !== '') {
    end = Number(endText);
    if (!Number.isFinite(end) || end < start) return null;
    if (end > size - 1) end = size - 1;
  }
  if (start >= size) return 'unsatisfiable';
  return { start, end };
}

/** The `Range` request header a caller forwards for a parsed range —
 * normalised, so a suffix or an over-long range reaches the store as the
 * exact bytes the answer will carry. */
export function formatRangeHeader(range: ByteRange): string {
  return `bytes=${range.start}-${range.end}`;
}

/** The `Content-Range` an unsatisfiable range answers (RFC 9110 §14.4):
 * no byte positions, the representation's size alone. */
export function unsatisfiableContentRange(size: number): string {
  return `bytes */${size}`;
}

/**
 * Whether an `If-Range` precondition (RFC 9110 §13.1.5) holds — the
 * `Range` may be honoured — against the current representation's `etag`
 * (the full field value, quotes and any `W/` included) and `lastModified`.
 * An entity tag matches only under STRONG comparison: a weak tag on either
 * side never satisfies it, so a resumed download can never be completed
 * from bytes that merely "mean the same". An HTTP-date matches when the
 * representation was not modified after it (whole seconds, the field's
 * own resolution). Anything else — a malformed value, a tag the door
 * never issued — does not hold, and the caller serves the whole
 * representation with 200: the safe outcome, since the client's partial
 * copy may be stale.
 */
export function ifRangeMatches(
  header: string,
  etag: string | null,
  lastModified: Date | null,
): boolean {
  const trimmed = header.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith('W/')) {
    if (etag === null) return false;
    if (trimmed.startsWith('W/') || etag.startsWith('W/')) return false;
    return trimmed === etag;
  }
  if (lastModified === null) return false;
  const since = Date.parse(trimmed);
  if (!Number.isFinite(since)) return false;
  const modified = lastModified.getTime();
  if (!Number.isFinite(modified)) return false;
  return Math.floor(modified / 1000) <= Math.floor(since / 1000);
}
