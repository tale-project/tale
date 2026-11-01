import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/list-page-size';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

import { ActiveHoldsSection } from './active-holds-section';
import { MattersSection } from './matters-section';
import { ReleaseHistorySection } from './release-history-section';
import { ReleaseRequestsSection } from './release-requests-section';

const mocks = vi.hoisted(() => ({
  matters: vi.fn(),
  holds: vi.fn(),
  requests: vi.fn(),
  history: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  useLegalMatters: mocks.matters,
  useLegalHolds: mocks.holds,
  useLegalHoldReleaseRequests: mocks.requests,
  useLegalHoldReleaseRequestsPaginated: mocks.history,
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'operator-1' } }),
}));
// The dialogs' own forms have tests of their own; here they only say whether
// the section opened them.
vi.mock('./upsert-matter-dialog', () => ({
  UpsertMatterDialog: ({ open, matter }: { open: boolean; matter?: object }) =>
    open && !matter ? (
      <div role="dialog" aria-label="Create matter dialog" />
    ) : null,
}));
vi.mock('./close-matter-dialog', () => ({ CloseMatterDialog: () => null }));
vi.mock('./place-hold-dialog', () => ({
  PlaceHoldDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Place hold dialog" /> : null,
}));
vi.mock('./request-release-dialog', () => ({
  RequestReleaseDialog: () => null,
}));
vi.mock('./approve-release-dialog', () => ({
  ApproveReleaseDialog: () => null,
}));
vi.mock('./reject-release-dialog', () => ({ RejectReleaseDialog: () => null }));

/** More rows than one display window holds. */
const MANY = DEFAULT_LIST_PAGE_SIZE + 5;
const AT = 1_700_000_000_000;

function query(data: unknown[]) {
  return {
    data,
    error: null,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
    errorUpdateCount: 0,
  };
}

function history(results: unknown[]) {
  return {
    results,
    error: null,
    status: 'Exhausted',
    isLoading: false,
    isRetrying: false,
    errorCount: 0,
    loadMore: vi.fn(),
    retry: vi.fn(),
  };
}

function matters(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    _id: `matter-${i}`,
    name: `Matter ${i}`,
    caseNumber: `CASE-${i}`,
    status: 'open',
    linkedActiveHolds: 0,
    createdAt: AT,
  }));
}

function holds(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    _id: `hold-${i}`,
    organizationId: 'org-1',
    targetType: 'org',
    targetId: `org-${i}`,
    targetLabel: `Hold ${i}`,
    reason: 'Preserve litigation evidence',
    placedBy: 'user-1',
    placedByName: 'Alice',
    placedAt: AT,
  }));
}

function requests(count: number, status: string) {
  return Array.from({ length: count }, (_, i) => ({
    _id: `request-${i}`,
    organizationId: 'org-1',
    holdId: `hold-${i}`,
    targetType: 'org',
    targetId: `target-${i}`,
    requestedBy: 'user-1',
    requestedByName: 'Alice',
    requestedAt: AT,
    reason: 'Matter settled',
    status,
  }));
}

/**
 * DataTable's own root: it holds the table's toolbar and the bordered frame
 * whose scrollport holds the table. `overflow-x-auto` is the scrollport of the
 * non-sticky layout a scrolling settings page needs (#2381, #2436); a sticky
 * table has none, and fails here.
 */
function tableRoot(table: HTMLElement): HTMLElement {
  const root = table.closest('.overflow-x-auto')?.parentElement?.parentElement;
  if (!root) throw new Error('No non-sticky DataTable frame around the table');
  return root;
}

/**
 * Each control sits in the table's own toolbar: inside the DataTable, above
 * the table and never in it. A bar of the section's own above the table fails
 * the first check.
 */
function expectInToolbar(table: HTMLElement, controls: HTMLElement[]) {
  const root = tableRoot(table);
  for (const control of controls) {
    expect(root).toContainElement(control);
    expect(table).not.toContainElement(control);
    expect(
      table.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  }
}

/** The one create button, which is DataTable's `addAction`. */
function createButton(name: string): HTMLElement {
  const buttons = screen.getAllByRole('button', { name });
  expect(buttons).toHaveLength(1);
  const button = buttons[0] as HTMLElement;
  expect(button.closest('[data-table-add-action]')).not.toBeNull();
  return button;
}

beforeEach(() => {
  mocks.matters.mockReturnValue(query([]));
  mocks.holds.mockReturnValue(query([]));
  mocks.requests.mockReturnValue(query([]));
  mocks.history.mockReturnValue(history([]));
});

describe('Legal hold tables follow the settings list pattern', () => {
  describe('Matters', () => {
    it('shows one window of matters and closes on the count footer', () => {
      mocks.matters.mockReturnValue(query(matters(MANY)));
      render(<MattersSection organizationId="org-1" />);

      expect(screen.getAllByText(/^Matter \d+$/)).toHaveLength(
        DEFAULT_LIST_PAGE_SIZE,
      );
      expect(
        screen.getByText(
          `Showing ${DEFAULT_LIST_PAGE_SIZE} of ${MANY} matters`,
        ),
      ).toBeInTheDocument();
    });

    it.each([
      ['with matters', 1],
      ['when empty', 0],
    ])(
      'keeps search, the status filter and Create matter in the table toolbar %s',
      async (_, count) => {
        mocks.matters.mockReturnValue(query(matters(count)));
        const { user } = render(<MattersSection organizationId="org-1" />);

        const create = createButton('Create matter');
        expectInToolbar(screen.getByRole('table', { name: 'Matters' }), [
          screen.getByPlaceholderText('Search matters'),
          screen.getByRole('button', { name: 'Filter' }),
          create,
        ]);
        expect(
          screen.queryByRole('dialog', { name: 'Create matter dialog' }),
        ).toBeNull();

        await user.click(create);

        expect(
          screen.getByRole('dialog', { name: 'Create matter dialog' }),
        ).toBeInTheDocument();
      },
    );
  });

  describe('Active holds', () => {
    it('shows one window of holds and closes on the count footer', () => {
      mocks.holds.mockReturnValue(query(holds(MANY)));
      render(<ActiveHoldsSection organizationId="org-1" />);

      expect(screen.getAllByText(/^Hold \d+$/)).toHaveLength(
        DEFAULT_LIST_PAGE_SIZE,
      );
      expect(
        screen.getByText(`Showing ${DEFAULT_LIST_PAGE_SIZE} of ${MANY} holds`),
      ).toBeInTheDocument();
    });

    it.each([
      ['with holds', 1],
      ['when empty', 0],
    ])(
      'keeps search, the target filter and Place legal hold in the table toolbar %s',
      async (_, count) => {
        mocks.holds.mockReturnValue(query(holds(count)));
        const { user } = render(<ActiveHoldsSection organizationId="org-1" />);

        const place = createButton('Place legal hold');
        expectInToolbar(screen.getByRole('table', { name: 'Active holds' }), [
          screen.getByPlaceholderText('Search holds'),
          screen.getByRole('button', { name: 'Filter' }),
          place,
        ]);
        expect(
          screen.queryByRole('dialog', { name: 'Place hold dialog' }),
        ).toBeNull();

        await user.click(place);

        expect(
          screen.getByRole('dialog', { name: 'Place hold dialog' }),
        ).toBeInTheDocument();
      },
    );
  });

  describe.each([
    ['pending', 'Pending approval', 'Search pending requests'],
    ['approved', 'Approved (awaiting cooldown)', 'Search approved requests'],
  ] as const)('%s release requests', (bucket, name, placeholder) => {
    it('shows one window of requests under a search in the table toolbar', () => {
      const full = query(requests(MANY, bucket));
      const empty = query([]);
      mocks.requests.mockImplementation((_organizationId, status) =>
        status === bucket ? full : empty,
      );
      render(<ReleaseRequestsSection organizationId="org-1" />);

      const region = within(screen.getByRole('region', { name }));
      expectInToolbar(region.getByRole('table', { name }), [
        region.getByPlaceholderText(placeholder),
      ]);
      expect(region.getAllByText(/^target-\d+$/)).toHaveLength(
        DEFAULT_LIST_PAGE_SIZE,
      );
      expect(
        region.getByText(
          `Showing ${DEFAULT_LIST_PAGE_SIZE} of ${MANY} release requests`,
        ),
      ).toBeInTheDocument();
    });
  });

  describe('Release history', () => {
    it('keeps the status filter in the table toolbar and names a short history whole', () => {
      mocks.history.mockReturnValue(history(requests(3, 'effected')));
      render(<ReleaseHistorySection organizationId="org-1" />);

      expectInToolbar(screen.getByRole('table', { name: 'Release history' }), [
        screen.getByRole('button', { name: 'Filter' }),
      ]);
      expect(screen.getByText('Showing all 3 releases')).toBeInTheDocument();
    });

    it('shows one window of a longer history before loading more', () => {
      mocks.history.mockReturnValue(history(requests(MANY, 'effected')));
      render(<ReleaseHistorySection organizationId="org-1" />);

      expect(screen.getAllByText(/^target-\d+$/)).toHaveLength(
        DEFAULT_LIST_PAGE_SIZE,
      );
      expect(
        screen.getByText(
          `Showing ${DEFAULT_LIST_PAGE_SIZE} of ${MANY} releases`,
        ),
      ).toBeInTheDocument();
    });
  });
});
