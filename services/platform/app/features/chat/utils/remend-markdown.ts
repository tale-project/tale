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
 *   - Headings, blockquotes, lists, tables — don't need closing syntax
 */

type FormattingMarker = '*' | '**' | '~~';

export function remendMarkdown(text: string): string {
  if (!text) return text;

  const len = text.length;

  // State
  let context: 'normal' | 'fenced_code' | 'inline_code' = 'normal';
  let fenceBacktickCount = 0;
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
      if (atLineStart && ch === '`') {
        let count = 0;
        while (i < len && text[i] === '`') {
          count++;
          i++;
        }
        if (count >= fenceBacktickCount) {
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
        fenceBacktickCount = count;
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

    // Tilde — strikethrough (~~)
    if (ch === '~' && i + 1 < len && text[i + 1] === '~') {
      i += 2;
      atLineStart = false;
      const topIdx = formattingStack.lastIndexOf('~~');
      if (topIdx !== -1) {
        formattingStack.splice(topIdx, 1);
      } else {
        formattingStack.push('~~');
      }
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

  // Phase 2: Build suffix from open state
  let suffix = '';

  if (context === 'inline_code') {
    suffix += '`'.repeat(inlineCodeBacktickCount);
  }

  if (context === 'normal' || context === 'inline_code') {
    for (let j = formattingStack.length - 1; j >= 0; j--) {
      suffix += formattingStack[j];
    }
  }

  if (context === 'fenced_code') {
    suffix += '\n' + '`'.repeat(fenceBacktickCount);
  }

  return suffix ? result + suffix : result;
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
