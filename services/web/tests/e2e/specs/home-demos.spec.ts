import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';

/**
 * Animated homepage demos, asserted deterministically: under
 * `prefers-reduced-motion` the timeline driver pins every demo to its final
 * beat, so the complete end state must be present without waiting on
 * animation timing. This is also the state prerendered HTML ships.
 */

const { t } = createI18n(new URL('../../../messages/en.json', import.meta.url));

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test.describe('homepage demos', () => {
  test('hero demo renders its complete end state under reduced motion', async ({
    page,
  }) => {
    await page.goto('/');

    const demo = page.getByRole('img', { name: t('home.demos.hero.label') });
    await expect(demo).toBeVisible();
    await expect(demo).toContainText(t('home.demos.hero.prompt'));
    await expect(demo).toContainText(t('home.demos.hero.chipAgent'));
    await expect(demo).toContainText(t('home.demos.hero.reply4'));
    await expect(demo).toContainText(t('home.demos.hero.citation2'));
    await expect(demo).toContainText(t('home.demos.hero.status'));
  });
});
