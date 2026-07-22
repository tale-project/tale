// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { toOutboundHtml } from './outbound-html';

describe('toOutboundHtml', () => {
  it('keeps the editor document structurally intact — no text rewriting', () => {
    const editorHtml = '<p>First paragraph.</p><p></p><p>Second paragraph.</p>';
    expect(toOutboundHtml(editorHtml)).toBe(editorHtml);
  });

  it('never emits literal "<br" text for blank lines (regression: sent messages showed <br/>)', () => {
    const editorHtml = '<p>above</p><p><br></p><p>below</p>';
    const result = toOutboundHtml(editorHtml);
    expect(result).not.toContain('&lt;br');
    expect(result).toContain('<br>');
  });

  it('decorates anchors with target and rel', () => {
    const result = toOutboundHtml(
      '<p><a href="https://example.com">example</a></p>',
    );
    expect(result).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">example</a></p>',
    );
  });

  it('sanitizes script content and event handlers', () => {
    const result = toOutboundHtml(
      '<p onclick="alert(1)">hi</p><script>alert(2)</script>',
    );
    expect(result).toBe('<p>hi</p>');
  });

  it('returns an empty string for empty input', () => {
    expect(toOutboundHtml('')).toBe('');
  });
});
