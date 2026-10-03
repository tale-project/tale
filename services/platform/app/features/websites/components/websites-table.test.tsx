// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

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
  useLocation: () => ({ pathname: '/dashboard/test-org/websites' }),
}));

vi.mock('../hooks/mutations', () => ({
  useSyncWebsiteStatuses: () => ({ mutate: vi.fn() }),
  useCreateWebsite: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteWebsite: () => ({ mutateAsync: vi.fn() }),
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
    pageSize: 10,
  }),
}));

vi.mock('./website-view-dialog', () => ({
  WebsiteViewDialog: () => null,
}));

vi.mock('./websites-action-menu', () => ({
  WebsitesActionMenu: () => <div data-testid="websites-action-menu" />,
}));

vi.mock('./website-search-notice', () => ({
  WebsiteSearchNotice: () => <div data-testid="website-search-notice" />,
}));

import { WebsitesTable } from './websites-table';

describe('WebsitesTable', () => {
  it('stacks the search notice above the table inside the list frame', () => {
    render(<WebsitesTable organizationId="test-org-id" />);
    const notice = screen.getByTestId('website-search-notice');
    const table = screen.getByRole('table');
    expect(
      notice.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // One flex column holds both, so the table keeps the height that is left.
    expect(notice.parentElement).toHaveClass('flex', 'min-h-0', 'flex-col');
    expect(notice.parentElement).toContainElement(table);
  });

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
