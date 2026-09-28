import { createSelectColumn } from '@tale/ui/data-table/column-builders';
import { Toaster } from '@tale/ui/toaster';
import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authClient } from '@/lib/auth-client';
import { i18n } from '@/lib/i18n/i18n';
import {
  LAPSED_SESSION_ANSWER,
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { cleanup, render, screen, waitFor, within } from '@/tests/utils/render';

import type { Team } from '../hooks/queries';
import { TeamCreateDialog } from './team-create-dialog';
import { TeamDeleteDialog } from './team-delete-dialog';
import { TeamEditDialog } from './team-edit-dialog';
import { TeamsTable } from './teams-table';

// The team writes run for real — the team hooks, `useBackendMutation`, the
// adapter rows, `backendFetch` — against the session door's own 401, and the
// real toast renders, so the test counts every toast a refused save raises,
// the hooks' default toast included. The dialogs toast through `useToast()`,
// which hands out the module's own function; it hands out the spy here.
vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/ui/use-toast')>();
  const spy = vi.fn(actual.toast);
  return {
    ...actual,
    toast: spy,
    useToast: () => ({ ...actual.useToast(), toast: spy }),
  };
});
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
// Better Auth creates the team; only the app's own doors meet the lapse.
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    organization: { createTeam: vi.fn(), updateTeam: vi.fn() },
    getSession: vi.fn(),
  },
}));
// One array for every render: the edit dialog re-seeds its selection
// whenever the member list changes identity.
const members = vi.hoisted(() => [
  { _id: 'tm-a', userId: 'user-a' },
  { _id: 'tm-c', userId: 'user-c' },
]);
vi.mock('../hooks/queries', () => ({
  useTeamMembers: () => ({ teamMembers: members, isLoading: false }),
  useTeamDeletionImpact: () => ({ impact: undefined, isLoading: false }),
}));
// Stands in for the member list: one press toggles a member.
vi.mock('./team-member-checklist', () => ({
  TeamMemberChecklist: ({
    onToggleMember,
  }: {
    onToggleMember: (userId: string) => void;
  }) => (
    <>
      <button type="button" onClick={() => onToggleMember('user-b')}>
        Toggle user-b
      </button>
      <button type="button" onClick={() => onToggleMember('user-c')}>
        Toggle user-c
      </button>
    </>
  ),
}));
// The select column is what puts a checkbox in every row.
vi.mock('../hooks/use-teams-table-config', () => ({
  useTeamsTableConfig: () => ({
    columns: [
      createSelectColumn<Team>(),
      { accessorKey: 'name', header: 'Name' },
    ],
    searchPlaceholder: 'Search teams',
    stickyLayout: false,
    pageSize: 20,
  }),
}));

const TEAM: Team = {
  id: 'team-1',
  name: 'Engineering',
  memberCount: 2,
  createdAt: 0,
};

/** A label as the dialogs show it in the current language. */
const settings = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'settings', ...options });
const common = (key: string) => i18n.t(key, { ns: 'common' });

function renderWithToaster(ui: ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json(LAPSED_SESSION_ANSWER.body, {
      status: LAPSED_SESSION_ANSWER.status,
    }),
  );
  vi.mocked(authClient.organization.createTeam).mockResolvedValue({
    data: { id: 'team-new', name: 'Finance' },
    error: null,
  } as Awaited<ReturnType<typeof authClient.organization.createTeam>>);
  vi.mocked(authClient.getSession).mockResolvedValue({
    data: { user: { id: 'user-a' } },
    error: null,
  } as Awaited<ReturnType<typeof authClient.getSession>>);
});

// Unmount first: the app shell still applying the saved language would
// otherwise switch it back after the reset.
afterEach(async () => {
  cleanup();
  for (const shown of vi.mocked(toast).mock.results) {
    if (shown.type === 'return') shown.value.dismiss();
  }
  vi.mocked(toast).mockClear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

/** Every toast raised so far, as the person reads it. */
function toasts() {
  return vi.mocked(toast).mock.calls.map(([shown]) => ({
    title: shown.title,
    description: shown.description,
    variant: shown.variant,
  }));
}

// Each write hook raised its own default toast on top of the surface's, one
// per refused call: deleting a team toasted twice, a save refusing an added
// and a removed member three times.
describe('a lapsed session raises one toast per refused save', () => {
  describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
    beforeEach(async () => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
    });

    it('when deleting a team', async () => {
      const { user } = renderWithToaster(
        <TeamDeleteDialog
          open
          onOpenChange={vi.fn()}
          team={TEAM}
          organizationId="org-1"
        />,
      );

      await user.click(
        within(
          screen.getByRole('dialog', { name: settings('teams.deleteTeam') }),
        ).getByRole('button', { name: common('actions.delete') }),
      );

      expect(await screen.findByText(SESSION_ENDED[locale])).toBeVisible();
      expect(toasts()).toEqual([
        {
          title: settings('teams.teamDeleteFailed'),
          description: SESSION_ENDED[locale],
          variant: 'destructive',
        },
      ]);
    });

    it.each([
      { change: 'an added member', toggle: ['Toggle user-b'] },
      { change: 'a removed member', toggle: ['Toggle user-c'] },
      {
        change: 'an added and a removed member',
        toggle: ['Toggle user-b', 'Toggle user-c'],
      },
    ])('when saving $change', async ({ toggle }) => {
      const { user } = renderWithToaster(
        <TeamEditDialog
          team={TEAM}
          organizationId="org-1"
          open
          onOpenChange={vi.fn()}
        />,
      );

      for (const name of toggle) {
        await user.click(screen.getByRole('button', { name }));
      }
      await user.click(
        screen.getByRole('button', { name: settings('teams.saveChanges') }),
      );

      expect(await screen.findByText(SESSION_ENDED[locale])).toBeVisible();
      expect(toasts()).toEqual([
        {
          title: settings('teams.teamUpdateFailed'),
          description: SESSION_ENDED[locale],
          variant: 'destructive',
        },
      ]);
      expect(authClient.organization.updateTeam).not.toHaveBeenCalled();
    });

    // The team exists once Better Auth has answered, so the one toast says
    // what the save could not do rather than "couldn't create".
    it.each([
      { members: 'no member chosen (the creator joins)', toggle: [] },
      { members: 'a chosen member', toggle: ['Toggle user-b'] },
      {
        members: 'two chosen members',
        toggle: ['Toggle user-b', 'Toggle user-c'],
      },
    ])('when creating a team with $members', async ({ toggle }) => {
      const onOpenChange = vi.fn();
      const { user } = renderWithToaster(
        <TeamCreateDialog
          organizationId="org-1"
          open
          onOpenChange={onOpenChange}
        />,
      );

      await user.type(
        screen.getByRole('textbox', { name: settings('teams.teamName') }),
        'Finance',
      );
      for (const name of toggle) {
        await user.click(screen.getByRole('button', { name }));
      }
      await user.click(
        screen.getByRole('button', { name: settings('teams.createTeam') }),
      );

      expect(await screen.findByText(SESSION_ENDED[locale])).toBeVisible();
      expect(toasts()).toEqual([
        {
          title: settings('teams.teamCreated'),
          description: SESSION_ENDED[locale],
          variant: 'destructive',
        },
      ]);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('when deleting several teams at once', async () => {
      const { user } = renderWithToaster(
        <TeamsTable
          teams={[TEAM, { ...TEAM, id: 'team-2', name: 'Design' }]}
          organizationId="org-1"
        />,
      );

      for (const row of screen.getAllByRole('checkbox', {
        name: common('aria.selectRow'),
      })) {
        await user.click(row);
      }
      await user.click(
        screen.getByRole('button', { name: common('actions.deleteSelected') }),
      );
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: common('actions.delete'),
        }),
      );

      await waitFor(() =>
        expect(toasts()).toEqual([
          {
            title: common('bulkActions.deleteFailed'),
            description: undefined,
            variant: 'destructive',
          },
        ]),
      );
    });
  });
});

// A refusal that is not a lapse keeps the save's own words, still once.
describe('a refused membership change without a lapse', () => {
  it('counts the refused changes in the one toast', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () =>
      Response.json(
        { error: 'Not a member of this organization', code: 'NOT_A_MEMBER' },
        { status: 409 },
      ),
    );
    const { user } = renderWithToaster(
      <TeamEditDialog
        team={TEAM}
        organizationId="org-1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Toggle user-b' }));
    await user.click(screen.getByRole('button', { name: 'Toggle user-c' }));
    await user.click(
      screen.getByRole('button', { name: settings('teams.saveChanges') }),
    );

    const refused = settings('teams.membershipChangesFailed', { count: 2 });
    expect(await screen.findByText(refused)).toBeVisible();
    expect(toasts()).toEqual([
      {
        title: settings('teams.teamUpdateFailed'),
        description: refused,
        variant: 'destructive',
      },
    ]);
  });
});
