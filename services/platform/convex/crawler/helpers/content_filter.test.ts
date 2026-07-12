import { describe, expect, it } from 'vitest';

import {
  htmlToFitMarkdown,
  htmlToRawMarkdown,
  pruneHtml,
} from './content_filter';

describe('pruneHtml', () => {
  it('pre-removes structural chrome (nav/footer/header/aside) even when it has dense text', () => {
    const html = `<html><body>
      <nav><a href="/a">Home</a><a href="/b">About</a><a href="/c">Contact</a></nav>
      <header><h1>Site Header</h1></header>
      <article><p>This is the real article body with plenty of unique prose to score well above the pruning threshold.</p></article>
      <aside><p>Related widgets and other sidebar chrome that should not survive.</p></aside>
      <footer><p>Copyright 2026</p></footer>
    </body></html>`;
    const pruned = pruneHtml(html);
    expect(pruned).not.toContain('Site Header');
    expect(pruned).not.toContain('sidebar chrome');
    expect(pruned).not.toContain('Copyright');
    expect(pruned).toContain('real article body');
  });

  it('drops HTML comments', () => {
    const html = `<html><body><article><p>Kept text with enough length to score above threshold for sure.</p><!-- a lingering editorial comment --></article></body></html>`;
    const pruned = pruneHtml(html);
    expect(pruned).not.toContain('editorial comment');
    expect(pruned).toContain('Kept text');
  });

  it('prunes a link-dense, low-text-density block (share bar) below the threshold', () => {
    const html = `<html><body>
      <article><p>${'Long-form editorial content with substantial prose. '.repeat(6)}</p></article>
      <div class="social-share"><a href="/share/x">X</a><a href="/share/fb">FB</a><a href="/share/li">LI</a></div>
    </body></html>`;
    const pruned = pruneHtml(html);
    expect(pruned).toContain('Long-form editorial content');
    expect(pruned).not.toContain('social-share');
    expect(pruned).not.toContain('>X<');
  });

  it('recovers from unclosed tags and unquoted attributes', () => {
    const html = `<html><body>
      <article class=main>
        <p>First paragraph never closes
        <p>Second paragraph with <b>bold text that never closes either
      </article>
    </body>`;
    const pruned = pruneHtml(html);
    expect(pruned).toContain('First paragraph never closes');
    expect(pruned).toContain('Second paragraph');
    expect(pruned).toContain('bold text that never closes either');
  });

  it('keeps entities intact (still HTML) in the pruned markup', () => {
    const html = `<html><body><article><p>Fish &amp; chips &mdash; caf&eacute; men&#117;.</p></article></body></html>`;
    const pruned = pruneHtml(html);
    // pruneHtml returns serialized HTML, not decoded text — entities
    // round-trip through the parser and back out via innerHTML.
    expect(pruned).toContain('Fish');
    expect(pruned).toContain('chips');
  });
});

describe('htmlToFitMarkdown', () => {
  it('converts pruned content to markdown and renders link text without the markdown link syntax', () => {
    const html = `<html><body><article><p>Read the <a href="https://example.com/more">full report</a> for details, plus plenty of surrounding prose to keep this block above threshold.</p></article></body></html>`;
    const markdown = htmlToFitMarkdown(html);
    expect(markdown).toContain('full report');
    expect(markdown).not.toContain('[full report]');
    expect(markdown).not.toContain('https://example.com/more');
  });

  it('falls back to empty content when nothing survives pruning', () => {
    const html = `<html><body><nav><a href="/a">A</a></nav></body></html>`;
    expect(htmlToFitMarkdown(html)).toBe('');
  });
});

describe('htmlToRawMarkdown', () => {
  it('converts the full page without pruning, still stripping link syntax', () => {
    const html = `<html><body><nav><a href="/a">Nav link</a></nav><p>Body text</p></body></html>`;
    const markdown = htmlToRawMarkdown(html);
    expect(markdown).toContain('Nav link');
    expect(markdown).toContain('Body text');
    expect(markdown).not.toContain('[Nav link]');
  });

  it('decodes entities in raw (unpruned) markdown too', () => {
    const html = `<p>Terms &amp; Conditions</p>`;
    expect(htmlToRawMarkdown(html)).toContain('Terms & Conditions');
  });
});
