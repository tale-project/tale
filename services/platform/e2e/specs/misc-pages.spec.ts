import { expect, test, type Page, type Locator } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Render-smoke breadth coverage for the remaining uncovered top-level pages —
 * the org landing redirect, the changelog viewer, the two redirecting agent
 * entry points, the agents/automations metrics dashboards, and the embedded
 * API docs. Runs as the pre-authenticated owner (chromium project
 * storageState) against the seeded org.
 *
 * Read-only by construction: each case navigates and asserts an always-present
 * anchor (a per-page heading, header-chrome control, or landmark) once any
 * skeleton settles — nothing here mutates the shared backend/owner state. The
 * deeper flows for these surfaces live elsewhere (chat in `chat.spec.ts`,
 * agents in `agents.spec.ts`); this spec only proves each route mounts.
 *
 * Anchors were chosen by reading each route component (NOT data rows, which
 * need seeding):
 *  - `/dashboard/$id`            → redirects to `/dashboard/$id/chat`; the chat
 *                                   surface has no heading, so we assert the URL
 *                                   landed on `/chat` and the always-present
 *                                   "New chat" header button (rendered in both
 *                                   the desktop bar and the mobile header → use
 *                                   `.first()`).
 *  - `/dashboard/changelog`      → `<h1>` `changelog.viewer.heading`. The page
 *                                   fetches GitHub releases first and shows a
 *                                   spinner WHILE in flight; the heading renders
 *                                   in BOTH terminal states (loaded AND error),
 *                                   so a generous timeout absorbs the network
 *                                   round-trip. See caveat below.
 *  - `/dashboard/$id/custom-agents` → redirects to `/dashboard/$id/agents`; the
 *                                   agents layout title (`AdaptiveHeaderTitle`,
 *                                   an `<h1>`) renders `settings.agents.title`.
 *  - `/dashboard/$id/agents/metrics`      → `<h1>` `workforce.title` (the
 *                                   Workforce dashboard title block).
 *  - `/dashboard/$id/automations/metrics` → `<h1>` `automations.metrics.title`
 *                                   (the WorkflowMetricsPage title block).
 *                                   Owner has `write wfDefinitions`, so the
 *                                   AccessDenied branch never shows.
 *  - `/docs`                     → renders an EMBEDDED Swagger UI (NOT a
 *                                   redirect to an external docs site). It has
 *                                   no translated heading, so we anchor on the
 *                                   `swagger-ui-standalone` `<main>` landmark
 *                                   (role `main`), which mounts synchronously
 *                                   ahead of the lazy Swagger chunk.
 */

const FIRST_PAINT_TIMEOUT = 60_000;

/**
 * The chat header's "New chat" button is rendered TWICE — once in the desktop
 * bar (`hidden md:flex`) and once in the mobile `AdaptiveHeaderRoot`
 * (`md:hidden`). On the Desktop Chrome viewport only one is visible, but both
 * match the accessible name, so scope to the first match.
 */
function newChatButton(page: Page): Locator {
  return page.getByRole('button', { name: t('chat.newChat') }).first();
}

test.describe('misc page loads', () => {
  test('org landing redirects to chat and renders the chat header', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(`/dashboard/${organizationId}`);

    // The index route is a `beforeLoad` redirect to the chat surface.
    await page.waitForURL(/\/chat(?:[/?#]|$)/, {
      timeout: FIRST_PAINT_TIMEOUT,
    });

    // The chat composer/messages are behind a Suspense skeleton; the header
    // chrome (New chat) renders immediately and is the stable anchor here.
    await expect(newChatButton(page)).toBeVisible({
      timeout: FIRST_PAINT_TIMEOUT,
    });
  });

  test('changelog renders the viewer heading', async ({ page }) => {
    await page.goto('/dashboard/changelog');

    // The viewer fetches GitHub releases first (spinner while in flight); the
    // `<h1>` renders once the action settles, in BOTH the success and error
    // branches. The generous budget absorbs the network round-trip.
    await expect(
      page
        .getByRole('heading', { name: t('changelog.viewer.heading'), level: 1 })
        .first(),
    ).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });
  });

  test('custom-agents redirects to the agents page', async ({ page }) => {
    const { organizationId } = readRunContext();
    await page.goto(`/dashboard/${organizationId}/custom-agents`);

    // `beforeLoad` redirect to `/agents`.
    await page.waitForURL(/\/agents(?:[/?#]|$)/, {
      timeout: FIRST_PAINT_TIMEOUT,
    });

    // The agents layout header title (`AdaptiveHeaderTitle` → `<h1>`) proves
    // the destination mounted.
    await expect(
      page
        .getByRole('heading', { name: t('settings.agents.title'), level: 1 })
        .first(),
    ).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });
  });

  test('agents metrics renders the workforce dashboard title', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(`/dashboard/${organizationId}/agents/metrics`);

    // Title block `<h1>` of the Workforce dashboard (the metrics charts paint
    // behind their own loaders; the title is always present).
    await expect(
      page
        .getByRole('heading', { name: t('workforce.title'), level: 1 })
        .first(),
    ).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });
  });

  test('automations metrics renders the metrics page title', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(`/dashboard/${organizationId}/automations/metrics`);

    // Title block `<h1>` of WorkflowMetricsPage. Owner has `write wfDefinitions`
    // so the AccessDenied branch never renders.
    await expect(
      page
        .getByRole('heading', {
          name: t('automations.metrics.title'),
          level: 1,
        })
        .first(),
    ).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });
  });

  test('docs renders the embedded Swagger UI', async ({ page }) => {
    await page.goto('/docs');

    // `/docs` embeds Swagger UI (no redirect, no translated heading). The
    // `swagger-ui-standalone` <main> landmark mounts ahead of the lazy chunk
    // and is the always-present anchor.
    await expect(
      page.locator('main.swagger-ui-standalone').first(),
    ).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });
  });
});
