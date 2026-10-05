// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, useMutation } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import deMessages from '@/messages/de.yml';
import enMessages from '@/messages/en.yml';
import frMessages from '@/messages/fr.yml';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

const { locale } = vi.hoisted(() => ({
  locale: { value: 'en' as 'en' | 'de' | 'fr' },
}));
const catalogs = { en: enMessages, de: deMessages, fr: frMessages };

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (ns === 'websites') {
        const copy = catalogs[locale.value].websites.syncError;
        if (key === 'syncError.title') return copy.title;
        if (key === 'syncError.description') return copy.description;
        if (key === 'syncError.retry') return copy.retry;
      }
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

const { syncStatuses } = vi.hoisted(() => ({
  syncStatuses: vi.fn<(args: { organizationId: string }) => Promise<void>>(),
}));

let queryClient: QueryClient;

vi.mock('../hooks/mutations', () => ({
  useSyncWebsiteStatuses: () =>
    useMutation({ mutationFn: syncStatuses }, queryClient),
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
  beforeEach(() => {
    queryClient = new QueryClient();
    locale.value = 'en';
    sessionStorage.clear();
    syncStatuses.mockReset().mockResolvedValue(undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries on remount within five minutes after the first sync rejects', async () => {
    syncStatuses.mockRejectedValueOnce(new Error('Unavailable'));
    const first = render(<WebsitesTable organizationId="org-sync" />);
    await waitFor(() => expect(syncStatuses).toHaveBeenCalledTimes(1));
    await act(async () => {});
    first.unmount();

    render(<WebsitesTable organizationId="org-sync" />);
    await waitFor(() => expect(syncStatuses).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(sessionStorage.getItem('websites-sync-org-sync')).toBe(
        String(Date.now()),
      ),
    );
  });

  it('records completion time only after success and throttles successful remounts', async () => {
    let finishSync: (() => void) | undefined;
    syncStatuses.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSync = resolve;
        }),
    );
    const first = render(<WebsitesTable organizationId="org-sync" />);
    await waitFor(() => expect(syncStatuses).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('websites-sync-org-sync')).toBeNull();
    first.unmount();
    vi.mocked(Date.now).mockReturnValue(1_800_000_010_000);
    await act(async () => finishSync?.());
    expect(sessionStorage.getItem('websites-sync-org-sync')).toBe(
      String(Date.now()),
    );

    const second = render(<WebsitesTable organizationId="org-sync" />);
    await act(async () => {});
    expect(syncStatuses).toHaveBeenCalledTimes(1);
    second.unmount();

    vi.mocked(Date.now).mockReturnValue(1_800_000_310_000);
    render(<WebsitesTable organizationId="org-sync" />);
    await waitFor(() => expect(syncStatuses).toHaveBeenCalledTimes(2));
  });

  it('keeps a retryable alert until Retry succeeds and prevents duplicate retries', async () => {
    syncStatuses.mockRejectedValueOnce(new Error('Unavailable'));
    render(<WebsitesTable organizationId="org-sync" />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(enMessages.websites.syncError.description);
    let finishRetry: (() => void) | undefined;
    syncStatuses.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRetry = resolve;
        }),
    );
    const retry = screen.getByRole('button', {
      name: enMessages.websites.syncError.retry,
    });
    fireEvent.click(retry);
    await waitFor(() => expect(retry).toBeDisabled());
    fireEvent.click(retry);
    expect(syncStatuses).toHaveBeenCalledTimes(2);
    expect(alert).toBeInTheDocument();
    expect(sessionStorage.getItem('websites-sync-org-sync')).toBeNull();
    await act(async () => finishRetry?.());
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    expect(sessionStorage.getItem('websites-sync-org-sync')).toBe(
      String(Date.now()),
    );
  });

  it('clears an expired timestamp on failure without touching another organization', async () => {
    sessionStorage.setItem(
      'websites-sync-org-sync',
      String(Date.now() - 300_000),
    );
    sessionStorage.setItem('websites-sync-other-org', String(Date.now()));
    syncStatuses.mockRejectedValueOnce(new Error('Unavailable'));
    const view = render(<WebsitesTable organizationId="org-sync" />);
    await screen.findByRole('alert');
    expect(sessionStorage.getItem('websites-sync-org-sync')).toBeNull();
    expect(sessionStorage.getItem('websites-sync-other-org')).toBe(
      String(Date.now()),
    );
    view.rerender(<WebsitesTable organizationId="other-org" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(syncStatuses).toHaveBeenCalledTimes(1);
  });

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
    it.each(['en', 'de', 'fr'] as const)(
      'shows an accessible, localized retry error in %s',
      async (language) => {
        locale.value = language;
        syncStatuses.mockRejectedValueOnce(new Error('Unavailable'));
        const { container, user } = render(
          <WebsitesTable organizationId="org-sync" />,
        );
        const alert = await screen.findByRole('alert');
        const copy = catalogs[language].websites.syncError;
        expect(alert).toHaveTextContent(copy.title);
        expect(alert).toHaveTextContent(copy.description);
        const retry = screen.getByRole('button', { name: copy.retry });
        await checkAccessibility(container, {
          rules: { 'aria-allowed-attr': { enabled: false } },
        });
        retry.focus();
        await user.keyboard('{Enter}');
        await waitFor(() =>
          expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
        );
        expect(syncStatuses).toHaveBeenCalledTimes(2);
      },
    );

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
