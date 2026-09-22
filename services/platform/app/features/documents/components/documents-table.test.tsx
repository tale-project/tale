// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

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
}));

vi.mock('../hooks/queries', () => ({
  useApproxDocumentCount: () => ({ data: 0 }),
  useFolder: () => ({ data: null }),
  useFolders: () => ({ data: [] }),
  useListDocumentsPaginated: () => ({
    results: [],
    status: paginatedMock.status,
    loadMore: paginatedMock.loadMore,
    isLoading: false,
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
    paginatedMock.status = 'CanLoadMore';
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
