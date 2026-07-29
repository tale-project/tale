import { type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Settings → Metrics render-smoke across all four tabs (usage, feedback,
 * automations, projects) on a fresh org: every tab paints its translated
 * header, toolbar, and empty states. Guards the #2414 regression class where
 * a namespace rework dropped the metrics subtree from every
 * catalog and the Automations tab rendered raw i18n keys — the per-tab
 * anchors resolve through the catalog, and an explicit leak check asserts no
 * dotted key path is ever visible as text. Read-only — only navigates and
 * asserts.
 */

const metricsBase = (organizationId: string) =>
  `/dashboard/${organizationId}/settings/metrics`;

/**
 * A missing translation renders its raw key (`metrics.cards.totalRuns`), so
 * the body must never contain `metrics.` followed by a known first segment.
 * Matching a bare `metrics.<letter>` is NOT safe: `textContent` concatenates
 * adjacent elements without whitespace, so a sentence ending in "… metrics."
 * runs straight into the next label ("Chat") and false-positives.
 */
async function expectNoRawI18nKeys(page: Page): Promise<void> {
  await expect(page.locator('body')).not.toContainText(
    /\bmetrics\.(title|description|cappedNotice|period|cards|chart|table|empty|groups|projects|noData)\b/,
  );
}

test('usage tab renders translated header, toolbar, and tables', async ({
  page,
  org,
}) => {
  await page.goto(`${metricsBase(org.organizationId)}/usage`);

  await expect(
    page.getByRole('heading', { name: t('analytics.usage.title'), level: 3 }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  const filterButton = page.getByRole('button', {
    name: t('common.labels.filter'),
    exact: true,
  });
  await expect(filterButton).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(
    page.getByRole('heading', {
      name: t('analytics.usage.tables.topAgents.title'),
      level: 3,
    }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // The period picker sits behind the shared toolbar filter button now (the
  // one-filter-button grammar); opening it proves `metrics.period.label`
  // still resolves on the live page — its section header is a plain button
  // named by the translated title.
  await filterButton.click();
  await expect(
    page.getByRole('button', { name: t('metrics.period.label'), exact: true }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await page.keyboard.press('Escape');

  await expectNoRawI18nKeys(page);
});

test('feedback tab renders translated header and empty teaching panel', async ({
  page,
  org,
}) => {
  await page.goto(`${metricsBase(org.organizationId)}/feedback`);

  await expect(
    page.getByRole('heading', {
      name: t('analytics.feedback.title'),
      level: 3,
    }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  // Fresh org → the org-empty teaching panel (not the KPI strip).
  await expect(page.getByText(t('analytics.feedback.empty.title'))).toBeVisible(
    { timeout: TIMEOUT.VISIBLE },
  );

  await expectNoRawI18nKeys(page);
});

test('automations tab renders translated KPIs, charts, and table', async ({
  page,
  org,
}) => {
  await page.goto(`${metricsBase(org.organizationId)}/automations`);

  // The #2414 regression surface: title, KPI card labels, chart titles, and
  // the top-automations table all read `analytics.automations.*` (the subtree
  // moved out of `automations.metrics.*` with the settings-rework sweep).
  await expect(
    page.getByRole('heading', {
      name: t('analytics.automations.title'),
      level: 3,
    }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await expect(
    page.getByText(t('analytics.automations.cards.totalRuns')),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(
    page.getByRole('heading', {
      name: t('analytics.automations.chart.trendTitle'),
      level: 3,
    }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(
    page.getByRole('heading', {
      name: t('analytics.automations.table.title'),
      level: 3,
    }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  // The period picker is the shared toolbar filter button (the usage-tab test
  // opens it and proves the period label resolves).
  await expect(
    page.getByRole('button', { name: t('common.labels.filter'), exact: true }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  await expectNoRawI18nKeys(page);
});

test('projects tab renders the picker in the toolbar and a stable header', async ({
  page,
  org,
}) => {
  await page.goto(`${metricsBase(org.organizationId)}/projects`);

  // The header is identical with and without a selected project; a fresh org
  // has no task projects, so the empty state renders under it.
  await expect(
    page.getByRole('heading', { name: t('tasks.metrics.title'), level: 3 }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  // The project picker is a section of the shared toolbar filter button
  // (ahead of Period), not a standalone select; opening the button proves
  // `metrics.projects.selectLabel` resolves — its section header is a plain
  // button named by the translated title.
  const filterButton = page.getByRole('button', {
    name: t('common.labels.filter'),
    exact: true,
  });
  await expect(filterButton).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await filterButton.click();
  await expect(
    page.getByRole('button', {
      name: t('metrics.projects.selectLabel'),
      exact: true,
    }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('heading', {
      name: t('metrics.projects.emptyTitle'),
      level: 3,
    }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  await expectNoRawI18nKeys(page);
});
