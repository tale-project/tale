import { describe, expect, it } from 'vitest';

import {
  IMAGE_WIDTHS,
  ladderWidths,
  sourceSet,
  widestVariant,
} from './responsive';

describe('ladderWidths', () => {
  it('stops at the image width and never upscales', () => {
    expect(ladderWidths(2880)).toEqual([...IMAGE_WIDTHS]);
    expect(ladderWidths(1300)).toEqual([480, 828, 1200]);
    expect(ladderWidths(300)).toEqual([]);
  });

  it('adds the native width only when asked', () => {
    expect(ladderWidths(750, { native: true })).toEqual([480, 750]);
    expect(ladderWidths(4480, { native: true })).toEqual([
      ...IMAGE_WIDTHS,
      4480,
    ]);
    expect(ladderWidths(1200, { native: true })).toEqual([480, 828, 1200]);
  });

  it('caps the ladder at max and keeps a native width under it', () => {
    const docs = { max: 1600, native: true };
    expect(ladderWidths(2880, docs)).toEqual([480, 828, 1200, 1600]);
    expect(ladderWidths(1600, docs)).toEqual([480, 828, 1200, 1600]);
    expect(ladderWidths(1474, docs)).toEqual([480, 828, 1200, 1474]);
    expect(ladderWidths(768, docs)).toEqual([480, 768]);
  });
});

describe('sourceSet', () => {
  it('lists every variant with its width descriptor', () => {
    expect(sourceSet({ 480: '/shot-480.avif', 828: '/shot-828.avif' })).toBe(
      '/shot-480.avif 480w, /shot-828.avif 828w',
    );
    expect(sourceSet({})).toBe('');
  });
});

describe('widestVariant', () => {
  it('picks the widest variant whatever the insertion order', () => {
    expect(widestVariant({ 1600: '/wide.webp', 480: '/narrow.webp' })).toBe(
      '/wide.webp',
    );
    expect(widestVariant({})).toBeUndefined();
  });
});
