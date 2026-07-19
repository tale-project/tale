import { test, expect } from '../helpers/fixtures';

/**
 * The SPA's "SSR" seam: dashboard navigations must arrive with the boot
 * shell already injected into `#root`, so the sidebar rail paints before
 * any JS runs. Served by the inject-boot-shell Vite middleware here (dev
 * webServer); `server.ts` mirrors it in production from the same shared
 * helpers. Asserts on the raw HTTP response, not the DOM — React replaces
 * the shell the moment it mounts.
 */

const SHELL_MARKER = 'data-boot-shell';

test('serves the boot shell for a dashboard navigation', async ({
  page,
  org,
}) => {
  const response = await page.request.get(
    `/dashboard/${org.organizationId}/chat`,
    { headers: { accept: 'text/html' } },
  );
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain(SHELL_MARKER);
  // The dev server delivers CSS through the JS module graph, so the shell
  // paints unstyled first — raw text (like the Skeletonize sr-only label)
  // would flash visibly on every reload. The shell must ship text-free.
  expect(html).not.toContain('Loading content');
});

test('serves no boot shell outside the dashboard', async ({ page }) => {
  const response = await page.request.get('/login', {
    headers: { accept: 'text/html' },
  });
  expect(response.ok()).toBe(true);
  expect(await response.text()).not.toContain(SHELL_MARKER);
});
