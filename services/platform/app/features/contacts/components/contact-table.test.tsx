import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ContactsTable } from './contact-table';

type Contact = ContactDoc;

// ---------------------------------------------------------------------------
// Mutable fixtures driven per-test. The component reads the paginated rows
// through `useListContactsPaginated`; we hand it a deterministic array so the
// SAME client-side DataTable behaviours the e2e exercised (managed search
// filtering, column sorting, the filtered-empty no-results copy) are
// reproduced without a backend or a CSV import.
// ---------------------------------------------------------------------------
let mockContacts: Contact[] = [];
let mockStatus: 'CanLoadMore' | 'Exhausted' = 'Exhausted';
const mockLoadMore = vi.fn();

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

vi.mock('@tale/ui/use-toast', () => ({
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
  useListContactsPaginated: ({ search }: { search?: string }) => {
    return {
      results: search
        ? mockContacts.filter((contact) =>
            [contact.name, contact.email, contact.externalId]
              .filter(Boolean)
              .some((value) =>
                String(value).toLowerCase().includes(search.toLowerCase()),
              ),
          )
        : mockContacts,
      status: mockStatus,
      loadMore: mockLoadMore,
      isLoading: false,
      error: null,
      retry: vi.fn(),
      isRetrying: false,
      unavailable: false,
      errorCount: 0,
    };
  },
}));

// Minimal columns that render the Name + Email so rows are queryable by their
// cell text — mirrors the real config's name/email columns. The query mock
// applies the same server-side name/email/external-id predicate as production.
// Name keeps a clickable header on TanStack's own toggle handler, the way the
// real config's `sortableHeader` does, so the sort can be driven from the UI.
const columns: ColumnDef<Contact>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <button type="button" onClick={column.getToggleSortingHandler()}>
        Name
      </button>
    ),
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
  mockStatus = 'Exhausted';
  mockLoadMore.mockClear();
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
  // server-search/pagination/empty-state logic is driven directly.
  describe('server-side search', () => {
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
      await waitFor(() => expect(contactRow('Other Beta')).toBeUndefined());
      expect(contactRow('Match Alpha')).toBeDefined();

      // Clearing the query brings the full list back.
      await user.clear(searchBox());
      await waitFor(() => expect(contactRow('Other Beta')).toBeDefined());
      expect(contactRow('Match Alpha')).toBeDefined();
    });

    it('shows the no-results empty state for an unmatched search', async () => {
      mockContacts = [makeContact('Solo Contact', 'solo@example.test')];
      const { user } = render(<ContactsTable organizationId="test-org-id" />);

      expect(contactRow('Solo Contact')).toBeDefined();

      // A query that matches nothing flips the body to the `filtered-empty`
      // state, which renders the shared `common.search.*` no-results copy.
      await user.type(searchBox(), 'zzz-no-match-zzz');
      await waitFor(() => expect(contactRow('Solo Contact')).toBeUndefined());
      expect(screen.getByText('No results found')).toBeInTheDocument();
      expect(
        screen.getByText('Try adjusting your search criteria'),
      ).toBeInTheDocument();

      // Clearing the query returns the row.
      await user.clear(searchBox());
      await waitFor(() => expect(contactRow('Solo Contact')).toBeDefined());
      expect(screen.queryByText('No results found')).not.toBeInTheDocument();
    });
  });

  it('does not drain broad server search pages during debounce or after a matching completion', async () => {
    mockStatus = 'CanLoadMore';
    mockContacts = Array.from({ length: 50 }, (_, index) =>
      makeContact(
        index === 0 ? 'Other' : `Match ${index}`,
        `contact-${index}@example.test`,
      ),
    );
    const { user } = render(<ContactsTable organizationId="test-org-id" />);
    await user.type(searchBox(), 'Match');
    expect(mockLoadMore).not.toHaveBeenCalled();
    await waitFor(() => expect(contactRow('Other')).toBeUndefined());
    expect(contactRow('Match 1')).toBeDefined();
    expect(mockLoadMore).not.toHaveBeenCalled();
  });

  it('renders the globally first 20 rows under an active Name sort for the accented-name counterexample', async () => {
    mockContacts = Array.from({ length: 100 }, (_, index) =>
      makeContact(
        index < 20 ? `Zebra ${index}` : `Álvaro ${index}`,
        `contact-${index}@example.test`,
      ),
    );
    const { user } = render(<ContactsTable organizationId="test-org-id" />);
    await user.click(screen.getByRole('button', { name: 'Name' }));
    expect(screen.getAllByRole('row')).toHaveLength(21);
    expect(contactRow('Zebra 0')).toBeDefined();
    expect(contactRow('Zebra 19')).toBeDefined();
    expect(contactRow('Álvaro 20')).toBeUndefined();
  });

  // Contacts used to render a client paginator of its own (#1108). Every
  // other overview list ends on the shared sticky "Showing all N {entity}"
  // footer, so this one does too — and #2646's singular noun still holds.
  describe('entity count footer', () => {
    it('reads the singular noun for exactly one contact', () => {
      mockContacts = [makeContact('Solo Contact', 'solo@example.test')];
      render(<ContactsTable organizationId="test-org-id" />);
      expect(screen.getByText('Showing all 1 contact')).toBeInTheDocument();
    });

    it('reads the plural noun for more than one contact', () => {
      mockContacts = [
        makeContact('Alpha', 'alpha@example.test'),
        makeContact('Beta', 'beta@example.test'),
        makeContact('Gamma', 'gamma@example.test'),
      ];
      render(<ContactsTable organizationId="test-org-id" />);
      expect(screen.getByText('Showing all 3 contacts')).toBeInTheDocument();
    });

    it('renders no page navigation', () => {
      mockContacts = Array.from({ length: 30 }, (_, i) =>
        makeContact(`Contact ${i}`, `contact-${i}@example.test`),
      );
      render(<ContactsTable organizationId="test-org-id" />);
      expect(
        screen.queryByRole('button', { name: 'Previous page' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Next page' }),
      ).not.toBeInTheDocument();
    });
  });

  // A sort has to order every contact, not the page window the user happens to
  // be looking at — otherwise rows reshuffle as later pages arrive (#2639).
  describe('sorting', () => {
    it('sorts across the whole list, past the page window', async () => {
      const PAGE_SIZE = 20;
      // Reverse-ordered names: the alphabetically first row lives beyond the
      // first page, so it can only surface if the sort saw every row.
      mockContacts = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => {
        const n = (PAGE_SIZE + 4 - i).toString().padStart(2, '0');
        return makeContact(`Contact ${n}`, `contact-${n}@example.test`);
      });

      const { user } = render(<ContactsTable organizationId="test-org-id" />);

      const firstBodyRowName = () => {
        const [, firstBodyRow] = screen.getAllByRole('row');
        return within(firstBodyRow!).getAllByRole('cell')[0]?.textContent;
      };

      expect(firstBodyRowName()).toBe('Contact 24');

      await user.click(screen.getByRole('button', { name: 'Name' }));

      expect(firstBodyRowName()).toBe('Contact 00');
    });
  });
});
