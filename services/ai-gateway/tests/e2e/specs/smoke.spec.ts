import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';
import { collectConsoleErrors, expectPageRenders } from '@tale/e2e/smoke';

/**
 * The panel, driven for real.
 *
 * There is no sign-in: the gateway asks a browser for nothing, so the account
 * screen is what a visitor gets. The API key the token endpoints want is
 * generated per dev-server process and printed rather than fixed, so the
 * specs that touch them assert the refusal — the part that must hold no
 * matter which key this run happens to have minted.
 */

const uiCatalogs = new URL(
  '../../../../../packages/ui/src/i18n/messages/',
  import.meta.url,
);
const { t } = createI18n(new URL('../../../messages/en.yml', import.meta.url), {
  packages: [new URL('global.yml', uiCatalogs), new URL('en.yml', uiCatalogs)],
});

test('the panel renders without a sign-in and without console errors', async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await expectPageRenders(page);

  await expect(
    page.getByRole('heading', { name: t('panel.title'), level: 1 }),
  ).toBeVisible();
  // No password field anywhere on the way in.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the account screen offers its add action straight away', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: t('accounts.add') }),
  ).toBeVisible();
});

test('the panel routes answer a browser that presented nothing', async ({
  request,
}) => {
  for (const path of ['/api/accounts', '/api/providers']) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
  }
});

test('every token endpoint refuses a request with no API key', async ({
  request,
}) => {
  for (const path of [
    '/api/tokens',
    '/api/tokens/anthropic',
    '/api/tokens/openai',
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
    expect(response.headers()['www-authenticate']).toBe('Bearer');
  }
});
