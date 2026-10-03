import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';
import axe from 'axe-core';

const { t } = createI18n(new URL('../../../messages/en.yml', import.meta.url));

// jsdom cannot measure contrast. Check the real palette on its rendered
// surfaces, including the alternate studio panel and both install commands.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`homepage has readable controls and text in ${colorScheme} mode`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/');
    const studio = page.getByRole('region', { name: t('home.showcaseTitle') });
    await expect(studio).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(axe.source);

    for (const marketing of [false, true]) {
      if (marketing) {
        await studio
          .getByRole('tab', {
            name: t('home.showcaseMarketingTab'),
            exact: true,
          })
          .click();
        await page
          .getByRole('tablist', { name: t('home.installPackagesLabel') })
          .getByRole('tab', { name: '@tale/marketing-ui', exact: true })
          .click();
      }
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
    }
  });
}
