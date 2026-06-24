import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

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

// Members list (email map) + block-counters list both go through this hook.
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

// Page renders for a permitted admin: ability allows orgSettings, member is an
// owner (so the export buttons mount, matching the E2E owner storageState).
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

// The DataTable reads the org id from the router; outside a RouterProvider that
// hook throws, so stub it (the table only uses it for row-level deep links).
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

// The active tab now round-trips through the URL (the route owns it), so the
// component is controlled. Mirror that here with a tiny stateful harness so
// clicking a trigger flips the selection the same way the route would.
function ControlledAuditLogsPage() {
  const [tab, setTab] = useState('audit');
  return (
    <AuditLogsPage
      organizationId="org-1"
      tab={tab}
      onTabChange={setTab}
      onCategoryChange={vi.fn()}
    />
  );
}

function renderPage() {
  return render(<ControlledAuditLogsPage />);
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

    // "Activity logs" tab — filter hidden (was a no-op).
    await user.click(screen.getByRole('tab', { name: 'Activity logs' }));
    expect(
      screen.queryByRole('button', { name: 'Filter' }),
    ).not.toBeInTheDocument();

    // "Error logs" tab — filter present (category really filters it).
    await user.click(screen.getByRole('tab', { name: 'Error logs' }));
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();

    // Back to "Audit logs" — filter present again.
    await user.click(screen.getByRole('tab', { name: 'Audit logs' }));
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
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
});
