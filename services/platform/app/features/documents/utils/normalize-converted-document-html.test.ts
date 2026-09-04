// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { normalizeConvertedDocumentHtml } from './normalize-converted-document-html';

describe('normalizeConvertedDocumentHtml', () => {
  it('strips absolute positioning so body text stays in the page flow', () => {
    const html =
      '<table><tr><td>Meta</td></tr></table><p style="position:absolute;top:400px">1. Preamble</p>';

    const normalized = normalizeConvertedDocumentHtml(html);
    const doc = new DOMParser().parseFromString(normalized, 'text/html');

    expect(doc.querySelector('p')?.style.position).toBe('');
    expect(doc.querySelector('p')?.style.top).toBe('');
  });

  it('removes fixed heights and clipping from flow wrapper divs', () => {
    const html =
      '<div style="height:300px;overflow:hidden"><table></table></div><p>After</p>';

    const normalized = normalizeConvertedDocumentHtml(html);
    const doc = new DOMParser().parseFromString(normalized, 'text/html');
    const wrapper = doc.querySelector('div');

    expect(wrapper?.style.height).toBe('');
    expect(wrapper?.style.overflow).toBe('');
  });

  it('leaves table cell heights alone', () => {
    const html = '<table><tr><td style="height:48px">Owner</td></tr></table>';

    const normalized = normalizeConvertedDocumentHtml(html);
    const doc = new DOMParser().parseFromString(normalized, 'text/html');

    expect(doc.querySelector('td')?.style.height).toBe('48px');
  });

  it('returns the original html when DOMParser is unavailable', () => {
    const original = DOMParser;
    // @ts-expect-error — simulate non-browser environments
    globalThis.DOMParser = undefined;

    expect(normalizeConvertedDocumentHtml('<p>keep me</p>')).toBe(
      '<p>keep me</p>',
    );

    globalThis.DOMParser = original;
  });
});
