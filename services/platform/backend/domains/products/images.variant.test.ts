import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { PRODUCT_IMAGE_VARIANTS } from '../../../lib/shared/product-images.ts';
import { productImageVariant } from './images.ts';

async function photo(width: number, height: number): Promise<Uint8Array> {
  const bytes = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 120, b: 40 },
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(bytes);
}

async function widthOf(bytes: Uint8Array): Promise<number> {
  const { width } = await sharp(bytes).metadata();
  if (width === undefined) throw new Error('no width');
  return width;
}

describe('product image variants', () => {
  it('derives the list cell at twice its 80 px CSS size, as WebP', async () => {
    const out = await productImageVariant(await photo(2000, 1500), 'list');
    expect(out).not.toBeNull();
    expect(await widthOf(out!)).toBe(PRODUCT_IMAGE_VARIANTS.list);
    expect((await sharp(out!).metadata()).format).toBe('webp');
  });

  it('derives the hover card at twice its 128 px CSS size', async () => {
    const out = await productImageVariant(await photo(2000, 1500), 'card');
    expect(await widthOf(out!)).toBe(PRODUCT_IMAGE_VARIANTS.card);
  });

  it('never upscales an original smaller than the variant', async () => {
    const out = await productImageVariant(await photo(100, 80), 'card');
    expect(await widthOf(out!)).toBe(100);
  });

  it('returns null for bytes that are not a decodable image', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await productImageVariant(
      new TextEncoder().encode('not an image'),
      'list',
    );
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
