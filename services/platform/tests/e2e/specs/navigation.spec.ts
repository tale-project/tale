import { type Locator, type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { t } from '../helpers/i18n';
import { STARTER_PROJECT_NAME } from '../helpers/seed';

/**
 * Cross-cutting navigation/routing the per-feature specs don't exercise:
 * primary rail-nav, the settings-rail → governance click-path, breadcrumb
 * up-navigation, the not-found shell, and back/forward history. Read-only —
 * only navigates and asserts.
 *
 * Rail links are icon-only with portalled tooltips; we scope to the
 * main-navigation landmark and locate each by its deterministic href (the rail
 * links carry `aria-label`s since #2329, but the href is the stable anchor).
 *
 * NOT-FOUND NOTE: a splat/catch-all route (`/dashboard/$id/$`) renders a styled
 * 404 inside the matched `$id` layout's `<Outlet/>` for any unmatched child —
 * a heading, message, and a "Back to dashboard" recovery link — so the copy is
 * translated and asserted via `t('common.notFound.*')`.
 */

function dashboardUrl(organizationId: string, path = ''): string {
  return `/dashboard/${organizationId}${path}`;
}

function primaryNav(page: Page): Locator {
  return page.getByRole('navigation', {
    name: t('common.aria.mainNavigation'),
  });
}

function navLinkByHref(page: Page, hrefSuffix: string): Locator {
  return primaryNav(page).locator(`a[href$="${hrefSuffix}"]`);
}

/**
 * The chat surface is settled once its composer renders. (The search control
 * moved into the shell's unified sidebar, where it exists on every route — it
 * can no longer distinguish the chat surface.)
 */
function chatSurfaceAnchor(page: Page): Locator {
  return page.getByRole('textbox', { name: t('chat.aria.chatInput') });
}

interface NavCase {
  readonly key: string;
  readonly hrefSuffix: string;
  readonly urlPattern: RegExp;
  readonly anchor: (page: Page) => Locator;
}

function navCases(organizationId: string): readonly NavCase[] {
  // Page titles registered through the adaptive header render twice — once in
  // the desktop header strip (`hidden md:flex`) and once in the mobile nav slot
  // (`md:hidden`, first in the DOM). On this desktop viewport the mobile copy is
  // hidden, so a bare `.first()` would pin the hidden one; filter to the visible
  // (desktop) instance for those title anchors.
  return [
    {
      key: 'projects',
      hrefSuffix: `/dashboard/${organizationId}/projects`,
      urlPattern: /\/projects(?:[/?#]|$)/,
      anchor: (page) =>
        page
          .getByRole('button', { name: t('projects.list.createButton') })
          .first(),
    },
    {
      key: 'knowledge',
      hrefSuffix: `/dashboard/${organizationId}/documents`,
      urlPattern: /\/documents(?:[/?#]|$)/,
      // Fixture seeds no documents, so the empty-state title is the settled body.
      anchor: (page) => page.getByText(t('documents.emptyState.title')).first(),
    },
    {
      // The org-level agent roster (and its rail entry) is gone with the
      // AI-backend rewrite; Automations is the rail's remaining list surface.
      key: 'automations',
      hrefSuffix: `/dashboard/${organizationId}/automations`,
      urlPattern: /\/automations(?:[/?#]|$)/,
      anchor: (page) =>
        page
          .getByRole('heading', { name: t('automations.title'), level: 2 })
          .filter({ visible: true })
          .first(),
    },
    {
      key: 'settings',
      hrefSuffix: `/dashboard/${organizationId}/settings`,
      // Settings index redirects to a permission-appropriate sub-page.
      urlPattern: /\/settings(?:[/?#]|$)/,
      anchor: (page) =>
        page
          .getByRole('heading', {
            name: t('navigation.userSettings'),
            level: 1,
          })
          .filter({ visible: true })
          .first(),
    },
  ];
}

test.describe('navigation: primary side-nav rail', () => {
  test('navigates to every major section by clicking its rail link', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;

    // Land on the org root (redirects to /chat) and prove the rail is mounted.
    await page.goto(dashboardUrl(organizationId));
    await page.waitForURL(/\/chat(?:[/?#]|$)/, {
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await expect(chatSurfaceAnchor(page)).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await expect(primaryNav(page)).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Each section: click the rail link, assert the URL committed, then a stable
    // landing anchor. Sequential (shared page) — order-independent.
    for (const navCase of navCases(organizationId)) {
      await navLinkByHref(page, navCase.hrefSuffix).first().click();
      await page.waitForURL(navCase.urlPattern, { timeout: TIMEOUT.NAV });
      await expect(navCase.anchor(page)).toBeVisible({
        timeout: TIMEOUT.VISIBLE,
      });
      // The rail persists across navigations (it lives in the layout shell).
      await expect(primaryNav(page)).toBeVisible();
    }

    // The chat rail link (shares its href with the logo) returns to chat.
    await navLinkByHref(page, `/dashboard/${organizationId}/chat`)
      .first()
      .click();
    await page.waitForURL(/\/chat(?:[/?#]|$)/, { timeout: TIMEOUT.NAV });
    await expect(chatSurfaceAnchor(page)).toBeVisible({
      timeout: TIMEOUT.VISIBLE,
    });
  });
});

test.describe('navigation: settings rail → governance', () => {
  test('expands the governance group and navigates into a governance page', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;

    // Start on a concrete settings page so the rail is rendered and the
    // governance group is collapsed (we drive its disclosure ourselves).
    await page.goto(dashboardUrl(organizationId, '/settings/account'));

    const settingsRail = page.getByRole('navigation', {
      name: t('navigation.userSettings'),
    });
    await expect(settingsRail).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // Governance is an expandable disclosure BUTTON (not a link); expand it.
    const governanceGroup = settingsRail.getByRole('button', {
      name: t('navigation.governance'),
    });
    await expect(governanceGroup).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    if ((await governanceGroup.getAttribute('aria-expanded')) !== 'true') {
      await governanceGroup.click();
    }
    await expect(governanceGroup).toHaveAttribute('aria-expanded', 'true');

    // Click the first governance child (Policies & Limits) and assert the route
    // + a settled anchor (the voice-output policy switch always renders).
    const policiesLink = settingsRail.getByRole('link', {
      name: t('governance.groups.policiesAndLimits'),
    });
    await expect(policiesLink).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await policiesLink.click();

    await page.waitForURL(
      /\/settings\/governance\/policies-limits(?:[/?#]|$)/,
      {
        timeout: TIMEOUT.NAV,
      },
    );
    await expect(
      page.getByRole('switch', {
        name: t('governance.voiceOutput.enabledLabel'),
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  });
});

test.describe('navigation: breadcrumbs', () => {
  test('project detail shows the breadcrumb trail and navigates up via the parent crumb', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;

    // Open the seeded starter project from the projects list (the worker
    // bootstrap already gated on it existing). Row click navigates to the
    // project detail. (The old target — the seeded agent's detail page — is
    // gone with the org-level agent roster in the AI-backend rewrite.)
    await page.goto(dashboardUrl(organizationId, '/projects'));
    const starterRow = page
      .getByRole('row')
      .filter({ hasText: STARTER_PROJECT_NAME })
      .first();
    await expect(starterRow).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await starterRow.click();
    await page.waitForURL(/\/projects\/[A-Za-z0-9]+(?:[/?#]|$)/, {
      timeout: TIMEOUT.NAV,
    });

    // The breadcrumb parent ("Projects") is a real link; the leaf is the
    // project's name (the breadcrumb switcher). Both prove the trail rendered.
    // Scope to the breadcrumb landmark: the side-nav rail also has a
    // "Projects" link (icon-only with an `aria-label`), so a page-wide lookup
    // hits a strict-mode collision.
    const projectsCrumb = page
      .getByRole('navigation', { name: t('common.aria.breadcrumb') })
      .getByRole('link', { name: t('projects.title') });
    await expect(projectsCrumb).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    // The breadcrumb trail (like all adaptive-header content) renders twice —
    // desktop strip + mobile slot — so the leaf appears once visibly and once
    // hidden; target the visible (desktop) copy.
    await expect(
      page.getByText(STARTER_PROJECT_NAME).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Clicking the parent crumb navigates up to the projects list.
    await projectsCrumb.click();
    await page.waitForURL(/\/projects(?:[/?#]|$)/, { timeout: TIMEOUT.NAV });
    await expect(
      page
        .getByRole('button', { name: t('projects.list.createButton') })
        .first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    // Confirm we left the detail route (the crumb links to the bare list).
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/${organizationId}/projects$`),
    );
  });
});

test.describe('navigation: user menu', () => {
  test('exposes a Documentation link to the docs site', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;

    await page.goto(dashboardUrl(organizationId));
    await page.waitForURL(/\/chat(?:[/?#]|$)/, {
      timeout: TIMEOUT.FIRST_PAINT,
    });

    // The account button is icon-only in the rail; its accessible name is the
    // manage-account label. Pin the visible (desktop) instance — a hidden mobile
    // copy shares the shell.
    await page
      .getByRole('button', { name: t('auth.userButton.manageAccount') })
      .filter({ visible: true })
      .first()
      .click();

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // The Help & feedback item was replaced by a Documentation link (BookOpen,
    // external). Assert the docs anchor exists with the safe external-link attrs…
    const docsLink = menu.locator('a[href="https://tale.dev/docs"]');
    await expect(docsLink).toBeVisible();
    await expect(docsLink).toContainText(t('auth.userButton.documentation'));
    await expect(docsLink).toHaveAttribute('target', '_blank');
    await expect(docsLink).toHaveAttribute('rel', 'noopener noreferrer');

    // …and the old contact link is gone.
    await expect(
      menu.locator('a[href="https://tale.dev/contact"]'),
    ).toHaveCount(0);
  });
});

test.describe('navigation: 404 and history', () => {
  test('renders the styled not-found UI for an unknown route inside the shell', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;

    await page.goto(dashboardUrl(organizationId, '/__nope__'));

    // The styled 404 renders: a heading proving the app didn't blank-screen or
    // fall back to the bare framework "Not Found" string on the unmatched route.
    await expect(
      page.getByRole('heading', { name: t('common.notFound.title'), level: 1 }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // The recovery CTA links back to the org dashboard.
    const backLink = page.getByRole('link', {
      name: t('common.notFound.backToDashboard'),
    });
    await expect(backLink).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(backLink).toHaveAttribute(
      'href',
      new RegExp(`/dashboard/${organizationId}$`),
    );

    // It renders INSIDE the `$id` layout, so the primary nav shell is still up.
    await expect(primaryNav(page)).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // The route `head` sets a sensible document title instead of falling back
    // to the marketing default — part of the issue's reported regression.
    await expect(page).toHaveTitle(new RegExp(t('metadata.notFound.title')));
  });

  test('back/forward navigation tracks the URL and content', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;

    // Step 1: org root → settles on chat.
    await page.goto(dashboardUrl(organizationId));
    await page.waitForURL(/\/chat(?:[/?#]|$)/, {
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await expect(chatSurfaceAnchor(page)).toBeVisible({
      timeout: TIMEOUT.VISIBLE,
    });

    // Step 2: deep-link into a nested settings page (a distinct history entry).
    await page.goto(dashboardUrl(organizationId, '/settings/account'));
    await page.waitForURL(/\/settings\/account(?:[/?#]|$)/, {
      timeout: TIMEOUT.NAV,
    });
    await expect(
      page.getByRole('heading', {
        name: t('settings.account.profile.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Back → chat surface (URL + content track the history pop).
    await page.goBack();
    await page.waitForURL(/\/chat(?:[/?#]|$)/, { timeout: TIMEOUT.NAV });
    await expect(chatSurfaceAnchor(page)).toBeVisible({
      timeout: TIMEOUT.VISIBLE,
    });

    // Forward → back to the settings account page.
    await page.goForward();
    await page.waitForURL(/\/settings\/account(?:[/?#]|$)/, {
      timeout: TIMEOUT.NAV,
    });
    await expect(
      page.getByRole('heading', {
        name: t('settings.account.profile.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  });
});
