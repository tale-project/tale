import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';
import { collectConsoleErrors, expectPageRenders } from '@tale/e2e/smoke';

import { gotoClientPage } from '../helpers/client-page';

/**
 * Marketing-site smoke: the high-value "does it load and navigate" checks.
 * Labels resolve from `messages/en.yml` (the context pins en-US), never
 * hardcoded literals (AGENTS.md i18n rule).
 */

const { t } = createI18n(new URL('../../../messages/en.yml', import.meta.url));

/** Every English marketing path that must render without console errors. */
const MARKETING_PATHS = [
  '/',
  '/about',
  '/pricing',
  '/contact',
  '/hardware-pricing',
  '/request-demo',
  '/platform',
  '/platform/agents',
  '/platform/chat',
  '/platform/projects',
  '/platform/automations',
  '/platform/knowledge',
  '/platform/governance',
  '/changelog',
] as const;

test.describe('web marketing smoke', () => {
  test('home renders with primary nav and no console errors', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoClientPage(page, '/');
    await expectPageRenders(page);
    await expect(
      page.getByRole('link', { name: t('nav.pricing') }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('nav.platform') }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('nav.resources') }),
    ).toBeVisible();
    await expect(
      page.locator('header').getByRole('link', { name: t('nav.getStarted') }),
    ).toBeVisible();
    await expect(
      page.locator('header').getByRole('link', { name: t('nav.requestDemo') }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: t('nav.platform') }).click();
    await expect(
      page
        .getByRole('navigation')
        .getByRole('link', { name: t('nav.product.chat.label') })
        .first(),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  for (const menuKey of ['platform', 'resources'] as const) {
    test(`desktop ${menuKey} disclosure restores only its own focus on Escape`, async ({
      page,
    }) => {
      await gotoClientPage(page, '/');
      const trigger = page.getByRole('button', { name: t(`nav.${menuKey}`) });
      const panel = page.getByRole('region', { name: t(`nav.${menuKey}`) });
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(panel).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(panel.getByRole('link').first()).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(panel).not.toBeVisible();
      await expect(trigger).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(panel).toBeVisible();
      const pricing = page
        .getByRole('link', { name: t('nav.pricing') })
        .first();
      await pricing.focus();
      await page.keyboard.press('Escape');
      await expect(panel).not.toBeVisible();
      await expect(pricing).toBeFocused();
    });
  }

  for (const path of MARKETING_PATHS) {
    if (path === '/') continue;
    test(`${path} renders`, async ({ page }) => {
      await gotoClientPage(page, path);
      await expectPageRenders(page);
    });
  }

  test('contact page shows a submittable form', async ({ page }) => {
    await gotoClientPage(page, '/contact');
    await expectPageRenders(page);
    await expect(page.locator('form')).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('contact.submit') }),
    ).toBeVisible();
  });

  test('request-demo form still exposes submit by label', async ({ page }) => {
    await gotoClientPage(page, '/request-demo');
    await expectPageRenders(page);
    await expect(page.locator('form')).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('requestDemo.submit') }),
    ).toBeVisible();
  });

  test('German locale route renders', async ({ page }) => {
    await gotoClientPage(page, '/de');
    await expectPageRenders(page);
  });

  for (const locale of ['en', 'de', 'fr'] as const) {
    const { t: tLocale } = createI18n(
      new URL(`../../../messages/${locale}.yml`, import.meta.url),
    );
    const prefix = locale === 'en' ? '' : `/${locale}`;
    test(`${locale} hero links to self-hosting in the same language on desktop and phone`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await gotoClientPage(page, prefix || '/');
        const install = page
          .locator('main section')
          .first()
          .getByRole('link', {
            name: tLocale('home.hero.ctaSecondary'),
            exact: true,
          });
        await expect(install).toBeVisible();
        await expect(install).toHaveAttribute(
          'href',
          `https://docs.tale.dev${prefix}/self-hosted/install/quickstart`,
        );
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          tLocale('home.hero.title'),
        );
      }
    });
  }

  test('German platform + pricing routes render', async ({ page }) => {
    await gotoClientPage(page, '/de/platform');
    await expectPageRenders(page);
    await gotoClientPage(page, '/de/pricing');
    await expectPageRenders(page);
  });

  test('French changelog + contact routes render', async ({ page }) => {
    await gotoClientPage(page, '/fr/changelog');
    await expectPageRenders(page);
    await gotoClientPage(page, '/fr/contact');
    await expectPageRenders(page);
  });

  test('unknown route shows not-found recovery', async ({ page }) => {
    await gotoClientPage(page, '/nope-not-a-route');
    await expectPageRenders(page);
    await expect(
      page.getByRole('heading', { name: t('notFound.title') }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: t('notFound.backHome') }),
    ).toBeVisible();
  });

  test('platform and pricing keep a single h1 and no skipped levels in main', async ({
    page,
  }) => {
    for (const path of ['/platform', '/pricing'] as const) {
      await gotoClientPage(page, path);
      await expectPageRenders(page);
      const outline = await page.evaluate(() =>
        [...document.querySelectorAll('main h1, main h2, main h3')].map((el) =>
          Number(el.tagName[1]),
        ),
      );
      expect(outline.filter((n) => n === 1)).toHaveLength(1);
      let last = 0;
      for (const level of outline) {
        if (last > 0) expect(level).toBeLessThanOrEqual(last + 1);
        last = level;
      }
    }
  });
});
