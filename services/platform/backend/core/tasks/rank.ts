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
 * A key after `before`, for an append to the end of a column — the hot path
 * (every created task, every status change, every drop at the bottom).
 *
 * Counts up within the key's length: base 36, carrying to the left, the
 * last digit running 1–z so no key ends in 0 (see the post-condition of
 * {@link rankBetween}). Only a key made entirely of `z` has nothing of its
 * length above it; it is extended by a block as long as itself. So n
 * appends need O(log n) digits — under a million appends stay within 16 —
 * where a midpoint walk towards the alphabet's end grows a digit every few
 * appends and a busy column's keys reach kilobytes (bigger rows, bigger
 * index entries, bigger board reads, and eventually more than a B-tree
 * entry may hold). Same-length keys order numerically, a longer key with a
 * smaller digit still sorts below, so counted keys interleave with every
 * key already stored.
 */
function rankAfter(before: string): string {
  const digits = Array.from(before, charIndex);
  const last = digits.length - 1;
  for (let i = last; i >= 0; i -= 1) {
    const digit = digits[i] ?? 0;
    if (digit < BASE - 1) {
      digits[i] = digit + 1;
      // Every digit right of the increment was z and wraps to its floor.
      for (let j = i + 1; j <= last; j += 1) digits[j] = j === last ? 1 : 0;
      return digits.map((d) => ALPHABET[d]).join('');
    }
  }
  const block =
    before.length < 2
      ? MID_CHAR
      : `${MID_CHAR}${'0'.repeat(before.length - 2)}1`;
  return `${before}${block}`;
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
  if (after == null && before != null) {
    result = rankAfter(before);
    if (result <= before) {
      throw new Error(`rankBetween: no key after ${before}`);
    }
    return result;
  }
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
