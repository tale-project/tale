import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { TrashPage } from './trash-page';

// Migrated from the governance E2E "trash: renders the page and its table/empty
// state". That test only proved render: the "Trash" section heading paints, and
// the page is past its skeleton when EITHER the loaded-empty notice OR the
// "Type" column header is present (a fresh backend has nothing trashed, so the
// empty notice is the common case — the E2E asserted either branch).
//
// None of that is a persistence round-trip, router redirect, real streaming,
// backend-enforced RBAC, or a connector call: the heading is static, the
// table/empty branch is pure client state off `useListTrashedRows`, and the
// admin access gate is a client `useAbility` branch. So it belongs at the
// component tier with the trash query stubbed to each state. Restore is NOT
// exercised here (same as the E2E, which avoided mutating the trash pool).

// Trash query — the page reads `useListTrashedRows`. Each test overrides this
// to the empty-loaded or with-rows shape.
const mockListTrashedRows = vi.fn();

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useListTrashedRows: (...args: unknown[]) => mockListTrashedRows(...args),
}));

// Restore mutation — never invoked by render/empty-state (no restore here), but
// the hook is called unconditionally at the top of the component.
vi.mock('@/app/features/settings/governance/hooks/mutations', () => ({
  useRestoreSoftDeletedRow: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// The page is admin-only: it returns <AccessDenied> when the ability cannot
// write orgSettings. The E2E runs as the org owner, so grant access.
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));

// The "Trashed" column renders via the shared, locale-aware <TableDateCell>.
// Stub the date hook so the relative output is deterministic (mirrors the
// sibling table-date-cell test).
vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatDate: (_date: unknown, preset?: string) =>
      preset === 'relative' ? '5 minutes ago' : 'Jan 1, 2025',
    locale: 'en',
    timezone: 'UTC',
  }),
}));

const HEADING = 'Trash';
const EMPTY_NOTICE =
  'Nothing in the trash. Retention will move expired rows here once their grace window starts.';
const TYPE_COLUMN = 'Type';

describe('TrashPage', () => {
  it('renders the Trash heading and the empty-state notice when nothing is trashed', async () => {
    // Fresh backend: loaded with zero rows (the E2E's common case).
    mockListTrashedRows.mockReturnValue({
      data: { rows: [], nextCursor: null },
      isLoading: false,
    });

    render(<TrashPage organizationId="org-1" />);

    // Section heading (static; always real) — mirrors the E2E's first assertion.
    expect(screen.getByRole('heading', { name: HEADING })).toBeInTheDocument();

    // Past the skeleton via the loaded-empty notice branch.
    const emptyNotice = screen.getByText(EMPTY_NOTICE);
    expect(emptyNotice).toBeInTheDocument();

    // No table is rendered in the empty state.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    // Audit the migrated subject — the empty-state region. We deliberately scope
    // to it rather than the whole page: the toolbar is the shared
    // `DataTableFilters` Popover, whose `div[type=button][aria-haspopup]` trigger
    // is a known `aria-allowed-attr` issue owned by that shared primitive (out of
    // scope of this page and of what the E2E exercised).
    const emptyRegion = emptyNotice.closest('div');
    expect(emptyRegion).not.toBeNull();
    await checkAccessibility(emptyRegion as HTMLElement);
  });

  it('renders the table with the Type column header when rows are trashed', () => {
    // Loaded with a trashed row: the table (not the empty notice) shows.
    mockListTrashedRows.mockReturnValue({
      data: {
        rows: [
          {
            resourceType: 'document' as const,
            id: 'row-1',
            status: 'trashed' as const,
            statusChangedAt: Date.now(),
            createdAt: Date.now(),
            displayName: 'Quarterly report',
            ownerId: 'user-1',
            ownerName: 'Ada Lovelace',
          },
        ],
        nextCursor: null,
      },
      isLoading: false,
    });

    render(<TrashPage organizationId="org-1" />);

    // Heading still present.
    expect(screen.getByRole('heading', { name: HEADING })).toBeInTheDocument();

    // Past the skeleton via the table-header branch — mirrors the E2E's
    // "Type" columnheader assertion.
    expect(
      screen.getByRole('columnheader', { name: TYPE_COLUMN }),
    ).toBeInTheDocument();

    // The empty notice must NOT show once rows exist.
    expect(screen.queryByText(EMPTY_NOTICE)).not.toBeInTheDocument();
  });

  // Regression for #2052 [110]: the "Trashed" column used a local
  // hardcoded-English `formatRelative()` helper. It now renders through the
  // shared, locale-aware <TableDateCell preset="relative" />.
  it('renders the locale-aware relative time, with an em-dash fallback for a missing date', () => {
    mockListTrashedRows.mockReturnValue({
      data: {
        rows: [
          {
            resourceType: 'document' as const,
            id: 'row-dated',
            status: 'trashed' as const,
            statusChangedAt: 1_700_000_000_000,
            createdAt: 1_700_000_000_000,
            displayName: 'Quarterly report',
            ownerId: 'user-1',
            ownerName: 'Ada Lovelace',
          },
          {
            resourceType: 'document' as const,
            id: 'row-undated',
            status: 'trashed' as const,
            statusChangedAt: null,
            createdAt: null,
            displayName: 'Orphan draft',
            ownerId: 'user-2',
            ownerName: 'Grace Hopper',
          },
        ],
        nextCursor: null,
      },
      isLoading: false,
    });

    render(<TrashPage organizationId="org-1" />);

    // Locale-aware relative output (from the shared cell), not raw English.
    expect(screen.getByText('5 minutes ago')).toBeInTheDocument();
    // Null date -> the shared cell's em-dash fallback (no NaN/crash).
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
