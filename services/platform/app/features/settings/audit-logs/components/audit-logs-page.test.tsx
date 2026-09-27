import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AuditLogsPage } from './audit-logs-page';

// Migrated from the governance E2E "logs: renders the audit table and switches
// tabs". What that test proved is pure client-side tab UI: the Logs heading +
// subheading render, the default "Audit logs" tab is selected and shows its
// DataTable (the table carries the audit caption regardless of row count), and
// clicking "Activity logs" / back flips `aria-selected` (Radix Tabs state).
// There is no router redirect, loader/beforeLoad, persistence round-trip, or
// backend-enforced gate in that assertion path — `category` is a prop and the
// tab strip is local Radix state — so it belongs at the component tier. We stub
// the data hooks to their empty/loaded states so only the static UI renders.

// All audit-page query hooks (page + child tabs) resolve to this one module.
// The two trails are mutable so a test can load, fill or empty either; a
// category narrows them on the server, so a categorised read answers
// `filtered` instead. Every test starts from two empty, settled trails.
const trails = vi.hoisted(() => ({
  status: 'Exhausted' as 'LoadingFirstPage' | 'Exhausted',
  audit: [] as unknown[],
  errors: [] as unknown[],
  filtered: [] as unknown[],
}));
function trail(rows: unknown[], args: { category?: string }) {
  const loading = trails.status === 'LoadingFirstPage';
  return {
    results: loading ? [] : args.category ? trails.filtered : rows,
    status: trails.status,
    loadMore: vi.fn(),
    isLoading: loading,
  };
}
vi.mock('@/app/features/settings/audit-logs/hooks/queries', () => ({
  useListAuditLogsPaginated: (args: { category?: string }) =>
    trail(trails.audit, args),
  useListErrorLogsPaginated: (args: { category?: string }) =>
    trail(trails.errors, args),
  useActivitySummary: () => ({ data: undefined, isLoading: false }),
}));

const LOG_ROW = {
  _id: 'log_1',
  _creationTime: 1_700_000_000_000,
  organizationId: 'org-1',
  actorId: 'user_1',
  actorType: 'user',
  action: 'add_member',
  category: 'member',
  resourceType: 'member',
  timestamp: 1_700_000_000_000,
  status: 'success',
};

// Members list (email map) + block-counters list both go through this hook.
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: [], isLoading: false }),
}));

const exportMutate = vi.hoisted(() => vi.fn());
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutate: exportMutate, isPending: false }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

// The admin-only integrity panel calls these; stub them to a benign
// "never checked / idle" state so the page renders without a Convex client.
vi.mock('@/app/features/settings/audit-logs/hooks/integrity', () => ({
  useIntegrityStatus: () => ({ data: null, isLoading: false }),
  useVerifyIntegrity: () => ({
    data: undefined,
    isPending: false,
    isError: false,
    mutate: vi.fn(),
  }),
}));

// Page renders for a permitted admin: ability allows orgSettings, member is an
// owner (so the export buttons mount, matching the E2E owner storageState).
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));

// Role is mutable so a single test can flip owner → member and assert the
// admin-only integrity panel disappears. Defaults to owner (the export buttons
// mount, matching the migrated E2E owner storageState); reset after each test.
const memberRole = vi.hoisted(() => ({ current: 'owner' as string }));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data: { role: memberRole.current },
    isLoading: false,
  }),
}));
afterEach(() => {
  memberRole.current = 'owner';
  exportMutate.mockClear();
  trails.status = 'Exhausted';
  trails.audit = [];
  trails.errors = [];
  trails.filtered = [];
});

// The DataTable reads the org id from the router; outside a RouterProvider that
// hook throws, so stub it (the table only uses it for row-level deep links).
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

// The active tab now round-trips through the URL (the route owns it), so the
// component is controlled. Mirror that here with a tiny stateful harness so
// clicking a trigger flips the selection the same way the route would.
function ControlledAuditLogsPage({ category }: { category?: string }) {
  const [tab, setTab] = useState('audit');
  return (
    <AuditLogsPage
      organizationId="org-1"
      tab={tab}
      onTabChange={setTab}
      category={category}
      onCategoryChange={vi.fn()}
    />
  );
}

function renderPage(category?: string) {
  return render(<ControlledAuditLogsPage category={category} />);
}

describe('AuditLogsPage', () => {
  it('renders the Logs heading and the default Audit tab selected with its table', async () => {
    renderPage();

    // Section heading (static; always real).
    expect(screen.getByRole('heading', { name: 'Logs' })).toBeInTheDocument();

    // The default "Audit logs" tab is selected.
    const auditTab = screen.getByRole('tab', { name: 'Audit logs' });
    expect(auditTab).toHaveAttribute('aria-selected', 'true');

    // The active tab renders the audit DataTable, identified by its caption.
    expect(
      await screen.findByRole('table', { name: 'Audit logs data table' }),
    ).toBeInTheDocument();
  });

  it('switches to Activity logs and back, toggling aria-selected', async () => {
    const { user } = renderPage();

    const auditTab = screen.getByRole('tab', { name: 'Audit logs' });
    const activityTab = screen.getByRole('tab', { name: 'Activity logs' });

    expect(auditTab).toHaveAttribute('aria-selected', 'true');

    await user.click(activityTab);
    expect(activityTab).toHaveAttribute('aria-selected', 'true');
    expect(auditTab).toHaveAttribute('aria-selected', 'false');

    await user.click(auditTab);
    expect(auditTab).toHaveAttribute('aria-selected', 'true');
    expect(activityTab).toHaveAttribute('aria-selected', 'false');
  });

  it('shows the category filter only on the Audit and Errors tabs', async () => {
    // [114] The category `DataTableFilters` feeds only the audit + error
    // queries, so the page renders it solely on those two tabs — on "Sign-in
    // blocks" and "Activity logs" it was a no-op and is now omitted entirely.
    // The shared toolbar's filter trigger is the `FilterButton`, accessible by
    // its "Filter" label, so its presence/absence tracks the fix exactly.
    const { user } = renderPage();

    // Default "Audit logs" tab — filter present.
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();

    // "Sign-in blocks" tab — filter hidden (was a no-op).
    await user.click(screen.getByRole('tab', { name: 'Sign-in blocks' }));
    expect(
      screen.queryByRole('button', { name: 'Filter' }),
    ).not.toBeInTheDocument();

    // "Activity logs" tab — the CATEGORY filter is gone, but the view brings
    // its own period filter, so a Filter trigger is still present. Opening it
    // must offer periods, never audit categories.
    await user.click(screen.getByRole('tab', { name: 'Activity logs' }));
    const activityFilter = screen.getByRole('button', { name: 'Filter' });
    await user.click(activityFilter);
    expect(screen.queryByText('Auth')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    // "Error logs" tab — filter present (category really filters it).
    await user.click(screen.getByRole('tab', { name: 'Error logs' }));
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();

    // Back to "Audit logs" — filter present again.
    await user.click(screen.getByRole('tab', { name: 'Audit logs' }));
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
  });

  it('shows the chain-integrity panel for an admin/owner', async () => {
    renderPage();
    expect(await screen.findByText('Chain integrity')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Verify now' }),
    ).toBeInTheDocument();
  });

  it('hides the chain-integrity panel for a non-admin member', () => {
    // Ability still permits the page (no AccessDenied); the panel has its own
    // admin gate, so a plain member sees the tabs but not the panel.
    memberRole.current = 'member';
    renderPage();
    expect(screen.queryByText('Chain integrity')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Logs' })).toBeInTheDocument();
  });

  it('consolidates export into one dropdown whose format items trigger the export', async () => {
    // The two side-by-side "Export CSV"/"Export JSON" buttons are now one
    // labelled "Export" trigger opening a keyboard-reachable format menu.
    const { user } = renderPage();

    expect(
      screen.queryByRole('button', { name: /Export CSV/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Export JSON/ }),
    ).not.toBeInTheDocument();

    const trigger = screen.getByRole('button', { name: 'Export audit logs' });
    await user.click(trigger);

    const csvItem = await screen.findByRole('menuitem', { name: 'CSV' });
    expect(screen.getByRole('menuitem', { name: 'JSON' })).toBeInTheDocument();

    await user.click(csvItem);
    expect(exportMutate).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'csv' }),
    );
  });

  it('passes an axe audit of the tab strip and active audit table', async () => {
    renderPage();
    // Audit the migrated subject — the tablist + the active tab panel holding
    // the audit DataTable. We deliberately scope to the tab panel rather than
    // the whole page: the toolbar action is the shared `DataTableFilters`
    // Popover, whose `div[type=button][aria-haspopup]` trigger is a known
    // `aria-allowed-attr` issue owned by that shared primitive (out of scope of
    // this page and of what the E2E exercised).
    const tabPanel = await screen.findByRole('tabpanel');
    await checkAccessibility(tabPanel);
    await checkAccessibility(screen.getByRole('tablist'));
  });

  // The category filter sits above the active tab's table, so the page reads
  // that tab's trail to know whether there is anything to filter.
  describe('category filter', () => {
    const filterButton = () => screen.getByRole('button', { name: 'Filter' });

    it('is offered over a trail with rows', () => {
      trails.audit = [LOG_ROW];
      renderPage();
      expect(filterButton()).toBeEnabled();
    });

    it('is disabled over an empty trail with no category picked', () => {
      renderPage();
      expect(filterButton()).toBeDisabled();
    });

    it('stays usable while the trail loads', () => {
      trails.status = 'LoadingFirstPage';
      renderPage();
      expect(filterButton()).toBeEnabled();
    });

    it('stays usable when the picked category narrows the trail to nothing', () => {
      trails.audit = [LOG_ROW];
      renderPage('security');
      expect(filterButton()).toBeEnabled();
    });

    it('follows the active tab: the error trail decides on Error logs', async () => {
      trails.audit = [LOG_ROW];
      const { user } = renderPage();
      expect(filterButton()).toBeEnabled();

      await user.click(screen.getByRole('tab', { name: 'Error logs' }));
      expect(filterButton()).toBeDisabled();
    });
  });
});
