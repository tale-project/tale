/**
 * Reveal Segments — Gemini-style chunked typewriter boundaries.
 *
 * The stream buffer no longer reveals one character per tick; it reveals one
 * SEGMENT per tick (pacing still charged per character, so the overall rate
 * is unchanged). This module decides where a segment ends:
 *
 *   - Prose: at the next clause separator (`, . : ; ! ?` followed by
 *     whitespace) or at the end of the line — so words appear in readable
 *     parts, never letter by letter.
 *   - Fenced code: at the next newline — code reveals line by line.
 *   - Tables (`|`-prefixed lines): at the next newline — row by row.
 *
 * While the server is still streaming, an incomplete clause/line is HELD
 * (returns `from`, no progress) so a partial part never flashes in and then
 * grows awkwardly; the drain phase (stream ended) always reveals through to
 * the end. A hard cap bounds segments when no separator shows up (e.g. long
 * unpunctuated runs), snapping back to the last word boundary.
 */

/** Clause separators that end a prose segment when followed by whitespace. */
const CLAUSE_SEPARATORS = new Set([',', '.', ':', ';', '!', '?']);

/** Fullwidth CJK punctuation ends a clause directly — CJK prose has no
 *  whitespace after punctuation, so no following-space requirement. */
const CJK_SEPARATORS = new Set(['、', '。', '，', '！', '？', '；', '：']);

/** Max chars a prose segment may span when no separator appears. */
export const MAX_SEGMENT_CHARS = 48;

/**
 * Whether `pos` sits inside a fenced code block. Counts fence-opening lines
 * (``` or ~~~ at up to 3 spaces of indent) before `pos`; odd count = inside.
 * Cheap parity approximation — good enough for reveal pacing (the markdown
 * parser, not this, decides actual rendering).
 */
export function isInsideCodeFence(text: string, pos: number): boolean {
  let count = 0;
  let lineStart = 0;
  while (lineStart < pos) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1 || lineEnd > pos) lineEnd = pos;
    // Up to 3 spaces of indent, then at least 3 backticks or tildes.
    let i = lineStart;
    while (i < lineEnd && text[i] === ' ' && i - lineStart < 3) i++;
    const marker = text[i];
    if (marker === '`' || marker === '~') {
      let run = 0;
      while (i + run < lineEnd && text[i + run] === marker) run++;
      if (run >= 3) count++;
    }
    if (lineEnd >= pos) break;
    lineStart = lineEnd + 1;
  }
  return count % 2 === 1;
}

/** Whether the line containing `pos` is a markdown table row (starts with `|`). */
function isTableLine(text: string, pos: number): boolean {
  const lineStart = text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
  let i = lineStart;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return text[i] === '|';
}

/** Segment end for line-oriented content (code lines, table rows): the next
 *  newline, inclusive. Incomplete lines hold while streaming. */
function findLineEnd(text: string, from: number, isStreaming: boolean): number {
  const nl = text.indexOf('\n', from);
  if (nl !== -1) return nl + 1;
  return isStreaming ? from : text.length;
}

/**
 * Find the end of the next reveal segment starting at `from`.
 *
 * Returns a position > `from` when a complete segment is available, or `from`
 * itself to signal "hold" (mid-clause/mid-line while the stream is still
 * delivering). Never returns a position past `text.length`.
 */
export function findRevealSegmentEnd(
  text: string,
  from: number,
  isStreaming: boolean,
): number {
  if (from >= text.length) return from;

  if (isInsideCodeFence(text, from) || isTableLine(text, from)) {
    return findLineEnd(text, from, isStreaming);
  }

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
      if (i + 1 === text.length && !isStreaming) return text.length;
    }

    if (i - from + 1 >= MAX_SEGMENT_CHARS) {
      // No separator within the cap: prefer breaking after the last word
      // boundary so the cut never lands mid-word; hard-cut as a last resort.
      if (lastWordBoundary > from) return lastWordBoundary + 1;
      return i + 1;
    }
  }

  // Reached the end of the buffered text without a boundary. While streaming,
  // hold — the rest of the clause is still on its way. After the stream ends
  // (drain), reveal everything that's left.
  return isStreaming ? from : text.length;
}
