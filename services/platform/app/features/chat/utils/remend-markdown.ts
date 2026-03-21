/**
 * remendMarkdown — Auto-complete incomplete markdown syntax for flicker-free streaming.
 *
 * During LLM streaming, partially-revealed markdown (unclosed backticks, bold markers,
 * code fences) causes react-markdown to oscillate between different parse trees on
 * consecutive frames. This function appends minimal closing tokens so the parser
 * always produces a structurally stable result.
 *
 * Algorithm: single forward pass with a small state machine tracking:
 *   - Fenced code block context (``` ... ```)
 *   - Inline code context (` ... `)
 *   - Open formatting markers (*, **, ~~) in a LIFO stack
 *
 * Guarantees:
 *   - Idempotent on well-formed markdown (no-op when all syntax is balanced)
 *   - Only appends at end of string, never modifies content
 *   - O(n) single pass, no regex backtracking
 *   - Escaped characters (\*, \`) are respected
 *   - Code block/span content is opaque (no formatting tracked inside)
 *
 * Does NOT handle (by design):
 *   - Links/images — parser treats unclosed [ as plain text, which is correct
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

  // Track whether we're at the start of a line (for fenced code detection)
  let atLineStart = true;

  let i = 0;
  while (i < len) {
    const ch = text[i];

    if (context === 'fenced_code') {
      // Inside a fenced code block — only look for closing fence
      if (atLineStart && ch === '`') {
        // Count consecutive backticks
        let count = 0;
        while (i < len && text[i] === '`') {
          count++;
          i++;
        }
        if (count >= fenceBacktickCount) {
          // Closing fence found
          context = 'normal';
          atLineStart = false;
          continue;
        }
        // Not enough backticks — stay in fenced code
        // Check if we ended on a newline
        if (i < len && text[i] === '\n') {
          atLineStart = true;
          i++;
        } else {
          atLineStart = false;
          // Skip to end of line
          while (i < len && text[i] !== '\n') i++;
          if (i < len) {
            atLineStart = true;
            i++;
          }
        }
        continue;
      }

      // Track line starts
      if (ch === '\n') {
        atLineStart = true;
      } else {
        atLineStart = false;
      }
      i++;
      continue;
    }

    if (context === 'inline_code') {
      // Inside inline code — only look for matching backtick sequence
      if (ch === '`') {
        let count = 0;
        while (i < len && text[i] === '`') {
          count++;
          i++;
        }
        if (count === inlineCodeBacktickCount) {
          context = 'normal';
        }
        // Non-matching backtick sequence — literal content, continue
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

      // Fenced code block: 3+ backticks at start of line
      if (count >= 3 && atLineStart) {
        context = 'fenced_code';
        fenceBacktickCount = count;
        // Skip to end of line (language info)
        while (i < len && text[i] !== '\n') i++;
        if (i < len) {
          atLineStart = true;
          i++;
        }
        continue;
      }

      // Inline code: 1+ backticks not at line start (or < 3 at line start)
      context = 'inline_code';
      inlineCodeBacktickCount = count;
      atLineStart = false;
      continue;
    }

    // Tilde — strikethrough (~~)
    if (ch === '~' && i + 1 < len && text[i + 1] === '~') {
      i += 2;
      atLineStart = false;

      // Pop if matching top of stack, otherwise push
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

      // Process asterisk runs: handle ** and * markers
      let remaining = count;
      while (remaining > 0) {
        if (remaining >= 2) {
          // Try to match ** with stack
          const boldIdx = formattingStack.lastIndexOf('**');
          if (boldIdx !== -1) {
            formattingStack.splice(boldIdx, 1);
          } else {
            formattingStack.push('**');
          }
          remaining -= 2;
        } else {
          // Single *
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

    // Track line starts
    if (ch === '\n') {
      atLineStart = true;
    } else {
      atLineStart = false;
    }
    i++;
  }

  // Build suffix from open state
  let suffix = '';

  if (context === 'inline_code') {
    suffix += '`'.repeat(inlineCodeBacktickCount);
  }

  if (context === 'normal' || context === 'inline_code') {
    // Close formatting in reverse order (LIFO)
    for (let j = formattingStack.length - 1; j >= 0; j--) {
      suffix += formattingStack[j];
    }
  }

  if (context === 'fenced_code') {
    suffix += '\n' + '`'.repeat(fenceBacktickCount);
  }

  return suffix ? text + suffix : text;
}
