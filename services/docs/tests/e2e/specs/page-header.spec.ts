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
