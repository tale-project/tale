import { expect, test, type Page } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';
import { JSDOM } from 'jsdom';

const { t } = createI18n(new URL('../../../messages/en.yml', import.meta.url));

test.use({ contextOptions: { reducedMotion: 'no-preference' } });

async function framePositions(page: Page, frames = 40) {
  return page.evaluate(async (count) => {
    const positions = [scrollY];
    for (let frame = 0; frame < count; frame += 1) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      positions.push(scrollY);
    }
    return positions;
  }, frames);
}

/** CI's client-only preview has no prerendered body. Capture the real rendered
 * homepage as its initial document, so the same startup regression runs there
 * and against production's actual prerendered HTML without a duplicate fixture. */
async function homepageDocument(page: Page, baseURL: string) {
  const response = await page.goto(baseURL);
  expect(response).not.toBeNull();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const dom = new JSDOM(await response!.text());
  try {
    const root = dom.window.document.getElementById('root');
    if (!root) throw new Error('Homepage response has no root');
    if (!root.querySelector('h1'))
      root.innerHTML = await page.locator('#root').innerHTML();
    const marker = dom.window.document.createElement('span');
    marker.hidden = true;
    marker.dataset.startupSnapshot = '';
    root.append(marker);
    const entry = dom.window.document
      .querySelector('script[type="module"][src]')
      ?.getAttribute('src');
    if (!entry) throw new Error('Homepage response has no module entry');
    const routeChunk = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((resource) => resource.name)
        .find((url) => /\/home-page(?:-[^/]+\.js|\.tsx)(?:\?|$)/.test(url)),
    );
    if (!routeChunk) throw new Error('Homepage did not load its route chunk');
    return {
      html: dom.serialize(),
      entry: new URL(entry, page.url()).href,
      routeChunk,
    };
  } finally {
    dom.window.close();
  }
}

for (const width of [390, 1440]) {
  for (const hash of ['', '#features']) {
    test(`cold homepage preserves reading position${hash ? ' after its initial hash' : ''} at ${width}px`, async ({
      page,
      browser,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      // A separate context avoids WebKit's warm module cache bypassing the
      // intentionally paused request in the actual cold-start page.
      const reference = await browser.newPage({
        viewport: { width, height: 844 },
        reducedMotion: 'no-preference',
      });
      let snapshot: Awaited<ReturnType<typeof homepageDocument>>;
      try {
        snapshot = await homepageDocument(reference, baseURL!);
      } finally {
        await reference.close();
      }
      const { html, entry, routeChunk } = snapshot;
      const gate = Promise.withResolvers<void>();
      await page.route(hash ? routeChunk : entry, async (route) => {
        await gate.promise;
        await route.continue();
      });
      await page.route(
        (url) => url.pathname === '/',
        (route) => route.fulfill({ contentType: 'text/html', body: html }),
      );
      try {
        await page.goto(`/${hash}`, {
          waitUntil: hash ? 'domcontentloaded' : 'commit',
        });
        await expect(page.locator('[data-startup-snapshot]')).toBeAttached();
        // Native fragment navigation finishes at DOMContentLoaded. Hold only
        // the lazy route chunk, so this measures the router's later commit.
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await framePositions(page, 2);
        const position = await page.evaluate((hasHash) => {
          const anchor = document.getElementById('features');
          const top = hasHash && anchor ? anchor.offsetTop + 700 : 1200;
          window.scrollTo({ top, behavior: 'instant' });
          return scrollY;
        }, Boolean(hash));
        expect(position).toBeGreaterThan(1000);
        gate.resolve();
        await expect(page.locator('[data-startup-snapshot]')).toHaveCount(0);
        const positions = await framePositions(page);
        expect(
          Math.max(...positions.map((value) => Math.abs(value - position))),
        ).toBeLessThanOrEqual(1);
        if (hash) {
          // Suppressing the startup replay must not suppress a later explicit
          // visit to another real section, or re-anchor subsequent scrolling.
          await page.goto('/#main');
          await expect(page).toHaveURL(/#main$/);
          await expect
            .poll(() => page.evaluate(() => scrollY))
            .toBeLessThan(100);
          await framePositions(page);
          await page.mouse.wheel(0, 500);
          const continued = (await framePositions(page)).at(-1)!;
          expect(continued).toBeGreaterThan(300);
          const settled = await framePositions(page);
          expect(
            Math.max(...settled.map((value) => Math.abs(value - continued))),
          ).toBeLessThanOrEqual(1);
        }
      } finally {
        gate.resolve();
      }
    });
  }

  test(`untouched initial homepage hash reaches its section at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#features');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(500);
    await framePositions(page);
    const top = await page
      .locator('#features')
      .evaluate((element) => element.getBoundingClientRect().top);
    expect(Math.abs(top)).toBeLessThanOrEqual(100);
  });

  test(`normal-motion homepage keeps wheel progress at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    let previous = await page.evaluate(() => scrollY);
    for (let step = 0; step < 5; step += 1) {
      await page.mouse.wheel(0, 650);
      await expect
        .poll(() => page.evaluate(() => scrollY))
        .toBeGreaterThan(previous + 400);
      const positions = await framePositions(page, 20);
      for (let index = 1; index < positions.length; index += 1)
        expect(positions[index]).toBeGreaterThanOrEqual(
          positions[index - 1] - 1,
        );
      previous = positions.at(-1)!;
    }
  });

  test(`following a homepage anchor then hovering navigation keeps reading position at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // This is a same-document visit to the homepage's real section URL,
    // followed by the reader continuing beyond that requested destination.
    await page.goto('/#features');
    await expect(page).toHaveURL(/#features$/);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(500);
    await framePositions(page);
    await page.mouse.wheel(0, 900);
    const positions = await framePositions(page);
    const position = positions.at(-1)!;
    const pricing = page
      .locator('header')
      .getByRole('link', { name: t('nav.pricing') })
      .first();
    if (await pricing.isVisible()) await pricing.hover();
    else await page.locator('header a').first().hover();
    const afterHover = await framePositions(page);
    expect(
      Math.max(...afterHover.map((value) => Math.abs(value - position))),
    ).toBeLessThanOrEqual(1);
    if (await pricing.isVisible()) {
      await pricing.click();
      await expect(page).toHaveURL(/\/pricing$/);
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    }
  });
}
