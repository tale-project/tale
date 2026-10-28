/**
 * Clause boundaries — the single source of truth for where a streamed prose
 * segment ends.
 *
 * Two consumers MUST agree on these positions:
 *  - the platform stream buffer (`reveal-segment.ts`), which decides how many
 *    characters to reveal per step, and
 *  - `rehype-reveal-segments`, which splits rendered text into the
 *    `.stream-seg` spans that carry the mount fade.
 *
 * If they disagree, a reveal step can land INSIDE an existing span: the new
 * text then grows in place without a mount animation — visible as "the last
 * word of a segment pops in separately" and as partial re-fades. Keeping one
 * scanner here makes every reveal step boundary a span boundary.
 */

/** ASCII clause separators — end a segment when followed by whitespace. */
const CLAUSE_SEPARATORS = new Set([',', '.', ':', ';', '!', '?']);

/** Fullwidth CJK punctuation ends a clause directly — CJK prose has no
 *  whitespace after punctuation, so no following-space requirement. */
const CJK_SEPARATORS = new Set(['、', '。', '，', '！', '？', '；', '：']);

/** Max chars a prose segment may span when no separator appears. */
export const MAX_SEGMENT_CHARS = 48;

/**
 * Find the end of the clause starting at `from`: the next separator boundary
 * (ASCII separator + trailing whitespace run, fullwidth CJK punctuation, or
 * newline), or a word-boundary cut once the segment exceeds
 * MAX_SEGMENT_CHARS. Returns -1 when no boundary exists before the end of
 * the text — the caller decides whether to hold (still streaming) or flush
 * (drain / final split).
 */
export function findClauseEnd(text: string, from: number): number {
  let lastWordBoundary = -1;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') return i + 1;
    if (c === ' ' || c === '\t') lastWordBoundary = i;

    if (CJK_SEPARATORS.has(c)) return i + 1;

    if (CLAUSE_SEPARATORS.has(c)) {
      const next = text[i + 1];
      // A separator only ends a clause when followed by whitespace — keeps
      // numbers ("3.14", "1,000"), URLs and version strings intact.
      if (next === ' ' || next === '\t') {
        let j = i + 1;
        while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
        return j;
      }
      if (next === '\n') return i + 1;
    }

    if (i - from + 1 >= MAX_SEGMENT_CHARS) {
      // No separator within the cap: prefer breaking after the last word
      // boundary so the cut never lands mid-word; hard-cut as a last resort.
      if (lastWordBoundary > from) return lastWordBoundary + 1;
      return i + 1;
    }
  }
  return -1;
}

/**
 * Split `value` into clause chunks at exactly the `findClauseEnd` positions.
 * Concatenating the chunks reproduces the input.
 */
export function splitClauseChunks(value: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    const end = findClauseEnd(value, start);
    if (end === -1 || end <= start) {
      chunks.push(value.slice(start));
      break;
    }
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}
