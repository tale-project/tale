import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';
import { collectConsoleErrors, expectPageRenders } from '@tale/e2e/smoke';

/**
 * Docs-site smoke: landing renders, the sidebar has navigable links, and the
 * search palette opens. Labels resolve from `messages/en.yml` (en-US pinned).
 */

const { t } = createI18n(new URL('../../../messages/en.yml', import.meta.url));

test.describe('docs smoke', () => {
  test('landing renders with a search affordance and no console errors', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');
    await expectPageRenders(page);
    await expect(
      page.getByRole('button', { name: t('nav.openSearch') }).first(),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('sidebar shows navigation links', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('navigation').getByRole('link').first(),
    ).toBeVisible();
  });

  test('search palette opens', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: t('nav.openSearch') })
      .first()
      .click();
    await expect(
      page.getByPlaceholder(t('nav.searchPlaceholder')),
    ).toBeVisible();
  });
});
