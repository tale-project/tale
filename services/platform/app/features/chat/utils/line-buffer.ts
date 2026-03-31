/**
 * Line Buffer — Prevent visual jumps from ambiguous markdown line starts.
 *
 * During character-by-character streaming reveal, certain line-start patterns
 * parse as one block type at partial length but become a different block type
 * when the line completes:
 *
 *   `-`  → list item    →  `---`  → thematic break (<hr>)
 *   `*`  → list/emphasis →  `***`  → thematic break
 *   `_`  → emphasis      →  `___`  → thematic break
 *   `` ` ``  → inline code   →  `` ``` ``  → fenced code block
 *   `~`  → text          →  `~~~`  → tilde code fence
 *   `=`  → text          →  `===`  → setext heading underline
 *
 * This module detects when the reveal position falls on such an ambiguous
 * partial line, allowing the animation loop to hold the display position
 * until the line resolves (a non-matching character or `\n` arrives).
 *
 * NOT buffered (confirmed unnecessary):
 *   - `#` at line start: micromark treats EOF as end-of-line, so `#` is
 *     already parsed as a heading from the first character.
 *   - Ordered list digits (`1.`): high false-positive rate, mild visual jump,
 *     word-boundary snapping already mitigates.
 */

/** Thematic break candidate: only one type of marker char (-, *, _) plus spaces/tabs. */
const THEMATIC_BREAK_RE = /^[ ]{0,3}([-*_])([ \t]*\1)*[ \t]*$/;

/** Code fence candidate: 1-2 backticks or tildes at line start (could become ``` or ~~~). */
const CODE_FENCE_RE = /^[ ]{0,3}[`~]{1,2}[ \t]*$/;

/** Setext heading underline candidate: only = chars plus spaces/tabs. */
const SETEXT_RE = /^[ ]{0,3}=+[ \t]*$/;

/**
 * Trailing empty formatting marker: the text (up to pos) ends with an opening
 * formatting marker (`**`, `*`, `~~`) that has no content after it.
 *
 * remendMarkdown Phase 1b strips these, causing a visual jump when content
 * arrives (text suddenly becomes bold/italic/strikethrough). By holding the
 * reveal before the marker, the marker and its first content character appear
 * together in the same frame.
 */
const TRAILING_MARKER_RE = /(^|[^*_~])(\*{1,2}|_{1,2}|~~)[ \t]*$/;

/**
 * Check whether the reveal position falls on a partial line whose start
 * is ambiguous in CommonMark/GFM.
 *
 * @param text        The full text being streamed
 * @param pos         The proposed reveal position (character count)
 * @param isStreaming  Whether the server is still sending text
 * @returns true if the position should be held (line is ambiguous)
 */
export function isAmbiguousPartialLine(
  text: string,
  pos: number,
  isStreaming: boolean,
): boolean {
  if (pos <= 0 || pos > text.length) return false;

  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  if (pos === lineStart) return false;

  const lineEnd = text.indexOf('\n', lineStart);

  if (lineEnd !== -1 && pos > lineEnd) return false;

  if (lineEnd === -1 && !isStreaming) return false;

  const partialLine = text.slice(lineStart, pos);

  return (
    THEMATIC_BREAK_RE.test(partialLine) ||
    CODE_FENCE_RE.test(partialLine) ||
    SETEXT_RE.test(partialLine)
  );
}

/**
 * Check whether the reveal position falls right after a trailing empty
 * formatting marker (`**`, `*`, `~~`) that has no content after it.
 *
 * When this returns true, holding the reveal prevents the marker-stripping →
 * bold-pop-in visual jump that Phase 1b of remendMarkdown causes.
 *
 * @param text        The full text being streamed
 * @param pos         The proposed reveal position (character count)
 * @param isStreaming  Whether the server is still sending text
 * @returns true if the position should be held (trailing empty marker)
 */
export function isAtTrailingEmptyMarker(
  text: string,
  pos: number,
  isStreaming: boolean,
): boolean {
  if (!isStreaming || pos <= 1 || pos > text.length) return false;

  // Only check the last few characters (marker is at most 2 chars + optional spaces)
  const windowStart = Math.max(0, pos - 10);
  const tail = text.slice(windowStart, pos);

  return TRAILING_MARKER_RE.test(tail);
}

/**
 * When the reveal position falls inside markdown link/image syntax or a
 * task-list checkbox, skip ahead to the end of that syntax so the element
 * appears atomically instead of flickering from plain text to styled element.
 *
 * - Links: `[text](url)` — skip past `)` so the `<a>` appears at once
 * - Images: `![alt](url)` — skip past `)` so the `<img>` appears at once
 * - Task checkboxes: `- [ ]` / `- [x]` — skip past `]` so the checkbox appears at once
 *
 * Only skips when the closing delimiter is available in the text (always true
 * during drain; during streaming, returns `pos` unchanged if incomplete).
 *
 * @param text  The full text
 * @param pos   The proposed reveal position
 * @returns     The adjusted position (may be > pos if skipping)
 */
export function findSyntaxSkipEnd(text: string, pos: number): number {
  if (pos <= 0 || pos >= text.length) return pos;

  // --- Task-list checkbox: - [ ] or - [x] ---
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const linePrefix = text.slice(lineStart, pos);
  if (/^\s*[-*+]\s+\[[^\]]?$/.test(linePrefix)) {
    const closingBracket = text.indexOf(']', pos);
    if (closingBracket !== -1 && closingBracket - pos <= 2) {
      // Skip past the ] and the space after it
      const afterBracket = closingBracket + 1;
      return afterBracket < text.length && text[afterBracket] === ' '
        ? afterBracket + 1
        : afterBracket;
    }
  }

  // --- Link/image: [text](url) or ![alt](url) ---
  // Strategy: scan backwards to find `](` which is the boundary between
  // link text and URL. From there, find the opening `[` and closing `)`.
  const searchStart = Math.max(0, pos - 500);

  // First, check if we're inside (url) by looking for ]( before pos
  let bracketParenPos = -1;
  for (let i = pos - 1; i >= searchStart; i--) {
    if (text[i] === '(' && i > 0 && text[i - 1] === ']') {
      bracketParenPos = i - 1; // position of ]
      break;
    }
    // Stop at ) — it closes a previous link, so we're not inside a URL
    if (text[i] === ')' || text[i] === '\n') break;
  }

  let openBracket = -1;

  if (bracketParenPos !== -1) {
    // We're inside (url). Find the matching [ before ].
    let depth = 0;
    for (let i = bracketParenPos - 1; i >= searchStart; i--) {
      if (text[i] === ']') depth++;
      else if (text[i] === '[') {
        if (depth > 0) depth--;
        else {
          openBracket = i;
          break;
        }
      }
    }
  } else {
    // We might be inside [text]. Scan backwards for unmatched [.
    let depth = 0;
    for (let i = pos - 1; i >= searchStart; i--) {
      if (text[i] === ']') depth++;
      else if (text[i] === '[') {
        if (depth > 0) depth--;
        else {
          openBracket = i;
          break;
        }
      }
    }
  }

  if (openBracket === -1) return pos;

  // Find the closing ] after the opening [
  const closeBracket = text.indexOf(']', openBracket + 1);
  if (closeBracket === -1 || closeBracket >= text.length - 1) return pos;

  // Must be followed by ( for an inline link
  if (text[closeBracket + 1] !== '(') return pos;

  // Find the matching closing )
  let parenDepth = 1;
  let j = closeBracket + 2;
  while (j < text.length && parenDepth > 0) {
    if (text[j] === '(') parenDepth++;
    else if (text[j] === ')') parenDepth--;
    j++;
  }

  if (parenDepth !== 0) return pos; // ) not found yet (still streaming)
  return j; // position after )
}
