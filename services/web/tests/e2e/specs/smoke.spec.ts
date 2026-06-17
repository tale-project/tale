import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';
import { collectConsoleErrors, expectPageRenders } from '@tale/e2e/smoke';

/**
 * Marketing-site smoke: the high-value "does it load and navigate" checks.
 * Labels resolve from `messages/en.json` (the context pins en-US), never
 * hardcoded literals (AGENTS.md i18n rule).
 */

const { t } = createI18n(new URL('../../../messages/en.json', import.meta.url));

test.describe('web marketing smoke', () => {
  test('home renders with primary nav and no console errors', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');
    await expectPageRenders(page);
    await expect(
      page.getByRole('link', { name: t('nav.pricing') }).first(),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('pricing page renders', async ({ page }) => {
    await page.goto('/pricing');
    await expectPageRenders(page);
  });

  test('contact page shows a submittable form', async ({ page }) => {
    await page.goto('/contact');
    await expectPageRenders(page);
    await expect(page.locator('form')).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('contact.submit') }),
    ).toBeVisible();
  });

  test('German locale route renders', async ({ page }) => {
    await page.goto('/de');
    await expectPageRenders(page);
  });
});
