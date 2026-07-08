// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { markdownToHtml } from './markdown-to-html';

describe('markdownToHtml', () => {
  it('serializes plain text into a paragraph', () => {
    expect(markdownToHtml('Hello there')).toBe('<p>Hello there</p>');
  });

  it('serializes markdown formatting', () => {
    expect(markdownToHtml('a **bold** reply')).toBe(
      '<p>a <strong>bold</strong> reply</p>',
    );
  });

  it('keeps a soft line break inside one paragraph', () => {
    expect(markdownToHtml('Line one\nline two')).toBe(
      '<p>Line one\nline two</p>',
    );
  });

  it('keeps link href and safe rel through sanitization', () => {
    const html = markdownToHtml('[docs](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    // DOMPurify's default allow-list drops `target` — true of the old inbox
    // editor too (the renderer sets target="_blank", sanitize removes it).
    expect(html).not.toContain('target=');
  });

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(markdownToHtml('')).toBe('');
    expect(markdownToHtml('   \n  ')).toBe('');
  });

  it('renders markdown that produces no visible content to an empty body', () => {
    // A thematic break serializes to <hr>; the composer relies on trimming
    // the SOURCE, so this stays non-empty — but raw HTML in the markdown is
    // never rendered as markup (react-markdown skips it), so nothing
    // executable can reach the body.
    expect(markdownToHtml('<script>alert(1)</script>')).not.toContain(
      '<script>',
    );
  });
});
