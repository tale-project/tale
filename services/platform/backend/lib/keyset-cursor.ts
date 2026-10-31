/**
 * The keyset cursor the paginated families exchange: `<timestamp>:<id>` —
 * the previous page's last row, opaque to the consumer (the spec says
 * "pass `continueCursor` back as `cursor`"). One codec for every list that
 * orders on `(<ts>_ms DESC, id DESC)`, so no family invents its own format.
 */
export function formatKeysetCursor(at: number, id: string): string {
  return `${at}:${id}`;
}

/** The inverse of `formatKeysetCursor`: the decoded position, or null for
 * nothing / an empty string / a token that is not one of ours. The REST
 * doors read it through `readKeysetCursor`, which turns the last case into
 * a 400 — this codec itself stays lenient for callers that hold a cursor a
 * service decoded for them. */
export function parseKeysetCursor(
  raw: string | null | undefined,
): { at: number; id: string } | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const split = raw.indexOf(':');
  if (split <= 0 || split === raw.length - 1) return null;
  // The encoder writes a whole epoch-millisecond count. A fraction, an
  // exponent or a count the bigint column cannot hold is not a token this
  // list answered — and reaches Postgres as a cast error (22P02 / 22003),
  // a 500, when it is let through as a finite number.
  const stamp = raw.slice(0, split);
  if (!/^\d{1,15}$/.test(stamp)) return null;
  const at = Number(stamp);
  return Number.isSafeInteger(at) ? { at, id: raw.slice(split + 1) } : null;
}
