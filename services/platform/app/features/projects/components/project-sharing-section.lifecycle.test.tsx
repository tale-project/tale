import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { backendFetch } from '@/app/lib/backend/api-client';
import { act, render, screen, waitFor } from '@/tests/utils/render';

import { ProjectSharingSection } from './project-sharing-section';

vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: vi.fn(),
}));
vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({
    teams: [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Bravo' },
      { id: 'c', name: 'Charlie' },
    ],
    isLoading: false,
  }),
  useTeamNames: () => ({ nameOf: (id: string) => id }),
}));

function projectBody(teamIds: string[]) {
  return {
    project: {
      id: 'project-audit',
      organizationId: 'org-audit',
      name: 'Synthetic',
      description: null,
      icon: null,
      color: null,
      key: null,
      externalItemId: null,
      taskCounter: 0,
      openTaskCount: 0,
      doneTaskCount: 0,
      projectAgentCount: 0,
      teamId: null,
      sharedWithTeamIds: [],
      teamIds,
      instructions: null,
      createdBy: 'admin',
      createdAt: 0,
      updatedAt: 0,
      archivedAt: null,
      pinnedAt: null,
      isOrgWide: false,
      canEdit: true,
      canAdminister: true,
    },
  };
}

function OverviewAudience() {
  const { data: project } = useBackendQuery('projects/queries:getProject', {
    organizationId: 'org-audit',
    projectId: 'project-audit',
  });
  if (!project) return null;
  return (
    <ProjectSharingSection
      projectId={project._id}
      organizationId={project.organizationId}
      teamIds={project.teamIds ?? []}
      canAdminister={project.canAdminister}
    />
  );
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.clearAllMocks();
});

it('uses cumulative replacement bodies with real adapters and mutation lifecycle while readback is delayed', async () => {
  window.history.replaceState(
    null,
    '',
    '/dashboard/org-audit/projects/project-audit/overview',
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let savedTeamIds = ['a'];
  let reads = 0;
  let finishFirstWrite: (() => void) | undefined;
  const releaseReads: (() => void)[] = [];
  const bodies: unknown[] = [];

  vi.mocked(backendFetch).mockImplementation(async (path, options) => {
    if (path === '/projects/project-audit/sharing') {
      bodies.push(options?.body);
      const body = options?.body;
      if (
        typeof body !== 'object' ||
        body === null ||
        !('teamIds' in body) ||
        !Array.isArray(body.teamIds) ||
        !body.teamIds.every((id: unknown) => typeof id === 'string')
      ) {
        throw new Error('Unexpected sharing body');
      }
      savedTeamIds = body.teamIds;
      if (bodies.length === 1) {
        await new Promise<void>((resolve) => {
          finishFirstWrite = resolve;
        });
      }
      return null;
    }
    if (path !== '/projects/project-audit')
      throw new Error(`Unexpected path: ${path}`);
    reads += 1;
    if (reads > 1) {
      await new Promise<void>((resolve) => {
        releaseReads.push(resolve);
      });
    }
    return projectBody([...savedTeamIds]);
  });

  const { user, unmount } = render(
    <QueryClientProvider client={client}>
      <OverviewAudience />
    </QueryClientProvider>,
  );
  try {
    const picker = await screen.findByRole('combobox', { name: 'Audience' });
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: 'Bravo' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    await waitFor(() =>
      expect(picker).toHaveAttribute('aria-disabled', 'true'),
    );
    await user.click(screen.getByRole('option', { name: 'Charlie' }));
    expect(bodies).toHaveLength(1);

    await act(async () => {
      finishFirstWrite?.();
    });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(releaseReads).toHaveLength(1));
    await user.click(screen.getByRole('option', { name: 'Charlie' }));
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    expect(bodies).toEqual([
      { teamIds: ['a', 'b'] },
      { teamIds: ['a', 'b', 'c'] },
    ]);
    expect(
      screen.queryByText(/This change narrows access/),
    ).not.toBeInTheDocument();

    await act(async () => {
      releaseReads.forEach((resolve) => resolve());
    });
    await user.keyboard('{Escape}');
    expect(savedTeamIds).toEqual(['a', 'b', 'c']);
    expect(
      screen.getByRole('button', { name: 'Remove Bravo' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove Charlie' }),
    ).toBeInTheDocument();
  } finally {
    unmount();
    client.clear();
  }
});
