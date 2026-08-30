import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { ContactsTable } from './contact-table';

type Contact = ContactDoc;

// ---------------------------------------------------------------------------
// Mutable fixtures driven per-test. The component reads the paginated rows
// through `useListContactsPaginated`; we hand it a deterministic array so the
// SAME client-side DataTable behaviours the e2e exercised (managed search
// filtering, `displayMode: 'pagination'` page navigation, the filtered-empty
// no-results copy) are reproduced without a backend or a CSV import.
// ---------------------------------------------------------------------------
let mockContacts: Contact[] = [];

function makeContact(name: string, email: string): Contact {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture; the table only renders name/email + reads source for row actions
  return {
    _id: `contact-${email}`,
    _creationTime: Date.now(),
    organizationId: 'test-org-id',
    name,
    email,
    source: 'manual_import',
  } as unknown as Contact;
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
  useBulkCreateContacts: () => ({ mutateAsync: vi.fn() }),
  useCreateContact: () => ({ mutateAsync: vi.fn() }),
  useDeleteContact: () => ({ mutateAsync: vi.fn() }),
  useUpdateContact: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/queries', () => ({
  useApproxContactCount: () => ({ data: mockContacts.length }),
  useListContactsPaginated: () => ({
    results: mockContacts,
    status: 'Exhausted',
    loadMore: vi.fn(),
    isLoading: false,
  }),
}));

// Minimal columns that render the Name + Email so rows are queryable by their
// cell text — mirrors the real config's name/email columns. The managed search
// in `useListPage` matches on the `name`/`email`/`externalId` row fields (not
// the columns), so this stays faithful to the production filtering contract.
const columns: ColumnDef<Contact>[] = [
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

vi.mock('../hooks/use-contacts-table-config', () => ({
  useContactsTableConfig: () => ({
    columns,
    searchPlaceholder: 'Search contacts',
    stickyLayout: undefined,
    pageSize: 20,
  }),
}));

const searchBox = () => screen.getByPlaceholderText('Search contacts');

/** A contacts-list data row whose Name cell exactly equals `name`. */
function contactRow(name: string): HTMLElement | undefined {
  return screen.getAllByRole('row').find((row) =>
    within(row)
      .queryAllByRole('cell')
      .some((cell) => cell.textContent?.trim() === name),
  );
}

beforeEach(() => {
  mockContacts = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ContactsTable', () => {
  describe('accessibility', () => {
    it('passes axe audit in empty state', async () => {
      const { container } = render(
        <ContactsTable organizationId="test-org-id" />,
      );
      // Disable aria-allowed-attr: Radix UI Popover renders aria-haspopup on a div,
      // which is a third-party component issue outside our control.
      await checkAccessibility(container, {
        rules: { 'aria-allowed-attr': { enabled: false } },
      });
    });
  });

  // Migrated from tests/e2e/specs/list-behaviors.spec.ts: the three DataTable
  // behaviours covered once on the contacts list. The e2e used a CSV import
  // only as SETUP to get rows on screen — here the rows are mocked and the same
  // client-side search/pagination/empty-state logic is driven directly.
  describe('client-side search', () => {
    it('search filters the contacts list and clearing restores it', async () => {
      mockContacts = [
        makeContact('Match Alpha', 'match@example.test'),
        makeContact('Other Beta', 'other@example.test'),
      ];
      const { user } = render(<ContactsTable organizationId="test-org-id" />);

      // Both rows visible before searching.
      expect(contactRow('Match Alpha')).toBeDefined();
      expect(contactRow('Other Beta')).toBeDefined();

      // Filter to the match row by its unique name (substring, case-insensitive).
      await user.type(searchBox(), 'match alpha');
      expect(contactRow('Match Alpha')).toBeDefined();
      expect(contactRow('Other Beta')).toBeUndefined();

      // Clearing the query brings the full list back.
      await user.clear(searchBox());
      expect(contactRow('Match Alpha')).toBeDefined();
      expect(contactRow('Other Beta')).toBeDefined();
    });

    it('shows the no-results empty state for an unmatched search', async () => {
      mockContacts = [makeContact('Solo Contact', 'solo@example.test')];
      const { user } = render(<ContactsTable organizationId="test-org-id" />);

      expect(contactRow('Solo Contact')).toBeDefined();

      // A query that matches nothing flips the body to the `filtered-empty`
      // state, which renders the shared `common.search.*` no-results copy.
      await user.type(searchBox(), 'zzz-no-match-zzz');
      expect(contactRow('Solo Contact')).toBeUndefined();
      expect(screen.getByText('No results found')).toBeInTheDocument();
      expect(
        screen.getByText('Try adjusting your search criteria'),
      ).toBeInTheDocument();

      // Clearing the query returns the row.
      await user.clear(searchBox());
      expect(contactRow('Solo Contact')).toBeDefined();
      expect(screen.queryByText('No results found')).not.toBeInTheDocument();
    });
  });

  describe('client-side pagination', () => {
    it('paginates a filtered contacts list across pages', async () => {
      // pageSize is 20, so 21 rows guarantee a second page. All 21 share one
      // token; searching by it filters to EXACTLY these rows so the per-page
      // counts are deterministic.
      const PAGE_SIZE = 20;
      const TOTAL = PAGE_SIZE + 1;
      const token = 'pagetok';
      mockContacts = Array.from({ length: TOTAL }, (_, i) => {
        const n = i.toString().padStart(2, '0');
        return makeContact(
          `Page ${token} ${n}`,
          `page-${token}-${n}@example.test`,
        );
      });

      const { user } = render(<ContactsTable organizationId="test-org-id" />);

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

  // #2646: the pagination footer must read the correct singular noun
  // ("contact", not "contacts") when exactly one row is shown.
  describe('entity count footer (#2646)', () => {
    it('reads the singular noun for exactly one contact', () => {
      mockContacts = [makeContact('Solo Contact', 'solo@example.test')];
      render(<ContactsTable organizationId="test-org-id" />);
      expect(screen.getByText('Showing 1-1 of 1 contact')).toBeInTheDocument();
    });

    it('reads the plural noun for more than one contact', () => {
      mockContacts = [
        makeContact('Alpha', 'alpha@example.test'),
        makeContact('Beta', 'beta@example.test'),
        makeContact('Gamma', 'gamma@example.test'),
      ];
      render(<ContactsTable organizationId="test-org-id" />);
      expect(screen.getByText('Showing 1-3 of 3 contacts')).toBeInTheDocument();
    });
  });
});
