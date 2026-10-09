// @vitest-environment node

import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { encodeMarketingImage } from './image-encoder';

const MAX_BYTES = 200 * 1024;

describe('marketing image encoding budget', () => {
  it.each(['de', 'fr'] as const)(
    'fits the actual %s audit capture without reducing its native resolution',
    async (locale) => {
      const source = fileURLToPath(
        new URL(
          `../../docs/public/images/platform/${locale}/governance-audit-logs.webp`,
          import.meta.url,
        ),
      );
      const image = sharp(source);
      const original = await image.metadata();
      const encoded = await encodeMarketingImage(image, {
        format: 'webp',
        quality: 90,
        label: `governance-audit-logs-${locale}`,
      });
      expect(encoded.bytes.byteLength).toBeLessThanOrEqual(MAX_BYTES);
      const metadata = await sharp(encoded.bytes).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(original.width);
      expect(metadata.height).toBe(original.height);
      expect(encoded.quality).toBeGreaterThanOrEqual(60);
      // A lower quality is justified only when the preceding rung does not
      // fit. This remains valid when refreshed source pixels already fit.
      if (encoded.quality < 90) {
        const higherQuality = await image
          .clone()
          .webp({ quality: encoded.quality + 2 })
          .toBuffer();
        expect(higherQuality.byteLength).toBeGreaterThan(MAX_BYTES);
      }
    },
  );

  it.each([
    { format: 'webp', quality: 90 },
    { format: 'avif', quality: 80 },
  ] as const)(
    'keeps $format quality when the first encoding fits',
    async ({ format, quality }) => {
      const image = sharp({
        create: { width: 32, height: 24, channels: 3, background: '#f7f7f7' },
      });
      const encoded = await encodeMarketingImage(image, {
        format,
        quality,
        label: 'small illustration',
      });
      expect(encoded.quality).toBe(quality);
      expect(encoded.bytes.byteLength).toBeLessThanOrEqual(MAX_BYTES);
      expect(await sharp(encoded.bytes).metadata()).toMatchObject({
        width: 32,
        height: 24,
      });
    },
  );

  it('fails clearly at the quality floor when a capture cannot fit', async () => {
    const image = sharp({
      create: { width: 16, height: 16, channels: 3, background: '#f7f7f7' },
    });
    await expect(
      encodeMarketingImage(image, {
        format: 'webp',
        quality: 90,
        label: 'unfit.webp',
        maxBytes: 1,
      }),
    ).rejects.toThrow(
      /unfit\.webp.*webp.*quality 60.*1-byte budget.*dimensions were preserved/,
    );
  });
});
