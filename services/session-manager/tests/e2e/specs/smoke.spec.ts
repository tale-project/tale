import { collectConsoleErrors, expectPageRenders } from '@tale/e2e/smoke';

import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { waitForPictures, watchLiveView } from '../helpers/live-view';
import { watchPolicyViolations } from '../helpers/nav-csp';

// Every address of the app, opened as a person (or a bookmark) opens it: the
// built page, under the headers the server sends it with. A console error is
// a broken page; a Content-Security-Policy refusal is one too.
const ADDRESSES = [
  '/sessions',
  '/proxies',
  '/secrets',
  '/settings/general',
  '/settings/appearance',
  '/settings/ai-access',
];

for (const address of ADDRESSES) {
  test(`${address} renders without console errors`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(address);
    await expectPageRenders(page);
    await expect(page.getByRole('navigation').first()).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    expect(errors).toEqual([]);
  });
}

// The page of a session is the one that opens a socket to the server: the
// policy of the page must let it connect, and nothing may be logged for it.
test('the page of a session that runs shows its picture without console errors', async ({
  page,
  api,
}) => {
  const running = await api.startSession('smoke-running');
  const live = watchLiveView(page);
  const errors = collectConsoleErrors(page);
  await page.goto(`/sessions/${running.id}`);
  await expectPageRenders(page);
  await waitForPictures(live);
  expect(errors).toEqual([]);
});

test('the page of a session that is stopped renders without console errors', async ({
  page,
  api,
}) => {
  const stopped = await api.stopSession(
    (await api.startSession('smoke-stopped')).id,
  );
  const errors = collectConsoleErrors(page);
  await page.goto(`/sessions/${stopped.id}`);
  await expectPageRenders(page);
  await expect(
    page.getByRole('heading', { level: 1, name: stopped.name, exact: true }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  expect(errors).toEqual([]);
});

// The page's policy forbids `eval`. A library that probes for it (the compiled
// parsers of zod do) and carries on without logs nothing to the console, so the
// only trace of a refusal is the `securitypolicyviolation` event: no page of
// the app may raise one, nor log an error, while it loads.
test('every page of the app loads without a console error or a Content-Security-Policy violation', async ({
  page,
  api,
}) => {
  const running = await api.startSession('policy');
  const errors = collectConsoleErrors(page);
  const violations = await watchPolicyViolations(page);
  const routes = [...ADDRESSES, `/sessions/${running.id}`, '/nowhere/at/all'];

  for (const route of routes) {
    await test.step(route, async () => {
      errors.length = 0;
      await page.goto(route);
      await expectPageRenders(page);
      await page.waitForLoadState('networkidle');
      expect.soft(errors, `${route}: console errors`).toEqual([]);
      expect
        .soft(await violations(), `${route}: policy violations`)
        .toEqual([]);
    });
  }
});

test('the root address leads to the sessions', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sessions$/);
});

test('an address the app does not know is answered by the app, not the server', async ({
  page,
}) => {
  const response = await page.goto('/nowhere/at/all');
  expect(response?.status()).toBe(200);
  await expectPageRenders(page);
});
