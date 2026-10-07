import '@testing-library/jest-dom/vitest';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { paramToAutomationSlug } from '@/lib/automations/slug';
import { cleanup, render, screen, waitFor, within } from '@/tests/utils/render';

import { AutomationBreadcrumbs } from './automation-breadcrumbs';

import '@/app/globals.css';

/**
 * The trail of an automation opened inside a project, under a real router in
 * Chromium: where its crumbs lead, that only the leaf names the current page
 * (the ancestors are prefixes of the URL, which TanStack would otherwise mark
 * current too), the phone's back arrow, and a long project name that must
 * not crowd the automation's own name out.
 */

const fixtures = vi.hoisted(() => ({
  projectName: 'Apollo',
}));

vi.mock('../hooks/queries', () => ({
  useAutomation: () => ({
    data: { presentation: { name: 'Intake' } },
    isPending: false,
  }),
  useAutomations: () => ({ data: [], isPending: false }),
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProject: () => ({
    project: { name: fixtures.projectName },
    isLoading: false,
  }),
}));

beforeEach(async () => {
  fixtures.projectName = 'Apollo';
  await page.viewport(1280, 800);
});

afterEach(cleanup);

function AutomationPage() {
  const { id, automationSlug, projectId } = useParams({ strict: false });
  return (
    <header className="flex h-13 w-full min-w-0 items-center px-4">
      <AutomationBreadcrumbs
        organizationId={id ?? ''}
        automationSlug={paramToAutomationSlug(automationSlug ?? '')}
        {...(projectId !== undefined && { projectId })}
      />
    </header>
  );
}

function renderTrail(initialPath: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const automationPages = [
    '/dashboard/$id/automations/$automationSlug/editor',
    '/dashboard/$id/automations/$automationSlug/runs/$runId',
    '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor',
    '/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$runId',
  ].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: AutomationPage,
    }),
  );
  const otherPages = [
    '/dashboard/$id/automations',
    '/dashboard/$id/projects',
    '/dashboard/$id/projects/$projectId',
    '/dashboard/$id/projects/$projectId/automations',
  ].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <p>{path}</p>,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([...automationPages, ...otherPages]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  return { router, ...render(<RouterProvider router={router} />) };
}

const PROJECT_AUTOMATION = '/dashboard/org-1/projects/p-1/automations';

describe('the trail of an automation opened in a project, in Chromium', () => {
  it('names only the leaf as the current page', async () => {
    renderTrail(`${PROJECT_AUTOMATION}/intake/editor`);

    const trail = await screen.findByRole('navigation', {
      name: 'Breadcrumb',
    });
    const list = within(trail).getByRole('list');
    await within(list).findByRole('link', { name: 'Apollo' });
    for (const link of within(trail).getAllByRole('link')) {
      expect(link, link.textContent ?? '').not.toHaveAttribute('aria-current');
    }
    expect(
      within(trail).getByRole('heading', { level: 1, name: 'Intake' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it("leads back to the project's Automations tab and to the project", async () => {
    const { user, router } = renderTrail(`${PROJECT_AUTOMATION}/intake/editor`);
    /** The desktop trail's crumb named `name`, once the trail renders. */
    const crumb = async (name: string) =>
      within(
        within(
          await screen.findByRole('navigation', { name: 'Breadcrumb' }),
        ).getByRole('list'),
      ).findByRole('link', { name });

    await user.click(await crumb('Automations'));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(PROJECT_AUTOMATION),
    );

    router.history.push(`${PROJECT_AUTOMATION}/intake/editor`);
    await user.click(await crumb('Apollo'));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/dashboard/org-1/projects/p-1',
      ),
    );
  });

  it("returns the phone's back arrow to the project's Automations tab", async () => {
    await page.viewport(390, 800);
    renderTrail(`${PROJECT_AUTOMATION}/intake/editor`);

    const back = await screen.findByRole('link', { name: 'Back' });
    expect(back).toBeVisible();
    expect(back).toHaveAttribute('href', PROJECT_AUTOMATION);
    // The full trail is the desktop's; the phone keeps the arrow and the name.
    expect(
      screen.getByRole('link', { name: 'Apollo', hidden: true }),
    ).not.toBeVisible();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Intake' }),
    ).toBeVisible();
  });

  it('truncates a long project name and keeps the automation readable', async () => {
    fixtures.projectName =
      `Quarterly regional operations ${'review '.repeat(13)}`.trim();
    renderTrail(`${PROJECT_AUTOMATION}/intake/runs/r-1`);

    const project = await screen.findByRole('link', {
      name: fixtures.projectName,
    });
    await waitFor(() =>
      expect(project.scrollWidth).toBeGreaterThan(project.clientWidth),
    );
    // The crumb is capped, the name crumb and the leaf both still show.
    expect(project.getBoundingClientRect().width).toBeLessThanOrEqual(192);
    const automation = screen.getByRole('link', { name: 'Intake' });
    expect(automation).toBeVisible();
    expect(automation).toHaveAttribute(
      'href',
      `${PROJECT_AUTOMATION}/intake/editor`,
    );
    const leaf = screen.getByRole('heading', { level: 1, name: 'Run' });
    expect(leaf.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(leaf.getBoundingClientRect().right).toBeLessThanOrEqual(1280);
  });
});
