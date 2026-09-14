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
import { afterEach, describe, expect, it, vi } from 'vitest';

import { paramToAutomationSlug } from '@/lib/automations/slug';
import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { AutomationBreadcrumbSwitcher } from './automation-breadcrumb-switcher';

import '@/app/globals.css';

const { automations } = vi.hoisted(() => ({
  automations: [
    { name: 'org/digest', projectIds: [], presentation: { name: 'Digest' } },
    {
      name: 'alpha/import',
      projectIds: ['project-a'],
      presentation: { name: 'Alpha import' },
    },
    {
      name: 'beta/export',
      projectIds: ['project-b'],
      presentation: { name: 'Beta export' },
    },
    {
      name: 'shared/reconcile',
      projectIds: ['project-a', 'project-b'],
      presentation: { name: 'Reconcile' },
    },
    {
      name: 'org/export',
      projectIds: [],
      presentation: { name: 'Organization export' },
    },
  ],
}));

vi.mock('../hooks/queries', () => ({
  // Keep the query's scope semantics: an unconditional fixture would hide the
  // regression where entering a project silently removes other automations.
  useAutomations: (
    _organizationId: string,
    projectId?: string,
    includeProjectBound?: boolean,
  ) => ({
    data: automations.filter((row) =>
      projectId !== undefined
        ? row.projectIds.includes(projectId)
        : includeProjectBound === true || row.projectIds.length === 0,
    ),
  }),
}));

afterEach(cleanup);

function AutomationPage() {
  const { id, automationSlug, projectId } = useParams({ strict: false });
  const name = paramToAutomationSlug(automationSlug ?? '');
  const row = automations.find((automation) => automation.name === name);
  return (
    <AutomationBreadcrumbSwitcher
      organizationId={id ?? ''}
      automationSlug={name}
      displayName={row?.presentation.name ?? name}
      {...(projectId !== undefined && { projectId })}
    />
  );
}

function renderSwitcher() {
  const rootRoute = createRootRoute({ component: Outlet });
  const routes = [
    '/dashboard/$id/automations/$automationSlug/editor',
    '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor',
  ].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: AutomationPage,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({
      initialEntries: ['/dashboard/org-test/automations/org__digest/editor'],
    }),
  });
  return { router, ...render(<RouterProvider router={router} />) };
}

// Every switch lands on the Editor tab — the automation's default surface —
// so the memory router mounts that route in both shells.
describe('automation switching across shells in Chromium', () => {
  it('groups every automation organization-first and keeps them reachable across project switches', async () => {
    const { user, router } = renderSwitcher();

    function expectOptions(names: string[]) {
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(names.length);
      for (const [index, name] of names.entries()) {
        expect(options[index]).toHaveAccessibleName(name);
      }
    }

    async function openSwitcher(current: string) {
      await user.click(
        await screen.findByRole('button', {
          name: `Switch automation, current: ${current}`,
        }),
      );
      await screen.findByRole('listbox');
      expectOptions([
        'Digest org/digest',
        'Organization export org/export',
        'Alpha import alpha/import',
        'Beta export beta/export',
        'Reconcile shared/reconcile',
      ]);
      const divider = screen.getByRole('separator', { hidden: true });
      expect(divider).toHaveAttribute('aria-hidden', 'true');
      const bounds = divider.getBoundingClientRect();
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
      expect(bounds.top).toBeGreaterThanOrEqual(
        screen
          .getByRole('option', { name: 'Organization export org/export' })
          .getBoundingClientRect().bottom,
      );
      expect(bounds.bottom).toBeLessThanOrEqual(
        screen
          .getByRole('option', { name: 'Alpha import alpha/import' })
          .getBoundingClientRect().top,
      );
      expect(screen.getByRole('option', { selected: true })).toHaveTextContent(
        current,
      );
      expect(screen.getByRole('combobox')).toHaveValue('');
    }

    await openSwitcher('Digest');
    await user.type(screen.getByRole('combobox'), 'export');
    expectOptions([
      'Organization export org/export',
      'Beta export beta/export',
    ]);
    expect(screen.getAllByRole('separator', { hidden: true })).toHaveLength(1);
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'alpha/import');
    expectOptions(['Alpha import alpha/import']);
    expect(
      screen.queryByRole('separator', { hidden: true }),
    ).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/dashboard/org-test/projects/project-a/automations/alpha__import/editor',
      ),
    );

    await openSwitcher('Alpha import');
    await user.click(screen.getByRole('option', { name: /Beta export/ }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/dashboard/org-test/projects/project-b/automations/beta__export/editor',
      ),
    );

    await openSwitcher('Beta export');
    await user.click(screen.getByRole('option', { name: /Reconcile/ }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/dashboard/org-test/projects/project-b/automations/shared__reconcile/editor',
      ),
    );

    await openSwitcher('Reconcile');
    await user.click(screen.getByRole('option', { name: /Digest/ }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/dashboard/org-test/automations/org__digest/editor',
      ),
    );
    await openSwitcher('Digest');
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
    );
  });
});
