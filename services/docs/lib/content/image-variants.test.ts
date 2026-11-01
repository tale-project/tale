import { describe, expect, it } from 'vitest';

import {
  DOCS_IMAGE_SIZES,
  docsImageVariant,
  docsImageWidths,
  docsResponsiveImage,
} from './image-variants';

describe('DOCS_IMAGE_SIZES', () => {
  it('sizes by the column, never auto, so a re-rendered image loads once', () => {
    const slots = DOCS_IMAGE_SIZES.split(',').map((slot) => slot.trim());
    expect(slots).not.toContain('auto');
    expect(slots.at(-1)).toBe('100vw');
  });
});

describe('docsImageWidths', () => {
  it('stops a DPR-2 capture at the width the article column needs', () => {
    expect(docsImageWidths(2880)).toEqual([480, 828, 1200, 1600]);
  });

  it('serves a narrower image at its own width, never upscaled', () => {
    expect(docsImageWidths(1440)).toEqual([480, 828, 1200, 1440]);
    expect(docsImageWidths(1600)).toEqual([480, 828, 1200, 1600]);
    expect(docsImageWidths(400)).toEqual([400]);
  });
});

describe('docsImageVariant', () => {
  it('mirrors the original under images/optimized/', () => {
    expect(
      docsImageVariant('images/platform/de/home-inbox.webp', 2880, 828, 'avif'),
    ).toBe('images/optimized/platform/de/home-inbox-828.avif');
    expect(
      docsImageVariant('images/platform/home-inbox.webp', 2880, 1600, 'webp'),
    ).toBe('images/optimized/platform/home-inbox-1600.webp');
  });

  it('answers the original for the WebP at its own width', () => {
    expect(
      docsImageVariant('images/develop/settings.webp', 1440, 1440, 'webp'),
    ).toBe('images/develop/settings.webp');
    expect(
      docsImageVariant('images/develop/settings.webp', 1440, 1440, 'avif'),
    ).toBe('images/optimized/develop/settings-1440.avif');
  });
});

describe('docsResponsiveImage', () => {
  it('lists every variant under the deploy base', () => {
    expect(
      docsResponsiveImage('/docs/', 'images/develop/settings.webp', 1440, 900),
    ).toEqual({
      width: 1440,
      height: 900,
      variants: {
        avif: {
          480: '/docs/images/optimized/develop/settings-480.avif',
          828: '/docs/images/optimized/develop/settings-828.avif',
          1200: '/docs/images/optimized/develop/settings-1200.avif',
          1440: '/docs/images/optimized/develop/settings-1440.avif',
        },
        webp: {
          480: '/docs/images/optimized/develop/settings-480.webp',
          828: '/docs/images/optimized/develop/settings-828.webp',
          1200: '/docs/images/optimized/develop/settings-1200.webp',
          1440: '/docs/images/develop/settings.webp',
        },
      },
    });
  });

  it('keeps root-absolute URLs at the root base', () => {
    const { variants } = docsResponsiveImage(
      '/',
      'images/develop/settings.webp',
      2880,
      1800,
    );
    expect(variants.avif[480]).toBe(
      '/images/optimized/develop/settings-480.avif',
    );
    expect(Object.keys(variants.webp)).toEqual(['480', '828', '1200', '1600']);
  });
});
