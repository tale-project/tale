import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';

import { micromarkCjkAttention } from '../plugins/micromark-cjk-attention';
import { normalizeHtmlBlocks } from './normalize-html-blocks';

const renderHtml = (md: string): string =>
  micromark(md, {
    extensions: [micromarkCjkAttention()],
    allowDangerousHtml: true,
  }).trim();

describe('normalizeHtmlBlocks — markdown inside HTML blocks', () => {
  it('inserts blank lines around <div align="center"> so bold renders', () => {
    const input =
      '<div align="center">\n⭐ **活化石** &nbsp;|&nbsp; 🌍 **世界自然基金会标志**\n</div>';
    const out = normalizeHtmlBlocks(input);
    expect(renderHtml(out)).toContain('<strong>活化石</strong>');
    expect(renderHtml(out)).toContain('<strong>世界自然基金会标志</strong>');
  });

  it('is idempotent — already-spaced HTML blocks are returned unchanged', () => {
    const already = '<div align="center">\n\n⭐ **活化石**\n\n</div>';
    expect(normalizeHtmlBlocks(already)).toBe(already);
  });

  it('handles nested block tags (<table><tbody><tr>) by spacing each', () => {
    const input =
      '<table>\n<tbody>\n<tr><td>**bold**</td></tr>\n</tbody>\n</table>';
    const out = normalizeHtmlBlocks(input);
    // Each block tag is now on a line surrounded by blanks
    expect(
      out.split('\n').filter((l) => l.trim() === '').length,
    ).toBeGreaterThan(0);
  });

  it('handles a single-line wrapped paragraph: <div>x</div>\\nmd\\n<div>y</div>', () => {
    const input = '<div>top</div>\n# heading\n<div>bottom</div>';
    const out = normalizeHtmlBlocks(input);
    expect(renderHtml(out)).toContain('<h1>heading</h1>');
  });
});

describe('normalizeHtmlBlocks — code blocks must NOT be touched', () => {
  it('leaves <div> inside fenced ``` block verbatim', () => {
    const input = '```html\n<div align="center">\nhello **world**\n</div>\n```';
    expect(normalizeHtmlBlocks(input)).toBe(input);
  });

  it('leaves <div> inside fenced ~~~ block verbatim', () => {
    const input = '~~~\n<div>\n**raw**\n</div>\n~~~';
    expect(normalizeHtmlBlocks(input)).toBe(input);
  });

  it('only normalizes <div> outside the fence, not inside', () => {
    const input =
      '<div>\nbefore\n</div>\n```\n<div>\ninside fence\n</div>\n```\n<div>\nafter\n</div>';
    const out = normalizeHtmlBlocks(input);
    // Inside-fence <div> stays glued to its content (no blank line inserted)
    expect(out).toContain('```\n<div>\ninside fence\n</div>\n```');
    // Outside-fence <div> gets blank lines
    expect(out).toMatch(/<div>\n\nbefore/);
    expect(out).toMatch(/after\n\n<\/div>/);
  });

  it('handles a fenced block opened with extra backticks', () => {
    const input = '````\n<div>x</div>\n````';
    expect(normalizeHtmlBlocks(input)).toBe(input);
  });
});

describe('normalizeHtmlBlocks — inline tags pass through untouched', () => {
  it('does not insert blanks around inline <span>', () => {
    const input = 'before <span>x</span> after';
    expect(normalizeHtmlBlocks(input)).toBe(input);
  });

  it('does not match tags whose name is a prefix of a block tag', () => {
    // <divider> shares prefix with <div> but is not a block-level tag
    const input = '<divider>x</divider>';
    expect(normalizeHtmlBlocks(input)).toBe(input);
  });

  it('does not insert blanks for inline <a> at line start', () => {
    const input = '<a href="#">link</a>';
    expect(normalizeHtmlBlocks(input)).toBe(input);
  });
});

describe('normalizeHtmlBlocks — edge cases', () => {
  it('returns empty string unchanged', () => {
    expect(normalizeHtmlBlocks('')).toBe('');
  });

  it('returns text without any < unchanged (cheap pre-check)', () => {
    const input = 'just a plain message with no html at all';
    expect(normalizeHtmlBlocks(input)).toBe(input);
  });

  it('handles tag right at the start with no preceding line', () => {
    const input = '<div>\nhi\n</div>';
    const out = normalizeHtmlBlocks(input);
    // No leading blank line should be prepended (out can start with the tag)
    expect(out.startsWith('<div>')).toBe(true);
  });

  it('handles tag right at the end with no following line', () => {
    const input = 'hi\n<div>';
    const out = normalizeHtmlBlocks(input);
    // Opening tags don't need a blank before — per CommonMark, an HTML
    // block start interrupts the preceding paragraph. And no blank after
    // because there are no following input lines.
    expect(out).toBe('hi\n<div>');
  });

  it('matches tag with attributes', () => {
    const input = '<div class="foo" id="bar">\n**x**\n</div>';
    const out = normalizeHtmlBlocks(input);
    expect(renderHtml(out)).toContain('<strong>x</strong>');
  });

  it('matches self-closing form like <hr/> with blank line after', () => {
    const input = 'before\n<hr/>\nafter';
    const out = normalizeHtmlBlocks(input);
    // <hr/> is treated as an opening tag — blank inserted only AFTER so
    // the next markdown content parses as its own block. The preceding
    // paragraph terminates naturally per CommonMark's interrupt rule.
    expect(out).toBe('before\n<hr/>\n\nafter');
  });

  it('case-insensitive tag matching', () => {
    const input = '<DIV>\n**x**\n</DIV>';
    const out = normalizeHtmlBlocks(input);
    expect(renderHtml(out)).toContain('<strong>x</strong>');
  });
});
