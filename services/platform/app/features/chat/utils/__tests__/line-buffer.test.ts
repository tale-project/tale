import { describe, it, expect } from 'vitest';

import {
  findSyntaxSkipEnd,
  isAmbiguousPartialLine,
  isAtTrailingEmptyMarker,
} from '../line-buffer';

// ============================================================================
// PASS-THROUGH — returns false (no buffering)
// ============================================================================

describe('pass-through (not ambiguous)', () => {
  it('returns false for pos at 0', () => {
    expect(isAmbiguousPartialLine('---', 0, true)).toBe(false);
  });

  it('returns false for pos at text.length when not streaming', () => {
    expect(isAmbiguousPartialLine('---', 3, false)).toBe(false);
  });

  it('returns true for pos at text.length when streaming (more text may come)', () => {
    expect(isAmbiguousPartialLine('---', 3, true)).toBe(true);
  });

  it('returns false for pos beyond text.length', () => {
    expect(isAmbiguousPartialLine('---', 5, true)).toBe(false);
  });

  it('returns false for empty text', () => {
    expect(isAmbiguousPartialLine('', 0, true)).toBe(false);
  });

  it('returns false for normal text mid-reveal', () => {
    expect(isAmbiguousPartialLine('Hello world', 5, true)).toBe(false);
  });

  it('returns false for pos at line boundary', () => {
    // pos=6 is right after \n, at start of next line — no partial content
    expect(isAmbiguousPartialLine('Hello\n---', 6, true)).toBe(false);
  });

  it('returns false for pos past complete line', () => {
    // pos=10 is past the \n after ---, on the next line
    expect(isAmbiguousPartialLine('Hello\n---\nMore', 10, true)).toBe(false);
  });

  it('returns false for # at line start (heading, not ambiguous)', () => {
    expect(isAmbiguousPartialLine('Hello\n# ', 7, true)).toBe(false);
  });

  it('returns false for ## at line start', () => {
    expect(isAmbiguousPartialLine('Hello\n## Title', 8, true)).toBe(false);
  });

  it('returns false for > at line start (blockquote)', () => {
    expect(isAmbiguousPartialLine('Hello\n> quote', 7, true)).toBe(false);
  });

  it('returns false for escaped dash (backslash not in marker set)', () => {
    expect(isAmbiguousPartialLine('Hello\n\\---', 7, true)).toBe(false);
  });

  it('returns false for - followed by text (non-marker char breaks pattern)', () => {
    // pos=9 reveals "- t" — the "t" breaks the thematic break pattern
    expect(isAmbiguousPartialLine('Hello\n- text', 9, true)).toBe(false);
  });

  it('returns false for non-streaming with partial -- at end', () => {
    // Stream ended — the line is "complete" even without \n
    expect(isAmbiguousPartialLine('Hello\n--', 8, false)).toBe(false);
  });

  it('returns false for 4-space indent (indented code, not block-level)', () => {
    expect(isAmbiguousPartialLine('Hello\n    -', 11, true)).toBe(false);
  });

  it('returns false for mixed markers (- * is not a valid thematic break)', () => {
    expect(isAmbiguousPartialLine('Hello\n- *', 9, true)).toBe(false);
  });

  it('returns false for digit at line start (ordered list not buffered)', () => {
    expect(isAmbiguousPartialLine('Hello\n1. item', 7, true)).toBe(false);
  });

  it('returns false for complete thematic break line followed by content', () => {
    // pos=10 is past \n, on "More" line
    expect(isAmbiguousPartialLine('Hello\n---\nMore', 11, true)).toBe(false);
  });

  it('returns false for 3+ backticks (already a fence, no longer ambiguous)', () => {
    expect(isAmbiguousPartialLine('Hello\n```py', 10, true)).toBe(false);
  });

  it('returns false for 3+ tildes (already a fence)', () => {
    expect(isAmbiguousPartialLine('Hello\n~~~py', 10, true)).toBe(false);
  });
});

// ============================================================================
// AMBIGUOUS — returns true (should hold display position)
// ============================================================================

describe('ambiguous (should buffer)', () => {
  // --- Thematic break candidates ---

  it('buffers single dash at line start', () => {
    expect(isAmbiguousPartialLine('Hello\n-', 7, true)).toBe(true);
  });

  it('buffers double dash', () => {
    expect(isAmbiguousPartialLine('Hello\n--', 8, true)).toBe(true);
  });

  it('buffers triple dash (still streaming, no \\n yet)', () => {
    expect(isAmbiguousPartialLine('Hello\n---', 9, true)).toBe(true);
  });

  it('buffers spaced thematic break candidate: "- -"', () => {
    expect(isAmbiguousPartialLine('Hello\n- -', 9, true)).toBe(true);
  });

  it('buffers spaced thematic break candidate: "- - "', () => {
    expect(isAmbiguousPartialLine('Hello\n- - ', 10, true)).toBe(true);
  });

  it('buffers single asterisk at line start', () => {
    expect(isAmbiguousPartialLine('Hello\n*', 7, true)).toBe(true);
  });

  it('buffers double asterisk at line start', () => {
    expect(isAmbiguousPartialLine('Hello\n**', 8, true)).toBe(true);
  });

  it('buffers spaced asterisk thematic break: "* *"', () => {
    expect(isAmbiguousPartialLine('Hello\n* *', 9, true)).toBe(true);
  });

  it('buffers single underscore at line start', () => {
    expect(isAmbiguousPartialLine('Hello\n_', 7, true)).toBe(true);
  });

  it('buffers double underscore', () => {
    expect(isAmbiguousPartialLine('Hello\n__', 8, true)).toBe(true);
  });

  it('buffers spaced underscore thematic break: "_ _"', () => {
    expect(isAmbiguousPartialLine('Hello\n_ _', 9, true)).toBe(true);
  });

  it('buffers very long thematic break candidate: "- - - - - - -"', () => {
    const text = 'Hello\n- - - - - - -';
    expect(isAmbiguousPartialLine(text, text.length, true)).toBe(true);
  });

  // --- Code fence candidates ---

  it('buffers single backtick at line start', () => {
    expect(isAmbiguousPartialLine('Hello\n`', 7, true)).toBe(true);
  });

  it('buffers double backtick at line start', () => {
    expect(isAmbiguousPartialLine('Hello\n``', 8, true)).toBe(true);
  });

  it('buffers single tilde at line start', () => {
    expect(isAmbiguousPartialLine('Hello\n~', 7, true)).toBe(true);
  });

  it('buffers double tilde at line start', () => {
    expect(isAmbiguousPartialLine('Hello\n~~', 8, true)).toBe(true);
  });

  it('buffers backtick with trailing space', () => {
    expect(isAmbiguousPartialLine('Hello\n` ', 8, true)).toBe(true);
  });

  it('buffers tilde with trailing space', () => {
    expect(isAmbiguousPartialLine('Hello\n~ ', 8, true)).toBe(true);
  });

  // --- Setext heading candidates ---

  it('buffers single = at line start', () => {
    expect(isAmbiguousPartialLine('Title\n=', 7, true)).toBe(true);
  });

  it('buffers double = at line start', () => {
    expect(isAmbiguousPartialLine('Title\n==', 8, true)).toBe(true);
  });

  it('buffers triple = at line start', () => {
    expect(isAmbiguousPartialLine('Title\n===', 9, true)).toBe(true);
  });

  it('buffers = with trailing spaces', () => {
    expect(isAmbiguousPartialLine('Title\n=== ', 10, true)).toBe(true);
  });

  // --- Leading spaces (1-3) ---

  it('buffers with 1 leading space', () => {
    expect(isAmbiguousPartialLine('Hello\n --', 9, true)).toBe(true);
  });

  it('buffers with 2 leading spaces', () => {
    expect(isAmbiguousPartialLine('Hello\n  --', 10, true)).toBe(true);
  });

  it('buffers with 3 leading spaces', () => {
    expect(isAmbiguousPartialLine('Hello\n   --', 11, true)).toBe(true);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('edge cases', () => {
  it('first line of text is ambiguous — holds at start', () => {
    expect(isAmbiguousPartialLine('---', 1, true)).toBe(true);
    expect(isAmbiguousPartialLine('---', 2, true)).toBe(true);
  });

  it('multi-line: only current line is checked', () => {
    // "Line one\n--" — pos is on second line
    expect(isAmbiguousPartialLine('Line one\n--', 11, true)).toBe(true);
    // But first line "Line one" at pos=5 is not ambiguous
    expect(isAmbiguousPartialLine('Line one\n--', 5, false)).toBe(false);
  });

  it('empty line is not ambiguous', () => {
    expect(isAmbiguousPartialLine('Hello\n\nWorld', 7, true)).toBe(false);
  });

  it('whitespace-only line is not ambiguous', () => {
    expect(isAmbiguousPartialLine('Hello\n   \nWorld', 9, true)).toBe(false);
  });

  it('tab between markers matches thematic break candidate', () => {
    expect(isAmbiguousPartialLine('Hello\n-\t-', 9, true)).toBe(true);
  });

  it('consecutive ambiguous lines are independently evaluated', () => {
    const text = '---\n---\n---';
    // First line: pos=1 is in first ---
    expect(isAmbiguousPartialLine(text, 1, true)).toBe(true);
    // Second line: pos=5 is in second ---
    expect(isAmbiguousPartialLine(text, 5, true)).toBe(true);
    // Third line: pos=9 is in third ---
    expect(isAmbiguousPartialLine(text, 9, true)).toBe(true);
  });

  it('releases when non-matching character arrives', () => {
    // "- T" has a non-marker char, breaks the regex
    expect(isAmbiguousPartialLine('Hello\n- T', 9, true)).toBe(false);
  });

  it('= at start of text (no preceding paragraph) still buffers', () => {
    // Unconditional buffering for simplicity
    expect(isAmbiguousPartialLine('===', 2, true)).toBe(true);
  });

  it('= after blank line still buffers', () => {
    expect(isAmbiguousPartialLine('Text\n\n===', 8, true)).toBe(true);
  });

  it('dash with trailing space (list-like) still buffers', () => {
    // "- " could become "- - -" (thematic break)
    expect(isAmbiguousPartialLine('Hello\n- ', 8, true)).toBe(true);
  });

  it('asterisk with trailing space still buffers', () => {
    expect(isAmbiguousPartialLine('Hello\n* ', 8, true)).toBe(true);
  });
});

// ============================================================================
// TRAILING EMPTY MARKERS — isAtTrailingEmptyMarker
// ============================================================================

describe('trailing empty marker detection', () => {
  describe('returns true (should hold)', () => {
    it('detects trailing **', () => {
      expect(isAtTrailingEmptyMarker('关于 **', 5, true)).toBe(true);
    });

    it('detects trailing *', () => {
      expect(isAtTrailingEmptyMarker('关于 *', 4, true)).toBe(true);
    });

    it('detects trailing ~~', () => {
      expect(isAtTrailingEmptyMarker('关于 ~~', 5, true)).toBe(true);
    });

    it('detects trailing ** with trailing space', () => {
      expect(isAtTrailingEmptyMarker('关于 ** ', 6, true)).toBe(true);
    });

    it('detects ** mid-text', () => {
      expect(isAtTrailingEmptyMarker('Hello world **', 14, true)).toBe(true);
    });

    it('detects * after complete bold', () => {
      // **done** then new * — the new * is an empty marker
      expect(isAtTrailingEmptyMarker('**done** and *', 14, true)).toBe(true);
    });

    it('detects trailing __', () => {
      expect(isAtTrailingEmptyMarker('关于 __', 5, true)).toBe(true);
    });

    it('detects trailing _', () => {
      expect(isAtTrailingEmptyMarker('关于 _', 4, true)).toBe(true);
    });

    it('detects __ mid-text', () => {
      expect(isAtTrailingEmptyMarker('Hello world __', 14, true)).toBe(true);
    });

    it('detects ** directly after CJK without space', () => {
      expect(isAtTrailingEmptyMarker('关于**', 4, true)).toBe(true);
    });

    it('detects * directly after CJK without space', () => {
      expect(isAtTrailingEmptyMarker('中文*', 3, true)).toBe(true);
    });

    it('detects ~~ directly after CJK without space', () => {
      expect(isAtTrailingEmptyMarker('删除~~', 4, true)).toBe(true);
    });
  });

  describe('returns false (no hold needed)', () => {
    it('returns false when not streaming', () => {
      expect(isAtTrailingEmptyMarker('text **', 7, false)).toBe(false);
    });

    it('returns false for pos at 0', () => {
      expect(isAtTrailingEmptyMarker('**', 0, true)).toBe(false);
    });

    it('returns false for pos at 1', () => {
      expect(isAtTrailingEmptyMarker('**', 1, true)).toBe(false);
    });

    it('returns false when ** has content after it', () => {
      // "**text" — the ** has content, not empty
      expect(isAtTrailingEmptyMarker('hello **text', 12, true)).toBe(false);
    });

    it('holds for escaped marker (harmless false positive)', () => {
      expect(isAtTrailingEmptyMarker('hello \\**', 9, true)).toBe(true);
    });

    it('holds for closing ** (harmless — one frame delay)', () => {
      expect(isAtTrailingEmptyMarker('**bold**', 8, true)).toBe(true);
    });

    it('returns false for normal text', () => {
      expect(isAtTrailingEmptyMarker('hello world', 11, true)).toBe(false);
    });

    it('returns false for pos beyond text length', () => {
      expect(isAtTrailingEmptyMarker('text **', 20, true)).toBe(false);
    });
  });
});

// ============================================================================
// SYNTAX SKIP — findSyntaxSkipEnd
// ============================================================================

describe('findSyntaxSkipEnd', () => {
  describe('links', () => {
    it('skips past complete link when pos is inside [text]', () => {
      const text = 'See [OpenAI](https://openai.com) for more';
      // pos at 'O' inside [OpenAI]
      const pos = 5;
      expect(findSyntaxSkipEnd(text, pos)).toBe(text.indexOf(')') + 1);
    });

    it('skips past complete link when pos is inside (url)', () => {
      const text = 'See [OpenAI](https://openai.com) for more';
      // pos inside the URL
      const pos = 20;
      expect(findSyntaxSkipEnd(text, pos)).toBe(text.indexOf(')') + 1);
    });

    it('returns pos when link is incomplete (no closing paren)', () => {
      const text = 'See [OpenAI](https://openai.com';
      const pos = 20;
      expect(findSyntaxSkipEnd(text, pos)).toBe(pos);
    });

    it('returns pos when not inside a link', () => {
      const text = 'Just plain text here';
      expect(findSyntaxSkipEnd(text, 10)).toBe(10);
    });

    it('skips past image syntax ![alt](url)', () => {
      const text = 'Look ![photo](https://example.com/img.png) here';
      const pos = 7; // inside [photo]
      expect(findSyntaxSkipEnd(text, pos)).toBe(text.indexOf(')') + 1);
    });

    it('handles nested parens in URL', () => {
      const text = '[wiki](https://en.wikipedia.org/wiki/AI_(concept)) done';
      const pos = 10;
      // The outer ) closes at index 50: "...concept))"
      const closePos = text.lastIndexOf(')');
      expect(findSyntaxSkipEnd(text, pos)).toBe(closePos + 1);
    });

    it('returns pos at start or end of text', () => {
      expect(findSyntaxSkipEnd('text', 0)).toBe(0);
      expect(findSyntaxSkipEnd('text', 4)).toBe(4);
    });

    it('handles multiple links — only skips the one containing pos', () => {
      const text = '[a](url1) and [b](url2) end';
      // pos inside second link
      const pos = 15; // inside [b]
      const secondClose = text.lastIndexOf(')');
      expect(findSyntaxSkipEnd(text, pos)).toBe(secondClose + 1);
    });

    it('does not skip for reference links [text][ref]', () => {
      const text = 'See [OpenAI][1] for more';
      const pos = 6; // inside [OpenAI]
      // ] at pos 11, text[12] = '[', not '(' → no skip
      expect(findSyntaxSkipEnd(text, pos)).toBe(pos);
    });
  });

  describe('task list checkboxes', () => {
    it('skips past [ ] checkbox', () => {
      const text = '- [ ] Task item';
      const pos = 3; // at '[' in '[ ]'
      // Should skip past '] '
      expect(findSyntaxSkipEnd(text, pos)).toBe(6); // after '] '
    });

    it('skips past [x] checkbox', () => {
      const text = '- [x] Done item';
      const pos = 3;
      expect(findSyntaxSkipEnd(text, pos)).toBe(6);
    });

    it('does not skip for regular list items', () => {
      const text = '- Regular item';
      const pos = 3;
      expect(findSyntaxSkipEnd(text, pos)).toBe(pos);
    });

    it('handles * as list marker', () => {
      const text = '* [ ] Star task';
      const pos = 3;
      expect(findSyntaxSkipEnd(text, pos)).toBe(6);
    });

    it('handles indented checkbox', () => {
      const text = '  - [ ] Indented task';
      const pos = 5; // at '['
      expect(findSyntaxSkipEnd(text, pos)).toBe(8);
    });
  });
});
