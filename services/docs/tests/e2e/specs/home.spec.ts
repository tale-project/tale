import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';
import { collectConsoleErrors } from '@tale/e2e/smoke';

for (const locale of ['en', 'de', 'fr'] as const) {
  const { t } = createI18n(
    new URL(`../../../messages/${locale}.yml`, import.meta.url),
    {
      packages: [
        new URL(
          `../../../../../packages/ui/src/i18n/messages/${locale}.yml`,
          import.meta.url,
        ),
      ],
    },
  );
  const prefix = locale === 'en' ? '' : `/${locale}`;
  for (const width of [320, 1440]) {
    test(`${locale} discovery homepage has usable paths and search at ${width}px`, async ({
      page,
    }) => {
      const errors = collectConsoleErrors(page);
      await page.setViewportSize({ width, height: 960 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(prefix || '/');
      await expect(
        page.getByRole('heading', { level: 1, name: t('home.heroTitle') }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      const landingInk = await page
        .getByRole('main')
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--color-fg-base').trim(),
        );
      await expect(
        page.getByRole('navigation', { name: t('nav.sidebarAriaLabel') }),
      ).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      await page.keyboard.press('Tab');
      await expect(
        page.getByRole('link', { name: t('docs.skipToMain') }),
      ).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('main')).toBeFocused();
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(
        page.getByPlaceholder(t('docs.search.placeholder')),
      ).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      const guide = page
        .locator(`main a[href="${prefix}/get-started/editors"]`)
        .last();
      await guide.click();
      await expect(page).toHaveURL(`${prefix}/get-started/editors`);
      await expect(page.locator('.marketing-surface')).toHaveCount(0);
      await expect(page.locator('article > header > h1')).toHaveCount(1);
      const articleInk = await page.getByRole('main').evaluate((element) => ({
        local: getComputedStyle(element)
          .getPropertyValue('--color-fg-base')
          .trim(),
        root: getComputedStyle(document.documentElement)
          .getPropertyValue('--color-fg-base')
          .trim(),
      }));
      expect(articleInk.local).toBe(articleInk.root);
      expect(articleInk.local).not.toBe(landingInk);
      await expect(
        page.getByRole('button', { name: t('docs.openSearch') }).first(),
      ).toBeVisible();
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test(`${locale} homepage mobile menu restores focus and preserves locale`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto(prefix || '/');
    const menu = page.getByRole('button', { name: t('docs.openMenu') });
    await menu.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await menu.click();
    await page
      .getByRole('dialog')
      .getByRole('link', { name: t('nav.groups.start'), exact: true })
      .click();
    await expect(page).toHaveURL(`${prefix}/get-started/quickstart`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test(`${locale} mobile search restores focus and opens a localized result`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 852 });
    await page.goto(prefix || '/');
    const menu = page.getByRole('button', { name: t('docs.openMenu') });
    const search = page
      .getByRole('banner')
      .getByRole('button', { name: t('docs.openSearch') });
    const input = page.getByPlaceholder(t('docs.search.placeholder'));
    const openSearch = async () => {
      await search.click();
      await expect(
        page.getByRole('dialog', { includeHidden: true }),
      ).toHaveCount(1);
      await expect(input).toBeFocused();
    };
    await openSearch();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(search).toBeFocused();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');

    await openSearch();
    await input.fill(
      { en: 'first agent', de: 'ersten Agenten', fr: 'premier agent' }[locale],
    );
    await page.getByRole('option').first().click();
    await expect(page.locator('article > header > h1')).toBeVisible();
    expect(new URL(page.url()).pathname.startsWith(`${prefix}/`)).toBe(true);
    await expect(page.locator('.marketing-surface')).toHaveCount(0);
    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(
      0,
    );
  });
}
