import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';
import { collectConsoleErrors } from '@tale/e2e/smoke';

for (const locale of ['en', 'de', 'fr'] as const) {
  const { t } = createI18n(
    new URL(`../../../messages/${locale}.yml`, import.meta.url),
  );
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const releasePath = `${prefix}/self-hosted/configuration/config-releases`;

  test.describe(`${locale} docs page header`, () => {
    for (const width of [1440, 390]) {
      test(`starts keyboard navigation at the skip link at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(releasePath);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.keyboard.press('Tab');
        await expect(
          page.getByRole('link', { name: t('nav.skipToMain') }),
        ).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('main')).toBeFocused();
      });
    }

    test('wraps long page titles within the phone viewport', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 960 });
      await page.goto(`${prefix}/self-hosted/configuration/secrets-with-sops`);
      const title = page.getByRole('heading', { level: 1 });
      await expect(title).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(390);
      const dimensions = await title.evaluate((element) => ({
        content: element.scrollWidth,
        available: element.clientWidth,
      }));
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.available);
    });

    test('uses the translated navigation group when a section has no index page', async ({
      page,
    }) => {
      for (const slug of ['providers', 'config-releases']) {
        await page.goto(`${prefix}/self-hosted/configuration/${slug}`);
        const trail = page.getByRole('navigation', {
          name: t('docs.breadcrumbs'),
        });
        await expect(
          trail.getByText(t('nav.groups.configuration'), { exact: true }),
        ).toBeVisible();
        await expect(trail.locator('[aria-current="page"]')).toHaveText(
          await page.getByRole('heading', { level: 1 }).innerText(),
        );
        await expect(
          trail.getByRole('link', { name: t('docs.home') }),
        ).toHaveAttribute('href', locale === 'en' ? '/' : `/${locale}`);
      }
    });

    test('keeps the phone trail above readable actions and restores menu focus', async ({
      page,
    }) => {
      const errors = collectConsoleErrors(page);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(releasePath);
      const trail = page.getByRole('navigation', {
        name: t('docs.breadcrumbs'),
      });
      const copy = page.getByRole('button', {
        name: t('docs.pageActions.copyPage'),
        exact: true,
      });
      const open = page.getByRole('button', {
        name: t('docs.pageActions.openIn'),
        exact: true,
      });
      await expect(trail).toBeVisible();
      await expect(copy).toBeVisible();
      await expect(open).toBeVisible();
      const trailBox = (await trail.boundingBox())!;
      const copyBox = (await copy.boundingBox())!;
      const openBox = (await open.boundingBox())!;
      expect(trailBox.y + trailBox.height).toBeLessThanOrEqual(copyBox.y);
      expect(openBox.x + openBox.width).toBeLessThanOrEqual(375);
      expect(copyBox.x).toBeGreaterThanOrEqual(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(375);
      await open.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();
      await expect(open).toBeFocused();
      expect(errors).toEqual([]);
    });

    test('keeps the trail leaf out of the heading outline', async ({
      page,
    }) => {
      await page.goto(releasePath);
      // The app's trail ends in the page's `h1`; a docs page carries that
      // title in the article instead, so the leaf must stay a plain marker —
      // one `h1` per page, and it is the article's.
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.locator('article > header > h1')).toHaveCount(1);
      await expect(
        page
          .getByRole('navigation', { name: t('docs.breadcrumbs') })
          .locator('[aria-current="page"]'),
      ).toHaveCount(1);
    });

    test('preserves the desktop breadcrumb and actions row', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(releasePath);
      const trail = page.getByRole('navigation', {
        name: t('docs.breadcrumbs'),
      });
      const copy = page.getByRole('button', {
        name: t('docs.pageActions.copyPage'),
        exact: true,
      });
      await expect(trail).toBeVisible();
      await expect(copy).toBeVisible();
      const trailBox = (await trail.boundingBox())!;
      const copyBox = (await copy.boundingBox())!;
      expect(trailBox.x + trailBox.width).toBeLessThan(copyBox.x);
      expect(
        Math.abs(
          trailBox.y + trailBox.height / 2 - (copyBox.y + copyBox.height / 2),
        ),
      ).toBeLessThan(2);
    });
  });
}
