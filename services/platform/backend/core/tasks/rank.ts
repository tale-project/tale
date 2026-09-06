/**
 * Lexicographic fractional ranking ("LexoRank"-style) for board ordering.
 *
 * A task carries a string `rank`; tasks in a column are ordered by ascending
 * lexicographic comparison of `rank`. Inserting between two neighbours computes
 * a key strictly between them, so a drag-reorder is an O(1) single-row write
 * rather than renumbering the whole column.
 *
 * Pure functions only — fully unit-tested in `rank.test.ts`. Keys use the
 * lowercase base-36 alphabet `0-9a-z`, whose ASCII ordering is lexicographic,
 * so Convex index range scans on `['projectId','status','rank']` stay valid.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length;
/** Midpoint digit used to seed the first key (\"i\" ≈ middle of the alphabet). */
const MID_CHAR = ALPHABET[Math.floor(BASE / 2)];

function charIndex(ch: string): number {
  const idx = ALPHABET.indexOf(ch);
  // Treat any out-of-alphabet char as the floor so a malformed key degrades
  // predictably rather than throwing mid-drag.
  return idx === -1 ? 0 : idx;
}

/** First rank for an empty column. */
export function initialRank(): string {
  return MID_CHAR;
}

/**
 * Compute a key strictly between `before` and `after` (lexicographically).
 *
 * - `rankBetween(undefined, undefined)` → {@link initialRank}.
 * - `rankBetween(a, undefined)` → a key after `a` (append/end of column).
 * - `rankBetween(undefined, b)` → a key before `b` (prepend/start of column).
 * - `rankBetween(a, b)` with `a < b` → a key `r` with `a < r < b`.
 *
 * Throws if `before >= after` (caller bug; columns must pass ordered neighbours).
 */
export function rankBetween(before?: string, after?: string): string {
  if (before == null && after == null) return initialRank();
  if (before != null && after != null && before >= after) {
    throw new Error(
      `rankBetween: before (${before}) must be < after (${after})`,
    );
  }

  let result = '';
  let i = 0;
  // Walk digit positions, choosing a digit strictly between the bounds. When a
  // gap exists at the current position we pick its midpoint and stop; otherwise
  // we copy the matching prefix digit and descend.
  for (;;) {
    const lo = before != null && i < before.length ? charIndex(before[i]) : 0;
    const hi = after != null && i < after.length ? charIndex(after[i]) : BASE;

    if (lo === hi) {
      // Digits identical here — copy and descend.
      result += ALPHABET[lo];
      i += 1;
      continue;
    }

    const mid = Math.floor((lo + hi) / 2);
    if (mid > lo) {
      result += ALPHABET[mid];
      break;
    }

    // Adjacent digits (hi === lo + 1): no room here. Keep the lower bound's
    // digit and descend into the fractional space below `after`.
    result += ALPHABET[lo];
    i += 1;
  }

  // Post-condition. The midpoint walk can land *outside* the open interval when
  // `after` ends in the minimum digit — e.g. no string sorts strictly between
  // 'a' and 'a0', so the walk would otherwise return 'a0…' (> after). Keys this
  // function generates never end in '0', so this only fires on corrupted or
  // externally-supplied ranks; surfacing it lets callers fall back to an
  // end-of-column or rebalanced rank instead of persisting an out-of-order key.
  if (
    (before != null && result <= before) ||
    (after != null && result >= after)
  ) {
    throw new Error(
      `rankBetween: no key strictly between ${String(before)} and ${String(after)}`,
    );
  }
  return result;
}
