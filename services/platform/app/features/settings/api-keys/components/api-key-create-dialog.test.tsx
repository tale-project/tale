import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ApiKeyCreateDialog } from './api-key-create-dialog';

const mockCreateKey = vi
  .fn()
  .mockResolvedValue({ key: 'tale_generated-api-key' });

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/use-api-keys', () => ({
  useCreateApiKey: () => ({ mutateAsync: mockCreateKey, isPending: false }),
}));

// The pickers an Owner or Admin chooses whose key it is from, each list read
// as its hook reports it; every test starts with the three lists answered.
const MEMBERS = [
  {
    userId: 'ada',
    displayName: 'Ada',
    email: 'ada@example.test',
    role: 'admin',
  },
  {
    userId: 'ines',
    displayName: 'Ines',
    email: 'ines@example.test',
    role: 'admin',
  },
  {
    userId: 'olav',
    displayName: 'Olav',
    email: 'olav@example.test',
    role: 'owner',
  },
  {
    userId: 'mia',
    displayName: 'Mia Keller',
    email: 'mia@example.test',
    role: 'member',
  },
];
const TEAMS = [{ id: 'finance', name: 'Finance' }];
const PROJECTS = [
  { _id: 'launch', name: 'Launch' },
  { _id: 'old', name: 'Old site', archivedAt: 1 },
];

const reads = vi.hoisted(() => ({
  members: {} as Record<string, unknown>,
  teams: {} as Record<string, unknown>,
  projects: {} as Record<string, unknown>,
}));
vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useOrgMembersForPicker: () => reads.members,
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => reads.teams,
}));
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => reads.projects,
}));

/** A list read: answered with its rows, still pending, or failed with no
 * answer — `readStateOf`'s `unavailable`, which holds through a retry. */
type ListRead = { rows: readonly object[] } | 'pending' | 'failed';
type TargetList = 'members' | 'teams' | 'projects';

const retries = {
  members: vi.fn(),
  teams: vi.fn(),
  projects: vi.fn(),
} satisfies Record<TargetList, () => void>;

/** Set how `list` reads, in the shape its hook answers. */
function setRead(list: TargetList, read: ListRead) {
  const rows = typeof read === 'object' ? read.rows : undefined;
  const failure = {
    unavailable: read === 'failed',
    stale: false,
    retrying: false,
    failureCount: read === 'failed' ? 1 : 0,
  };
  if (list === 'members') {
    // The whole react-query result.
    reads.members = {
      data: rows,
      isLoading: read === 'pending',
      isError: read === 'failed',
      isFetching: read === 'pending',
      errorUpdateCount: failure.failureCount,
      refetch: retries.members,
    };
  } else if (list === 'teams') {
    reads.teams = {
      teams: rows,
      isLoading: read === 'pending',
      ...failure,
      retry: retries.teams,
    };
  } else {
    reads.projects = {
      projects: rows ?? [],
      hasAnswer: rows !== undefined,
      isLoading: read === 'pending',
      error: read === 'failed',
      isRetrying: false,
      ...failure,
      retry: retries.projects,
    };
  }
}

describe('ApiKeyCreateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRead('members', { rows: MEMBERS });
    setRead('teams', { rows: TEAMS });
    setRead('projects', { rows: PROJECTS });
  });

  // The key name is capped at Better Auth's apiKey `maximumNameLength` default
  // (32). Before #1991 the client only gated on non-empty, so a long name passed
  // the client and Better Auth returned a generic 400 that surfaced as an
  // undismissable error toast. The cap is now enforced inline via the shared
  // `common.validation.maxLength` message, and FormDialog disables submit while
  // `!isValid`.
  describe('name length validation', () => {
    it('rejects a name over the 32-char cap and accepts one at the cap', async () => {
      const { user } = render(
        <ApiKeyCreateDialog
          open
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );
      const nameField = screen.getByRole('textbox', { name: /Key name/ });
      const submit = screen.getByRole('button', { name: 'Create key' });

      // 33 chars → over the cap. The inline message surfaces only after the
      // first blur (onTouched, #1943); submit is disabled while over the cap.
      await user.type(nameField, 'a'.repeat(33));
      await user.tab();
      expect(
        await screen.findByText('Key name must be 32 characters or fewer'),
      ).toBeInTheDocument();
      expect(submit).toBeDisabled();

      // Exactly 32 → valid → message clears, submit ENABLED.
      await user.clear(nameField);
      await user.type(nameField, 'a'.repeat(32));
      await waitFor(() => {
        expect(
          screen.queryByText('Key name must be 32 characters or fewer'),
        ).not.toBeInTheDocument();
        expect(submit).toBeEnabled();
      });
      expect(mockCreateKey).not.toHaveBeenCalled();
    });

    it('submits a valid name to createKey', async () => {
      const { user } = render(
        <ApiKeyCreateDialog
          open
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );
      await user.type(
        screen.getByRole('textbox', { name: /Key name/ }),
        'CI Token',
      );
      const submit = screen.getByRole('button', { name: 'Create key' });
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);

      await waitFor(() => {
        expect(mockCreateKey).toHaveBeenCalledTimes(1);
      });
      expect(mockCreateKey).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'CI Token' }),
      );
    });
  });

  // The page lives under one organization, but a key belongs to the person
  // and works in every organization they are a member of — the dialog says
  // so before the name is typed (2026-09-26 evaluation, E-09).
  it('says the key belongs to the person and spans their organizations', () => {
    render(
      <ApiKeyCreateDialog open onOpenChange={vi.fn()} organizationId="org-1" />,
    );
    expect(
      screen.getByText(/belongs to you, not to this organization/),
    ).toBeInTheDocument();
    expect(screen.getByText(/X-Organization-Slug/)).toBeInTheDocument();
  });

  // The lifetime is read as a date: every choice says the day the key
  // stops working, and "Custom date" picks that day in a calendar.
  describe('expiry', () => {
    // Wednesday 2026-10-07, 09:00 local.
    const NOW = new Date(2026, 9, 7, 9, 0).getTime();

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function renderDialog() {
      const view = render(
        <ApiKeyCreateDialog
          open
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );
      return view;
    }

    it('starts at 30 days and says the day the key stops working', async () => {
      const { user } = renderDialog();
      const expiry = screen.getByRole('combobox', { name: 'Expiration' });
      expect(expiry).toHaveTextContent('30 days');
      expect(expiry).toHaveAccessibleDescription(
        'The key expires on November 6, 2026.',
      );

      await user.type(
        screen.getByRole('textbox', { name: /Key name/ }),
        'CI Token',
      );
      const submit = screen.getByRole('button', { name: 'Create key' });
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);
      await waitFor(() =>
        expect(mockCreateKey).toHaveBeenCalledWith({
          name: 'CI Token',
          expiresIn: 2_592_000,
          owner: { kind: 'self' },
        }),
      );
    });

    it('creates a key without an expiry when Never is chosen [APIKEY-R10]', async () => {
      const { user } = renderDialog();
      await user.click(screen.getByRole('combobox', { name: 'Expiration' }));
      await user.click(screen.getByRole('option', { name: 'Never' }));
      expect(
        screen.getByRole('combobox', { name: 'Expiration' }),
      ).toHaveAccessibleDescription('The key works until it is revoked.');

      await user.type(
        screen.getByRole('textbox', { name: /Key name/ }),
        'CI Token',
      );
      const submit = screen.getByRole('button', { name: 'Create key' });
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);
      await waitFor(() =>
        expect(mockCreateKey).toHaveBeenCalledWith({
          name: 'CI Token',
          expiresIn: undefined,
          owner: { kind: 'self' },
        }),
      );
    });

    it('expires on the day picked under Custom date', async () => {
      const { user } = renderDialog();
      await user.click(screen.getByRole('combobox', { name: 'Expiration' }));
      await user.click(screen.getByRole('option', { name: 'Custom date' }));

      // The calendar opens on a day a month out, named with its label.
      const date = screen.getByRole('button', {
        name: 'Expiration date Nov 6, 2026',
      });
      await user.click(date);
      await user.click(
        screen.getByRole('gridcell', { name: /November 20th, 2026$/ }),
      );
      expect(
        screen.getByRole('button', { name: 'Expiration date Nov 20, 2026' }),
      ).toHaveAccessibleDescription('The key expires on November 20, 2026.');

      await user.type(
        screen.getByRole('textbox', { name: /Key name/ }),
        'CI Token',
      );
      const submit = screen.getByRole('button', { name: 'Create key' });
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);
      // Use elapsed seconds to the selected local date, including offset changes.
      await waitFor(() =>
        expect(mockCreateKey).toHaveBeenCalledWith({
          name: 'CI Token',
          expiresIn: (new Date(2026, 10, 20, 9).getTime() - NOW) / 1000,
          owner: { kind: 'self' },
        }),
      );
    });

    it('recalculates a valid custom date when the form stays open overnight [APIKEY-R10]', async () => {
      const { user } = renderDialog();
      await user.type(
        screen.getByRole('textbox', { name: /Key name/ }),
        'CI Token',
      );
      await user.click(screen.getByRole('combobox', { name: 'Expiration' }));
      await user.click(screen.getByRole('option', { name: 'Custom date' }));
      const submit = screen.getByRole('button', { name: 'Create key' });
      await waitFor(() => expect(submit).toBeEnabled());
      const submittedAt = new Date(2026, 9, 8, 9).getTime();
      vi.setSystemTime(submittedAt);
      await user.click(submit);
      await waitFor(() =>
        expect(mockCreateKey).toHaveBeenCalledWith({
          name: 'CI Token',
          expiresIn: (new Date(2026, 10, 6, 9).getTime() - submittedAt) / 1000,
          owner: { kind: 'self' },
        }),
      );
    });

    it('refuses a custom date that became unavailable while the form stayed open [APIKEY-R10]', async () => {
      const { user } = renderDialog();
      await user.type(
        screen.getByRole('textbox', { name: /Key name/ }),
        'CI Token',
      );
      await user.click(screen.getByRole('combobox', { name: 'Expiration' }));
      await user.click(screen.getByRole('option', { name: 'Custom date' }));
      await user.click(
        screen.getByRole('button', { name: 'Expiration date Nov 6, 2026' }),
      );
      await user.click(screen.getByRole('button', { name: 'Previous month' }));
      await user.click(
        screen.getByRole('gridcell', { name: /October 8th, 2026$/ }),
      );
      const submit = screen.getByRole('button', { name: 'Create key' });
      await waitFor(() => expect(submit).toBeEnabled());
      vi.setSystemTime(new Date(2026, 9, 8, 9));
      await user.click(submit);
      expect(
        await screen.findByText('Pick a date within the available range.'),
      ).toBeInTheDocument();
      expect(mockCreateKey).not.toHaveBeenCalled();
      await user.click(
        screen.getByRole('button', { name: 'Expiration date Oct 8, 2026' }),
      );
      expect(
        screen.getByRole('gridcell', { name: /October 8th, 2026$/ }),
      ).toHaveAttribute('aria-disabled', 'true');
      expect(
        screen.getByRole('gridcell', { name: /October 9th, 2026$/ }),
      ).toHaveAttribute('aria-disabled', 'false');
    });

    it('offers no day before tomorrow or past a year from today [APIKEY-R10]', async () => {
      const { user } = renderDialog();
      await user.click(screen.getByRole('combobox', { name: 'Expiration' }));
      await user.click(screen.getByRole('option', { name: 'Custom date' }));
      await user.click(
        screen.getByRole('button', { name: 'Expiration date Nov 6, 2026' }),
      );
      await user.click(screen.getByRole('button', { name: 'Previous month' }));
      expect(
        screen.getByRole('gridcell', { name: /October 7th, 2026$/ }),
      ).toHaveAttribute('aria-disabled', 'true');
      expect(
        screen.getByRole('gridcell', { name: /October 8th, 2026$/ }),
      ).toHaveAttribute('aria-disabled', 'false');
    });

    it('asks for a day when Custom date has none', async () => {
      const { user } = renderDialog();
      await user.type(
        screen.getByRole('textbox', { name: /Key name/ }),
        'CI Token',
      );
      await user.click(screen.getByRole('combobox', { name: 'Expiration' }));
      await user.click(screen.getByRole('option', { name: 'Custom date' }));
      await user.click(screen.getByRole('button', { name: 'Clear date' }));

      expect(
        await screen.findByText('Pick an expiration date.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create key' })).toBeDisabled();
      expect(mockCreateKey).not.toHaveBeenCalled();
    });
  });

  describe('whose key it is', () => {
    function renderForAdmin() {
      return render(
        <ApiKeyCreateDialog
          open
          onOpenChange={vi.fn()}
          organizationId="org-1"
          canCreateForOthers
          viewerUserId="ada"
          viewerRole="admin"
        />,
      );
    }

    async function submitNamed(
      user: ReturnType<typeof render>['user'],
      name: string,
    ) {
      await user.type(screen.getByRole('textbox', { name: /Key name/ }), name);
      const submit = screen.getByRole('button', { name: 'Create key' });
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);
    }

    it('is a choice for an Owner or Admin alone [APIKEY-R1]', () => {
      const { unmount } = render(
        <ApiKeyCreateDialog
          open
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );
      expect(
        screen.queryByRole('combobox', { name: 'Belongs to' }),
      ).not.toBeInTheDocument();
      unmount();

      renderForAdmin();
      expect(
        screen.getByRole('combobox', { name: 'Belongs to' }),
      ).toHaveTextContent('You');
    });

    it('makes the organization’s key with the role picked [APIKEY-R4]', async () => {
      const { user } = renderForAdmin();
      await user.click(screen.getByRole('combobox', { name: 'Belongs to' }));
      await user.click(
        screen.getByRole('option', { name: 'The organization' }),
      );
      await user.click(screen.getByRole('combobox', { name: 'Acts as' }));
      expect(
        screen.getAllByRole('option').map((option) => option.textContent),
      ).toEqual(['Member', 'Editor', 'Developer', 'Admin']);
      await user.click(screen.getByRole('option', { name: 'Developer' }));

      await submitNamed(user, 'Ops sync');
      await waitFor(() =>
        expect(mockCreateKey).toHaveBeenCalledWith({
          name: 'Ops sync',
          expiresIn: 30 * 86_400,
          owner: { kind: 'organization', role: 'developer' },
        }),
      );
      expect(screen.getByText('New API key')).toBeInTheDocument();
    });

    it('offers a team’s key no admin role, and falls back to Member [APIKEY-R4]', async () => {
      const { user } = renderForAdmin();
      await user.click(screen.getByRole('combobox', { name: 'Belongs to' }));
      await user.click(
        screen.getByRole('option', { name: 'The organization' }),
      );
      await user.click(screen.getByRole('combobox', { name: 'Acts as' }));
      await user.click(screen.getByRole('option', { name: 'Admin' }));

      await user.click(screen.getByRole('combobox', { name: 'Belongs to' }));
      await user.click(screen.getByRole('option', { name: 'A team' }));
      const role = screen.getByRole('combobox', { name: 'Acts as' });
      expect(role).toHaveTextContent('Member');
      await user.click(role);
      expect(
        screen.getAllByRole('option').map((option) => option.textContent),
      ).toEqual(['Member', 'Editor', 'Developer']);
    });

    it('offers only members below the maker, and asks for one before it submits [APIKEY-R3]', async () => {
      const { user } = renderForAdmin();
      await user.click(screen.getByRole('combobox', { name: 'Belongs to' }));
      await user.click(screen.getByRole('option', { name: 'Another member' }));
      await user.type(
        screen.getByRole('textbox', { name: /Key name/ }),
        'Sync',
      );
      expect(screen.getByRole('button', { name: 'Create key' })).toBeDisabled();

      await user.click(screen.getByRole('button', { name: /^Member/ }));
      // Not Ada herself, nor the admin and the owner at or above her.
      expect(
        screen.getAllByRole('option').map((option) => option.textContent),
      ).toEqual([expect.stringContaining('Mia Keller')]);
    });

    it('makes a key for a member and says to hand it to them [APIKEY-R2]', async () => {
      const { user } = renderForAdmin();
      await user.click(screen.getByRole('combobox', { name: 'Belongs to' }));
      await user.click(screen.getByRole('option', { name: 'Another member' }));
      await user.click(screen.getByRole('button', { name: /^Member/ }));
      await user.click(screen.getByRole('option', { name: /Mia Keller/ }));

      await submitNamed(user, 'Billing sync');
      await waitFor(() =>
        expect(mockCreateKey).toHaveBeenCalledWith({
          name: 'Billing sync',
          expiresIn: 30 * 86_400,
          owner: { kind: 'member', userId: 'mia' },
        }),
      );
      expect(
        await screen.findByText(/Hand the key to Mia Keller/),
      ).toBeInTheDocument();
    });

    it('offers no archived project', async () => {
      const { user } = renderForAdmin();
      await user.click(screen.getByRole('combobox', { name: 'Belongs to' }));
      await user.click(screen.getByRole('option', { name: 'A project' }));
      await user.click(screen.getByRole('button', { name: /^Project/ }));
      expect(
        screen.getAllByRole('option').map((option) => option.textContent),
      ).toEqual(['Launch']);
    });

    // A list that has not answered offers nobody, and that never reads as
    // nobody qualifying: a pending read masks the picker, a failed one says
    // the list couldn't load and offers Try again (#4586).
    describe('before its list answers', () => {
      const TARGETS = [
        {
          list: 'members',
          owner: 'Another member',
          picker: 'api-key-member',
          failed: "Couldn't load the members.",
          empty: 'No member whose role is below yours',
          // Only Ada, her fellow Admin and the Owner: nobody below her.
          nobody: MEMBERS.filter((member) => member.role !== 'member'),
        },
        {
          list: 'teams',
          owner: 'A team',
          picker: 'api-key-team',
          failed: "Couldn't load the teams.",
          empty: 'No teams',
          nobody: [],
        },
        {
          list: 'projects',
          owner: 'A project',
          picker: 'api-key-project',
          failed: "Couldn't load the projects.",
          empty: 'No active projects',
          // An archived project takes no new keys.
          nobody: PROJECTS.filter((project) => project.archivedAt),
        },
      ] satisfies Array<{
        list: TargetList;
        owner: string;
        picker: string;
        failed: string;
        empty: string;
        nobody: readonly object[];
      }>;

      async function chooseOwner(
        user: ReturnType<typeof render>['user'],
        owner: string,
      ) {
        await user.click(screen.getByRole('combobox', { name: 'Belongs to' }));
        await user.click(screen.getByRole('option', { name: owner }));
      }

      function pickerTrigger(id: string): HTMLElement {
        const trigger = document.getElementById(id);
        if (trigger === null) throw new Error(`No picker #${id}`);
        return trigger;
      }

      /** The alert that says `message` (the name field's own error is an
       * alert too). */
      function alertSaying(message: string): HTMLElement {
        const alert = screen
          .getByText(message)
          .closest<HTMLElement>('[role="alert"]');
        if (alert === null) throw new Error(`"${message}" is in no alert`);
        return alert;
      }

      function expectNoFailure(failed: string) {
        expect(screen.queryByText(failed)).not.toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: 'Try again' }),
        ).not.toBeInTheDocument();
      }

      it.each(TARGETS)(
        'names a failed $list read with Try again, not as nobody to choose',
        async ({ list, owner, picker, failed, empty }) => {
          setRead(list, 'failed');
          const { user, container } = renderForAdmin();
          await chooseOwner(user, owner);

          await user.click(pickerTrigger(picker));
          expect(screen.queryByText(empty)).not.toBeInTheDocument();
          expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
          expect(pickerTrigger(picker)).toBeDisabled();
          expect(
            screen.getByRole('button', { name: 'Create key' }),
          ).toBeDisabled();
          const alert = alertSaying(failed);

          await user.click(
            within(alert).getByRole('button', { name: 'Try again' }),
          );
          expect(retries[list]).toHaveBeenCalledTimes(1);
          await checkAccessibility(container);
        },
      );

      it.each(TARGETS)(
        'masks the picker while the $list read is pending, never saying nobody qualifies',
        async ({ list, owner, picker, failed, empty }) => {
          setRead(list, 'pending');
          const { user } = renderForAdmin();
          await chooseOwner(user, owner);

          await user.click(pickerTrigger(picker));
          expect(screen.queryByText(empty)).not.toBeInTheDocument();
          expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
          expect(pickerTrigger(picker)).toBeDisabled();
          expect(pickerTrigger(picker)).toHaveAttribute('aria-hidden', 'true');
          expectNoFailure(failed);
        },
      );

      it.each(TARGETS)(
        'says nobody qualifies once the $list read answered without a candidate',
        async ({ list, owner, picker, failed, empty, nobody }) => {
          setRead(list, { rows: nobody });
          const { user } = renderForAdmin();
          await chooseOwner(user, owner);

          expectNoFailure(failed);
          await user.click(pickerTrigger(picker));
          expect(await screen.findByText(empty)).toBeInTheDocument();
        },
      );
    });
  });

  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <ApiKeyCreateDialog
          open={true}
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when closed', async () => {
      const { container } = render(
        <ApiKeyCreateDialog
          open={false}
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
