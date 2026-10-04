import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';

const { t } = createI18n(new URL('../../../messages/en.yml', import.meta.url));

for (const width of [390, 1280]) {
  test(`all connector names stay readable without motion at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const connectors = page.getByRole('list', {
      name: t('home.connectors.title'),
    });
    const tiles = connectors.getByRole('listitem');
    await expect(tiles).toHaveCount(13);
    await expect(connectors.getByRole('button')).toHaveCount(0);

    for (const tile of await tiles.all()) {
      await tile.scrollIntoViewIfNeeded();
      await expect(tile).toBeInViewport({ ratio: 1 });
      await expect(tile.locator('span')).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test('changing motion preference completes an already-mounted offscreen demo', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');

  const govern = page.getByRole('img', {
    name: t('home.demos.govern.label'),
  });
  // This illustration is below the viewport and has not begun its timeline.
  await expect(govern).not.toContainText(t('home.demos.govern.audit2'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(govern).toContainText(t('home.demos.govern.approved'));
  await expect(govern).toContainText(t('home.demos.govern.audit2'));

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await govern.scrollIntoViewIfNeeded();
  await expect(govern).toContainText(t('home.demos.govern.audit2'));
});
