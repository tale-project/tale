import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Doc } from '@/convex/_generated/dataModel';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { CustomersTable } from './customers-table';

type Customer = Doc<'customers'>;

// ---------------------------------------------------------------------------
// Mutable fixtures driven per-test. The component reads the paginated rows
// through `useListCustomersPaginated`; we hand it a deterministic array so the
// SAME client-side DataTable behaviours the e2e exercised (managed search
// filtering, `displayMode: 'pagination'` page navigation, the filtered-empty
// no-results copy) are reproduced without a backend or a CSV import.
// ---------------------------------------------------------------------------
let mockCustomers: Customer[] = [];

function makeCustomer(name: string, email: string): Customer {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture; the table only renders name/email + reads source for row actions
  return {
    _id: `customer-${email}`,
    _creationTime: Date.now(),
    organizationId: 'test-org-id',
    name,
    email,
    status: 'active',
    source: 'manual_import',
  } as unknown as Customer;
}

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('../hooks/mutations', () => ({
  useBulkCreateCustomers: () => ({ mutateAsync: vi.fn() }),
  useDeleteCustomer: () => ({ mutateAsync: vi.fn() }),
  useUpdateCustomer: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/queries', () => ({
  useApproxCustomerCount: () => ({ data: mockCustomers.length }),
  useListCustomersPaginated: () => ({
    results: mockCustomers,
    status: 'Exhausted',
    loadMore: vi.fn(),
    isLoading: false,
  }),
}));

// Minimal columns that render the Name + Email so rows are queryable by their
// cell text — mirrors the real config's name/email columns. The managed search
// in `useListPage` matches on the `name`/`email`/`externalId` row fields (not
// the columns), so this stays faithful to the production filtering contract.
const columns: ColumnDef<Customer>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    size: 200,
    cell: ({ row }) => (
      <Text as="span" variant="label">
        {row.original.name || ''}
      </Text>
    ),
  },
  {
    accessorKey: 'email',
    header: 'Email',
    size: 240,
    cell: ({ row }) => (
      <Text as="span" variant="body">
        {row.original.email || ''}
      </Text>
    ),
  },
];

vi.mock('../hooks/use-customers-table-config', () => ({
  useCustomersTableConfig: () => ({
    columns,
    searchPlaceholder: 'Search customers',
    stickyLayout: undefined,
    pageSize: 20,
  }),
}));

const searchBox = () => screen.getByPlaceholderText('Search customers');

/** A customers-list data row whose Name cell exactly equals `name`. */
function customerRow(name: string): HTMLElement | undefined {
  return screen.getAllByRole('row').find((row) =>
    within(row)
      .queryAllByRole('cell')
      .some((cell) => cell.textContent?.trim() === name),
  );
}

beforeEach(() => {
  mockCustomers = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CustomersTable', () => {
  describe('accessibility', () => {
    it('passes axe audit in empty state', async () => {
      const { container } = render(
        <CustomersTable organizationId="test-org-id" />,
      );
      // Disable aria-allowed-attr: Radix UI Popover renders aria-haspopup on a div,
      // which is a third-party component issue outside our control.
      await checkAccessibility(container, {
        rules: { 'aria-allowed-attr': { enabled: false } },
      });
    });
  });

  // Migrated from tests/e2e/specs/list-behaviors.spec.ts: the three DataTable
  // behaviours covered once on the customers list. The e2e used a CSV import
  // only as SETUP to get rows on screen — here the rows are mocked and the same
  // client-side search/pagination/empty-state logic is driven directly.
  describe('client-side search', () => {
    it('search filters the customers list and clearing restores it', async () => {
      mockCustomers = [
        makeCustomer('Match Alpha', 'match@example.test'),
        makeCustomer('Other Beta', 'other@example.test'),
      ];
      const { user } = render(<CustomersTable organizationId="test-org-id" />);

      // Both rows visible before searching.
      expect(customerRow('Match Alpha')).toBeDefined();
      expect(customerRow('Other Beta')).toBeDefined();

      // Filter to the match row by its unique name (substring, case-insensitive).
      await user.type(searchBox(), 'match alpha');
      expect(customerRow('Match Alpha')).toBeDefined();
      expect(customerRow('Other Beta')).toBeUndefined();

      // Clearing the query brings the full list back.
      await user.clear(searchBox());
      expect(customerRow('Match Alpha')).toBeDefined();
      expect(customerRow('Other Beta')).toBeDefined();
    });

    it('shows the no-results empty state for an unmatched search', async () => {
      mockCustomers = [makeCustomer('Solo Customer', 'solo@example.test')];
      const { user } = render(<CustomersTable organizationId="test-org-id" />);

      expect(customerRow('Solo Customer')).toBeDefined();

      // A query that matches nothing flips the body to the `filtered-empty`
      // state, which renders the shared `common.search.*` no-results copy.
      await user.type(searchBox(), 'zzz-no-match-zzz');
      expect(customerRow('Solo Customer')).toBeUndefined();
      expect(screen.getByText('No results found')).toBeInTheDocument();
      expect(
        screen.getByText('Try adjusting your search criteria'),
      ).toBeInTheDocument();

      // Clearing the query returns the row.
      await user.clear(searchBox());
      expect(customerRow('Solo Customer')).toBeDefined();
      expect(screen.queryByText('No results found')).not.toBeInTheDocument();
    });
  });

  describe('client-side pagination', () => {
    it('paginates a filtered customers list across pages', async () => {
      // pageSize is 20, so 21 rows guarantee a second page. All 21 share one
      // token; searching by it filters to EXACTLY these rows so the per-page
      // counts are deterministic.
      const PAGE_SIZE = 20;
      const TOTAL = PAGE_SIZE + 1;
      const token = 'pagetok';
      mockCustomers = Array.from({ length: TOTAL }, (_, i) => {
        const n = i.toString().padStart(2, '0');
        return makeCustomer(
          `Page ${token} ${n}`,
          `page-${token}-${n}@example.test`,
        );
      });

      const { user } = render(<CustomersTable organizationId="test-org-id" />);

      // Scope to just this run's rows so counts ignore the header row.
      await user.type(searchBox(), token);

      const tokenRowCount = () =>
        screen.getAllByRole('row').filter((row) =>
          within(row)
            .queryAllByRole('cell')
            .some((cell) => cell.textContent?.includes(token)),
        ).length;

      const prev = () => screen.getByRole('button', { name: 'Previous page' });
      const next = () => screen.getByRole('button', { name: 'Next page' });

      // Page 1: a full page; previous is the boundary, next isn't.
      expect(tokenRowCount()).toBe(PAGE_SIZE);
      expect(prev()).toBeDisabled();
      expect(next()).toBeEnabled();

      // Advance: the last page holds only the remaining row; next is now boundary.
      await user.click(next());
      expect(tokenRowCount()).toBe(TOTAL - PAGE_SIZE);
      expect(prev()).toBeEnabled();
      expect(next()).toBeDisabled();

      // Back to the first full page.
      await user.click(prev());
      expect(tokenRowCount()).toBe(PAGE_SIZE);
      expect(prev()).toBeDisabled();
    });
  });
});
