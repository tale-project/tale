import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { encodeImage } from './encode';
import { IMAGE_MAX_BYTES, PNG_QUALITY } from './responsive';

describe('encodeImage', () => {
  it.each([
    { format: 'webp', quality: 90 },
    { format: 'avif', quality: 80 },
  ] as const)(
    'keeps $format quality when the first encoding fits',
    async ({ format, quality }) => {
      const image = sharp({
        create: { width: 32, height: 24, channels: 3, background: '#f7f7f7' },
      });
      const encoded = await encodeImage(image, {
        format,
        quality,
        label: 'small illustration',
      });
      expect(encoded.quality).toBe(quality);
      expect(encoded.bytes.byteLength).toBeLessThanOrEqual(IMAGE_MAX_BYTES);
      expect(await sharp(encoded.bytes).metadata()).toMatchObject({
        format: format === 'avif' ? 'heif' : 'webp',
        width: 32,
        height: 24,
      });
    },
  );

  it('steps the quality down until the bytes fit', async () => {
    // Generated noise is drawn again on every run of a pipeline: fix it in a
    // buffer once, so every encoding below sees the same pixels.
    const { data, info } = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const image = sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    });
    const first = await image.clone().webp({ quality: 90 }).toBuffer();
    const budget = first.byteLength - 1;
    const encoded = await encodeImage(image, {
      format: 'webp',
      quality: 90,
      label: 'noise.webp',
      maxBytes: budget,
    });
    expect(encoded.quality).toBeLessThan(90);
    expect(encoded.bytes.byteLength).toBeLessThanOrEqual(budget);
    // The quality above the one returned did not fit.
    const higher = await image
      .clone()
      .webp({ quality: encoded.quality + 2 })
      .toBuffer();
    expect(higher.byteLength).toBeGreaterThan(budget);
  });

  it('writes flat artwork as a palette PNG that keeps its colours exact', async () => {
    // Two flat halves, as in brand art: ink on white.
    const source = await sharp({
      create: { width: 32, height: 16, channels: 3, background: '#ffffff' },
    })
      .composite([
        {
          input: {
            create: {
              width: 16,
              height: 16,
              channels: 3,
              background: '#060809',
            },
          },
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const encoded = await encodeImage(sharp(source), {
      format: 'png',
      quality: PNG_QUALITY,
      label: 'card.png',
    });
    expect(encoded.quality).toBe(PNG_QUALITY);
    expect(await sharp(encoded.bytes).metadata()).toMatchObject({
      format: 'png',
      width: 32,
      height: 16,
      isPalette: true,
    });
    const pixels = await sharp(encoded.bytes).removeAlpha().raw().toBuffer();
    expect([...pixels.subarray(0, 3)]).toEqual([0x06, 0x08, 0x09]);
    expect([...pixels.subarray(-3)]).toEqual([0xff, 0xff, 0xff]);
  });

  it('fails clearly at the quality floor when an image cannot fit', async () => {
    const image = sharp({
      create: { width: 16, height: 16, channels: 3, background: '#f7f7f7' },
    });
    await expect(
      encodeImage(image, {
        format: 'webp',
        quality: 90,
        label: 'unfit.webp',
        maxBytes: 1,
      }),
    ).rejects.toThrow(
      /unfit\.webp.*webp.*quality 60.*1-byte budget.*dimensions were preserved/,
    );
  });

  it('fails a PNG at the quality floor the same way', async () => {
    const image = sharp({
      create: { width: 16, height: 16, channels: 3, background: '#f7f7f7' },
    });
    await expect(
      encodeImage(image, {
        format: 'png',
        quality: PNG_QUALITY,
        label: 'unfit.png',
        maxBytes: 1,
      }),
    ).rejects.toThrow(/unfit\.png.*png.*quality 60.*1-byte budget/);
  });
});
