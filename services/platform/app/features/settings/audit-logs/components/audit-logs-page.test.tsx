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

function renderPage() {
  return render(
    <AuditLogsPage organizationId="org-1" onCategoryChange={vi.fn()} />,
  );
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
