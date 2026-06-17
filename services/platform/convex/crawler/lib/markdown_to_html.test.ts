import { describe, expect, it } from 'vitest';

import { injectCss, markdownToHtml, wrapHtml } from './markdown_to_html';

describe('markdownToHtml', () => {
  it('renders headings and emphasis', () => {
    const html = markdownToHtml('# Title\n\nHello **world**.');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>world</strong>');
  });

  it('renders GFM tables', () => {
    const html = markdownToHtml('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('renders bullet and numbered lists', () => {
    const html = markdownToHtml('- one\n- two\n\n1. first\n2. second');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>one</li>');
  });

  it('renders fenced code blocks', () => {
    const html = markdownToHtml('```js\nconst x = 1;\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('const x = 1;');
  });
});

describe('wrapHtml', () => {
  it('wraps content in the default template with font stack', () => {
    const out = wrapHtml('<p>Body</p>');
    expect(out).toContain('<!DOCTYPE html>');
    expect(out).toContain("font-family: 'Noto Sans'");
    expect(out).toContain('<p>Body</p>');
    expect(out.indexOf('<body>')).toBeLessThan(out.indexOf('<p>Body</p>'));
  });

  it('injects extra head content before the body', () => {
    const out = wrapHtml('<p>Body</p>', '<style>.x{}</style>');
    expect(out).toContain('<style>.x{}</style>');
    expect(out.indexOf('<style>.x{}</style>')).toBeLessThan(
      out.indexOf('<body>'),
    );
  });
});

describe('injectCss', () => {
  it('injects before </head> when present', () => {
    const out = injectCss('<html><head></head><body></body></html>', '.a{}');
    expect(out).toContain('<style>.a{}</style></head>');
  });

  it('injects after <head ...> when no closing tag matched first', () => {
    const out = injectCss('<head class="x"><meta>', '.b{}');
    expect(out).toContain('<head class="x"><style>.b{}</style>');
  });

  it('injects before <body> when no head', () => {
    const out = injectCss('<body><p>x</p></body>', '.c{}');
    expect(out).toContain('<style>.c{}</style><body>');
  });

  it('prepends as a fallback when neither head nor body exists', () => {
    const out = injectCss('<p>x</p>', '.d{}');
    expect(out).toBe('<style>.d{}</style><p>x</p>');
  });

  it('returns the html unchanged for empty css', () => {
    expect(injectCss('<p>x</p>', '')).toBe('<p>x</p>');
    expect(injectCss('<p>x</p>', '   ')).toBe('<p>x</p>');
  });
});
