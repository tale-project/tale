import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';

import { act, render, screen, waitFor } from '@/tests/utils/render';

import { Route } from './agents';

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProject: () => ({ project: { canEdit: true }, isLoading: false }),
  useProjectHarnesses: () => ({ data: { harnesses: [], models: [] } }),
  useProjectCapabilityCatalog: (organizationId: string, projectId: string) => ({
    data: {
      skills: [
        {
          slug:
            organizationId === 'org-2'
              ? 'pdf'
              : projectId === 'p2'
                ? 'xlsx'
                : 'docx',
          label: 'Document skill',
        },
      ],
      connectors: [],
    },
  }),
  useProjectAgents: () => ({
    agents: [
      {
        _id: 'saved-agent',
        name: 'Saved agent',
        harness: 'claude-code',
        skills: ['brief-summary'],
        connectors: [],
      },
    ],
    isLoading: false,
  }),
  useAgentSecrets: () => ({ data: [] }),
}));

vi.mock('@/app/features/projects/hooks/mutations', () => ({
  useCreateProjectAgent: () => ({ mutateAsync: vi.fn() }),
  useUpdateProjectAgent: () => ({ mutateAsync: vi.fn() }),
  useDeleteProjectAgent: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/features/projects/hooks/use-unpinned-serving-preview', () => ({
  useUnpinnedServingPreview: () => ({ data: undefined }),
}));

vi.mock('@/app/features/projects/components/agent-secrets-field', () => ({
  AgentSecretsField: () => null,
}));

const path = '/dashboard/$id/projects/$projectId/agents';

describe('project agent form scope', () => {
  it.each([
    { id: 'org-1', projectId: 'p2', mode: 'create' },
    { id: 'org-2', projectId: 'p1', mode: 'create' },
    { id: 'org-1', projectId: 'p2', mode: 'edit' },
    { id: 'org-2', projectId: 'p1', mode: 'edit' },
  ])(
    'closes the $mode form on navigation to $id/$projectId',
    async ({ id, projectId, mode }) => {
      const root = createRootRoute({ component: Outlet });
      const route = createRoute({
        getParentRoute: () => root,
        path,
        component: Route.options.component,
      });
      const router = createRouter({
        routeTree: root.addChildren([route]),
        history: createMemoryHistory({
          initialEntries: ['/dashboard/org-1/projects/p1/agents'],
        }),
      });
      const { user } = render(<RouterProvider router={router} />);
      await screen.findByText('Saved agent');
      await user.click(
        await screen.findByRole('button', {
          name: mode === 'create' ? 'New agent' : 'Edit agent',
        }),
      );
      if (mode === 'create')
        await user.type(screen.getByLabelText('Name'), 'Old project draft');
      else expect(screen.getByLabelText('Name')).toHaveValue('Saved agent');

      await act(() => router.navigate({ to: path, params: { id, projectId } }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      await screen.findByText('Saved agent');
      await user.click(screen.getByRole('button', { name: 'New agent' }));
      expect(screen.getByLabelText('Name')).toHaveValue('');
      await user.click(screen.getByRole('button', { name: 'Skills' }));
      expect(
        await screen.findByRole('menuitemcheckbox', { name: 'Document skill' }),
      ).toHaveAttribute('aria-checked', 'true');
      expect(
        screen.queryByRole('menuitemcheckbox', { name: /brief-summary/ }),
      ).not.toBeInTheDocument();
    },
  );
});
