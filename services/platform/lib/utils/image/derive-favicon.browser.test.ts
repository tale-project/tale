import { describe, it, expect } from 'vitest';

import { deriveFaviconPngBase64 } from './derive-favicon';

// 1×1 red PNG.
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function tinyPngFile(): Promise<File> {
  const res = await fetch(`data:image/png;base64,${TINY_PNG}`);
  const blob = await res.blob();
  return new File([blob], 'logo.png', { type: 'image/png' });
}

// Runs in real Chromium (the `browser` vitest project) so the canvas draw /
// toDataURL path — which jsdom can't execute — is exercised for real.
describe('deriveFaviconPngBase64 (real browser)', () => {
  it('renders a logo into a square PNG of the requested size', async () => {
    const file = await tinyPngFile();
    const base64 = await deriveFaviconPngBase64(file, 64);

    expect(base64.length).toBeGreaterThan(0);

    const binary = atob(base64);
    // PNG magic: 0x89 'P' 'N' 'G'.
    expect(binary.charCodeAt(0)).toBe(0x89);
    expect(binary.slice(1, 4)).toBe('PNG');

    // IHDR width is a big-endian uint32 at byte offset 16.
    const width =
      (binary.charCodeAt(16) << 24) |
      (binary.charCodeAt(17) << 16) |
      (binary.charCodeAt(18) << 8) |
      binary.charCodeAt(19);
    expect(width).toBe(64);
  });
});
