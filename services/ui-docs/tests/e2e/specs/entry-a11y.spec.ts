import { expect, test } from '@playwright/test';
import axe from 'axe-core';

// jsdom cannot measure contrast. Check the real documentation entry,
// including its shared navigation, article, controls and footnote.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`the documentation entry has readable controls and text in ${colorScheme} mode`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Introduction',
    );
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(axe.source);

    const violations = await page.evaluate(async () => {
      const engine = (window as typeof window & { axe: typeof axe }).axe;
      const result = await engine.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21aa'],
        },
      });
      return result.violations.map(({ id, nodes }) => ({
        id,
        nodes: nodes.map(({ html, failureSummary }) => ({
          html,
          failureSummary,
        })),
      }));
    });
    expect(violations).toEqual([]);
  });
}
