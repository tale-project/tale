/**
 * remendMarkdown — Auto-complete incomplete markdown syntax for flicker-free streaming.
 *
 * During LLM streaming, partially-revealed markdown (unclosed backticks, bold markers,
 * code fences) causes react-markdown to oscillate between different parse trees on
 * consecutive frames. This function produces a structurally stable result so the parser
 * always generates consistent DOM.
 *
 * Algorithm: single forward pass with a small state machine tracking:
 *   - Fenced code block context (``` ... ```)
 *   - Inline code context (` ... `)
 *   - Open formatting markers (*, **, ~~) in a LIFO stack
 *   - Last unmatched [ position for link/image detection
 *
 * Guarantees:
 *   - Idempotent on well-formed markdown (no-op when all syntax is balanced)
 *   - O(n) single pass, no regex backtracking
 *   - Escaped characters (\*, \`) are respected
 *   - Code block/span content is opaque (no formatting tracked inside)
 *   - Incomplete links show display text only (no raw markdown syntax)
 *   - Incomplete images are removed entirely (no broken image placeholders)
 *
 * Does NOT handle (by design):
 *   - HTML tags — rehype-sanitize handles safety; string-level closing risks mXSS
 *   - Headings, blockquotes, lists — don't need closing syntax
 */

type FormattingMarker = '*' | '**' | '~~';

export function remendMarkdown(text: string): string {
  if (!text) return text;

  const len = text.length;

  // State
  let context: 'normal' | 'fenced_code' | 'inline_code' = 'normal';
  let fenceChar = '';
  let fenceCount = 0;
  let inlineCodeBacktickCount = 0;
  const formattingStack: FormattingMarker[] = [];

  // Link tracking: position of last unmatched '[' in normal context.
  // -1 means no open bracket. Resets when a complete link is found.
  let lastOpenBracket = -1;
  // Whether the '[' is preceded by '!' (image syntax)
  let lastOpenBracketIsImage = false;

  // Track whether we're at the start of a line (for fenced code detection)
  let atLineStart = true;

  let i = 0;
  while (i < len) {
    const ch = text[i];

    if (context === 'fenced_code') {
      // Inside a fenced code block — only look for closing fence
      if (atLineStart && ch === fenceChar) {
        let count = 0;
        while (i < len && text[i] === fenceChar) {
          count++;
          i++;
        }
        if (count >= fenceCount) {
          context = 'normal';
          atLineStart = false;
          continue;
        }
        if (i < len && text[i] === '\n') {
          atLineStart = true;
          i++;
        } else {
          atLineStart = false;
          while (i < len && text[i] !== '\n') i++;
          if (i < len) {
            atLineStart = true;
            i++;
          }
        }
        continue;
      }

      if (ch === '\n') {
        atLineStart = true;
      } else {
        atLineStart = false;
      }
      i++;
      continue;
    }

    if (context === 'inline_code') {
      if (ch === '`') {
        let count = 0;
        while (i < len && text[i] === '`') {
          count++;
          i++;
        }
        if (count === inlineCodeBacktickCount) {
          context = 'normal';
        }
        continue;
      }
      i++;
      continue;
    }

    // context === 'normal'

    // Escaped character — skip next
    if (ch === '\\' && i + 1 < len) {
      i += 2;
      atLineStart = false;
      continue;
    }

    // Backticks — could be fenced code block or inline code
    if (ch === '`') {
      let count = 0;
      while (i < len && text[i] === '`') {
        count++;
        i++;
      }

      if (count >= 3 && atLineStart) {
        context = 'fenced_code';
        fenceChar = '`';
        fenceCount = count;
        while (i < len && text[i] !== '\n') i++;
        if (i < len) {
          atLineStart = true;
          i++;
        }
        continue;
      }

      context = 'inline_code';
      inlineCodeBacktickCount = count;
      atLineStart = false;
      continue;
    }

    // Open bracket — potential link/image start
    if (ch === '[') {
      lastOpenBracketIsImage = i > 0 && text[i - 1] === '!';
      lastOpenBracket = lastOpenBracketIsImage ? i - 1 : i;
      i++;
      atLineStart = false;
      continue;
    }

    // Close bracket — check if this is part of a link [text](url) or
    // just a standalone bracket (e.g., task list checkbox `- [ ]`).
    // If ] is NOT followed by (, it's not a link — reset tracking.
    if (ch === ']' && lastOpenBracket !== -1) {
      if (i + 1 < len && text[i + 1] === '(') {
        // ] followed by ( — this is the [text]( boundary of a link.
        // Don't reset; let the ) handler below complete the link.
      } else {
        // ] NOT followed by ( — not a link (e.g., task list, standalone brackets).
        lastOpenBracket = -1;
        lastOpenBracketIsImage = false;
      }
      i++;
      atLineStart = false;
      continue;
    }

    // Close bracket + parenthesized URL — complete link
    if (ch === ')' && lastOpenBracket !== -1) {
      // Check if this closes a ](... pattern
      // Find the ] before this )
      const closeParenPos = i;
      let j = closeParenPos - 1;
      // Walk back to find matching '('
      let parenDepth = 1;
      while (j > lastOpenBracket && parenDepth > 0) {
        if (text[j] === '(') parenDepth--;
        else if (text[j] === ')') parenDepth++;
        if (parenDepth > 0) j--;
      }
      // j is now at '(' — check if preceded by ']'
      if (
        j > lastOpenBracket &&
        parenDepth === 0 &&
        j > 0 &&
        text[j - 1] === ']'
      ) {
        // Complete link found — reset tracking
        lastOpenBracket = -1;
        lastOpenBracketIsImage = false;
      }
      i++;
      atLineStart = false;
      continue;
    }

    // Tilde — fenced code block (~~~+) or strikethrough (~~)
    if (ch === '~') {
      let count = 0;
      while (i < len && text[i] === '~') {
        count++;
        i++;
      }

      if (count >= 3 && atLineStart) {
        context = 'fenced_code';
        fenceChar = '~';
        fenceCount = count;
        while (i < len && text[i] !== '\n') i++;
        if (i < len) {
          atLineStart = true;
          i++;
        }
        continue;
      }

      let remaining = count;
      while (remaining >= 2) {
        const topIdx = formattingStack.lastIndexOf('~~');
        if (topIdx !== -1) {
          formattingStack.splice(topIdx, 1);
        } else {
          formattingStack.push('~~');
        }
        remaining -= 2;
      }
      atLineStart = false;
      continue;
    }

    // Asterisk — bold (**) or italic (*)
    if (ch === '*') {
      let count = 0;
      while (i < len && text[i] === '*') {
        count++;
        i++;
      }
      atLineStart = false;

      let remaining = count;
      while (remaining > 0) {
        if (remaining >= 2) {
          const boldIdx = formattingStack.lastIndexOf('**');
          if (boldIdx !== -1) {
            formattingStack.splice(boldIdx, 1);
          } else {
            formattingStack.push('**');
          }
          remaining -= 2;
        } else {
          const italicIdx = formattingStack.lastIndexOf('*');
          if (italicIdx !== -1) {
            formattingStack.splice(italicIdx, 1);
          } else {
            formattingStack.push('*');
          }
          remaining -= 1;
        }
      }
      continue;
    }

    if (ch === '\n') {
      atLineStart = true;
    } else {
      atLineStart = false;
    }
    i++;
  }

  // Phase 1: Handle trailing incomplete link/image (only in normal context)
  let result = text;
  if (context === 'normal' && lastOpenBracket !== -1) {
    result = stripIncompleteLink(
      result,
      lastOpenBracket,
      lastOpenBracketIsImage,
    );
  }

  // Phase 1b: Strip trailing formatting markers with no content after them.
  // CommonMark requires non-whitespace content between emphasis delimiters;
  // empty markers (e.g. `the **`) would render as literal asterisks.
  if (context === 'normal') {
    while (formattingStack.length > 0) {
      const last = formattingStack[formattingStack.length - 1];
      const trimmed = result.trimEnd();
      if (trimmed.endsWith(last)) {
        result = result.slice(0, trimmed.lastIndexOf(last));
        formattingStack.pop();
      } else {
        break;
      }
    }
  }

  // Phase 1c: Relocate trailing whitespace past closing markers.
  // CommonMark requires closing emphasis delimiters to be preceded by
  // non-whitespace. "**text **" is invalid — the space before "**"
  // prevents it from being a right-flanking delimiter run, so the
  // parser renders literal asterisks instead of bold. Moving the
  // whitespace to after the closing markers produces valid emphasis:
  // "**text** " (bold "text" + trailing space).
  let trailingWhitespace = '';
  if (context === 'normal' && formattingStack.length > 0) {
    const wsMatch = result.match(/(\s+)$/);
    if (wsMatch) {
      trailingWhitespace = wsMatch[1];
      result = result.slice(0, -trailingWhitespace.length);
    }
  }

  // Phase 2: Build formatting suffix from open markers
  let formattingSuffix = '';
  if (context === 'normal' || context === 'inline_code') {
    for (let j = formattingStack.length - 1; j >= 0; j--) {
      formattingSuffix += formattingStack[j];
    }
    formattingSuffix += trailingWhitespace;
  }

  // Phase 3: Auto-complete incomplete GFM tables (only outside code blocks)
  // Pass formatting suffix so it lands inside cells, not after the row closer.
  if (context === 'normal') {
    const tableResult = remendTable(result, formattingSuffix);
    result = tableResult.text;
    if (tableResult.consumed) formattingSuffix = '';
  }

  // Phase 3b: Build final suffix from remaining parts
  let suffix = '';
  if (context === 'inline_code') {
    suffix += '`'.repeat(inlineCodeBacktickCount);
  }
  suffix += formattingSuffix;
  if (context === 'fenced_code') {
    suffix += '\n' + fenceChar.repeat(fenceCount);
  }

  // Phase 4: Strip trailing incomplete HTML tag (only outside code blocks)
  // Prevents partial tags like `<details` from rendering as literal text.
  // Does NOT close/complete tags — only strips the incomplete fragment.
  if (context === 'normal') {
    result = result.replace(/<\/?[a-zA-Z][^>\n]*$|<\/?$/, '');
  }

  // Phase 5: Auto-close unclosed <details> element
  // Runs for ALL contexts — when inside a code block, the suffix already
  // closes the fence first, so appending </details> after is correct.
  // Uses \n to ensure </details> is on its own line (HTML block parsing).
  {
    const lastDetails = result.lastIndexOf('<details');
    if (lastDetails !== -1 && !result.includes('</details>', lastDetails)) {
      const textBefore = result.slice(0, lastDetails);
      const fenceLines = (textBefore.match(/^`{3,}/gm) || []).length;
      if (fenceLines % 2 === 0) {
        const detailsContent = result.slice(lastDetails);
        if (detailsContent.includes('</summary>')) {
          suffix += '\n</details>';
        } else {
          result = result.slice(0, lastDetails);
        }
      }
    }
  }

  return suffix ? result + suffix : result;
}

/**
 * Count columns in a GFM table row by counting pipe-delimited cells.
 * `| A | B |` → 2 columns.
 */
function countTableColumns(row: string): number {
  const trimmed = row.trim();
  // Split by | and filter: leading/trailing empty segments from outer pipes
  const cells = trimmed.split('|').filter((_, i, arr) => {
    if (i === 0 && arr[i].trim() === '') return false;
    if (i === arr.length - 1 && arr[i].trim() === '') return false;
    return true;
  });
  return cells.length;
}

/**
 * Check whether a line looks like a GFM separator row (e.g. `|---|---|`).
 * A complete separator has at least one `---` cell per column.
 */
const SEPARATOR_RE = /^\|[\s:]*-{3,}[\s:]*\|/;

function isCompleteSeparator(line: string, expectedCols: number): boolean {
  if (!SEPARATOR_RE.test(line)) return false;
  return countTableColumns(line) >= expectedCols;
}

/**
 * Generate a GFM separator row for a given column count.
 * e.g. cols=3 → `| - | - | - |`
 */
function makeSeparator(cols: number): string {
  return '| ' + Array.from({ length: cols }, () => '-').join(' | ') + ' |';
}

/**
 * Auto-complete an incomplete GFM table at the end of the text.
 *
 * GFM requires header + separator to parse as a table. During streaming
 * the separator may be missing or partial, causing raw `| A | B |` text.
 *
 * Cases handled:
 *   1. Header only (no separator)  → append separator
 *   2. Header + partial separator  → replace partial with complete separator
 *   3. Header + separator + incomplete data row → close the row with `|`
 */
function remendTable(
  text: string,
  formattingSuffix = '',
): { text: string; consumed: boolean } {
  // Find the last block boundary (double newline or start of text)
  const blockStart = text.lastIndexOf('\n\n');
  const block = blockStart === -1 ? text : text.slice(blockStart + 2);

  // Quick check: does this block look like a table at all?
  if (!block.startsWith('|')) return { text, consumed: false };

  const lines = block.split('\n');
  if (lines.length === 0) return { text, consumed: false };

  const headerLine = lines[0];
  // Must have at least `| x |` pattern (2+ pipes)
  if ((headerLine.match(/\|/g) || []).length < 2)
    return { text, consumed: false };

  const cols = countTableColumns(headerLine);
  if (cols === 0) return { text, consumed: false };

  const prefix = blockStart === -1 ? '' : text.slice(0, blockStart + 2);

  if (lines.length === 1) {
    // Case 1: Header only — close formatting in last cell if needed, then append separator
    let closedHeader = headerLine;
    let consumed = false;
    if (!headerLine.trimEnd().endsWith('|')) {
      closedHeader = headerLine + formattingSuffix + ' |';
      consumed = true;
    }
    const finalCols = countTableColumns(closedHeader);
    return {
      text: prefix + closedHeader + '\n' + makeSeparator(finalCols),
      consumed,
    };
  }

  const secondLine = lines[1];

  if (!isCompleteSeparator(secondLine, cols)) {
    // Case 2: Partial or missing separator — replace second line
    const rest = lines.slice(2);
    return {
      text:
        prefix +
        headerLine +
        '\n' +
        makeSeparator(cols) +
        (rest.length > 0 ? '\n' + rest.join('\n') : ''),
      consumed: false,
    };
  }

  // Separator is complete. Check if the last data row is incomplete.
  if (lines.length >= 3) {
    const lastLine = lines[lines.length - 1];
    if (lastLine.startsWith('|') && !lastLine.trimEnd().endsWith('|')) {
      // Case 3: Incomplete data row — close formatting inside the cell, then close the row
      return { text: text + formattingSuffix + ' |', consumed: true };
    }
  }

  return { text, consumed: false };
}

/**
 * Strip trailing incomplete link/image syntax and extract display text.
 *
 * For links: `[display text](partial-url` → `display text`
 * For images: `![alt](partial-url` → `` (removed entirely)
 */
function stripIncompleteLink(
  text: string,
  openPos: number,
  isImage: boolean,
): string {
  const before = text.slice(0, openPos);
  const linkPart = text.slice(openPos);

  if (isImage) {
    // Incomplete image — remove entirely to avoid broken image placeholder
    return before;
  }

  // Extract display text from [text]... or [text... patterns
  const bracketClose = linkPart.indexOf(']');
  if (bracketClose !== -1) {
    // [text]( or [text](url — extract text between [ and ]
    // +1 to skip the leading '[' (or '![')
    const displayText = linkPart.slice(1, bracketClose);
    return before + displayText;
  }

  // [text (no closing bracket yet) — extract everything after [
  const displayText = linkPart.slice(1);
  return before + displayText;
}
