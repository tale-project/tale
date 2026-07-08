import { type Locator, type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Render-smoke breadth for the remaining top-level routes (changelog, embedded
 * API docs, and a legacy tab-suffix redirect). One sequential test on a shared
 * page asserts a stable anchor per route, so the whole breadth costs a single
 * worker fixture instead of one cold paint per route. Read-only — only
 * navigates and asserts.
 */

/**
 * The chat surface is settled once its header search control renders (New chat
 * is no longer a header button — it moved to the side-nav rail). It renders in
 * both the desktop bar and mobile header; pin the first (visible).
 */
function chatSurfaceAnchor(page: Page): Locator {
  return page.getByRole('button', { name: t('chat.searchChat') }).first();
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
      anchor: (page) => chatSurfaceAnchor(page),
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
      // Legacy `/automations/{slug}/{tab}` (a workflow detail tab from before
      // the Workflows rename — the segment can't be an automation page, so it
      // still redirects): lands on `/workflows/{slug}/executions`; the
      // executions search input proves the tab mounted for the seeded
      // workflow.
      key: 'automation-tab-legacy-redirect',
      path: (id) => `/dashboard/${id}/automations/test/executions`,
      anchor: (page) =>
        page.getByPlaceholder(t('workflows.executions.searchPlaceholder')),
    },
    {
      // D3: a bare `/automations/{slug}` predates the Automations rename too
      // (when this URL space belonged to a workflow directly). `test` isn't a
      // real automation (only the seeded email/GitHub automations are),
      // so `automations/$automationSlug`'s `beforeLoad` falls back to the standalone
      // workflow route; the Editor nav tab proves the workflow detail page
      // mounted for the seeded workflow. A REAL automation slug would win
      // instead (never reaching this fallback) — covered by the automation
      // detail unit/component tests, not this render-smoke spec.
      key: 'automation-bare-slug-legacy-redirect',
      path: (id) => `/dashboard/${id}/automations/test`,
      anchor: (page) =>
        page.getByRole('link', { name: t('workflows.navigation.editor') }),
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
