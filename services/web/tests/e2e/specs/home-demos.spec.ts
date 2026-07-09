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

  test('tour demos render their complete end states under reduced motion', async ({
    page,
  }) => {
    await page.goto('/');

    const connect = page.getByRole('img', {
      name: t('home.demos.connect.label'),
    });
    await connect.scrollIntoViewIfNeeded();
    await expect(connect).toContainText('Claude Code');

    const knowledge = page.getByRole('img', {
      name: t('home.demos.knowledge.label'),
    });
    await knowledge.scrollIntoViewIfNeeded();
    await expect(knowledge).toContainText(t('home.demos.knowledge.answer2'));
    await expect(knowledge).toContainText(t('home.demos.knowledge.citation'));

    const automation = page.getByRole('img', {
      name: t('home.demos.automation.label'),
    });
    await automation.scrollIntoViewIfNeeded();
    await expect(automation).toContainText(t('home.demos.automation.trigger'));
    await expect(automation).toContainText(t('home.demos.automation.log2'));

    const govern = page.getByRole('img', {
      name: t('home.demos.govern.label'),
    });
    await govern.scrollIntoViewIfNeeded();
    await expect(govern).toContainText(t('home.demos.govern.approved'));
    await expect(govern).toContainText(t('home.demos.govern.audit3'));
  });

  test('tour headings carry the four-stage journey', async ({ page }) => {
    await page.goto('/');
    for (const stage of ['connect', 'pool', 'delegate', 'govern'] as const) {
      await expect(
        page.getByRole('heading', {
          name: t(`home.tour.${stage}.title`).replace('\n', ' '),
        }),
      ).toBeVisible();
    }
  });
});
