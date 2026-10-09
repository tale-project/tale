// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  IMAGE_MANIFEST,
  type ImageManifestEntry,
} from '@/app/generated/image-manifest';

import {
  PRODUCT_SCREENSHOT_LOCALES,
  PRODUCT_SCREENSHOTS,
  productScreenshotId,
  productScreenshotLocale,
} from './product-screenshots';

interface CaptureEntry {
  file: string;
  shot: string;
  locale?: string;
  width: number;
  height: number;
}

const captures = JSON.parse(
  readFileSync(
    new URL('../../../docs/public/images/manifest.json', import.meta.url),
    'utf8',
  ),
) as { entries: CaptureEntry[] };
const images: readonly ImageManifestEntry[] = IMAGE_MANIFEST;

describe('localized product captures', () => {
  it('uses German product captures for Swiss German pages', () => {
    expect(productScreenshotLocale('de-CH')).toBe('de');
    expect(productScreenshotId('projects-task-board', 'de-CH')).toBe(
      productScreenshotId('projects-task-board', 'de'),
    );
  });

  it('gives every product destination its own actual source', () => {
    const sources = Object.values(PRODUCT_SCREENSHOTS).map(
      ({ source }) => source,
    );
    expect(new Set(sources).size).toBe(sources.length);
  });

  for (const locale of PRODUCT_SCREENSHOT_LOCALES) {
    it(`ships verified ${locale} sources and complete responsive derivatives`, () => {
      for (const shot of Object.values(PRODUCT_SCREENSHOTS)) {
        const file = `images/platform/${locale === 'en' ? '' : `${locale}/`}${shot.source}.webp`;
        const capture = captures.entries.find((entry) => entry.file === file);
        expect(capture, `Missing capture provenance: ${file}`).toBeDefined();
        expect(capture!.shot).toBe(shot.source);
        expect(capture!.locale ?? 'en').toBe(locale);
        expect(
          existsSync(new URL(`../../../docs/public/${file}`, import.meta.url)),
        ).toBe(true);

        const id = productScreenshotId(shot.source, locale);
        const original = images.find((entry) => entry.id === id);
        expect(original, `Missing original: ${id}`).toBeDefined();
        expect(original!.width).toBe(capture!.width);
        expect(original!.height).toBe(capture!.height);
        // Inspection links preserve native capture resolution, even when it
        // exceeds the standard marketing-image width budget.
        expect(original!.variants.webp).toHaveProperty(String(capture!.width));
        const crops = [
          { id: `${id}-mobile`, crop: shot.crop },
          ...('desktopCrop' in shot
            ? [{ id: `${id}-desktop`, crop: shot.desktopCrop }]
            : []),
        ];
        for (const { id: cropId, crop } of crops) {
          expect(crop.left + crop.width).toBeLessThanOrEqual(capture!.width);
          expect(crop.top + crop.height).toBeLessThanOrEqual(capture!.height);
          const derivative = images.find((entry) => entry.id === cropId);
          expect(derivative, `Missing crop: ${cropId}`).toBeDefined();
          expect(derivative!.width).toBe(crop.width);
          expect(derivative!.height).toBe(crop.height);
        }
        for (const asset of images.filter((entry) => entry.id.startsWith(id))) {
          for (const format of Object.values(asset.variants)) {
            for (const path of Object.values(format)) {
              expect(
                existsSync(new URL(`../../public${path}`, import.meta.url)),
                `Missing generated asset: ${path}`,
              ).toBe(true);
            }
          }
        }
      }
    });
  }
});
