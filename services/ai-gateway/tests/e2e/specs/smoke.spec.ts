import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';
import { collectConsoleErrors, expectPageRenders } from '@tale/e2e/smoke';

/**
 * The panel's door, driven for real.
 *
 * Everything past sign-in needs the panel password, which the dev server
 * generates per process and prints rather than fixing — so these specs cover
 * what an unauthenticated visitor gets, which is the part that must hold no
 * matter what: the form renders, the wrong password is refused and said so,
 * and nothing behind the door answers a browser that has not been through it.
 */

const uiCatalogs = new URL(
  '../../../../../packages/ui/src/i18n/messages/',
  import.meta.url,
);
const { t } = createI18n(new URL('../../../messages/en.yml', import.meta.url), {
  packages: [new URL('global.yml', uiCatalogs), new URL('en.yml', uiCatalogs)],
});

test('the sign-in screen renders without console errors', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await expectPageRenders(page);

  await expect(
    page.getByRole('heading', { name: t('signIn.heading'), level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: t('signIn.passwordLabel') }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('the submit button stays inert until a password is typed', async ({
  page,
}) => {
  await page.goto('/');
  const submit = page.getByRole('button', { name: t('signIn.submit') });
  await expect(submit).toBeDisabled();

  await page
    .getByRole('textbox', { name: t('signIn.passwordLabel') })
    .fill('x');
  await expect(submit).toBeEnabled();
});

test('a wrong password is refused and named', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: t('signIn.passwordLabel') })
    .fill('definitely-not-the-panel-password');
  await page.getByRole('button', { name: t('signIn.submit') }).click();

  await expect(page.getByText(t('signIn.wrongPassword'))).toBeVisible();
  await expect(
    page.getByRole('heading', { name: t('signIn.heading'), level: 1 }),
  ).toBeVisible();
});

test('the password field is reachable and submittable from the keyboard', async ({
  page,
}) => {
  await page.goto('/');
  const password = page.getByRole('textbox', {
    name: t('signIn.passwordLabel'),
  });
  await expect(password).toBeFocused();
  await password.fill('definitely-not-the-panel-password');
  await password.press('Enter');
  await expect(page.getByText(t('signIn.wrongPassword'))).toBeVisible();
});

test('the panel routes refuse a browser that has not signed in', async ({
  request,
}) => {
  for (const path of ['/api/accounts', '/api/providers']) {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'not_signed_in' },
    });
  }
});

test('the token endpoint refuses a request with no API key', async ({
  request,
}) => {
  const response = await request.get('/api/tokens');
  expect(response.status()).toBe(401);
  expect(response.headers()['www-authenticate']).toBe('Bearer');
});
