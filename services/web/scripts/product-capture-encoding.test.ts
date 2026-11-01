// @vitest-environment node

import { fileURLToPath } from 'node:url';

import { encodeImage } from '@tale/ui/images/encode';
import {
  IMAGE_MAX_BYTES,
  IMAGE_MIN_QUALITY,
  IMAGE_QUALITY,
  IMAGE_QUALITY_STEP,
} from '@tale/ui/images/responsive';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

// The encoder's own cases live with it (`packages/ui/src/images`); this one
// holds it to the real captures that needed its quality step.
describe('product capture encoding budget', () => {
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
      const quality = IMAGE_QUALITY.screen.webp;
      const encoded = await encodeImage(image, {
        format: 'webp',
        quality,
        label: `governance-audit-logs-${locale}`,
      });
      expect(encoded.bytes.byteLength).toBeLessThanOrEqual(IMAGE_MAX_BYTES);
      const metadata = await sharp(encoded.bytes).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(original.width);
      expect(metadata.height).toBe(original.height);
      expect(encoded.quality).toBeGreaterThanOrEqual(IMAGE_MIN_QUALITY);
      // A lower quality is justified only when the preceding rung does not
      // fit. This remains valid when refreshed source pixels already fit.
      if (encoded.quality < quality) {
        const higherQuality = await image
          .clone()
          .webp({ quality: encoded.quality + IMAGE_QUALITY_STEP })
          .toBuffer();
        expect(higherQuality.byteLength).toBeGreaterThan(IMAGE_MAX_BYTES);
      }
    },
  );
});
