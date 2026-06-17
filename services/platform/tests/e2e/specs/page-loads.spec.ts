import { type Locator, type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Render-smoke breadth for the remaining top-level routes (changelog, embedded
 * API docs, the redirecting agent entry points, and the metrics dashboards).
 * One sequential test on a shared page asserts a stable anchor per route, so
 * the whole breadth costs a single worker fixture instead of one cold paint per
 * route. Read-only — only navigates and asserts.
 */

/** "New chat" renders in both the desktop bar and mobile header; pin the first. */
function newChatButton(page: Page): Locator {
  return page.getByRole('button', { name: t('chat.newChat') }).first();
}

interface RouteCase {
  readonly key: string;
  /** Built per-org (or org-independent) so the table stays declarative. */
  readonly path: (organizationId: string) => string;
  readonly anchor: (page: Page) => Locator;
}

function routeCases(): readonly RouteCase[] {
  return [
    {
      // Org index `beforeLoad` redirect to the chat surface (no heading there).
      key: 'org-landing',
      path: (id) => `/dashboard/${id}`,
      anchor: (page) => newChatButton(page),
    },
    {
      // Viewer fetches GitHub releases first; the <h1> renders in BOTH the
      // success and error branches once the action settles.
      key: 'changelog',
      path: () => '/dashboard/changelog',
      anchor: (page) =>
        page
          .getByRole('heading', {
            name: t('changelog.viewer.heading'),
            level: 1,
          })
          .first(),
    },
    {
      // `beforeLoad` redirect to `/agents`; the layout title proves the landing.
      key: 'custom-agents-redirect',
      path: (id) => `/dashboard/${id}/custom-agents`,
      anchor: (page) =>
        page
          .getByRole('heading', { name: t('settings.agents.title'), level: 1 })
          .first(),
    },
    {
      // Workforce dashboard title block (charts paint behind their own loaders).
      key: 'agents-metrics',
      path: (id) => `/dashboard/${id}/agents/metrics`,
      anchor: (page) =>
        page
          .getByRole('heading', { name: t('workforce.title'), level: 1 })
          .first(),
    },
    {
      // WorkflowMetricsPage title block. Owner has `write wfDefinitions`, so the
      // AccessDenied branch never renders.
      key: 'automations-metrics',
      path: (id) => `/dashboard/${id}/automations/metrics`,
      anchor: (page) =>
        page
          .getByRole('heading', {
            name: t('automations.metrics.title'),
            level: 1,
          })
          .first(),
    },
    {
      // `/docs` embeds Swagger UI (no redirect, no translated heading); the
      // `swagger-ui-standalone` <main> landmark mounts ahead of the lazy chunk.
      key: 'docs-swagger',
      path: () => '/docs',
      anchor: (page) => page.locator('main.swagger-ui-standalone').first(),
    },
  ];
}

test('render-only routes mount their stable anchor', async ({ page, org }) => {
  const { organizationId } = org;

  // Sequential on a shared page so the whole breadth reuses one warm worker.
  // The first navigation absorbs a cold Vite compile; the rest are warm.
  let first = true;
  for (const routeCase of routeCases()) {
    await page.goto(routeCase.path(organizationId));
    await expect(routeCase.anchor(page)).toBeVisible({
      timeout: first ? TIMEOUT.FIRST_PAINT : TIMEOUT.NAV,
    });
    first = false;
  }
});
