import { expect, type Locator, type Page, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';

import {
  PRODUCT_SCREENSHOTS,
  type ProductScreenshotPage,
} from '../../../app/content/product-screenshots';
import { IMAGE_MANIFEST } from '../../../app/generated/image-manifest';
import { PRODUCT_MOTION } from '../../../app/generated/product-motion';
import type { MotionCapture } from '../../../lib/media/product-motion-provenance';
import { gotoClientPage } from '../helpers/client-page';

const catalogs = {
  en: createI18n(new URL('../../../messages/en.yml', import.meta.url)),
  de: createI18n(new URL('../../../messages/de.yml', import.meta.url)),
  fr: createI18n(new URL('../../../messages/fr.yml', import.meta.url)),
};
const locales = ['en', 'de', 'fr'] as const;
const pages = Object.keys(PRODUCT_SCREENSHOTS) as ProductScreenshotPage[];
const mediaRequest = /\/marketing\/product-motion\/[^?]+\.(?:webm|mp4)(?:\?|$)/;

function pagePath(page: ProductScreenshotPage, locale = 'en'): string {
  const path =
    page === 'home' ? '/' : page === 'hub' ? '/platform' : `/platform/${page}`;
  return locale === 'en' ? path : `/${locale}${path === '/' ? '' : path}`;
}

function figureOn(page: Page, id: ProductScreenshotPage): Locator {
  return page.locator(`[data-product-screenshot="${id}"]`);
}

function videoIn(figure: Locator): Locator {
  return figure.locator('video');
}

/** Give browser observers and React effects real frames to react to external inputs. */
async function settleFrames(page: Page, count = 8): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let frame = 0; frame < frames; frame += 1) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
  }, count);
}

async function expectReadablePoster(figure: Locator): Promise<void> {
  const picture = figure.locator('picture img');
  await expect(picture).toBeVisible();
  await expect
    .poll(() =>
      picture.evaluate((image: HTMLImageElement) => {
        if (!image.complete || image.naturalWidth === 0) return false;
        for (
          let node: Element | null = image;
          node;
          node = node.parentElement
        ) {
          const style = getComputedStyle(node);
          if (
            style.display === 'none' ||
            style.visibility !== 'visible' ||
            Number(style.opacity) === 0
          )
            return false;
          if (node.tagName === 'FIGURE') break;
        }
        return true;
      }),
    )
    .toBe(true);
}

async function expectPlaying(figure: Locator): Promise<void> {
  const video = videoIn(figure);
  await expect(video).toHaveCount(1);
  await expect
    .poll(() =>
      video.evaluate(
        (element: HTMLVideoElement) =>
          !element.paused && element.readyState >= 2 && element.videoWidth > 0,
      ),
    )
    .toBe(true);
  const started = await video.evaluate(
    (element: HTMLVideoElement) => element.currentTime,
  );
  // Playback can loop between samples. The positive modulo duration still
  // requires a real media clock to have progressed, rather than an attribute.
  await expect
    .poll(() =>
      video.evaluate(
        (element: HTMLVideoElement, before) =>
          (element.currentTime - before + element.duration) % element.duration,
        started,
      ),
    )
    .toBeGreaterThan(0.12);
  await expect(figure).toHaveAttribute('data-product-motion-state', 'playing');
}

async function expectPaused(video: Locator, page: Page): Promise<void> {
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(true);
  const before = await video.evaluate(
    (element: HTMLVideoElement) => element.currentTime,
  );
  await settleFrames(page, 12);
  const after = await video.evaluate(
    (element: HTMLVideoElement) => element.currentTime,
  );
  expect(Math.abs(after - before)).toBeLessThan(0.04);
}

/** Decode and seek the shipped file itself, including the MP4 compatibility source. */
async function decodedAction(
  page: Page,
  url: string,
  proof: MotionCapture,
  posterUrl: string,
) {
  return page.evaluate(
    async ({ source, capture, posterSource }) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.style.cssText =
        'position:fixed;left:0;top:0;width:1px;height:1px;z-index:2147483647;pointer-events:none';
      document.body.append(video);
      const timeout = (reject: (reason: Error) => void) =>
        window.setTimeout(
          () => reject(new Error(`Media did not decode: ${source}`)),
          20_000,
        );
      try {
        let firstFrameTime = -1;
        await new Promise<void>((resolve, reject) => {
          const timer = timeout(reject);
          let loaded = false;
          const finish = () => {
            if (loaded && firstFrameTime >= 0) {
              clearTimeout(timer);
              resolve();
            }
          };
          const callback = video.requestVideoFrameCallback((_, metadata) => {
            firstFrameTime = metadata.mediaTime;
            finish();
          });
          video.addEventListener(
            'loadeddata',
            () => {
              loaded = true;
              finish();
            },
            { once: true },
          );
          video.addEventListener(
            'error',
            () => {
              clearTimeout(timer);
              video.cancelVideoFrameCallback(callback);
              reject(
                new Error(
                  `Media decoder error: ${video.error?.message ?? source}`,
                ),
              );
            },
            { once: true },
          );
          video.src = source;
          video.load();
        });
        const inkDifference = (
          before: Uint8ClampedArray,
          after: Uint8ClampedArray,
        ) => {
          let changedInk = 0;
          for (let pixel = 0; pixel < before.length; pixel += 4) {
            const delta = Math.max(
              Math.abs(before[pixel] - after[pixel]),
              Math.abs(before[pixel + 1] - after[pixel + 1]),
              Math.abs(before[pixel + 2] - after[pixel + 2]),
            );
            const darkest = Math.min(
              before[pixel],
              before[pixel + 1],
              before[pixel + 2],
              after[pixel],
              after[pixel + 1],
              after[pixel + 2],
            );
            if (delta > 28 && darkest < 220) changedInk += 1;
          }
          return changedInk / (before.length / 4);
        };
        const continuity = document.createElement('canvas');
        const frameScale = Math.min(
          1,
          512 / video.videoWidth,
          512 / video.videoHeight,
        );
        continuity.width = Math.round(video.videoWidth * frameScale);
        continuity.height = Math.round(video.videoHeight * frameScale);
        const continuityContext = continuity.getContext('2d', {
          willReadFrequently: true,
        });
        if (!continuityContext)
          throw new Error('A decoded first frame needs a canvas context');
        continuityContext.drawImage(
          video,
          0,
          0,
          continuity.width,
          continuity.height,
        );
        const firstFrame = continuityContext.getImageData(
          0,
          0,
          continuity.width,
          continuity.height,
        ).data;
        const poster = new Image();
        poster.src = posterSource;
        await poster.decode();
        continuityContext.drawImage(
          poster,
          0,
          0,
          continuity.width,
          continuity.height,
        );
        const posterMismatchRatio = inkDifference(
          firstFrame,
          continuityContext.getImageData(
            0,
            0,
            continuity.width,
            continuity.height,
          ).data,
        );
        const region = capture.action.inkRegion;
        const scale = Math.min(1, 256 / region.width, 256 / region.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(region.width * scale));
        canvas.height = Math.max(1, Math.round(region.height * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context)
          throw new Error(
            'The actual decoded product frame needs a canvas context',
          );
        const presentedTimes: number[] = [];
        const frameAt = async (timeMs: number) => {
          const target = timeMs / 1000;
          const presented = await new Promise<number>((resolve, reject) => {
            let callback = 0;
            const timer = window.setTimeout(() => {
              video.cancelVideoFrameCallback(callback);
              reject(
                new Error(`No decoded frame was presented at ${timeMs}ms`),
              );
            }, 20_000);
            const inspect = (
              _now: number,
              metadata: VideoFrameCallbackMetadata,
            ) => {
              if (Math.abs(metadata.mediaTime - target) <= 0.06) {
                clearTimeout(timer);
                resolve(metadata.mediaTime);
              } else callback = video.requestVideoFrameCallback(inspect);
            };
            callback = video.requestVideoFrameCallback(inspect);
            video.currentTime = target;
          });
          presentedTimes.push(presented);
          context.drawImage(
            video,
            region.left,
            region.top,
            region.width,
            region.height,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          return context.getImageData(0, 0, canvas.width, canvas.height).data;
        };
        const before = await frameAt(capture.action.beforeAtMs);
        const after = await frameAt(capture.action.afterAtMs);
        return {
          width: video.videoWidth,
          height: video.videoHeight,
          durationMs: video.duration * 1000,
          changedInkRatio: inkDifference(before, after),
          firstFrameTime,
          presentedTimes,
          posterWidth: poster.naturalWidth,
          posterHeight: poster.naturalHeight,
          posterMismatchRatio,
        };
      } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      }
    },
    { source: url, capture: proof, posterSource: posterUrl },
  );
}

test.describe('real product hero playback', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  for (const locale of locales) {
    for (const width of [320, 1440]) {
      test(`${locale} uses only its responsive product clips at ${width}px`, async ({
        page,
      }) => {
        const { t } = catalogs[locale];
        await page.setViewportSize({ width, height: 1000 });
        for (const id of pages) {
          const variant = width < 640 ? 'mobile' : 'desktop';
          const asset = PRODUCT_MOTION[id]?.[locale]?.[variant];
          expect(
            asset,
            `Missing ${id}/${locale}/${variant} recording`,
          ).toBeDefined();
          if (!asset)
            throw new Error(`Missing motion recording for ${id}/${locale}`);
          const requests: string[] = [];
          const track = (request: { url(): string }) => {
            if (mediaRequest.test(request.url())) requests.push(request.url());
          };
          page.on('request', track);
          try {
            await gotoClientPage(page, pagePath(id, locale));
            const figure = figureOn(page, id);
            await figure.scrollIntoViewIfNeeded();
            await expectPlaying(figure);
            const video = videoIn(figure);
            expect(
              await video.evaluate(
                (element: HTMLVideoElement) =>
                  new URL(element.currentSrc).pathname,
              ),
            ).toBe(asset.webm);
            await expect(
              figure.getByRole('button', {
                name: t('demo.pages.pauseMotion'),
                exact: true,
              }),
            ).toBeVisible();
            await expect(
              figure.getByRole('link', {
                name: t('demo.pages.viewLabel'),
                exact: true,
              }),
            ).toHaveAttribute('target', '_blank');
            expect(requests.length).toBeGreaterThan(0);
            expect(
              requests.every((url) => new URL(url).pathname === asset.webm),
            ).toBe(true);
            const bounds = await video.boundingBox();
            expect(bounds).not.toBeNull();
            if (!bounds)
              throw new Error('A decoded video must have visible geometry');
            expect(bounds.x).toBeGreaterThanOrEqual(0);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
            expect(
              Math.abs(
                bounds.width / bounds.height - asset.width / asset.height,
              ),
            ).toBeLessThan(0.01);
            expect(
              await page.evaluate(() => document.body.scrollWidth),
            ).toBeLessThanOrEqual(width);
            await expect(
              figure.locator('a button, a video[controls]'),
            ).toHaveCount(0);
          } finally {
            page.off('request', track);
          }
        }
      });
    }
  }

  test('keyboard pause survives leaving and reentering the viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoClientPage(page, pagePath('agents'));
    const figure = figureOn(page, 'agents');
    await figure.scrollIntoViewIfNeeded();
    await expectPlaying(figure);
    const pause = figure.getByRole('button', {
      name: catalogs.en.t('demo.pages.pauseMotion'),
      exact: true,
    });
    await pause.focus();
    await page.keyboard.press('Space');
    const play = figure.getByRole('button', {
      name: catalogs.en.t('demo.pages.playMotion'),
      exact: true,
    });
    await expect(play).toBeFocused();
    await expectPaused(videoIn(figure), page);
    await page.locator('footer').scrollIntoViewIfNeeded();
    await expectReadablePoster(figure);
    await figure.scrollIntoViewIfNeeded();
    await expectPaused(videoIn(figure), page);
    await expect(play).toBeVisible();
    await play.focus();
    await page.keyboard.press('Enter');
    await expectPlaying(figure);
  });

  test('offscreen heroes make no initial media request and pause when scrolled away', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 200 });
    const requests: string[] = [];
    page.on('request', (request) => {
      if (mediaRequest.test(request.url())) requests.push(request.url());
    });
    await gotoClientPage(page, pagePath('agents'));
    const figure = figureOn(page, 'agents');
    await settleFrames(page);
    const bounds = await figure.boundingBox();
    expect(bounds?.y).toBeGreaterThanOrEqual(200);
    await expect(videoIn(figure)).toHaveCount(0);
    expect(requests).toEqual([]);
    await figure.scrollIntoViewIfNeeded();
    await expectPlaying(figure);
    await page.locator('footer').scrollIntoViewIfNeeded();
    await expectPaused(videoIn(figure), page);
    await expectReadablePoster(figure);
    await figure.scrollIntoViewIfNeeded();
    await expectPlaying(figure);
  });

  test('a changed motion preference stops real playback and restores the picture', async ({
    page,
  }) => {
    await gotoClientPage(page, pagePath('agents'));
    const figure = figureOn(page, 'agents');
    await figure.scrollIntoViewIfNeeded();
    await expectPlaying(figure);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expectPaused(videoIn(figure), page);
    await expectReadablePoster(figure);
  });

  test('visibility changes pause actual media without losing an explicit user pause', async ({
    page,
  }) => {
    await gotoClientPage(page, pagePath('agents'));
    const figure = figureOn(page, 'agents');
    await figure.scrollIntoViewIfNeeded();
    await expectPlaying(figure);
    // Headless tabs remain visible. Supply the browser environment event,
    // while paused/currentTime/decoding continue to come from actual media.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expectPaused(videoIn(figure), page);
    await expectReadablePoster(figure);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'visibilityState');
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expectPlaying(figure);
    await figure
      .getByRole('button', {
        name: catalogs.en.t('demo.pages.pauseMotion'),
        exact: true,
      })
      .click();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
      Reflect.deleteProperty(document, 'visibilityState');
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expectPaused(videoIn(figure), page);
  });

  test('failed codecs leave a readable image and its original-resolution link', async ({
    page,
  }) => {
    await page.route(mediaRequest, (route) => route.abort('failed'));
    await gotoClientPage(page, pagePath('agents'));
    const figure = figureOn(page, 'agents');
    await figure.scrollIntoViewIfNeeded();
    await expect(figure).toHaveAttribute('data-product-motion-state', 'error');
    await expect(videoIn(figure)).toHaveCount(0);
    await expectReadablePoster(figure);
    const original = figure.getByRole('link', {
      name: catalogs.en.t('demo.pages.viewLabel'),
      exact: true,
    });
    await expect(original).toHaveAttribute('href', /\.webp$/);
    await original.focus();
    await expect(original).toBeFocused();
  });

  test('a failed WebM source still decodes and plays the real MP4 fallback', async ({
    page,
  }) => {
    await page.route(
      /\/marketing\/product-motion\/[^?]+\.webm(?:\?|$)/,
      (route) => route.abort('failed'),
    );
    await gotoClientPage(page, pagePath('agents'));
    const figure = figureOn(page, 'agents');
    await figure.scrollIntoViewIfNeeded();
    await expectPlaying(figure);
    const src = await videoIn(figure).evaluate(
      (element: HTMLVideoElement) => element.currentSrc,
    );
    expect(new URL(src).pathname).toBe(PRODUCT_MOTION.agents?.en?.desktop.mp4);
    await expect(
      figure.getByRole('button', {
        name: catalogs.en.t('demo.pages.pauseMotion'),
        exact: true,
      }),
    ).toBeVisible();
  });

  test('a delayed first frame keeps the static picture and stable media geometry', async ({
    page,
  }) => {
    let releaseMedia = () => {};
    const held = new Promise<void>((resolve) => {
      releaseMedia = resolve;
    });
    await page.route(mediaRequest, async (route) => {
      await held;
      await route.continue();
    });
    try {
      await gotoClientPage(page, pagePath('agents'));
      const figure = figureOn(page, 'agents');
      await figure.scrollIntoViewIfNeeded();
      await expect(videoIn(figure)).toHaveCount(1);
      await expect(figure).toHaveAttribute(
        'data-product-motion-state',
        'loading',
      );
      await expectReadablePoster(figure);
      const picture = figure.locator('picture');
      const before = await picture.boundingBox();
      expect(before).not.toBeNull();
      releaseMedia();
      await expectPlaying(figure);
      const after = await picture.boundingBox();
      expect(after).not.toBeNull();
      if (!before || !after)
        throw new Error('Media needs a stable reserved frame');
      expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
    } finally {
      releaseMedia();
    }
  });

  test('viewport changes load the matching native crop before revealing motion', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoClientPage(page, pagePath('agents'));
    const figure = figureOn(page, 'agents');
    await figure.scrollIntoViewIfNeeded();
    await expectPlaying(figure);
    const previous = await videoIn(figure).elementHandle();
    let releaseMobile = () => {};
    const held = new Promise<void>((resolve) => {
      releaseMobile = resolve;
    });
    await page.route(
      /\/marketing\/product-motion\/en\/agents-mobile\.(?:webm|mp4)(?:\?|$)/,
      async (route) => {
        await held;
        await route.continue();
      },
    );
    try {
      await page.setViewportSize({ width: 320, height: 1000 });
      await figure.scrollIntoViewIfNeeded();
      await expect(videoIn(figure)).toHaveAttribute(
        'data-product-motion-variant',
        'mobile',
      );
      await expect(figure).toHaveAttribute(
        'data-product-motion-state',
        'loading',
      );
      if (
        previous &&
        !(await previous.evaluate((video) => video.isConnected))
      ) {
        expect(
          await previous.evaluate((video: HTMLVideoElement) => video.paused),
        ).toBe(true);
      }
      await expectReadablePoster(figure);
      const source = await figure
        .locator('picture img')
        .evaluate((image: HTMLImageElement) => image.currentSrc);
      expect(source).toContain(PRODUCT_MOTION.agents?.en?.mobile.posterId);
      const poster = await figure.locator('picture').boundingBox();
      expect(poster?.x).toBeGreaterThanOrEqual(0);
      expect((poster?.x ?? 320) + (poster?.width ?? 320)).toBeLessThanOrEqual(
        321,
      );
      releaseMobile();
      await expectPlaying(figure);
      const media = await videoIn(figure).evaluate(
        (video: HTMLVideoElement) => ({
          src: new URL(video.currentSrc).pathname,
          width: video.videoWidth,
          height: video.videoHeight,
        }),
      );
      expect(media.src).toBe(PRODUCT_MOTION.agents?.en?.mobile.webm);
      expect(media.width).toBe(PRODUCT_MOTION.agents?.en?.mobile.width);
      expect(media.height).toBe(PRODUCT_MOTION.agents?.en?.mobile.height);
      const decoded = await videoIn(figure).boundingBox();
      expect(decoded?.width).toBeCloseTo(poster?.width ?? 0, 0);
      expect(decoded?.height).toBeCloseTo(poster?.height ?? 0, 0);
      await figure
        .getByRole('button', {
          name: catalogs.en.t('demo.pages.pauseMotion'),
          exact: true,
        })
        .click();
      await expectPaused(videoIn(figure), page);
      const requestsAfterPause: string[] = [];
      const trackPaused = (request: { url(): string }) => {
        if (mediaRequest.test(request.url()))
          requestsAfterPause.push(request.url());
      };
      page.on('request', trackPaused);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await figure.scrollIntoViewIfNeeded();
      await expectReadablePoster(figure);
      await expect(figure).toHaveAttribute(
        'data-product-motion-state',
        'paused',
      );
      await expect(videoIn(figure)).toHaveCount(0);
      expect(
        await figure
          .locator('picture img')
          .evaluate((image: HTMLImageElement) => image.currentSrc),
      ).toContain(PRODUCT_MOTION.agents?.en?.desktop.posterId);
      const resume = figure.getByRole('button', {
        name: catalogs.en.t('demo.pages.playMotion'),
        exact: true,
      });
      await expect(resume).toBeVisible();
      await settleFrames(page, 12);
      expect(requestsAfterPause).toEqual([]);
      page.off('request', trackPaused);
      await resume.click();
      await expectPlaying(figure);
      await expect(videoIn(figure)).toHaveAttribute(
        'data-product-motion-variant',
        'desktop',
      );
      expect(
        await videoIn(figure).evaluate(
          (video: HTMLVideoElement) => new URL(video.currentSrc).pathname,
        ),
      ).toBe(PRODUCT_MOTION.agents?.en?.desktop.webm);
      expect(errors).toEqual([]);
    } finally {
      releaseMobile();
    }
  });
});

test.describe('static product fallback', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  for (const locale of locales) {
    test(`${locale} reduced motion attaches no automatic media sources`, async ({
      page,
    }) => {
      const requests: string[] = [];
      page.on('request', (request) => {
        if (mediaRequest.test(request.url())) requests.push(request.url());
      });
      for (const id of pages) {
        await gotoClientPage(page, pagePath(id, locale));
        const figure = figureOn(page, id);
        await figure.scrollIntoViewIfNeeded();
        await settleFrames(page);
        await expectReadablePoster(figure);
        await expect(videoIn(figure)).toHaveCount(0);
      }
      expect(requests).toEqual([]);
    });
  }

  test('Swiss pages use German media after motion is intentionally enabled', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      locale: 'de-CH',
      reducedMotion: 'reduce',
      viewport: { width: 1440, height: 1000 },
    });
    try {
      const page = await context.newPage();
      // Regional messages use a base-language URL, never a /de-CH prefix.
      await gotoClientPage(page, pagePath('agents', 'de'));
      const figure = figureOn(page, 'agents');
      await figure.scrollIntoViewIfNeeded();
      await expectReadablePoster(figure);
      await expect(videoIn(figure)).toHaveCount(0);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expectPlaying(figure);
      const src = await videoIn(figure).evaluate(
        (element: HTMLVideoElement) => element.currentSrc,
      );
      expect(new URL(src).pathname).toBe(
        PRODUCT_MOTION.agents?.de?.desktop.webm,
      );
    } finally {
      await context.close();
    }
  });
});

test.describe('actual encoded product actions', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  for (const locale of locales) {
    for (const variant of ['desktop', 'mobile'] as const) {
      test(`${locale} ${variant} action frames decode in both shipped codecs`, async ({
        page,
        request,
      }) => {
        await page.setViewportSize({
          width: variant === 'mobile' ? 320 : 1440,
          height: 1000,
        });
        await gotoClientPage(page, pagePath('agents', locale));
        const response = await request.get(
          '/marketing/product-motion/manifest.json',
        );
        expect(response.ok()).toBe(true);
        const manifest = (await response.json()) as {
          entries: MotionCapture[];
        };
        for (const id of pages) {
          const proof = manifest.entries.find(
            (entry) =>
              entry.page === id &&
              entry.locale === locale &&
              entry.variant === variant,
          );
          expect(
            proof,
            `Missing action provenance for ${id}/${locale}/${variant}`,
          ).toBeDefined();
          const asset = PRODUCT_MOTION[id]?.[locale]?.[variant];
          if (!proof || !asset)
            throw new Error(
              `Missing native action recording for ${id}/${locale}/${variant}`,
            );
          expect(proof.action.beforeAssertion).not.toBe(
            proof.action.afterAssertion,
          );
          const poster = IMAGE_MANIFEST.find(
            (entry) => entry.id === asset.posterId,
          );
          const nativePoster = poster?.variants.webp[asset.width];
          if (!nativePoster)
            throw new Error(`Missing native first frame ${asset.posterId}`);
          for (const format of ['webm', 'mp4'] as const) {
            const decoded = await decodedAction(
              page,
              asset[format],
              proof,
              nativePoster,
            );
            expect(decoded.width).toBe(asset.width);
            expect(decoded.height).toBe(asset.height);
            expect(decoded.firstFrameTime).toBeLessThan(0.05);
            for (const [index, timeMs] of [
              proof.action.beforeAtMs,
              proof.action.afterAtMs,
            ].entries()) {
              expect(
                Math.abs(decoded.presentedTimes[index] * 1000 - timeMs),
              ).toBeLessThanOrEqual(60);
            }
            expect(decoded.posterWidth).toBe(asset.width);
            expect(decoded.posterHeight).toBe(asset.height);
            expect(
              decoded.posterMismatchRatio,
              `${id}/${locale}/${variant}/${format} starts in a different scene from its still poster`,
            ).toBeLessThan(0.025);
            expect(
              Math.abs(decoded.durationMs - asset.durationMs),
            ).toBeLessThanOrEqual(100);
            // Native capture assertions and an explicit result region bind
            // this change to UI information, rather than pointer movement.
            expect(
              decoded.changedInkRatio,
              `${id}/${locale}/${variant}/${format} did not visibly change the asserted UI result`,
            ).toBeGreaterThan(0.005);
          }
        }
      });
    }
  }
});

test.describe('prerendered motion fallback', () => {
  test.use({
    javaScriptEnabled: false,
    contextOptions: { reducedMotion: 'no-preference' },
  });

  for (const locale of locales) {
    for (const width of [320, 1440]) {
      test(`${locale} retains responsive product images and inspection links without JavaScript at ${width}px`, async ({
        page,
      }) => {
        const requests: string[] = [];
        page.on('request', (request) => {
          if (mediaRequest.test(request.url())) requests.push(request.url());
        });
        await page.setViewportSize({ width, height: 1000 });
        // Vite preview falls back to the SPA for extensionless paths. Read
        // the actual prerendered file; production URL serving has SEO guards.
        await page.goto(`${pagePath('agents', locale)}/index.html`);
        const figure = figureOn(page, 'agents');
        await expectReadablePoster(figure);
        const variant = width < 640 ? 'mobile' : 'desktop';
        const asset = PRODUCT_MOTION.agents?.[locale]?.[variant];
        expect(asset).toBeDefined();
        if (!asset) throw new Error(`Missing ${locale}/${variant} recording`);
        expect(
          await figure
            .locator('picture img')
            .evaluate((image: HTMLImageElement) => image.currentSrc),
        ).toContain(asset.posterId);
        const picture = await figure.locator('picture').boundingBox();
        expect(picture).not.toBeNull();
        if (!picture) throw new Error('The SSR picture needs native geometry');
        expect(picture.x).toBeGreaterThanOrEqual(0);
        expect(picture.x + picture.width).toBeLessThanOrEqual(width + 1);
        expect(
          Math.abs(picture.width / picture.height - asset.width / asset.height),
        ).toBeLessThan(0.01);
        await expect(
          figure.getByRole('link', {
            name: catalogs[locale].t('demo.pages.viewLabel'),
            exact: true,
          }),
        ).toHaveAttribute('href', /\.webp$/);
        await expect(videoIn(figure)).toHaveCount(0);
        expect(requests).toEqual([]);
      });
    }
  }
});
