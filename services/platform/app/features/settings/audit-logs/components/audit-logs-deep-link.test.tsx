import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { AuditLogsPage } from './audit-logs-page';

// Deep-link reveal (#1845): a `logId` search param must reveal that row's
// detail dialog even when it isn't on the loaded page (fetched by id), and
// degrade to a toast when the row is gone. These mocks isolate the page from
// Convex; the reveal row is driven from a mutable holder.
const holder = vi.hoisted(() => ({ reveal: null as unknown }));
const toastSpy = vi.hoisted(() => vi.fn());

const revealRow = {
  _id: 'log_broken',
  _creationTime: 1_700_000_000_000,
  organizationId: 'org-1',
  actorId: 'user_1',
  actorType: 'user',
  action: 'add_member',
  category: 'security',
  resourceType: 'audit_log',
  timestamp: 1_700_000_000_000,
  status: 'success',
};

vi.mock('@/app/features/settings/audit-logs/hooks/queries', () => ({
  useListAuditLogsPaginated: () => ({
    results: [],
    status: 'Exhausted' as const,
    loadMore: vi.fn(),
    isLoading: false,
  }),
  useListErrorLogsPaginated: () => ({
    results: [],
    status: 'Exhausted' as const,
    loadMore: vi.fn(),
    isLoading: false,
  }),
  useActivitySummary: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/app/features/settings/audit-logs/hooks/integrity', () => ({
  useIntegrityStatus: () => ({ data: null, isLoading: false }),
  useVerifyIntegrity: () => ({
    data: undefined,
    isPending: false,
    isError: false,
    mutate: vi.fn(),
  }),
}));

// Members list carries no `logId`; the by-id reveal read does — branch on it so
// one mock serves both call sites.
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (_func: unknown, args: unknown) =>
    args !== null && typeof args === 'object' && 'logId' in args
      ? { data: holder.reveal, isLoading: false }
      : { data: [], isLoading: false },
}));

vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data: { role: 'owner' },
    isLoading: false,
  }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

function renderPage(revealLogId?: string) {
  return render(
    <AuditLogsPage
      organizationId="org-1"
      tab="audit"
      onTabChange={vi.fn()}
      onCategoryChange={vi.fn()}
      revealLogId={revealLogId}
    />,
  );
}

describe('AuditLogsPage deep link', () => {
  it('reveals the detail dialog for a logId that is not on the loaded page', async () => {
    holder.reveal = revealRow;
    renderPage('log_broken');

    // The dialog opened for the fetched row (title + a value only that row has).
    expect(await screen.findByText('Audit log details')).toBeInTheDocument();
    expect(screen.getByText('Added member')).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('lands on the page with no dialog when there is no logId', () => {
    holder.reveal = revealRow;
    renderPage(undefined);

    expect(screen.getByRole('heading', { name: 'Logs' })).toBeInTheDocument();
    expect(screen.queryByText('Audit log details')).not.toBeInTheDocument();
  });

  it('toasts and stays on the page when the logId row is gone', async () => {
    holder.reveal = null;
    renderPage('log_gone');

    await vi.waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      ),
    );
    expect(screen.queryByText('Audit log details')).not.toBeInTheDocument();
    // Toast names the missing id so an operator can still find it.
    const call = toastSpy.mock.calls.at(-1)?.[0] as { title?: string };
    expect(call?.title).toContain('log_gone');
  });
});
