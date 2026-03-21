import { describe, it, expect } from 'vitest';

import { remendMarkdown } from '../remend-markdown';

// ============================================================================
// IDEMPOTENCY — well-formed markdown passes through unchanged
// ============================================================================

describe('idempotency', () => {
  it.each([
    ['plain text', 'Hello world'],
    ['inline code', '`inline code`'],
    ['multi-backtick inline code', '``code with ` inside``'],
    ['bold', '**bold text**'],
    ['italic', '*italic text*'],
    ['strikethrough', '~~strikethrough~~'],
    ['fenced code block', '```js\nconst x = 1;\n```'],
    ['fenced code block with 4 backticks', '````\ncode\n````'],
    ['mixed complete syntax', '**bold** and *italic* and ~~strike~~'],
    [
      'all types',
      'A **bold** with `code` and *italic* plus ~~strike~~\n\n```js\nx\n```',
    ],
    ['bold + italic combo', '***bold italic***'],
    ['multiple paragraphs', 'Para one.\n\nPara two.\n\nPara three.'],
    ['escaped asterisks', 'Price is 5\\*3 = 15'],
    ['escaped backtick', 'Use \\` for code'],
  ])('preserves %s', (_label, input) => {
    expect(remendMarkdown(input)).toBe(input);
  });
});

// ============================================================================
// INCOMPLETE SYNTAX — auto-complete unclosed markers
// ============================================================================

describe('incomplete syntax closure', () => {
  it('closes unclosed inline code', () => {
    expect(remendMarkdown('use `Array.from')).toBe('use `Array.from`');
  });

  it('closes unclosed double-backtick inline code', () => {
    expect(remendMarkdown('``code with `')).toBe('``code with ```');
  });

  it('closes unclosed bold', () => {
    expect(remendMarkdown('**bold text')).toBe('**bold text**');
  });

  it('closes unclosed italic', () => {
    expect(remendMarkdown('*italic text')).toBe('*italic text*');
  });

  it('closes unclosed strikethrough', () => {
    expect(remendMarkdown('~~deleted text')).toBe('~~deleted text~~');
  });

  it('closes unclosed fenced code block', () => {
    expect(remendMarkdown('```js\nconst x = 1;')).toBe(
      '```js\nconst x = 1;\n```',
    );
  });

  it('closes unclosed fenced code block without language', () => {
    expect(remendMarkdown('```\ncode here')).toBe('```\ncode here\n```');
  });

  it('closes fenced code block with 4 backticks', () => {
    expect(remendMarkdown('````python\ndef foo():')).toBe(
      '````python\ndef foo():\n````',
    );
  });

  it('closes bold that opened after complete bold', () => {
    expect(remendMarkdown('**first** and **second')).toBe(
      '**first** and **second**',
    );
  });

  it('closes italic that opened after complete italic', () => {
    expect(remendMarkdown('*one* then *two')).toBe('*one* then *two*');
  });
});

// ============================================================================
// CONTEXT AWARENESS — respects code block/span boundaries
// ============================================================================

describe('context awareness', () => {
  it('does not close bold inside fenced code block', () => {
    const input = '```\n**not bold';
    const result = remendMarkdown(input);
    // Should only close the fence, not the **
    expect(result).toBe('```\n**not bold\n```');
  });

  it('does not close italic inside fenced code block', () => {
    expect(remendMarkdown('```\n*not italic')).toBe('```\n*not italic\n```');
  });

  it('does not close strikethrough inside fenced code block', () => {
    expect(remendMarkdown('```\n~~not strike')).toBe('```\n~~not strike\n```');
  });

  it('does not close bold inside inline code', () => {
    // Inside backticks, ** is literal — only close the backtick
    expect(remendMarkdown('`**bold')).toBe('`**bold`');
  });

  it('respects escaped asterisk', () => {
    expect(remendMarkdown('\\*not italic')).toBe('\\*not italic');
  });

  it('handles escaped backslash before real asterisk', () => {
    // \\\* = escaped backslash + real asterisk opener
    expect(remendMarkdown('\\\\*real italic')).toBe('\\\\*real italic*');
  });

  it('respects escaped backtick', () => {
    expect(remendMarkdown('\\`not code')).toBe('\\`not code');
  });

  it('handles nested bold inside italic', () => {
    // *text **bold → close in reverse: ** then *
    expect(remendMarkdown('*text **bold')).toBe('*text **bold***');
  });

  it('handles nested italic inside bold', () => {
    expect(remendMarkdown('**bold *italic')).toBe('**bold *italic***');
  });

  it('handles triple asterisk (bold+italic)', () => {
    expect(remendMarkdown('***bold italic')).toBe('***bold italic***');
  });

  it('handles inline code then bold', () => {
    expect(remendMarkdown('**bold `code`')).toBe('**bold `code`**');
  });

  it('closes inline code before formatting when both are open', () => {
    // **bold `code → close backtick first, then bold
    const result = remendMarkdown('**bold `code');
    expect(result).toBe('**bold `code`**');
  });
});

// ============================================================================
// BOUNDARY CONDITIONS
// ============================================================================

describe('boundary conditions', () => {
  it('returns empty string for empty input', () => {
    expect(remendMarkdown('')).toBe('');
  });

  it('returns empty string for undefined-like input', () => {
    // The function signature accepts string, but guard anyway
    expect(remendMarkdown('')).toBe('');
  });

  it('handles single backtick', () => {
    expect(remendMarkdown('`')).toBe('``');
  });

  it('handles single asterisk with content', () => {
    expect(remendMarkdown('*a')).toBe('*a*');
  });

  it('handles double asterisk with content', () => {
    expect(remendMarkdown('**a')).toBe('**a**');
  });

  it('handles trailing backslash', () => {
    // Trailing backslash with nothing after it — nothing to escape
    expect(remendMarkdown('hello\\')).toBe('hello\\');
  });

  it('handles very long code block', () => {
    const longCode = 'x'.repeat(2000);
    const input = '```\n' + longCode;
    expect(remendMarkdown(input)).toBe('```\n' + longCode + '\n```');
  });

  it('handles unicode CJK content', () => {
    expect(remendMarkdown('**你好世界')).toBe('**你好世界**');
  });

  it('handles emoji content', () => {
    expect(remendMarkdown('*🎉 party')).toBe('*🎉 party*');
  });

  it('handles triple backtick alone on a line', () => {
    expect(remendMarkdown('```')).toBe('```\n```');
  });

  it('handles code fence with only language specified', () => {
    expect(remendMarkdown('```typescript')).toBe('```typescript\n```');
  });

  it('handles multiple paragraphs with unclosed bold in last', () => {
    expect(remendMarkdown('Done.\n\n**Next')).toBe('Done.\n\n**Next**');
  });
});

// ============================================================================
// LINK/IMAGE HANDLING
// ============================================================================

describe('link handling', () => {
  it('preserves complete links', () => {
    expect(remendMarkdown('[text](url)')).toBe('[text](url)');
  });

  it('preserves complete links with title', () => {
    expect(remendMarkdown('[text](url "title")')).toBe('[text](url "title")');
  });

  it('strips incomplete link with just opening bracket', () => {
    expect(remendMarkdown('[text')).toBe('text');
  });

  it('strips incomplete link with closing bracket', () => {
    expect(remendMarkdown('[text]')).toBe('text');
  });

  it('strips incomplete link with opening paren', () => {
    expect(remendMarkdown('[text](')).toBe('text');
  });

  it('strips incomplete link with partial URL', () => {
    expect(remendMarkdown('[text](http://example.com')).toBe('text');
  });

  it('strips incomplete link with long partial URL', () => {
    expect(
      remendMarkdown(
        '[contract-comparison-report.docx](http://localhost:3000/http_api/storage?id=kg2djxf4svmjqnjtejxges0xbs83azgy&',
      ),
    ).toBe('contract-comparison-report.docx');
  });

  it('preserves text before incomplete link', () => {
    expect(remendMarkdown('Check this: [link')).toBe('Check this: link');
  });

  it('preserves complete link followed by incomplete link', () => {
    expect(remendMarkdown('[a](b) [c')).toBe('[a](b) c');
  });

  it('preserves multiple complete links', () => {
    expect(remendMarkdown('[a](b) and [c](d)')).toBe('[a](b) and [c](d)');
  });

  it('strips incomplete link after complete links', () => {
    expect(remendMarkdown('[a](b) and [c](d) and [e')).toBe(
      '[a](b) and [c](d) and e',
    );
  });

  it('does not process links inside fenced code block', () => {
    expect(remendMarkdown('```\n[text](url')).toBe('```\n[text](url\n```');
  });

  it('does not process links inside inline code', () => {
    expect(remendMarkdown('`[text](url')).toBe('`[text](url`');
  });

  it('respects escaped bracket', () => {
    expect(remendMarkdown('\\[not a link')).toBe('\\[not a link');
  });
});

describe('image handling', () => {
  it('preserves complete images', () => {
    expect(remendMarkdown('![alt](url)')).toBe('![alt](url)');
  });

  it('removes incomplete image with just opening', () => {
    expect(remendMarkdown('![alt')).toBe('');
  });

  it('removes incomplete image with bracket and paren', () => {
    expect(remendMarkdown('![alt](')).toBe('');
  });

  it('removes incomplete image with partial URL', () => {
    expect(remendMarkdown('![alt](http://example.com/img')).toBe('');
  });

  it('preserves text before incomplete image', () => {
    expect(remendMarkdown('See: ![photo')).toBe('See: ');
  });

  it('preserves complete image followed by incomplete image', () => {
    expect(remendMarkdown('![a](b) ![c')).toBe('![a](b) ');
  });
});

// ============================================================================
// COMPLEX / REAL-WORLD SCENARIOS
// ============================================================================

describe('real-world streaming scenarios', () => {
  it('handles partial LLM response with code block mid-stream', () => {
    const input = 'Here is the code:\n\n```python\ndef hello():';
    expect(remendMarkdown(input)).toBe(
      'Here is the code:\n\n```python\ndef hello():\n```',
    );
  });

  it('handles bold header followed by partial code', () => {
    const input = '**Solution:**\n\n```\nconst x';
    expect(remendMarkdown(input)).toBe('**Solution:**\n\n```\nconst x\n```');
  });

  it('handles complete code block followed by unclosed bold', () => {
    const input = '```js\nx\n```\n\n**Important';
    expect(remendMarkdown(input)).toBe('```js\nx\n```\n\n**Important**');
  });

  it('handles inline code in the middle with unclosed bold after', () => {
    const input = 'Use `foo()` and **then';
    expect(remendMarkdown(input)).toBe('Use `foo()` and **then**');
  });

  it('handles strikethrough and bold combined', () => {
    const input = '~~old~~ → **new';
    expect(remendMarkdown(input)).toBe('~~old~~ → **new**');
  });

  it('handles multiple complete + one incomplete formatting', () => {
    const input = '*a* **b** ~~c~~ *d';
    expect(remendMarkdown(input)).toBe('*a* **b** ~~c~~ *d*');
  });
});

// ============================================================================
// PERFORMANCE
// ============================================================================

describe('performance', () => {
  it('processes typical streaming chunks in under 0.1ms', () => {
    const chunks = [
      'Hello **world**, this is a test with `code` and *italic* text.',
      '```python\ndef foo():\n    return bar\n',
      'Some text with ~~strike~~ and **bold',
      '**bold text that is not yet clos',
      'Normal paragraph with no special syntax at all, just words flowing.',
    ];

    // Warm up
    for (const chunk of chunks) {
      remendMarkdown(chunk);
    }

    const iterations = 10_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      for (const chunk of chunks) {
        remendMarkdown(chunk);
      }
    }
    const elapsed = performance.now() - start;
    const perCall = elapsed / (iterations * chunks.length);

    expect(perCall).toBeLessThan(0.1);
  });
});
