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
  useLocation: () => ({ pathname: '/dashboard/test-org/websites' }),
}));

vi.mock('../hooks/mutations', () => ({
  useSyncWebsiteStatuses: () => ({ mutate: vi.fn() }),
  useCreateWebsite: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/queries', () => ({
  useApproxWebsiteCount: () => ({ data: 0 }),
  useListWebsitesPaginated: () => ({
    results: [],
    status: 'success',
    loadMore: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock('../hooks/use-websites-table-config', () => ({
  useWebsitesTableConfig: () => ({
    columns: [],
    searchPlaceholder: 'Search websites',
    stickyLayout: undefined,
    pageSize: 10,
  }),
}));

vi.mock('./website-view-dialog', () => ({
  ViewWebsiteDialog: () => null,
}));

vi.mock('./websites-action-menu', () => ({
  WebsitesActionMenu: () => <div data-testid="websites-action-menu" />,
}));

import { WebsitesTable } from './websites-table';

describe('WebsitesTable', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <WebsitesTable organizationId="test-org-id" />,
      );
      // aria-allowed-attr disabled: Radix UI popover trigger renders a <div>
      // with aria-haspopup which axe flags — upstream issue, not component code.
      await checkAccessibility(container, {
        rules: { 'aria-allowed-attr': { enabled: false } },
      });
    });
  });
});
