import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompetenceRecordWire } from '@/app/lib/backend/contract/governance';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { CompetencesPage } from './competences-page';

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

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
  records: [] as CompetenceRecordWire[],
  canWrite: true,
  revoke: vi.fn(),
  refetch: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  useCompetences: () => ({
    data: state.records,
    isLoading: false,
    error: null,
    refetch: state.refetch,
  }),
  useOrgMembersForPicker: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/mutations', () => ({
  useRevokeCompetence: () => ({ mutateAsync: state.revoke, isPending: false }),
  useGrantCompetence: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  state.canWrite = true;
  state.refetch.mockResolvedValue({});
});

describe('CompetencesPage', () => {
  it('opens on active grants, naming capability, holder and grantor', () => {
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
    expect(screen.getByText('No competences granted yet')).toBeInTheDocument();
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
      expect.objectContaining({ title: 'Competence revoked' }),
    );
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
        title: "Couldn't revoke the competence",
        description:
          'Only organization owners and admins can grant or revoke competences.',
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

  it('turns away a member who may not manage organization settings', () => {
    state.canWrite = false;
    render(<CompetencesPage organizationId="org-a" />);
    expect(
      screen.getByText(
        'Only organization owners and admins can manage competences.',
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
