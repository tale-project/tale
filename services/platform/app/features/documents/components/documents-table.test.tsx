// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'test-org-id' }),
  Link: ({
    children,
    to,
  }: {
    children: React.ReactNode;
    to: string;
    [key: string]: unknown;
  }) => <a href={to}>{children}</a>,
  useLocation: () => ({ pathname: '/dashboard/test-org/documents' }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ prefetchQuery: vi.fn() }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@tale/ui/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));

// The Teams filter lists the org's team directory (every team by name) and
// expands "My teams" from the viewer's own memberships.
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useTeams: () => ({ teams: [], isLoading: false }),
  useTeamNames: () => ({
    teams: [],
    nameOf: () => undefined,
    isLoading: false,
  }),
}));

const paginatedMock = vi.hoisted(() => ({
  loadMore: vi.fn(),
  status: 'CanLoadMore' as string,
  results: [] as unknown[],
  error: null as Error | null,
  retry: vi.fn(),
  errorCount: 0,
}));

vi.mock('../hooks/queries', () => ({
  useApproxDocumentCount: () => ({ data: 0 }),
  useFolder: () => ({ data: null }),
  useFolders: () => ({ data: [] }),
  useListDocumentsPaginated: () => ({
    results: paginatedMock.results,
    status: paginatedMock.status,
    loadMore: paginatedMock.loadMore,
    isLoading: false,
    error: paginatedMock.error,
    retry: paginatedMock.retry,
    isRetrying: false,
    errorCount: paginatedMock.errorCount,
  }),
}));

vi.mock('../hooks/use-documents-table-config', () => ({
  useDocumentsTableConfig: () => ({
    columns: [],
    pageSize: 20,
    searchPlaceholder: 'Search documents',
  }),
}));

vi.mock('./documents-action-menu', () => ({
  DocumentsActionMenu: () => <div data-testid="documents-action-menu" />,
}));

vi.mock('./document-preview-dialog', () => ({
  DocumentPreviewDialog: () => null,
}));

vi.mock('./breadcrumb-navigation', () => ({
  BreadcrumbNavigation: () => <nav data-testid="breadcrumb" />,
}));

import { DocumentsTable } from './documents-table';

describe('DocumentsTable', () => {
  beforeEach(() => {
    paginatedMock.loadMore.mockClear();
    paginatedMock.retry.mockClear();
    paginatedMock.status = 'CanLoadMore';
    paginatedMock.results = [];
    paginatedMock.error = null;
    paginatedMock.errorCount = 0;
  });

  // Search/filters run client-side over loaded pages only; without this the
  // first matching document past page 1 reads as "no results".
  describe('eager pagination while searching', () => {
    it('loads remaining pages when a search query is active', () => {
      render(
        <DocumentsTable organizationId="test-org-id" searchQuery="contract" />,
      );
      expect(paginatedMock.loadMore).toHaveBeenCalled();
    });

    it('does not force-load pages without a search or filter', () => {
      render(<DocumentsTable organizationId="test-org-id" />);
      expect(paginatedMock.loadMore).not.toHaveBeenCalled();
    });

    it('stops loading once pages are exhausted', () => {
      paginatedMock.status = 'Exhausted';
      render(
        <DocumentsTable organizationId="test-org-id" searchQuery="contract" />,
      );
      expect(paginatedMock.loadMore).not.toHaveBeenCalled();
    });
  });

  // #3777's sibling in the same library: rows a failed page or refresh left
  // on screen stay, the failure is named above them, and a search does not
  // re-issue the failed page.
  it('names a failed read above the rows it keeps, and retries from the list', async () => {
    paginatedMock.results = [
      { id: 'doc-1', name: 'Contract.pdf', type: 'file', lastModified: 0 },
    ];
    paginatedMock.error = new Error('next page failed');
    paginatedMock.errorCount = 1;
    const { user } = render(
      <DocumentsTable organizationId="test-org-id" searchQuery="contract" />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('documents.refreshFailed');
    await user.click(
      within(alert).getByRole('button', { name: 'common.actions.tryAgain' }),
    );
    expect(paginatedMock.retry).toHaveBeenCalledTimes(1);
    // The alert that held focus goes once the read answers: focus waits on
    // the list instead.
    expect(
      screen.getByRole('region', { name: 'knowledge.documents' }),
    ).toHaveFocus();
  });

  // #3814 review: a refresh that fails again must not re-create a focused
  // Try again; the failure is announced again inside the same alert.
  it('keeps a focused Try again through another failure', () => {
    paginatedMock.results = [
      { id: 'doc-1', name: 'Contract.pdf', type: 'file', lastModified: 0 },
    ];
    paginatedMock.error = new Error('refresh failed');
    paginatedMock.errorCount = 1;
    const { rerender } = render(
      <DocumentsTable organizationId="test-org-id" />,
    );
    const retry = within(screen.getByRole('alert')).getByRole('button', {
      name: 'common.actions.tryAgain',
    });
    retry.focus();

    paginatedMock.error = new Error('refresh failed again');
    paginatedMock.errorCount = 2;
    rerender(<DocumentsTable organizationId="test-org-id" />);

    expect(
      within(screen.getByRole('alert')).getByRole('button', {
        name: 'common.actions.tryAgain',
      }),
    ).toBe(retry);
    expect(retry).toHaveFocus();
  });

  it('renders the fixed frame every overview list uses', () => {
    // The knowledge side of the same contract Projects and Automations now
    // hold: the table owns the scrollport, the page shell never grows.
    render(<DocumentsTable organizationId="test-org-id" />);

    expect(screen.getByTestId('data-table-scrollport')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <DocumentsTable organizationId="test-org-id" />,
      );
      // aria-allowed-attr disabled: Radix UI popover trigger renders a <div>
      // with aria-haspopup which axe flags — upstream issue, not component code.
      await checkAccessibility(container, {
        rules: { 'aria-allowed-attr': { enabled: false } },
      });
    });

    it('gives the table an sr-only caption (#1980)', () => {
      const { container } = render(
        <DocumentsTable organizationId="test-org-id" />,
      );
      const caption = container.querySelector('caption');
      expect(caption).not.toBeNull();
      expect(caption).toHaveTextContent('documents.tableCaption');
    });
  });
});
