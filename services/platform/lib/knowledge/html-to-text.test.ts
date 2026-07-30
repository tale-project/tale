import { describe, expect, it } from 'vitest';

import { decodeHtmlEntities, htmlTitle, htmlToText } from './html-to-text';

describe('htmlToText', () => {
  it('drops scripts and styles wholesale and keeps the prose', () => {
    const text = htmlToText(
      '<html><head><title>T</title><style>p{color:red}</style></head>' +
        '<body><script>alert("x")</script><p>Hello world.</p></body></html>',
    );
    expect(text).toBe('Hello world.');
  });

  it('keeps block structure, headings, and list markers readable', () => {
    const text = htmlToText(
      '<h2>Returns</h2><p>Two rules:</p><ul><li>30 days</li><li>Receipt required</li></ul>',
    );
    expect(text).toBe(
      '## Returns\n\nTwo rules:\n\n- 30 days\n\n- Receipt required',
    );
  });

  it('keeps absolute links as markdown and flattens relative ones', () => {
    const text = htmlToText(
      '<p>See <a href="https://example.com/a">the docs</a> or <a href="/local">here</a>.</p>',
    );
    expect(text).toContain('[the docs](https://example.com/a)');
    expect(text).toContain('here');
    expect(text).not.toContain('/local');
  });

  it('decodes the entities prose actually uses', () => {
    expect(decodeHtmlEntities('Fish &amp; Chips &#8212; &lt;tasty&gt;')).toBe(
      'Fish & Chips — <tasty>',
    );
    // Unknown entities pass through rather than being mangled.
    expect(decodeHtmlEntities('&nosuchentity;')).toBe('&nosuchentity;');
  });

  it('renders table cells with separators instead of gluing them', () => {
    const text = htmlToText(
      '<table><tr><th>Name</th><th>Price</th></tr><tr><td>Widget</td><td>9</td></tr></table>',
    );
    expect(text).toContain('Name | Price');
    expect(text).toContain('Widget | 9');
  });
});

describe('htmlTitle', () => {
  it('reads and decodes the title, collapsing whitespace', () => {
    expect(htmlTitle('<title>\n  Example &amp; Domain \n</title>')).toBe(
      'Example & Domain',
    );
    expect(htmlTitle('<p>no title</p>')).toBeNull();
  });
});
