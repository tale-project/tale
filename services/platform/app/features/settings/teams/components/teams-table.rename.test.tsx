import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backendKey } from '@/app/lib/backend/query-keys';
import { authClient } from '@/lib/auth-client';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import type { Team } from '../hooks/queries';
import { TeamsTable } from './teams-table';

const fixtures = vi.hoisted(() => ({
  members: [{ _id: 'membership-a', userId: 'user-a' }],
  addMember: vi.fn(),
  removeMember: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-a',
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { organization: { updateTeam: vi.fn() } },
}));
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: fixtures.toast }),
}));
vi.mock('../hooks/queries', () => ({
  useTeamMembers: () => ({ teamMembers: fixtures.members, isLoading: false }),
}));
vi.mock('../hooks/mutations', () => ({
  useDeleteTeam: () => ({ mutateAsync: vi.fn() }),
  useAddTeamMember: () => ({ mutateAsync: fixtures.addMember }),
  useRemoveTeamMember: () => ({ mutateAsync: fixtures.removeMember }),
}));
vi.mock('../hooks/use-teams-table-config', () => ({
  useTeamsTableConfig: () => ({
    columns: [{ accessorKey: 'name', header: 'Name' }],
    searchPlaceholder: 'Search teams',
    stickyLayout: false,
    pageSize: 20,
  }),
}));
vi.mock('./team-create-dialog', () => ({ TeamCreateDialog: () => null }));
vi.mock('./team-member-checklist', () => ({ TeamMemberChecklist: () => null }));

const key = backendKey('org-a', 'team', 'org-list');
let storedTeam: Team;
const readTeams = vi.fn(() => [storedTeam]);
let client: QueryClient;

function TeamList() {
  const { data } = useQuery({
    queryKey: key,
    queryFn: readTeams,
    staleTime: Infinity,
  });
  return <TeamsTable teams={data} organizationId="org-a" />;
}

function renderTeams() {
  return render(
    <QueryClientProvider client={client}>
      <TeamList />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  storedTeam = {
    id: 'team-a',
    name: 'Original team',
    memberCount: 1,
    createdAt: 0,
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(authClient.organization.updateTeam).mockImplementation(async () => {
    storedTeam = { ...storedTeam, name: 'Renamed team' };
    return { data: null, error: null };
  });
});

afterEach(() => {
  expect(fixtures.addMember).not.toHaveBeenCalled();
  expect(fixtures.removeMember).not.toHaveBeenCalled();
  cleanup();
  client.clear();
});

describe('TeamsTable selected team identity', () => {
  it('refreshes the detail title and subsequent cancel baseline after a successful rename', async () => {
    const { user } = renderTeams();
    await user.click(
      await screen.findByRole('cell', { name: 'Original team' }),
    );
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const name = screen.getByRole('textbox', { name: /Team name/ });
    await user.clear(name);
    await user.type(name, 'Renamed team');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('cell', { name: 'Renamed team', hidden: true });
    expect(client.getQueryData(key)).toEqual([storedTeam]);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit team' })).toBeNull(),
    );
    expect(
      screen.getByRole('dialog', { name: 'Renamed team' }),
    ).toBeInTheDocument();
    expect(authClient.organization.updateTeam).toHaveBeenCalledTimes(1);
    expect(authClient.organization.updateTeam).toHaveBeenCalledWith({
      teamId: 'team-a',
      data: { name: 'Renamed team', organizationId: 'org-a' },
    });
    expect(readTeams).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: /Team name/ })).toHaveValue(
      'Renamed team',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: /Team name/ })).toHaveValue(
      'Renamed team',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Renamed team' })).getByRole(
        'button',
        { name: 'Cancel' },
      ),
    );
    await user.click(screen.getByRole('cell', { name: 'Renamed team' }));
    expect(
      screen.getByRole('dialog', { name: 'Renamed team' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: /Team name/ })).toHaveValue(
      'Renamed team',
    );
    expect(authClient.organization.updateTeam).toHaveBeenCalledTimes(1);
  });

  it('retains a refused duplicate-name draft without changing the saved list or reporting success', async () => {
    vi.mocked(authClient.organization.updateTeam).mockResolvedValue({
      data: null,
      error: {
        code: 'TEAM_NAME_TAKEN',
        message: 'Name taken',
        status: 409,
        statusText: 'Conflict',
      },
    });
    const { user } = renderTeams();
    await user.click(
      await screen.findByRole('cell', { name: 'Original team' }),
    );
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const name = screen.getByRole('textbox', { name: /Team name/ });
    await user.clear(name);
    await user.type(name, 'Finance');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('A team with this name already exists'),
    ).toBeInTheDocument();
    expect(name).toHaveValue('Finance');
    expect(
      screen.getByRole('cell', { name: 'Original team', hidden: true }),
    ).toBeInTheDocument();
    expect(client.getQueryData(key)).toEqual([storedTeam]);
    expect(readTeams).toHaveBeenCalledTimes(1);
    expect(fixtures.toast).not.toHaveBeenCalled();
    expect(authClient.organization.updateTeam).toHaveBeenCalledTimes(1);
  });

  it('preserves an open dirty name on list replacement and uses the latest saved name after cancel', async () => {
    const { user } = renderTeams();
    await user.click(
      await screen.findByRole('cell', { name: 'Original team' }),
    );
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const name = screen.getByRole('textbox', { name: /Team name/ });
    await user.clear(name);
    await user.type(name, 'Unsaved draft');
    await act(async () => {
      client.setQueryData(key, [{ ...storedTeam, name: 'Latest saved name' }]);
    });
    await screen.findByRole('cell', {
      name: 'Latest saved name',
      hidden: true,
    });
    expect(name).toHaveValue('Unsaved draft');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('dialog', { name: 'Latest saved name' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: /Team name/ })).toHaveValue(
      'Latest saved name',
    );
    expect(authClient.organization.updateTeam).not.toHaveBeenCalled();
  });

  it('updates a clean open editor when the saved name changes', async () => {
    const { user } = renderTeams();
    await user.click(
      await screen.findByRole('cell', { name: 'Original team' }),
    );
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await act(async () => {
      client.setQueryData(key, [{ ...storedTeam, name: 'Latest saved name' }]);
    });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /Team name/ })).toHaveValue(
        'Latest saved name',
      ),
    );
    expect(authClient.organization.updateTeam).not.toHaveBeenCalled();
  });
});
