import { expect, type BrowserContext } from '@playwright/test';

import { TIMEOUT } from '../e2e/helpers/env';
import { labelStart } from '../e2e/helpers/forms';
import { t } from '../e2e/helpers/i18n';
import { DEMO_OWNER } from './demo-content';

/** Browser fetch preserves Bun's auth cookies without APIRequestContext's
 * Set-Cookie parsing issue. Wait for the auth UI before a cold Vite reload
 * can abort the request, then reuse the synthetic owner when it exists.
 */
export async function signUpOrIn(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto('/log-in');
    await expect(
      page.getByRole('textbox', {
        name: labelStart(t('auth.email')),
      }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    const attempt = (endpoint: string) =>
      page.evaluate(
        async ({ url, owner }) => {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: owner.name,
              email: owner.email,
              password: owner.password,
            }),
          });
          return { status: res.status, body: await res.text() };
        },
        { url: endpoint, owner: DEMO_OWNER },
      );
    const signUp = await attempt('/api/auth/sign-up/email');
    if (signUp.status >= 400) {
      const signIn = await attempt('/api/auth/sign-in/email');
      if (signIn.status >= 400) {
        throw new Error(
          `Could not authenticate ${DEMO_OWNER.email}: sign-up ${signUp.status} (${signUp.body.slice(0, 200)}), ` +
            `sign-in ${signIn.status} (${signIn.body.slice(0, 200)})`,
        );
      }
    }
  } finally {
    await page.close();
  }
}
