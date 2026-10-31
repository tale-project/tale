import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemberRight, MemberRights } from '@/lib/shared/competences';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { MemberRightsDialog } from './member-rights-dialog';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

const state = vi.hoisted(() => ({
  grant: vi.fn(),
  revoke: vi.fn(),
  toast: vi.fn(),
  refetch: vi.fn(),
  teams: vi.fn(() => ({ teams: [], unavailable: false, failureCount: 0 })),
  // The rights as `useMemberRights` answers them (`setRights`).
  rights: {} as Record<string, unknown>,
}));

vi.mock('@/app/features/settings/governance/hooks/mutations', () => ({
  useGrantCompetence: () => ({ mutateAsync: state.grant, isPending: false }),
  useRevokeCompetence: () => ({ mutateAsync: state.revoke, isPending: false }),
}));
vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useMemberRights: () => state.rights,
  useOrgMembersForPicker: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
  useMyModelApiAccess: () => ({
    data: { enabled: true, allowed: true, models: [] },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: state.teams,
}));
vi.mock('../hooks/queries', () => ({
  useMembers: () => ({
    members: [
      {
        userId: 'user-ada',
        email: 'ada@example.com',
        displayName: 'Ada Admin',
        role: 'admin',
      },
      {
        userId: 'user-bo',
        email: 'bo@example.com',
        displayName: 'Bo Editor',
        role: 'editor',
      },
    ],
  }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: state.toast }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-a',
}));

const GRANTED_AT = NOW - 10 * DAY;

/** An editor's rights: the model endpoints are off for the organization,
 * one grant has no end date (by someone who has left), one runs until a
 * date, one has run out, and the skill sharing policy admits editors. */
const RIGHTS: MemberRight[] = [
  {
    capability: 'tale:models.api',
    held: false,
    grantId: 'record-models',
    reasons: [
      { kind: 'organization', setting: 'model_api', state: 'off' },
      { kind: 'role', standing: 'grant' },
      {
        kind: 'grant',
        recordId: 'record-models',
        grantedBy: 'user-gone',
        grantedAt: GRANTED_AT,
        expiresAt: null,
        status: 'active',
      },
    ],
  },
  {
    capability: 'tale:notifications.export',
    held: true,
    grantId: 'record-export',
    reasons: [
      { kind: 'role', standing: 'grant' },
      {
        kind: 'grant',
        recordId: 'record-export',
        grantedBy: 'user-ada',
        grantedAt: GRANTED_AT,
        expiresAt: NOW + 30 * DAY,
        status: 'active',
      },
    ],
  },
  {
    capability: 'tale:rest.act-as',
    held: false,
    grantId: null,
    reasons: [
      { kind: 'role', standing: 'grant' },
      {
        kind: 'grant',
        recordId: 'record-act-as',
        grantedBy: 'user-ada',
        grantedAt: GRANTED_AT - 40 * DAY,
        expiresAt: NOW - DAY,
        status: 'expired',
      },
    ],
  },
  {
    capability: 'tale:skills.publish',
    held: true,
    grantId: null,
    reasons: [
      { kind: 'policy', policy: 'skill_sharing', mode: 'editors' },
      { kind: 'role', standing: 'admits' },
    ],
  },
];

function answer(rights: MemberRight[] = RIGHTS): MemberRights {
  return { userId: 'user-bo', role: 'editor', rights };
}

/** The same rights with one of them changed. */
function withRight(
  capability: MemberRight['capability'],
  right: Partial<MemberRight>,
): MemberRight[] {
  const rights = RIGHTS.slice();
  const index = rights.findIndex((entry) => entry.capability === capability);
  rights[index] = { ...rights[index]!, ...right };
  return rights;
}

/** How the rights read: answered, still pending, or failed with no
 * answer (`readStateOf`'s `unavailable`). */
type RightsRead = MemberRights | 'pending' | 'failed';

/** Set the rights' read, in the shape of the react-query result. */
function setRights(read: RightsRead) {
  state.rights = {
    data: typeof read === 'object' ? read : undefined,
    isLoading: read === 'pending',
    isError: read === 'failed',
    isFetching: read === 'pending',
    errorUpdateCount: read === 'failed' ? 1 : 0,
    refetch: state.refetch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setRights(answer());
  state.refetch.mockResolvedValue({ data: answer() });
});

function dialog() {
  return (
    <MemberRightsDialog
      open
      onOpenChange={vi.fn()}
      organizationId="org-a"
      member={{
        userId: 'user-bo',
        displayName: 'Bo Editor',
        email: 'bo@example.com',
      }}
    />
  );
}

function renderDialog() {
  return render(dialog());
}

/** The row of one right, found through its switch's name. */
function rowOf(label: string) {
  const row = screen.getByRole('switch', { name: label }).closest('li');
  if (row === null) throw new Error(`no row for ${label}`);
  return within(row);
}

describe('MemberRightsDialog [GOV-R21]', () => {
  it('shows each right as the server answers it, with the reasons', async () => {
    renderDialog();

    expect(
      await screen.findByRole('dialog', { name: 'Rights of Bo Editor' }),
    ).toBeInTheDocument();

    const models = rowOf('Call models over the API');
    expect(models.getByText('Not allowed')).toBeInTheDocument();
    expect(
      models.getByText(
        'Model endpoints for API keys are off for this organization, so no one can call the models over the API.',
      ),
    ).toBeInTheDocument();
    expect(
      models.getByText('Their role, Editor, needs a grant for this right.'),
    ).toBeInTheDocument();
    // A granter who left the organization is named as such.
    expect(
      models.getByText(/^Granted by Former member on .+, with no end date\.$/),
    ).toBeInTheDocument();
    // The switch is the grant, which stays on while the organization's
    // switch keeps the right shut.
    expect(models.getByRole('switch')).toBeChecked();

    const exportRow = rowOf('Export notifications');
    expect(exportRow.getByText('Allowed')).toBeInTheDocument();
    expect(
      exportRow.getByText(/^Granted by Ada Admin on .+, until .+\.$/),
    ).toBeInTheDocument();
    expect(exportRow.getByRole('switch')).toBeChecked();

    const actAs = rowOf('Act for another member');
    expect(actAs.getByText('Not allowed')).toBeInTheDocument();
    expect(
      actAs.getByText(/^The grant by Ada Admin ended on .+\.$/),
    ).toBeInTheDocument();
    expect(actAs.getByRole('switch')).not.toBeChecked();

    const skills = rowOf('Publish skills to the organization');
    expect(skills.getByText('Allowed')).toBeInTheDocument();
    expect(
      skills.getByText('Skill sharing is set to "Editors and above".'),
    ).toBeInTheDocument();
    expect(
      skills.getByText('Their role, Editor, carries this right.'),
    ).toBeInTheDocument();
    expect(skills.getByRole('switch')).not.toBeChecked();

    // A screen reader hears the verdict and its reasons with the switch.
    expect(
      screen.getByRole('switch', { name: 'Call models over the API' }),
    ).toHaveAccessibleDescription(
      /^Not allowed Model endpoints for API keys are off .+ Former member/,
    );
  });

  it('names the team whose grant carries a right, and leaves the switch to a grant of the member’s own', async () => {
    setRights(
      answer(
        withRight('tale:rest.act-as', {
          held: true,
          grantId: null,
          reasons: [
            { kind: 'role', standing: 'grant' },
            {
              kind: 'team',
              recordId: 'record-team-ops',
              teamId: 'team-ops',
              teamName: 'Ops',
              grantedBy: 'user-ada',
              grantedAt: GRANTED_AT,
              expiresAt: NOW + 30 * DAY,
              status: 'active',
            },
            {
              kind: 'team',
              recordId: 'record-team-gone',
              teamId: 'team-gone',
              teamName: null,
              grantedBy: 'user-ada',
              grantedAt: GRANTED_AT - 40 * DAY,
              expiresAt: NOW - DAY,
              status: 'expired',
            },
          ],
        }),
      ),
    );
    renderDialog();

    const actAs = rowOf('Act for another member');
    expect(await actAs.findByText('Allowed')).toBeInTheDocument();
    expect(
      actAs.getByText(
        /^Granted to the team "Ops" by Ada Admin on .+, until .+\.$/,
      ),
    ).toBeInTheDocument();
    expect(
      actAs.getByText(
        /^The grant to the team "Deleted team" by Ada Admin ended on .+\.$/,
      ),
    ).toBeInTheDocument();
    // The team's grant is the team's: the switch is the member's own.
    expect(actAs.getByRole('switch')).not.toBeChecked();
  });

  it('grants a right from its switch, with the member and the right fixed and an expiry', async () => {
    setRights(
      answer(
        withRight('tale:rest.act-as', {
          reasons: [{ kind: 'role', standing: 'grant' }, { kind: 'no-grant' }],
        }),
      ),
    );
    state.grant.mockResolvedValue({ recordId: 'record-new' });
    const { user } = renderDialog();

    const actAs = rowOf('Act for another member');
    expect(actAs.getByText('Not granted.')).toBeInTheDocument();
    await user.click(actAs.getByRole('switch'));

    const grantDialog = await screen.findByRole('dialog', {
      name: 'Grant a right or qualification',
    });
    expect(
      within(grantDialog).getByText(
        'Bo Editor holds "Act for another member" in this organization until it expires or an admin revokes it.',
      ),
    ).toBeInTheDocument();
    // The member and the right are given: no pickers to choose them, and
    // no team to grant to instead, so the team list is not read.
    expect(
      within(grantDialog).queryByRole('button', { name: 'Member' }),
    ).not.toBeInTheDocument();
    expect(
      within(grantDialog).queryByRole('button', {
        name: 'Right or qualification',
      }),
    ).not.toBeInTheDocument();
    expect(
      within(grantDialog).queryByRole('combobox', { name: 'Grant to' }),
    ).not.toBeInTheDocument();
    expect(state.teams).not.toHaveBeenCalledWith(true);

    await user.click(
      within(grantDialog).getByRole('combobox', { name: 'Expires' }),
    );
    await user.click(await screen.findByRole('option', { name: 'In 30 days' }));
    const before = Date.now();
    await user.click(
      within(grantDialog).getByRole('button', { name: 'Grant' }),
    );
    const after = Date.now();

    expect(state.grant).toHaveBeenCalledTimes(1);
    const args = state.grant.mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({
      organizationId: 'org-a',
      userId: 'user-bo',
      competence: 'tale:rest.act-as',
    });
    expect(args).not.toHaveProperty('teamId');
    expect(args.expiresAt).toBeGreaterThanOrEqual(before + 30 * DAY);
    expect(args.expiresAt).toBeLessThanOrEqual(after + 30 * DAY);
    expect(state.revoke).not.toHaveBeenCalled();
  });

  it('revokes a right from its switch once the admin confirms, and shows the rights read again', async () => {
    state.revoke.mockResolvedValue(undefined);
    state.refetch.mockResolvedValue({
      data: answer(withRight('tale:notifications.export', { grantId: null })),
    });
    const { user } = renderDialog();

    await user.click(rowOf('Export notifications').getByRole('switch'));
    expect(
      await screen.findByText(
        'Bo Editor loses "Export notifications" in this organization right away. The grant stays in the register as history.',
      ),
    ).toBeInTheDocument();
    expect(state.revoke).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(state.revoke).toHaveBeenCalledWith({
      organizationId: 'org-a',
      recordId: 'record-export',
    });
    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Grant revoked',
          variant: 'success',
        }),
      ),
    );
    expect(state.refetch).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText(/loses "Export notifications"/)).toBeNull(),
    );
  });

  it('keeps the question and says why when the register refuses the revocation', async () => {
    state.revoke.mockRejectedValue({ data: { code: 'COMPETENCE_FORBIDDEN' } });
    const { user } = renderDialog();

    await user.click(rowOf('Export notifications').getByRole('switch'));
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));

    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith({
        title: "Couldn't revoke the grant",
        description:
          'Only organization owners and admins can grant, change or revoke rights and qualifications.',
        variant: 'destructive',
      }),
    );
    // The grant is still there, so the question stays.
    expect(state.refetch).toHaveBeenCalled();
    expect(
      screen.getByText(/loses "Export notifications"/),
    ).toBeInTheDocument();
  });

  it('drops the question when the grant was revoked meanwhile', async () => {
    state.revoke.mockRejectedValue({
      data: { code: 'COMPETENCE_ALREADY_REVOKED' },
    });
    state.refetch.mockResolvedValue({
      data: answer(withRight('tale:notifications.export', { grantId: null })),
    });
    const { user } = renderDialog();

    await user.click(rowOf('Export notifications').getByRole('switch'));
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));

    await waitFor(() =>
      expect(screen.queryByText(/loses "Export notifications"/)).toBeNull(),
    );
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('offers no switch to act on while the rights load', async () => {
    setRights('pending');
    renderDialog();

    await screen.findByRole('dialog', { name: 'Rights of Bo Editor' });
    // The placeholder rows sit behind the skeleton, hidden from the
    // accessibility tree; their switches cannot be used either.
    const switches = screen.getAllByRole('switch', { hidden: true });
    expect(switches).toHaveLength(4);
    for (const right of switches) {
      expect(right).toBeDisabled();
    }
  });

  it('says the rights could not be read, and reads them again on retry', async () => {
    setRights('failed');
    const { user } = renderDialog();

    expect(
      await screen.findByText("Couldn't load the rights."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(state.refetch).toHaveBeenCalled();
  });

  it('hands the focus to the rights once a retry reads them', async () => {
    setRights('failed');
    const { user, rerender } = renderDialog();

    await user.click(
      await screen.findByRole('button', { name: /retry|try again/i }),
    );
    setRights(answer());
    rerender(dialog());

    await waitFor(() =>
      expect(
        screen.getByRole('list', { name: 'Rights of Bo Editor' }),
      ).toHaveFocus(),
    );
  });

  describe('accessibility', () => {
    it('passes axe audit with the rights shown', async () => {
      renderDialog();
      await screen.findByRole('dialog', { name: 'Rights of Bo Editor' });
      await checkAccessibility(document.body);
    });

    it('passes axe audit with the grant dialog open over it', async () => {
      const { user } = renderDialog();
      await user.click(rowOf('Act for another member').getByRole('switch'));
      await screen.findByRole('dialog', {
        name: 'Grant a right or qualification',
      });
      await checkAccessibility(document.body);
    });
  });
});
