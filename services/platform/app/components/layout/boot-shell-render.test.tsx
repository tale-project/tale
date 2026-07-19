import { describe, expect, it } from 'vitest';

import { renderBootShell } from './boot-shell-render';

describe('renderBootShell', () => {
  it('renders no text content — the shell paints before the app stylesheet in dev, so any raw text (e.g. an sr-only "Loading content" label) would flash unstyled', () => {
    const html = renderBootShell();
    const text = html
      .replaceAll(/<[^>]+>/g, '')
      .replaceAll(/\s/g, '')
      // Zero-width glyphs (SkeletonText line sizing) are invisible unstyled.
      .replaceAll('\u200B', '');
    expect(text).toBe('');
  });

  it('wraps the markup as an aria-hidden boot-shell artifact', () => {
    const html = renderBootShell();
    expect(html).toContain('data-boot-shell');
    expect(html).toContain('aria-hidden="true"');
  });

  it('bakes the chat sub-panel placeholder, gated on the pre-hydration boot class', () => {
    // The panel stand-in ships in every served shell; the inline script in
    // index.html reveals it via the `boot-chat-panel-open` class on <html>
    // when the navigation targets a chat route with the panel open.
    expect(renderBootShell()).toContain('boot-chat-panel-open');
  });
});
