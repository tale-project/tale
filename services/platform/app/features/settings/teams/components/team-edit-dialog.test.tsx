import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { backendKey } from '@/app/lib/backend/query-keys';
import { authClient } from '@/lib/auth-client';
import { render, screen, waitFor } from '@/tests/utils/render';

import { TeamEditDialog } from './team-edit-dialog';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-a',
}));
vi.mock('@tale/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { organization: { updateTeam: vi.fn() } },
}));
const members = vi.hoisted(() => [{ _id: 'tm-a', userId: 'user-a' }]);
vi.mock('../hooks/queries', () => ({
  useTeamMembers: () => ({ teamMembers: members }),
}));
vi.mock('../hooks/mutations', () => ({
  useAddTeamMember: () => ({ mutateAsync: vi.fn() }),
  useRemoveTeamMember: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./team-member-checklist', () => ({ TeamMemberChecklist: () => null }));

const key = backendKey('org-a', 'team', 'org-list');
let storedName = 'Original team';
function TeamList() {
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => [{ name: storedName }],
    staleTime: Infinity,
  });
  return <output aria-label="Team list">{data?.[0]?.name}</output>;
}

beforeEach(() => {
  vi.clearAllMocks();
  storedName = 'Original team';
});

describe('TeamEditDialog', () => {
  it('refreshes the visible list after a name-only Better Auth update without reloading', async () => {
    vi.mocked(authClient.organization.updateTeam).mockImplementation(
      async () => {
        storedName = 'Renamed team';
        return { data: null, error: null };
      },
    );
    const client = new QueryClient();
    client.setQueryData(key, [{ name: storedName }]);
    const other = backendKey('org-b', 'team', 'org-list');
    client.setQueryData(other, [{ name: 'Other org' }]);
    const { user } = render(
      <QueryClientProvider client={client}>
        <TeamList />
        <TeamEditDialog
          team={{
            id: 'team-a',
            name: storedName,
            memberCount: 1,
            createdAt: 0,
          }}
          organizationId="org-a"
          open
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const name = screen.getByRole('textbox', { name: /Team name/ });
    await user.clear(name);
    await user.type(name, 'Renamed team');
    await user.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() =>
      expect(screen.getByLabelText('Team list')).toHaveTextContent(
        'Renamed team',
      ),
    );
    expect(authClient.organization.updateTeam).toHaveBeenCalledWith({
      teamId: 'team-a',
      data: { name: 'Renamed team', organizationId: 'org-a' },
    });
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    client.clear();
  });
});
