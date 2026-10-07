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
 * current too), the phone's back arrow, and long project and automation
 * names that must not crowd the page's own title out, whose whole text a
 * tooltip shows while they are cut.
 */

const fixtures = vi.hoisted(() => ({
  projectName: 'Apollo',
  automationName: 'Intake',
}));

vi.mock('../hooks/queries', () => ({
  useAutomation: () => ({
    data: { presentation: { name: fixtures.automationName } },
    isPending: false,
  }),
  useAutomations: () => ({ data: [], isPending: false }),
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProject: () => ({
    project: { name: fixtures.projectName },
    isLoading: false,
    unavailable: false,
  }),
}));

beforeEach(async () => {
  fixtures.projectName = 'Apollo';
  fixtures.automationName = 'Intake';
  fixedHeader.width = undefined;
  await page.viewport(1280, 800);
});

afterEach(cleanup);

/** The header's width at `md` in the app: the viewport less the rail. */
const fixedHeader = { width: undefined as number | undefined };

function AutomationPage() {
  const { id, automationSlug, projectId } = useParams({ strict: false });
  return (
    <header
      className="flex h-13 w-full min-w-0 items-center px-4"
      style={fixedHeader.width ? { width: fixedHeader.width } : undefined}
    >
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

  it('caps a long automation name on a run so the Run title keeps its room', async () => {
    // At `md` the header is the viewport less the 3rem rail and the padding.
    await page.viewport(768, 800);
    fixedHeader.width = 720;
    fixtures.projectName = 'Quarterly regional operations review';
    fixtures.automationName =
      'Chase every overdue invoice across all regional customer accounts';
    renderTrail(`${PROJECT_AUTOMATION}/intake/runs/r-1`);

    const automation = await screen.findByRole('link', {
      name: fixtures.automationName,
    });
    await waitFor(() =>
      expect(automation.scrollWidth).toBeGreaterThan(automation.clientWidth),
    );
    expect(automation.getBoundingClientRect().width).toBeLessThanOrEqual(192);
    const header = screen.getByRole('banner').getBoundingClientRect();
    const leaf = screen
      .getByRole('heading', { level: 1, name: 'Run' })
      .getBoundingClientRect();
    expect(leaf.width).toBeGreaterThan(0);
    expect(leaf.right).toBeLessThanOrEqual(header.right);
  });

  it('shows a cut name whole in a tooltip, on hover and on focus', async () => {
    fixtures.projectName =
      `Quarterly regional operations ${'review '.repeat(13)}`.trim();
    const { user } = renderTrail(`${PROJECT_AUTOMATION}/intake/editor`);

    const project = await screen.findByRole('link', {
      name: fixtures.projectName,
    });
    await waitFor(() =>
      expect(project.scrollWidth).toBeGreaterThan(project.clientWidth),
    );

    await user.hover(project);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      fixtures.projectName,
    );
    await user.unhover(project);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());

    // The back arrow is the phone's; on a computer the project's name is the
    // first stop.
    await user.tab();
    expect(project).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      fixtures.projectName,
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('opens no tooltip over a name that fits', async () => {
    const { user } = renderTrail(`${PROJECT_AUTOMATION}/intake/editor`);

    const project = await screen.findByRole('link', { name: 'Apollo' });
    await user.hover(project);
    // Past the tooltip's open delay.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it("keeps the phone's back arrow an icon button on a run", async () => {
    await page.viewport(390, 800);
    fixtures.automationName =
      'Chase every overdue invoice across all regional customer accounts';
    renderTrail(`${PROJECT_AUTOMATION}/intake/runs/r-1`);

    const back = await screen.findByRole('link', { name: 'Back' });
    expect(back).toBeVisible();
    expect(back).toHaveAttribute('href', `${PROJECT_AUTOMATION}/intake/editor`);
    const box = back.getBoundingClientRect();
    // The capped crumb's classes leave the square icon button as it was.
    expect(box.width).toBe(box.height);
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(back.querySelector('svg')).toBeVisible();
  });
});
