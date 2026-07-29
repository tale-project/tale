import { type Locator, type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Render-smoke breadth for the remaining top-level routes (changelog, embedded
 * API docs) plus the legacy `/customers` and `/vendors` → `/contacts` loader
 * redirects kept for old bookmarks/links after the contacts merge (#2618,
 * #2634). One sequential test on a shared page asserts a stable anchor (and,
 * for the redirect cases, the committed URL) per route, so the whole breadth
 * costs a single worker fixture instead of one cold paint per route.
 * Read-only — only navigates and asserts.
 */

/**
 * The chat surface is settled once its composer renders. (The search control
 * moved into the shell's unified sidebar, where it exists on every route — it
 * can no longer distinguish the chat surface.)
 */
function chatSurfaceAnchor(page: Page): Locator {
  return page.getByRole('textbox', { name: t('chat.aria.chatInput') });
}

/**
 * The contacts list's import menu is a writer-only action that renders
 * unconditionally (empty list or not) — the stable "we're on contacts" anchor
 * for the legacy `/customers` and `/vendors` redirect cases below.
 */
function contactsImportAnchor(page: Page): Locator {
  return page.getByRole('button', {
    name: t('contacts.addButton'),
  });
}

interface RouteCase {
  readonly key: string;
  /** Built per-org (or org-independent) so the table stays declarative. */
  readonly path: (organizationId: string) => string;
  readonly anchor: (page: Page) => Locator;
  /**
   * Only set for cases that must land on a DIFFERENT route than `path`
   * (a redirect) — asserted via `waitForURL` before the anchor check, so the
   * case proves the URL actually committed and not just that the anchor's
   * text happens to appear somewhere.
   */
  readonly redirectsTo?: (organizationId: string) => RegExp;
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
      // `/docs` embeds Swagger UI (no redirect, no translated heading); the
      // `swagger-ui-standalone` <main> landmark mounts ahead of the lazy chunk.
      key: 'docs-swagger',
      path: () => '/docs',
      anchor: (page) => page.locator('main.swagger-ui-standalone').first(),
    },
    {
      // Legacy `/customers` loader redirect to `/contacts` (#2618 merge, kept
      // for old bookmarks/links — #2634).
      key: 'customers-redirect',
      path: (id) => `/dashboard/${id}/customers`,
      redirectsTo: (id) => new RegExp(`/dashboard/${id}/contacts(?:[/?#]|$)`),
      anchor: (page) => contactsImportAnchor(page),
    },
    {
      // Legacy `/vendors` loader redirect to `/contacts` (#2618 merge, kept
      // for old bookmarks/links — #2634).
      key: 'vendors-redirect',
      path: (id) => `/dashboard/${id}/vendors`,
      redirectsTo: (id) => new RegExp(`/dashboard/${id}/contacts(?:[/?#]|$)`),
      anchor: (page) => contactsImportAnchor(page),
    },
  ];
}

test('render-only routes mount their stable anchor', async ({ page, org }) => {
  const { organizationId } = org;

  // Sequential on a shared page so the whole breadth reuses one warm worker.
  // The first navigation absorbs a cold Vite compile; the rest are warm.
  let first = true;
  for (const routeCase of routeCases()) {
    const timeout = first ? TIMEOUT.FIRST_PAINT : TIMEOUT.NAV;
    await page.goto(routeCase.path(organizationId));
    if (routeCase.redirectsTo) {
      await page.waitForURL(routeCase.redirectsTo(organizationId), {
        timeout,
      });
    }
    await expect(routeCase.anchor(page)).toBeVisible({ timeout });
    first = false;
  }
});
