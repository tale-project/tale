// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PRODUCT_SCREENSHOTS,
  PRODUCT_SCREENSHOT_LOCALES,
  type ProductScreenshotPage,
  productScreenshotLocale,
} from '../app/content/product-screenshots';
import { IMAGE_MANIFEST } from '../app/generated/image-manifest';
import { PRODUCT_MOTION } from '../app/generated/product-motion';
import type { MotionCapture } from '../lib/media/product-motion-provenance';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const ROOT = path.join(PUBLIC, 'marketing/product-motion');
const pages = Object.keys(PRODUCT_SCREENSHOTS) as ProductScreenshotPage[];
const variants = ['desktop', 'mobile'] as const;
const formats = ['webm', 'mp4'] as const;
const sha256 = /^[a-f\d]{64}$/;

function captures(): MotionCapture[] {
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'),
  ) as {
    version: number;
    entries: MotionCapture[];
  };
  expect(manifest.version).toBe(1);
  expect(Array.isArray(manifest.entries)).toBe(true);
  return manifest.entries;
}

function mediaFiles(dir = ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory()
      ? mediaFiles(full)
      : /\.(?:webm|mp4)$/.test(entry.name)
        ? [full]
        : [];
  });
}

describe('native marketing product motion assets', () => {
  it('ships the full page, locale, viewport and format matrix without orphaned media', () => {
    expect(pages).toHaveLength(8);
    const proof = captures();
    const keys = proof.map(
      (entry) => `${entry.page}/${entry.locale}/${entry.variant}`,
    );
    const expected = pages.flatMap((page) =>
      PRODUCT_SCREENSHOT_LOCALES.flatMap((locale) =>
        variants.map((variant) => `${page}/${locale}/${variant}`),
      ),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(expected.sort());
    expect(Object.keys(PRODUCT_MOTION).sort()).toEqual([...pages].sort());
    const declared = pages.flatMap((page) =>
      PRODUCT_SCREENSHOT_LOCALES.flatMap((locale) =>
        variants.flatMap((variant) =>
          formats.map((format) => {
            const asset = PRODUCT_MOTION[page]?.[locale]?.[variant];
            if (!asset)
              throw new Error(
                `Missing native motion ${page}/${locale}/${variant}`,
              );
            return path.join(PUBLIC, asset[format]);
          }),
        ),
      ),
    );
    expect(new Set(declared).size).toBe(96);
    expect(mediaFiles().sort()).toEqual(declared.sort());
  });

  it('uses German native motion for Swiss German pages', () => {
    const locale = productScreenshotLocale('de-CH');
    expect(locale).toBe('de');
    for (const page of pages) {
      const german = PRODUCT_MOTION[page]?.[locale];
      expect(german).toBeDefined();
      expect(german?.desktop.webm).toContain('/de/');
      expect(german?.mobile.mp4).toContain('/de/');
    }
  });

  for (const locale of PRODUCT_SCREENSHOT_LOCALES) {
    for (const variant of variants) {
      it(`${locale} ${variant} assets bind native actions, posters and file budgets to actual bytes`, () => {
        const proof = captures();
        for (const page of pages) {
          const asset = PRODUCT_MOTION[page]?.[locale]?.[variant];
          const capture = proof.find(
            (entry) =>
              entry.page === page &&
              entry.locale === locale &&
              entry.variant === variant,
          );
          expect(asset, `${page}/${locale}/${variant} registry`).toBeDefined();
          expect(
            capture,
            `${page}/${locale}/${variant} native provenance`,
          ).toBeDefined();
          if (!asset || !capture)
            throw new Error(
              `Missing native motion ${page}/${locale}/${variant}`,
            );
          expect(capture.sourceShot).toBe(PRODUCT_SCREENSHOTS[page].source);
          expect(capture.route).toMatch(/^\/dashboard\/:orgId\//);
          expect(capture.viewport.width).toBeGreaterThan(0);
          expect(capture.viewport.height).toBeGreaterThan(0);
          expect(capture.dpr).toBeGreaterThanOrEqual(1);
          expect(capture.width).toBeLessThanOrEqual(
            variant === 'mobile' ? 720 : 1280,
          );
          expect(capture.width).toBeGreaterThanOrEqual(
            variant === 'mobile' ? 320 : 960,
          );
          expect(capture.height).toBeGreaterThan(0);
          expect(capture.width).toBeLessThanOrEqual(
            capture.viewport.width * capture.dpr,
          );
          expect(capture.height).toBeLessThanOrEqual(
            capture.viewport.height * capture.dpr,
          );
          expect(capture.durationMs).toBe(8000);
          expect(capture.fps).toBe(24);
          expect(capture.recordedFrameCount).toBeGreaterThanOrEqual(48);
          expect(asset.width).toBe(capture.width);
          expect(asset.height).toBe(capture.height);
          expect(asset.durationMs).toBe(capture.durationMs);

          const action = capture.action;
          expect(action.id).toMatch(/^[a-z][a-z-]+$/);
          expect(action.beforeAssertion.trim().length).toBeGreaterThan(3);
          expect(action.afterAssertion.trim().length).toBeGreaterThan(3);
          expect(action.beforeAssertion).not.toBe(action.afterAssertion);
          expect(action.beforeFrameHash).toMatch(sha256);
          expect(action.afterFrameHash).toMatch(sha256);
          expect(action.beforeFrameHash).not.toBe(action.afterFrameHash);
          expect(action.beforeAtMs).toBeGreaterThanOrEqual(0);
          expect(action.completedAtMs).toBeGreaterThan(action.beforeAtMs);
          expect(action.afterAtMs).toBeGreaterThan(action.completedAtMs);
          expect(action.afterAtMs).toBeLessThan(capture.durationMs - 1000);
          expect(action.inkRegion.left).toBeGreaterThanOrEqual(0);
          expect(action.inkRegion.top).toBeGreaterThanOrEqual(0);
          expect(action.inkRegion.width).toBeGreaterThan(0);
          expect(action.inkRegion.height).toBeGreaterThan(0);
          expect(
            action.inkRegion.left + action.inkRegion.width,
          ).toBeLessThanOrEqual(capture.width + 1);
          expect(
            action.inkRegion.top + action.inkRegion.height,
          ).toBeLessThanOrEqual(capture.height + 1);

          const poster = IMAGE_MANIFEST.find(
            (entry) => entry.id === asset.posterId,
          );
          expect(
            poster,
            `Missing recorded first frame: ${asset.posterId}`,
          ).toBeDefined();
          expect(poster?.width).toBe(capture.width);
          expect(poster?.height).toBe(capture.height);
          for (const imageFormat of Object.values(poster?.variants ?? {})) {
            for (const file of Object.values(imageFormat)) {
              expect(
                readFileSync(path.join(PUBLIC, file)).byteLength,
              ).toBeGreaterThan(0);
            }
          }

          for (const format of formats) {
            expect(asset[format]).toBe(
              `/marketing/product-motion/${locale}/${page}-${variant}.${format}`,
            );
            const bytes = readFileSync(path.join(PUBLIC, asset[format]));
            const encoded = capture[format];
            expect(bytes.byteLength).toBeGreaterThan(1000);
            expect(bytes.byteLength).toBeLessThanOrEqual(
              variant === 'mobile' ? 358400 : 768000,
            );
            expect(bytes.byteLength).toBe(encoded.bytes);
            expect(createHash('sha256').update(bytes).digest('hex')).toBe(
              encoded.sha256,
            );
            expect(
              Math.abs(encoded.durationMs - capture.durationMs),
            ).toBeLessThanOrEqual(100);
            // The actual container signature catches an incorrect format URL;
            // browser decode and the explicit ffprobe verifier prove codecs.
            if (format === 'webm')
              expect([...bytes.subarray(0, 4)]).toEqual([
                0x1a, 0x45, 0xdf, 0xa3,
              ]);
            else expect(bytes.toString('ascii', 4, 8)).toBe('ftyp');
          }
        }
      });
    }
  }
});
