import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';

import { gotoClientPage } from '../helpers/client-page';

const { t } = createI18n(new URL('../../../messages/en.yml', import.meta.url));

for (const width of [390, 1280]) {
  for (const scene of [
    {
      name: 'the agent roster',
      path: '/platform/agents',
      label: 'platformAgents.demos.connect.label',
      parts: '[data-agent-row]',
      opacities: ['1', '1', '1', '1', '1'],
    },
    {
      name: 'the Agents & connectors sandbox',
      path: '/',
      label: 'home.demos.sandbox.label',
      parts: '[data-sandbox-part]',
      opacities: ['1', '1', '1', '0', '1', '1'],
    },
  ]) {
    test(`${scene.name} stays in place throughout playback at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 150 });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await gotoClientPage(page, scene.path);
      await page.evaluate(() => document.fonts.ready);
      const agents = page.getByRole('img', {
        name: t(scene.label),
      });
      await expect(agents.locator(scene.parts)).toHaveCount(
        scene.opacities.length,
      );
      await expect(agents.locator(scene.parts).last()).toHaveCSS(
        'opacity',
        '0',
      );
      await page.setViewportSize({ width, height: 900 });
      await agents.scrollIntoViewIfNeeded();

      const playback = await agents.evaluate(async (figure, selector) => {
        const rows = [...figure.querySelectorAll(selector)];
        const elements = rows.flatMap((row) => [
          row,
          ...row.querySelectorAll('*'),
        ]);
        const measure = () => {
          const frame = figure.getBoundingClientRect();
          return [
            { x: 0, y: 0, width: frame.width, height: frame.height },
            ...elements.map((element) => {
              const box = element.getBoundingClientRect();
              return {
                x: box.x - frame.x,
                y: box.y - frame.y,
                width: box.width,
                height: box.height,
              };
            }),
          ];
        };
        const baseline = measure();
        const start = performance.now();
        let maxMovement = 0;
        await new Promise<void>((resolve) => {
          const sample = () => {
            measure().forEach((box, index) => {
              const before = baseline[index];
              maxMovement = Math.max(
                maxMovement,
                Math.abs(box.x - before.x),
                Math.abs(box.y - before.y),
                Math.abs(box.width - before.width),
                Math.abs(box.height - before.height),
              );
            });
            if (performance.now() - start < 3800) requestAnimationFrame(sample);
            else resolve();
          };
          requestAnimationFrame(sample);
        });
        return {
          maxMovement,
          opacities: rows.map((row) => getComputedStyle(row).opacity),
        };
      }, scene.parts);
      expect(playback.maxMovement).toBeLessThan(0.5);
      expect(playback.opacities).toEqual(scene.opacities);
    });
  }

  test(`all connector names stay readable without motion at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoClientPage(page, '/');

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
  await gotoClientPage(page, '/');

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
