import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backendKey } from '@/app/lib/backend/query-keys';
import { authClient } from '@/lib/auth-client';
import { i18n } from '@/lib/i18n/i18n';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  lapsedSessionRefusal,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { act, cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { TeamEditDialog } from './team-edit-dialog';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-a',
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@tale/ui/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { organization: { updateTeam: vi.fn() } },
}));
const members = vi.hoisted(() => [{ _id: 'tm-a', userId: 'user-a' }]);
vi.mock('../hooks/queries', () => ({
  useTeamMembers: () => ({ teamMembers: members }),
}));
const addMember = vi.hoisted(() => vi.fn());
vi.mock('../hooks/mutations', () => ({
  useAddTeamMember: () => ({ mutateAsync: addMember }),
  useRemoveTeamMember: () => ({ mutateAsync: vi.fn() }),
}));
// Stands in for the member list: one press adds a second member.
vi.mock('./team-member-checklist', () => ({
  TeamMemberChecklist: ({
    onToggleMember,
    disabled,
  }: {
    onToggleMember: (userId: string) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggleMember('user-b')}
    >
      Add user-b
    </button>
  ),
}));

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
  it.each([true, false])(
    'saves the submitted draft and closes (attempt later edits: %s)',
    async (attemptLaterEdits) => {
      const pending =
        Promise.withResolvers<
          Awaited<ReturnType<typeof authClient.organization.updateTeam>>
        >();
      vi.mocked(authClient.organization.updateTeam).mockReturnValue(
        pending.promise,
      );
      const client = new QueryClient();
      const onOpenChange = vi.fn();
      const onSuccess = vi.fn();
      const { user } = render(
        <QueryClientProvider client={client}>
          <TeamEditDialog
            team={{
              id: 'team-a',
              name: storedName,
              memberCount: 1,
              createdAt: 0,
            }}
            organizationId="org-a"
            open
            onOpenChange={onOpenChange}
            onSuccess={onSuccess}
          />
        </QueryClientProvider>,
      );
      const name = screen.getByRole('textbox', { name: /Team name/ });
      await user.clear(name);
      await user.type(name, 'First draft');
      await user.click(screen.getByRole('button', { name: /Save/ }));
      await waitFor(() =>
        expect(authClient.organization.updateTeam).toHaveBeenCalledTimes(1),
      );
      expect(authClient.organization.updateTeam).toHaveBeenCalledWith({
        teamId: 'team-a',
        data: { name: 'First draft', organizationId: 'org-a' },
      });
      expect(onOpenChange).not.toHaveBeenCalled();
      if (attemptLaterEdits) {
        await user.type(name, 'Later unsaved draft');
        await user.click(screen.getByRole('button', { name: 'Add user-b' }));
        expect(name).toBeDisabled();
        expect(name).toHaveValue('First draft');
        expect(
          screen.getByRole('button', { name: 'Add user-b' }),
        ).toBeDisabled();
        expect(addMember).not.toHaveBeenCalled();
      }
      await act(async () => pending.resolve({ data: null, error: null }));
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(onOpenChange).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith({
        title: 'Team updated',
        variant: 'success',
      });
      expect(authClient.organization.updateTeam).toHaveBeenCalledTimes(1);
      expect(addMember).not.toHaveBeenCalled();
      client.clear();
    },
  );

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

  // E-01: a rename onto a name another team of the organization already
  // reads as is refused by the server (`TEAM_NAME_TAKEN`, 409); the dialog
  // says so under the field and stays open.
  it('shows the uniqueness refusal under the field when the new name is taken', async () => {
    vi.mocked(authClient.organization.updateTeam).mockResolvedValue({
      data: null,
      error: {
        code: 'TEAM_NAME_TAKEN',
        message: 'A team named "Finance" already exists',
        status: 409,
        statusText: 'Conflict',
      },
    });
    const client = new QueryClient();
    const onOpenChange = vi.fn();
    const { user } = render(
      <QueryClientProvider client={client}>
        <TeamEditDialog
          team={{
            id: 'team-a',
            name: storedName,
            memberCount: 1,
            createdAt: 0,
          }}
          organizationId="org-a"
          open
          onOpenChange={onOpenChange}
        />
      </QueryClientProvider>,
    );
    const name = screen.getByRole('textbox', { name: /Team name/ });
    await user.clear(name);
    await user.type(name, 'Finance');
    await user.click(screen.getByRole('button', { name: /Save/ }));

    expect(
      await screen.findByText('A team with this name already exists'),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(name).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add user-b' })).toBeEnabled();
    await user.clear(name);
    await user.type(name, 'Available team');
    expect(name).toHaveValue('Available team');
    client.clear();
  });

  // Better Auth's session middleware answers a rename whose session has
  // ended with 401 `UNAUTHORIZED` and the English "Unauthorized", which the
  // dialog toasted under the localized title; a change of members alone is
  // refused by the session door itself.
  describe.each(SHIPPED_LOCALES)('after a lapsed session (%s)', (locale) => {
    beforeEach(async () => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
    });
    // Unmount first: the app shell still applying the saved language would
    // otherwise switch it back after the reset.
    afterEach(async () => {
      cleanup();
      await forgetSavedLocale();
    });

    it.each(['a rename', 'a new member'] as const)(
      'says the session ended for %s',
      async (change) => {
        vi.mocked(authClient.organization.updateTeam).mockResolvedValue({
          data: null,
          error: {
            status: 401,
            statusText: 'UNAUTHORIZED',
            code: 'UNAUTHORIZED',
            message: 'Unauthorized',
          },
        });
        addMember.mockImplementation(lapsedSessionRefusal);
        const settings = i18n.getFixedT(locale, 'settings');
        const client = new QueryClient();
        const { user } = render(
          <QueryClientProvider client={client}>
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
        if (change === 'a rename') {
          const name = screen.getByRole('textbox');
          await user.clear(name);
          await user.type(name, 'Renamed team');
        } else {
          await user.click(screen.getByRole('button', { name: 'Add user-b' }));
        }
        await user.click(
          screen.getByRole('button', { name: settings('teams.saveChanges') }),
        );

        await waitFor(() =>
          expect(toast).toHaveBeenCalledWith({
            title: settings('teams.teamUpdateFailed'),
            description: SESSION_ENDED[locale],
            variant: 'destructive',
          }),
        );
        expect(addMember).toHaveBeenCalledTimes(change === 'a rename' ? 0 : 1);
        client.clear();
      },
    );
  });
});
