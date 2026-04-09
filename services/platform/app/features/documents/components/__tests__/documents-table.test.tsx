// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

vi.mock('@/lib/i18n/client', () => ({
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

vi.mock('@/app/hooks/use-team-filter', () => ({
  useTeamFilter: () => ({ teams: [], selectedTeamId: undefined }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@/app/hooks/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useTeams: () => ({ teams: [], isLoading: false }),
}));

vi.mock('../../hooks/queries', () => ({
  useApproxDocumentCount: () => ({ data: 0 }),
  useFolder: () => ({ data: null }),
  useFolders: () => ({ data: [] }),
  useListDocumentsPaginated: () => ({
    results: [],
    status: 'success',
    loadMore: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock('../../hooks/use-documents-table-config', () => ({
  useDocumentsTableConfig: () => ({
    columns: [],
    stickyLayout: undefined,
    pageSize: 20,
    searchPlaceholder: 'Search documents',
  }),
}));

vi.mock('../documents-action-menu', () => ({
  DocumentsActionMenu: () => <div data-testid="documents-action-menu" />,
}));

vi.mock('../document-preview-dialog', () => ({
  DocumentPreviewDialog: () => null,
}));

vi.mock('../breadcrumb-navigation', () => ({
  BreadcrumbNavigation: () => <nav data-testid="breadcrumb" />,
}));

import { DocumentsTable } from '../documents-table';

describe('DocumentsTable', () => {
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
  });
});
