import { describe, expect, it, vi } from 'vitest';

import { parseHtml, stripStyleBlocks } from './parse_html';

describe('stripStyleBlocks', () => {
  it('drops inline style blocks, including attributed and multiline ones', () => {
    const html = [
      '<html><head>',
      '<style>body { color: red; }</style>',
      '<STYLE media="print">\n@page { margin: 0; }\n</STYLE>',
      '<style type="text/css" data-x="1">.a{}</style >',
      '</head><body><a href="/x">x</a></body></html>',
    ].join('\n');
    const stripped = stripStyleBlocks(html);
    expect(stripped).not.toContain('color: red');
    expect(stripped).not.toContain('@page');
    expect(stripped).not.toContain('.a{}');
    expect(stripped).toContain('<a href="/x">x</a>');
  });

  it('leaves style attributes and non-style tags alone', () => {
    const html = '<div style="color:blue"><p>text</p></div>';
    expect(stripStyleBlocks(html)).toBe(html);
  });
});

describe('parseHtml', () => {
  it('extracts title, links, and meta through the quiet parse', () => {
    const { document } = parseHtml(
      `<html><head>
         <title>Probe</title>
         <meta property="og:title" content="Probe OG" />
         <style>main { display: grid; }</style>
       </head>
       <body><a href="https://example.com/a">a</a></body></html>`,
    ).window;
    expect(document.querySelector('title')?.textContent).toBe('Probe');
    expect(
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute('content'),
    ).toBe('Probe OG');
    expect(document.querySelector('a[href]')?.getAttribute('href')).toBe(
      'https://example.com/a',
    );
    // The stripped stylesheet never reaches the DOM (no CSSOM work) and can't
    // leak into text extraction.
    expect(document.body?.textContent).not.toContain('display: grid');
  });

  // Regression: a bare `new JSDOM(html)` logs "Could not parse CSS
  // stylesheet" through the default virtual console for every broken sheet —
  // at crawl volume that floods the backend log pipeline (observed live as
  // per-page error spam during a site scan).
  it('parses pages with broken CSS without emitting console errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { document } = parseHtml(
        `<html><head><style>@invalid { ; } } garbage {{{</style></head>
         <body><a href="/ok">ok</a></body></html>`,
      ).window;
      expect(document.querySelector('a[href]')?.getAttribute('href')).toBe(
        '/ok',
      );
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
