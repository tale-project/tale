import { describe, expect, it } from 'vitest';

import { htmlToText } from '../../../../lib/knowledge/html-to-text';
import { RENDERED_LAYOUT_SCRIPT } from './render_layout';

/**
 * The render lane's layout pass in a real Chromium: the exact script text the
 * worker ships runs inside a page, and the host's text pass reads the markup
 * it returns. What is pinned is the pair — `htmlToText` lays inline tags out
 * without a space, so everything the page's CSS separates has to reach it in
 * the markup.
 */
async function renderedText(
  body: string,
): Promise<{ text: string; liveUnchanged: boolean }> {
  const iframe = document.createElement('iframe');
  const loaded = new Promise<void>((resolve) => {
    iframe.addEventListener('load', () => resolve(), { once: true });
  });
  iframe.srcdoc =
    '<!DOCTYPE html><html><head>' +
    `<script>window.renderedLayout = () => ${RENDERED_LAYOUT_SCRIPT};</script>` +
    `</head><body>${body}</body></html>`;
  document.body.append(iframe);
  try {
    await loaded;
    const frameDocument = iframe.contentDocument;
    const frameWindow: unknown = iframe.contentWindow;
    if (
      frameDocument === null ||
      typeof frameWindow !== 'object' ||
      frameWindow === null ||
      !('renderedLayout' in frameWindow) ||
      typeof frameWindow.renderedLayout !== 'function'
    ) {
      throw new Error('the fixture page did not load the layout script');
    }
    const before = frameDocument.documentElement.outerHTML;
    const html: unknown = frameWindow.renderedLayout();
    if (typeof html !== 'string') throw new Error('no markup came back');
    return {
      text: htmlToText(html),
      liveUnchanged: frameDocument.documentElement.outerHTML === before,
    };
  } finally {
    iframe.remove();
  }
}

const spell = (text: string): string =>
  text
    .split('')
    .map((char) => `<span>${char}</span>`)
    .join('');

describe('renderedLayoutHtml in a real page', () => {
  it('keeps a text split into one span per letter as words', async () => {
    const { text } = await renderedText(
      `<p>${spell('This domain is for use in examples.')}</p>`,
    );
    expect(text).toBe('This domain is for use in examples.');
  });

  it('separates what only CSS lays out apart — flex and grid items, inline blocks', async () => {
    const { text } = await renderedText(
      '<div style="display:flex;gap:8px"><span>Price</span><span>CHF 20</span></div>' +
        '<nav style="display:grid"><a href="/a">Home</a><a href="/b">About</a></nav>' +
        '<p><span style="display:inline-block">New</span><span style="display:inline-block">Hot</span></p>',
    );
    const lines = text.split('\n').filter((line) => line !== '');
    expect(lines).toContain('Price');
    expect(lines).toContain('CHF 20');
    expect(lines).toContain('Home');
    expect(lines).toContain('About');
    expect(lines).toContain('New Hot');
  });

  it('keeps table rows on one line and hidden content readable', async () => {
    const { text } = await renderedText(
      '<table><tr><th>Name</th><th>Price</th></tr><tr><td>Widget</td><td>9</td></tr></table>' +
        '<div style="display:none"><p>The answer behind a closed accordion.</p></div>',
    );
    expect(text).toContain('Name | Price');
    expect(text).toContain('Widget | 9');
    expect(text).toContain('The answer behind a closed accordion.');
  });

  it('writes the layout into a copy, never into the live page', async () => {
    const { liveUnchanged } = await renderedText(
      '<div style="display:flex"><span>a</span><span>b</span></div>',
    );
    expect(liveUnchanged).toBe(true);
  });
});
