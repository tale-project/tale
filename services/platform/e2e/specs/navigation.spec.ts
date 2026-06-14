import { expect, test, type Locator, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Cross-cutting NAVIGATION & ROUTING coverage that the per-feature happy-path
 * specs don't exercise. Runs as the pre-authenticated owner (chromium project
 * storageState) against the seeded org. READ-ONLY by construction: it only
 * navigates and asserts — it never creates, edits, or deletes anything.
 *
 * Four areas:
 *  1. Primary side-nav rail — from the org landing, CLICK each major section's
 *     rail link (chat, projects, conversations, knowledge, agents, automations,
 *     settings) and assert both the URL changed AND a stable section anchor
 *     rendered. Governance is NOT in the primary rail (it's a settings
 *     sub-section), so it's covered separately via the settings rail below.
 *  2. Settings rail → governance — the only click-path to governance: expand
 *     the Governance disclosure group in the settings rail, click a child, and
 *     assert the governance route + a settled anchor.
 *  3. Breadcrumbs — open the seeded agent's detail page (a two-level
 *     "Agents › <agent>" breadcrumb whose parent is a real link), assert the
 *     trail renders, click the parent crumb, assert the URL navigates up.
 *  4. 404 / history — a bogus child path renders the framework not-found UI
 *     inside the dashboard shell (NOT a blank page / crash); a deep-link then
 *     goBack()/goForward() tracks the URL each way.
 *
 * SELECTOR NOTE (primary rail): the rail links are ICON-ONLY `<Link>`s wrapped
 * in a Radix tooltip — the tooltip text is portalled and does NOT name the
 * link, so `getByRole('link', { name })` can't match them. Their `href`s are
 * deterministic (derived from the route), so we scope to the main-navigation
 * landmark (`<nav aria-label="Main navigation">`, named via
 * `common.aria.mainNavigation`) and locate each link by its exact `href`.
 *
 * NOT-FOUND NOTE: the app sets no custom `notFoundComponent`/
 * `defaultNotFoundComponent` (verified in `app/router.tsx` + `app/routes/
 * __root.tsx`), and there's no splat/catch-all route under `/dashboard/$id`.
 * An unmatched child therefore renders TanStack Router's built-in default —
 * a literal `<p>Not Found</p>` — inside the matched `$id` layout's `<Outlet/>`.
 * That string is FRAMEWORK output (not in `messages/en.json`), so it is an
 * intentional hardcoded constant here rather than a `t()` lookup; the same UI
 * is what `throw notFound()` renders in the conversations route.
 */

// TanStack Router's built-in default not-found body (see NOT-FOUND NOTE). Not a
// translated UI string — it comes from `@tanstack/react-router`, so it stays a
// local framework constant rather than going through `t()`.
const FRAMEWORK_NOT_FOUND_TEXT = 'Not Found';

// Seeded fixture agent, defined in
// `fixtures/config/default/agents/chat-agent.json`. The route param (`agentId`)
// is the filename basename; `displayName` is the breadcrumb leaf. Fixture
// literals, not translated UI copy — kept as local constants for rename-safety,
// matching the convention in `settings.spec.ts`.
const SEEDED_AGENT_SLUG = 'chat-agent';
const SEEDED_AGENT_DISPLAY_NAME = 'E2E Assistant';

const FIRST_PAINT_TIMEOUT = 60_000;

function dashboardUrl(organizationId: string, path = ''): string {
  return `/dashboard/${organizationId}${path}`;
}

/** The desktop primary side-nav rail landmark (Radix NavigationMenu → `<nav>`). */
function primaryNav(page: Page): Locator {
  return page.getByRole('navigation', {
    name: t('common.aria.mainNavigation'),
  });
}

/**
 * A primary-rail link located by its trailing href. The rail links carry no
 * accessible name (icon-only + portalled tooltip), so href is the stable hook.
 * Scoped to the main-navigation landmark so it never collides with in-page nav
 * (e.g. the projects/agents secondary navs share link hrefs are distinct, but
 * scoping keeps the intent explicit and robust).
 */
function navLinkByHref(page: Page, hrefSuffix: string): Locator {
  return primaryNav(page).locator(`a[href$="${hrefSuffix}"]`);
}

/**
 * The chat header's "New chat" button renders TWICE (desktop bar + mobile
 * header); only one is visible on the Desktop Chrome viewport but both match
 * the accessible name, so scope to the first.
 */
function newChatButton(page: Page): Locator {
  return page.getByRole('button', { name: t('chat.newChat') }).first();
}

/**
 * Per-section rail-click matrix. `hrefSuffix` is the rail link's destination
 * (the logo also links to `/chat`, so the chat row + logo share that href —
 * either click lands on chat, so `.first()` is safe). `urlPattern` proves the
 * navigation committed; `anchor` is an always-present element on the landing
 * page (chosen by reading each route component, never a seeded data row).
 */
interface NavCase {
  readonly key: string;
  readonly hrefSuffix: string;
  readonly urlPattern: RegExp;
  readonly anchor: (page: Page) => Locator;
}

function navCases(organizationId: string): readonly NavCase[] {
  return [
    {
      key: 'projects',
      hrefSuffix: `/dashboard/${organizationId}/projects`,
      urlPattern: /\/projects(?:[/?#]|$)/,
      // The list header's "Create project" action is always present (empty or
      // populated). `.first()` pins it across the header/empty-state variants.
      anchor: (page) =>
        page
          .getByRole('button', { name: t('projects.list.createButton') })
          .first(),
    },
    {
      key: 'conversations',
      // The rail links to the "open" status; the base route also redirects there.
      hrefSuffix: `/dashboard/${organizationId}/conversations/open`,
      urlPattern: /\/conversations\/open(?:[/?#]|$)/,
      anchor: (page) =>
        page.getByText(t('conversations.title'), { exact: true }).first(),
    },
    {
      key: 'knowledge',
      // Knowledge's rail entry lands on the documents list.
      hrefSuffix: `/dashboard/${organizationId}/documents`,
      urlPattern: /\/documents(?:[/?#]|$)/,
      // Documents empty-state title — the fixture seeds no documents, so this
      // is the settled body; reading the route, it's an always-present anchor.
      anchor: (page) => page.getByText(t('documents.emptyState.title')).first(),
    },
    {
      key: 'agents',
      hrefSuffix: `/dashboard/${organizationId}/agents`,
      urlPattern: /\/agents(?:[/?#]|$)/,
      // Agents layout header title (`AdaptiveHeaderTitle` → `<h1>`).
      anchor: (page) =>
        page
          .getByRole('heading', { name: t('settings.agents.title'), level: 1 })
          .first(),
    },
    {
      key: 'automations',
      hrefSuffix: `/dashboard/${organizationId}/automations`,
      urlPattern: /\/automations(?:[/?#]|$)/,
      // Automations layout header title (`AdaptiveHeaderTitle` → `<h1>`).
      anchor: (page) =>
        page
          .getByRole('heading', { name: t('automations.title'), level: 1 })
          .first(),
    },
    {
      key: 'settings',
      hrefSuffix: `/dashboard/${organizationId}/settings`,
      // Settings index redirects to a permission-appropriate sub-page, so only
      // assert we entered the settings subtree.
      urlPattern: /\/settings(?:[/?#]|$)/,
      // Settings layout header title (`AdaptiveHeaderTitle` → `<h1>`).
      anchor: (page) =>
        page
          .getByRole('heading', {
            name: t('navigation.userSettings'),
            level: 1,
          })
          .first(),
    },
  ];
}

test.describe('navigation: primary side-nav rail', () => {
  test('navigates to every major section by clicking its rail link', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();

    // Land on the org root (redirects to /chat) and prove the rail is mounted
    // via the always-present chat header button before driving it.
    await page.goto(dashboardUrl(organizationId));
    await page.waitForURL(/\/chat(?:[/?#]|$)/, {
      timeout: FIRST_PAINT_TIMEOUT,
    });
    await expect(newChatButton(page)).toBeVisible({
      timeout: FIRST_PAINT_TIMEOUT,
    });
    await expect(primaryNav(page)).toBeVisible({
      timeout: FIRST_PAINT_TIMEOUT,
    });

    // Each section: click its rail link, assert the URL committed, then assert
    // a stable landing anchor. Sequential (shared page) — order-independent.
    for (const navCase of navCases(organizationId)) {
      await navLinkByHref(page, navCase.hrefSuffix).first().click();
      await page.waitForURL(navCase.urlPattern, {
        timeout: FIRST_PAINT_TIMEOUT,
      });
      await expect(navCase.anchor(page)).toBeVisible({
        timeout: FIRST_PAINT_TIMEOUT,
      });
      // The rail persists across navigations (it lives in the layout shell).
      await expect(primaryNav(page)).toBeVisible();
    }

    // Finally, the chat rail link (shares its href with the logo) returns to
    // the chat surface.
    await navLinkByHref(page, `/dashboard/${organizationId}/chat`)
      .first()
      .click();
    await page.waitForURL(/\/chat(?:[/?#]|$)/, {
      timeout: FIRST_PAINT_TIMEOUT,
    });
    await expect(newChatButton(page)).toBeVisible({
      timeout: FIRST_PAINT_TIMEOUT,
    });
  });
});

test.describe('navigation: settings rail → governance', () => {
  test('expands the governance group and navigates into a governance page', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();

    // Start on a concrete settings page so the rail is rendered and the
    // governance group is collapsed (we drive its disclosure ourselves).
    await page.goto(dashboardUrl(organizationId, '/settings/account'));

    // The settings rail is its own landmark (`<nav aria-label="Settings">`).
    const settingsRail = page.getByRole('navigation', {
      name: t('navigation.userSettings'),
    });
    await expect(settingsRail).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });

    // Governance is an expandable disclosure BUTTON (not a link); expand it to
    // reveal its child links.
    const governanceGroup = settingsRail.getByRole('button', {
      name: t('navigation.governance'),
    });
    await expect(governanceGroup).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });
    if ((await governanceGroup.getAttribute('aria-expanded')) !== 'true') {
      await governanceGroup.click();
    }
    await expect(governanceGroup).toHaveAttribute('aria-expanded', 'true');

    // Click the first governance child (Policies & Limits) and assert the
    // route + a settled anchor (the voice-output policy switch always renders).
    const policiesLink = settingsRail.getByRole('link', {
      name: t('governance.groups.policiesAndLimits'),
    });
    await expect(policiesLink).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });
    await policiesLink.click();

    await page.waitForURL(
      /\/settings\/governance\/policies-limits(?:[/?#]|$)/,
      {
        timeout: FIRST_PAINT_TIMEOUT,
      },
    );
    await expect(
      page.getByRole('switch', {
        name: t('governance.voiceOutput.enabledLabel'),
      }),
    ).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });
  });
});

test.describe('navigation: breadcrumbs', () => {
  test('agent detail shows the breadcrumb trail and navigates up via the parent crumb', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();

    // Deep-link into the seeded agent's detail page (param = filename basename).
    await page.goto(
      dashboardUrl(organizationId, `/agents/${SEEDED_AGENT_SLUG}`),
    );

    // The breadcrumb parent ("Agents") is a real link; the leaf is the agent's
    // display name. Both prove the trail rendered.
    const agentsCrumb = page.getByRole('link', {
      name: t('settings.agents.title'),
    });
    await expect(agentsCrumb).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });
    await expect(page.getByText(SEEDED_AGENT_DISPLAY_NAME).first()).toBeVisible(
      { timeout: FIRST_PAINT_TIMEOUT },
    );

    // Clicking the parent crumb navigates up to the agents list.
    await agentsCrumb.click();
    await page.waitForURL(new RegExp(`/agents(?:[/?#]|$)`), {
      timeout: FIRST_PAINT_TIMEOUT,
    });
    await expect(
      page
        .getByRole('heading', { name: t('settings.agents.title'), level: 1 })
        .first(),
    ).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });
    // Confirm we left the detail route (no agent-name leaf on the list header).
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/${organizationId}/agents$`),
    );
  });
});

test.describe('navigation: 404 and history', () => {
  test('renders the not-found UI for an unknown route inside the shell', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();

    await page.goto(dashboardUrl(organizationId, '/__nope__'));

    // The framework default not-found body renders (no custom 404 component),
    // proving the app didn't blank-screen or crash on the unmatched route.
    await expect(
      page.getByText(FRAMEWORK_NOT_FOUND_TEXT, { exact: true }).first(),
    ).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });

    // It renders INSIDE the `$id` layout, so the primary nav shell is still up.
    await expect(primaryNav(page)).toBeVisible({
      timeout: FIRST_PAINT_TIMEOUT,
    });
  });

  test('back/forward navigation tracks the URL and content', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();

    // Step 1: org root → settles on chat.
    await page.goto(dashboardUrl(organizationId));
    await page.waitForURL(/\/chat(?:[/?#]|$)/, {
      timeout: FIRST_PAINT_TIMEOUT,
    });
    await expect(newChatButton(page)).toBeVisible({
      timeout: FIRST_PAINT_TIMEOUT,
    });

    // Step 2: deep-link into a nested settings page (a distinct history entry).
    await page.goto(dashboardUrl(organizationId, '/settings/account'));
    await page.waitForURL(/\/settings\/account(?:[/?#]|$)/, {
      timeout: FIRST_PAINT_TIMEOUT,
    });
    await expect(
      page.getByRole('heading', {
        name: t('settings.account.profile.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });

    // Back → chat surface (URL + content track the history pop).
    await page.goBack();
    await page.waitForURL(/\/chat(?:[/?#]|$)/, {
      timeout: FIRST_PAINT_TIMEOUT,
    });
    await expect(newChatButton(page)).toBeVisible({
      timeout: FIRST_PAINT_TIMEOUT,
    });

    // Forward → back to the settings account page.
    await page.goForward();
    await page.waitForURL(/\/settings\/account(?:[/?#]|$)/, {
      timeout: FIRST_PAINT_TIMEOUT,
    });
    await expect(
      page.getByRole('heading', {
        name: t('settings.account.profile.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });
  });
});
