import { describe, expect, it } from 'vitest';

import { firstFrameFonts, withFontPreloads } from './font-preloads';

const ASSETS = [
  'index-Dxp8STdk.js',
  'inter-latin-400-normal-C38fXH4l.woff2',
  'inter-latin-400-normal-CyCys3Eg.woff',
  'inter-latin-500-normal-Cerq10X2.woff2',
  'inter-latin-600-normal-LgqL8muc.woff2',
  'inter-latin-700-normal-Yt3aPRUw.woff2',
  'inter-latin-ext-600-normal-D2bJ5OIk.woff2',
  'inter-cyrillic-600-normal-Bcila6Z-.woff2',
];

describe('firstFrameFonts', () => {
  it('finds the Latin woff2 of the weights the first frame draws with, and no other', () => {
    expect(firstFrameFonts(ASSETS)).toEqual([
      'inter-latin-400-normal-C38fXH4l.woff2',
      'inter-latin-500-normal-Cerq10X2.woff2',
      'inter-latin-600-normal-LgqL8muc.woff2',
    ]);
  });
});

describe('withFontPreloads', () => {
  const page =
    '<html><head><title>Session Manager</title></head><body></body></html>';

  it('names each in the head as a font preload, fetched as a font is', () => {
    const html = withFontPreloads(page, ASSETS);
    expect(html).toContain(
      '<link rel="preload" href="/assets/inter-latin-600-normal-LgqL8muc.woff2" as="font" type="font/woff2" crossorigin></head>',
    );
    expect(html.match(/rel="preload"/g)).toHaveLength(3);
  });

  it('leaves a page as it is when the build has none of the fonts', () => {
    expect(withFontPreloads(page, ['index.js'])).toBe(page);
  });
});
