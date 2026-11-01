import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/use-list-page';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompetenceRecordWire } from '@/app/lib/backend/contract/governance';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { CompetencesPage } from './competences-page';

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const REFRESH_FAILED =
  "Couldn't load the latest grants. What's listed may be incomplete or out of date.";

function record(
  overrides: Partial<CompetenceRecordWire> & { id: string },
): CompetenceRecordWire {
  return {
    userId: 'user-worker',
    competence: 'tale:rest.act-as',
    grantedBy: 'user-admin',
    grantedAt: NOW - DAY,
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    evidence: null,
    ...overrides,
  };
}

const state = vi.hoisted(() => ({
  /** `undefined` until the register has answered. */
  records: [] as CompetenceRecordWire[] | undefined,
  /** The read's settled failure, once its retry policy gave up. */
  error: null as Error | null,
  canWrite: true,
  revoke: vi.fn(),
  update: vi.fn(),
  refetch: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  useCompetences: () => ({
    data: state.records,
    isLoading: false,
    error: state.error,
    isError: state.error !== null,
    errorUpdateCount: state.error === null ? 0 : 1,
    isFetching: false,
    refetch: state.refetch,
  }),
  useOrgMembersForPicker: () => ({ data: [], isLoading: false }),
  useMyModelApiAccess: () => ({ data: undefined, isLoading: true }),
}));
vi.mock('../hooks/mutations', () => ({
  useRevokeCompetence: () => ({ mutateAsync: state.revoke, isPending: false }),
  useGrantCompetence: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCompetence: () => ({ mutateAsync: state.update, isPending: false }),
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: [
      {
        userId: 'user-worker',
        displayName: 'Integration Worker',
        email: 'worker@example.com',
      },
      { userId: 'user-admin', displayName: 'Office Admin', email: undefined },
    ],
    isLoading: false,
  }),
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({ teams: [], unavailable: false, failureCount: 0 }),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ cannot: () => !state.canWrite }),
}));
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: state.toast }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-a',
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.records = [];
  state.error = null;
  state.canWrite = true;
  state.refetch.mockResolvedValue({});
});

describe('CompetencesPage', () => {
  it('changes an active grant in place from its row [GOV-R18]', async () => {
    state.records = [
      record({ id: 'live', competence: 'tax-reviewer', evidence: 'Course' }),
    ];
    state.update.mockResolvedValue({ changed: true });
    const { user } = render(<CompetencesPage organizationId="org-a" />);

    await user.click(
      screen.getByRole('button', {
        name: 'Change tax-reviewer for Integration Worker',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    const evidence = within(dialog).getByRole('textbox', { name: 'Evidence' });
    expect(evidence).toHaveValue('Course');
    await user.type(evidence, ' 2026');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(state.update).toHaveBeenCalledWith({
      organizationId: 'org-a',
      recordId: 'live',
      evidence: 'Course 2026',
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('changes a team’s grant from its row, naming the team [GOV-R18]', async () => {
    state.records = [
      record({
        id: 'team-grant',
        userId: null,
        teamId: 'team-billing',
        teamName: 'Billing',
        competence: 'tale:models.api',
      }),
    ];
    state.update.mockResolvedValue({ changed: true });
    const { user } = render(<CompetencesPage organizationId="org-a" />);

    await user.click(
      screen.getByRole('button', {
        name: 'Change Call models over the API for Billing',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        /"Call models over the API" for the members of Billing/,
      ),
    ).toBeInTheDocument();
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Evidence' }),
      'Runs the gateway',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(state.update).toHaveBeenCalledWith({
      organizationId: 'org-a',
      recordId: 'team-grant',
      evidence: 'Runs the gateway',
    });
  });

  it('opens on active grants, naming right, holder and grantor', () => {
    state.records = [
      record({ id: 'live', evidence: 'Relays office answers' }),
      record({
        id: 'qualified',
        userId: 'user-gone',
        competence: 'tax-reviewer',
        expiresAt: NOW + 30 * DAY,
      }),
      record({ id: 'ended', revokedAt: NOW - 1000, revokedBy: 'user-admin' }),
    ];
    render(<CompetencesPage organizationId="org-a" />);

    expect(
      screen.getByRole('columnheader', { name: 'Right or qualification' }),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const live = within(rows[0]!);
    expect(live.getByText('Integration Worker')).toBeInTheDocument();
    expect(live.getByText('Act for another member')).toBeInTheDocument();
    expect(live.getByText('tale:rest.act-as')).toBeInTheDocument();
    expect(live.getByText('No expiry')).toBeInTheDocument();
    expect(live.getByText('by Office Admin')).toBeInTheDocument();
    const qualified = within(rows[1]!);
    expect(qualified.getByText('Former member')).toBeInTheDocument();
    expect(qualified.getByText('tax-reviewer')).toBeInTheDocument();
    expect(qualified.getByText(/^Until /)).toBeInTheDocument();
    expect(screen.queryByText('Revoked')).not.toBeInTheDocument();
  });

  it('shows the empty state for an empty register, not "no results"', () => {
    render(<CompetencesPage organizationId="org-a" />);
    expect(
      screen.getByText('No rights or qualifications granted yet'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No results found')).not.toBeInTheDocument();
  });

  it('revokes, waits for the refreshed list, then closes', async () => {
    state.records = [record({ id: 'live' })];
    state.revoke.mockResolvedValue(null);
    const { user } = render(<CompetencesPage organizationId="org-a" />);

    await user.click(
      screen.getByRole('button', {
        name: 'Revoke Act for another member from Integration Worker',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        /Integration Worker loses "Act for another member"/,
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    expect(state.revoke).toHaveBeenCalledWith({
      organizationId: 'org-a',
      recordId: 'live',
    });
    expect(state.refetch).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Grant revoked' }),
    );
  });

  // #3791: the revoked row leaves the Active list before the dialog closes,
  // so focus goes to the list's section — a region named by its heading,
  // since ARIA lets no plain div carry a name.
  it('returns focus to the named section once the revoked row leaves', async () => {
    state.records = [record({ id: 'live' })];
    state.revoke.mockResolvedValue(null);
    state.refetch.mockImplementationOnce(async () => {
      state.records = [
        record({ id: 'live', revokedAt: NOW, revokedBy: 'user-admin' }),
      ];
    });
    const { user } = render(<CompetencesPage organizationId="org-a" />);

    screen
      .getByRole('button', {
        name: 'Revoke Act for another member from Integration Worker',
      })
      .focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    within(dialog).getByRole('button', { name: 'Revoke' }).focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(
        screen.getByRole('region', { name: 'Rights and qualifications' }),
      ).toHaveFocus();
    });
  });

  it('keeps the dialog while the refused grant is still live', async () => {
    state.records = [record({ id: 'live' })];
    state.revoke.mockRejectedValue({ data: { code: 'COMPETENCE_FORBIDDEN' } });
    state.refetch.mockResolvedValue({ data: [record({ id: 'live' })] });
    const { user } = render(<CompetencesPage organizationId="org-a" />);

    await user.click(screen.getByRole('button', { name: /^Revoke Act for/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't revoke the grant",
        description:
          'Only organization owners and admins can grant, change or revoke rights and qualifications.',
        variant: 'destructive',
      }),
    );
    expect(state.refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('refreshes and closes when another admin revoked the grant first', async () => {
    state.records = [record({ id: 'live' })];
    state.revoke.mockRejectedValue({
      data: { code: 'COMPETENCE_ALREADY_REVOKED' },
    });
    state.refetch.mockResolvedValue({
      data: [
        record({ id: 'live', revokedAt: NOW - 1000, revokedBy: 'user-admin' }),
      ],
    });
    const { user } = render(<CompetencesPage organizationId="org-a" />);

    await user.click(screen.getByRole('button', { name: /^Revoke Act for/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'This grant has already been revoked.',
        variant: 'destructive',
      }),
    );
    expect(state.refetch).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  // A team grant names the team, marked Team: its members hold it while they
  // are in the team (GOV-R19).
  it('lists a team grant under the team, and revokes it for its members', async () => {
    state.records = [
      record({
        id: 'team-grant',
        userId: null,
        teamId: 'team-billing',
        teamName: 'Billing',
        competence: 'tale:models.api',
      }),
    ];
    state.revoke.mockResolvedValue(null);
    const { user } = render(<CompetencesPage organizationId="org-a" />);

    const row = within(screen.getAllByRole('row')[1]!);
    expect(row.getByText('Billing')).toBeInTheDocument();
    expect(row.getByText('Team')).toBeInTheDocument();
    expect(row.getByText('Call models over the API')).toBeInTheDocument();
    await checkAccessibility(document.body);

    await user.click(
      screen.getByRole('button', {
        name: 'Revoke Call models over the API from Billing',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        /The members of Billing lose "Call models over the API" in this organization right away, unless they hold it themselves/,
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(state.revoke).toHaveBeenCalledWith({
      organizationId: 'org-a',
      recordId: 'team-grant',
    });
  });

  it("names a deleted team's revoked grant Deleted team", async () => {
    state.records = [
      record({
        id: 'retired',
        userId: null,
        teamId: 'team-gone',
        teamName: null,
        competence: 'tale:models.api',
        revokedAt: NOW - 1000,
        revokedBy: 'user-admin',
      }),
      record({ id: 'live' }),
    ];
    const { user } = render(<CompetencesPage organizationId="org-a" />);

    await user.click(screen.getByRole('button', { name: 'Filter' }));
    const panel = await screen.findByRole('dialog', { name: 'Filters' });
    await user.click(within(panel).getByRole('button', { name: /^Status/ }));
    await user.click(within(panel).getByRole('checkbox', { name: 'Revoked' }));

    const retired = screen
      .getAllByRole('row')
      .find((row) => within(row).queryByText('Deleted team') !== null);
    if (retired === undefined) throw new Error('No row names a deleted team');
    expect(within(retired).getByText('Team')).toBeInTheDocument();
    expect(within(retired).getByText('Revoked')).toBeInTheDocument();
  });

  it('says why the register revoked a grant on its own', async () => {
    state.records = [
      // Expired, then replaced: the new grant came in the same instant.
      record({
        id: 'expired',
        expiresAt: NOW - 2000,
        revokedAt: NOW - 1000,
        revokedBy: 'system',
      }),
      record({ id: 'renewed', grantedAt: NOW - 1000 }),
      record({
        id: 'left',
        userId: 'user-gone',
        revokedAt: NOW - 1000,
        revokedBy: 'system',
      }),
      record({
        id: 'retired',
        userId: null,
        teamId: 'team-gone',
        teamName: null,
        competence: 'tale:models.api',
        revokedAt: NOW - 1000,
        revokedBy: 'system',
      }),
    ];
    const { user } = render(<CompetencesPage organizationId="org-a" />);

    await user.click(screen.getByRole('button', { name: 'Filter' }));
    const panel = await screen.findByRole('dialog', { name: 'Filters' });
    await user.click(within(panel).getByRole('button', { name: /^Status/ }));
    await user.click(within(panel).getByRole('checkbox', { name: 'Revoked' }));

    expect(
      screen.getByTitle('Replaced by a new grant after it expired'),
    ).toBeInTheDocument();
    expect(
      screen.getByTitle('Revoked when the member left the organization'),
    ).toBeInTheDocument();
    const retired = screen
      .getAllByRole('row')
      .find((row) => within(row).queryByText('Deleted team') !== null);
    if (retired === undefined) throw new Error('No row names a deleted team');
    expect(
      within(retired).getByTitle('Revoked when the team was deleted'),
    ).toBeInTheDocument();
  });

  // #5160: the register pages like every settings list — one window of the
  // shared size, more as the reader scrolls — and closes on the count footer,
  // which counts what the status filter leaves.
  it('shows one window of grants and counts them in the footer', () => {
    state.records = [
      ...Array.from({ length: DEFAULT_LIST_PAGE_SIZE + 5 }, (_, index) =>
        record({ id: `grant-${index}`, competence: `qualification-${index}` }),
      ),
      record({ id: 'ended', revokedAt: NOW - 1000, revokedBy: 'user-admin' }),
    ];
    render(<CompetencesPage organizationId="org-a" />);

    expect(screen.getAllByRole('row').slice(1)).toHaveLength(
      DEFAULT_LIST_PAGE_SIZE,
    );
    expect(
      screen.getByText(
        `Showing ${DEFAULT_LIST_PAGE_SIZE} of ${DEFAULT_LIST_PAGE_SIZE + 5} grants`,
      ),
    ).toBeInTheDocument();
  });

  it('finds grants by holder, email and the right’s name, within the status filter', async () => {
    state.records = [
      record({ id: 'act-as' }),
      record({
        id: 'models',
        userId: 'user-admin',
        competence: 'tale:models.api',
      }),
      record({ id: 'tax', userId: 'user-admin', competence: 'tax-reviewer' }),
      // Revoked: the default Active filter keeps it out of every search.
      record({
        id: 'ended',
        competence: 'tale:models.api',
        revokedAt: NOW - 1000,
        revokedBy: 'user-admin',
      }),
    ];
    const { user } = render(<CompetencesPage organizationId="org-a" />);
    expect(screen.getByText('Showing all 3 grants')).toBeInTheDocument();

    const search = screen.getByPlaceholderText('Search grants');
    const listed = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent);

    await user.type(search, 'worker@example');
    await waitFor(() => expect(listed()).toHaveLength(1));
    expect(listed()[0]).toContain('Integration Worker');
    expect(screen.getByText('Showing 1 of 3 grants')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'office admin');
    await waitFor(() => expect(listed()).toHaveLength(2));

    // The translated name, not only the id the record stores.
    await user.clear(search);
    await user.type(search, 'models over');
    await waitFor(() => expect(listed()).toHaveLength(1));
    expect(listed()[0]).toContain('Office Admin');

    // A qualification has only its name.
    await user.clear(search);
    await user.type(search, 'tax-rev');
    await waitFor(() => expect(listed()).toHaveLength(1));
    expect(listed()[0]).toContain('tax-reviewer');
  });

  it('shows the error state with Try again when the register cannot be read', async () => {
    state.records = undefined;
    state.error = new Error('Service unavailable');
    const { user } = render(<CompetencesPage organizationId="org-a" />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(REFRESH_FAILED)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(state.refetch).toHaveBeenCalledTimes(1);
    // The retry replaces its own button: focus waits on the list's section.
    expect(
      screen.getByRole('region', { name: 'Rights and qualifications' }),
    ).toHaveFocus();
  });

  it('keeps the grants a failed refresh left, and names the failure above them', async () => {
    state.records = [record({ id: 'live' })];
    state.error = new Error('Service unavailable');
    const { user } = render(<CompetencesPage organizationId="org-a" />);

    const notice = screen.getByText(REFRESH_FAILED).closest('[role="alert"]');
    if (!(notice instanceof HTMLElement)) throw new Error('No alert');
    expect(
      screen.getByRole('region', { name: 'Rights and qualifications' }),
    ).toContainElement(notice);
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
    expect(screen.getByText('Showing all 1 grant')).toBeInTheDocument();

    await user.click(within(notice).getByRole('button', { name: 'Try again' }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it('turns away a member who may not manage organization settings', () => {
    state.canWrite = false;
    render(<CompetencesPage organizationId="org-a" />);
    expect(
      screen.getByText(
        'Only organization owners and admins can manage rights and qualifications.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('passes an axe audit with grants listed', async () => {
    state.records = [record({ id: 'live', evidence: 'Relays answers' })];
    render(<CompetencesPage organizationId="org-a" />);
    await checkAccessibility(document.body);
  });
});
