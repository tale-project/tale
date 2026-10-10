import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { i18n } from '@/lib/i18n/i18n';
import { forgetSavedLocale } from '@/tests/utils/lapsed-session';
import { render, screen } from '@/tests/utils/render';

import { RetentionPendingBanner } from './retention-pending-banner';

const { query } = vi.hoisted(() => ({
  query: {
    data: undefined as
      | ReturnsOf<'governance/queries:getPendingRetentionChange'>
      | undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null as Error | null,
    errorUpdateCount: 0,
    refetch: vi.fn(),
  },
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => query,
}));

const pending = {
  _id: 'pending-1',
  appliesAt: Date.now() + 3 * 24 * 60 * 60 * 1000,
  summary: 'Documents: 90 days → 30 days',
  requestedBy: 'admin-1',
  requestedAt: Date.now(),
};
const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient();
  clients.push(client);
  const banner = () => (
    <QueryClientProvider client={client}>
      <RetentionPendingBanner organizationId="org-1" />
    </QueryClientProvider>
  );
  return { banner, ...render(banner()) };
}
function fail() {
  query.isError = true;
  query.error = new BackendApiError(503, 'Controlled failure');
  query.errorUpdateCount += 1;
}
beforeEach(() => {
  query.data = undefined;
  query.isLoading = false;
  query.isError = false;
  query.isFetching = false;
  query.error = null;
  query.errorUpdateCount = 0;
  query.refetch.mockReset();
});
afterEach(async () => {
  for (const client of clients) client.clear();
  clients.length = 0;
  await forgetSavedLocale();
});

describe('RetentionPendingBanner read states', () => {
  it('renders nothing for a successful null answer', () => {
    query.data = null;
    expect(mount().container).toBeEmptyDOMElement();
  });
  it('does not invent an error while the initial read is loading', () => {
    query.isLoading = true;
    expect(mount().container).toBeEmptyDOMElement();
  });
  it('shows healthy pending details and Cancel without a retry', () => {
    query.data = pending;
    mount();
    expect(screen.getByRole('alert')).toHaveTextContent(pending.summary);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
  it.each([
    {
      locale: 'en',
      message: "Couldn't load the pending retention change.",
      retry: 'Try again',
    },
    {
      locale: 'de',
      message:
        'Die ausstehende Aufbewahrungsänderung konnte nicht geladen werden.',
      retry: 'Erneut versuchen',
    },
    {
      locale: 'fr',
      message: 'Impossible de charger le changement de rétention en attente.',
      retry: 'Réessayer',
    },
  ])(
    'reports a failed first read and retries in $locale',
    async ({ locale, message, retry }) => {
      localStorage.setItem('user-locale', locale);
      await i18n.changeLanguage(locale);
      fail();
      const { user } = mount();
      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(screen.getByRole('alert')).toHaveAttribute(
        'data-variant',
        'destructive',
      );
      expect(screen.getByRole('alert')).not.toHaveTextContent(
        'Controlled failure',
      );
      await user.click(screen.getByRole('button', { name: retry }));
      expect(query.refetch).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps the first failure and retry focus until a null recovery', async () => {
    fail();
    const { banner, rerender, user, container } = mount();
    const retry = screen.getByRole('button', { name: 'Try again' });
    await user.click(retry);
    query.isError = false;
    query.isLoading = true;
    query.isFetching = true;
    rerender(banner());
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the pending retention change.",
    );
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(retry).toHaveFocus();
    await user.click(retry);
    expect(query.refetch).toHaveBeenCalledTimes(1);
    query.isLoading = false;
    query.isFetching = false;
    query.data = null;
    rerender(banner());
    expect(container).toBeEmptyDOMElement();
  });
  it('preserves cached pending details and Cancel when a refresh fails', async () => {
    query.data = pending;
    const { banner, rerender, user } = mount();
    fail();
    rerender(banner());
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent(
      "Couldn't refresh the pending retention change. Previously loaded information may be out of date.",
    );
    expect(screen.getByText(/Documents: 90 days/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
    query.isError = false;
    rerender(banner());
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
  it('reports a failed refresh of a cached null', () => {
    query.data = null;
    fail();
    mount();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't refresh the pending retention change.",
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});
