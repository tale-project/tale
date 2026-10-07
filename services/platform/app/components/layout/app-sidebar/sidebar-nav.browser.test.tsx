import '@testing-library/jest-dom/vitest';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defineAbilityFor } from '@/lib/permissions/ability';
import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { SidebarFooter } from './sidebar-footer';
import { SidebarNav } from './sidebar-nav';

import '@/app/globals.css';

/**
 * The rail under a real router, in Chromium: what each tile opens and which
 * tile names the page as current. The unit tests mock `Link`, so they cannot
 * see TanStack's own `aria-current` stamp beside the rail's — only this run
 * proves the two never name different tiles, and that a click lands on the
 * section's overview whatever was open there before.
 */

vi.mock('@/app/features/conversations/hooks/use-inbox-availability', () => ({
  useInboxAvailability: () => ({ showInbox: false }),
}));

vi.mock('@/app/features/conversations/hooks/queries', () => ({
  useUnreadConversationCount: () => ({ data: undefined }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => defineAbilityFor('owner'),
}));

vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ accentColor: null, logoUrl: null }),
}));

vi.mock('@/app/components/user-button', () => ({
  UserButton: () => null,
}));

vi.mock('@/app/features/notifications/components/notification-bell', () => ({
  NotificationBell: () => null,
}));

afterEach(cleanup);

const ORG = '/dashboard/org-1';

function Rail() {
  return (
    <>
      <aside aria-label="Rail">
        <SidebarNav organizationId="org-1" />
        <SidebarFooter organizationId="org-1" />
      </aside>
      <main>
        <Outlet />
      </main>
    </>
  );
}

function renderRail(initialPath: string) {
  const rootRoute = createRootRoute({ component: Rail });
  const chatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dashboard/$id/chat',
    validateSearch: (search: Record<string, unknown>) =>
      search.new === true ? { new: true } : {},
    component: () => <p>Chat page</p>,
  });
  const pages = [
    '/dashboard/$id/documents',
    '/dashboard/$id/websites',
    '/dashboard/$id/automations',
    '/dashboard/$id/automations/$automationSlug/runs',
    '/dashboard/$id/projects/$projectId/tasks/board',
    '/dashboard/$id/projects/$projectId/automations',
    '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor',
    '/dashboard/$id/settings',
    '/dashboard/$id/settings/teams',
  ].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <p>{path}</p>,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([chatRoute, ...pages]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  /** Moves to `path` the way an address or another link would. */
  async function go(path: string) {
    router.history.push(path);
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
  }
  return { router, go, ...render(<RouterProvider router={router} />) };
}

const tile = (name: string) =>
  screen.findByRole('link', { name: new RegExp(`^${name}`) });

/** Every rail link naming the page as current, by its accessible name. */
function currentTiles(): string[] {
  return screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.getAttribute('aria-label') ?? '');
}

describe('the rail in Chromium', () => {
  it("opens each section's overview, never the place left there", async () => {
    const { user, router, go } = renderRail(`${ORG}/automations/intake/runs`);
    const location = () => router.state.location;

    await user.click(await tile('Knowledge'));
    await waitFor(() => expect(location().pathname).toBe(`${ORG}/documents`));

    // Another Knowledge tab, then away and back: Documents again.
    await go(`${ORG}/websites`);
    await user.click(await tile('Home'));
    await waitFor(() => expect(location().pathname).toBe(`${ORG}/chat`));
    expect(location().search).toEqual({ new: true });

    await user.click(await tile('Automations'));
    await waitFor(() => expect(location().pathname).toBe(`${ORG}/automations`));

    await user.click(await tile('Knowledge'));
    await waitFor(() => expect(location().pathname).toBe(`${ORG}/documents`));

    await user.click(await tile('Settings'));
    await waitFor(() => expect(location().pathname).toBe(`${ORG}/settings`));

    // From inside the section, too.
    await go(`${ORG}/settings/teams`);
    await user.click(await tile('Settings'));
    await waitFor(() => expect(location().pathname).toBe(`${ORG}/settings`));

    await go(`${ORG}/projects/p-1/tasks/board`);
    await user.click(await tile('Home'));
    await waitFor(() => expect(location().pathname).toBe(`${ORG}/chat`));
    expect(location().search).toEqual({ new: true });
  });

  // The owner's report: an automation opened from a project's Automations
  // tab left the rail on Home, and Automations later reopened it.
  it('treats an automation opened in a project as Automations', async () => {
    const { user, router, go } = renderRail(
      `${ORG}/projects/p-1/automations/intake/editor`,
    );
    const location = () => router.state.location;

    await waitFor(() => expect(currentTiles()).toEqual(['Automations']));

    await user.click(await tile('Knowledge'));
    await waitFor(() => expect(location().pathname).toBe(`${ORG}/documents`));
    await user.click(await tile('Automations'));
    await waitFor(() => expect(location().pathname).toBe(`${ORG}/automations`));

    // Clicked from the automation itself, too.
    await go(`${ORG}/projects/p-1/automations/intake/editor`);
    await user.click(await tile('Automations'));
    await waitFor(() => expect(location().pathname).toBe(`${ORG}/automations`));
  });

  it('names exactly one tile as the current page, the one the pill marks', async () => {
    const { go } = renderRail(`${ORG}/chat`);

    for (const [path, section] of [
      [`${ORG}/chat`, 'Home'],
      [`${ORG}/websites`, 'Knowledge'],
      [`${ORG}/automations/intake/runs`, 'Automations'],
      [`${ORG}/projects/p-1/tasks/board`, 'Home'],
      [`${ORG}/projects/p-1/automations`, 'Home'],
      [`${ORG}/projects/p-1/automations/intake/editor`, 'Automations'],
      [`${ORG}/settings/teams`, 'Settings'],
    ] as const) {
      await go(path);
      await waitFor(() => expect(currentTiles(), path).toEqual([section]));
      expect(
        screen
          .getByRole('link', { name: new RegExp(`^${section}`) })
          .querySelector('[data-active="true"]'),
        path,
      ).not.toBeNull();
    }
  });

  it('opens a section from the keyboard', async () => {
    const { user, router } = renderRail(`${ORG}/automations/intake/runs`);

    (await tile('Automations')).focus();
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`${ORG}/automations`),
    );
  });
});
