import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import {
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { KnowledgeEntriesTable } from './knowledge-entries-table';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #3777: a knowledge list whose read failed said "No knowledge entries yet".
// The whole read lane runs for real here — the paginated hook, the adapter
// row, `backendFetch` and the read retry policy (four attempts for a fault)
// — against a closed synthetic transport that fails exactly the read under
// test, so the same mounted table can be watched failing and recovering.

vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useSessionUser: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
// The badge reads and retries indexing through its own doors.
vi.mock('@/app/features/documents/components/rag-status-badge', () => ({
  RagStatusBadge: () => null,
}));

const LIST = /^GET \/api\/app\/knowledge-entries\?limit=20&orgId=org-1$/;
const NEXT_PAGE = /^GET \/api\/app\/knowledge-entries\?limit=20&cursor=/;
const ANY_PAGE = /^GET \/api\/app\/knowledge-entries\?limit=/;

/** 34 synthetic entries, newest first, as the door pages them (20 + 14). */
const ENTRIES = Array.from({ length: 34 }, (_, index) => {
  const n = String(34 - index).padStart(2, '0');
  return {
    id: `entry-${n}`,
    topic: `Synthetic fact ${n}`,
    content: `Synthetic content number ${n}.`,
    source: 'manual',
    documentId: `doc-${n}`,
    createdBy: 'user-1',
    createdAt: 1789450000000 + index,
  };
});

function pagedEntries(rows: readonly (typeof ENTRIES)[number][]) {
  return (url: URL) => {
    const cursor = Number(url.searchParams.get('cursor') ?? 0);
    const page = rows.slice(cursor, cursor + 20);
    const next = cursor + 20 < rows.length ? cursor + 20 : null;
    return Response.json({ rows: page, nextCursor: next });
  };
}

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/knowledge-entries');
  backend = syntheticBackend();
  backend.on(/\/knowledge-entries\/count/, () =>
    Response.json({ count: ENTRIES.length }),
  );
  // No backoff between the policy's attempts; the attempt count is real.
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderTable() {
  return render(
    <QueryClientProvider client={client}>
      <KnowledgeEntriesTable organizationId="org-1" />
    </QueryClientProvider>,
  );
}

const t = (key: string, ns = 'knowledgeEntries') => i18n.t(key, { ns });
const emptyTitle = () => t('knowledgeEntries.title', 'emptyStates');
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });

/** Type a query into the list's search in one input event (a pasted
 * query), so each test re-renders the table once per query, not per key. */
async function search(
  user: ReturnType<typeof renderTable>['user'],
  query: string,
) {
  await user.click(
    screen.getByRole('textbox', { name: t('searchPlaceholder') }),
  );
  await user.paste(query);
}

// These run the real retry policy through a 34-row table, several times
// over; they need more than the default five seconds on a loaded runner.
describe(
  'KnowledgeEntriesTable when its read fails',
  { timeout: 30_000 },
  () => {
    it('shows a failed first page as a failure with a retry, never as an empty library', async () => {
      backend.on(ANY_PAGE, () => serviceUnavailable());
      const { user } = renderTable();

      const retry = await screen.findByRole(
        'button',
        { name: i18n.t('errors.tryAgain', { ns: 'common' }) },
        { timeout: 5000 },
      );
      // The policy's four attempts, then the error state — not the empty one.
      expect(backend.count(LIST)).toBe(4);
      expect(screen.queryByText(emptyTitle())).not.toBeInTheDocument();

      // The same mounted table recovers on Retry, with no reload.
      backend.on(ANY_PAGE, pagedEntries(ENTRIES));
      await user.click(retry);
      expect(await screen.findByText('Synthetic fact 34')).toBeInTheDocument();
      expect(screen.queryByText(emptyTitle())).not.toBeInTheDocument();
    });

    it('keeps the empty state for a library that is really empty', async () => {
      backend.on(ANY_PAGE, () => Response.json({ rows: [], nextCursor: null }));
      renderTable();

      expect(await screen.findByText(emptyTitle())).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('keeps loaded rows, search and selection through a failed refresh, and recovers on Retry', async () => {
      backend.on(ANY_PAGE, pagedEntries(ENTRIES));
      const { user } = renderTable();
      await screen.findByText('Synthetic fact 34');

      // Narrow the list and pick a row before the refresh fails.
      await search(user, 'fact 3');
      await screen.findByText('Synthetic fact 30');
      const row = screen.getByText('Synthetic fact 33').closest('tr');
      await user.click(within(row as HTMLElement).getByRole('checkbox'));

      // A background refresh (an edit elsewhere, the hint stream) fails.
      const before = backend.count(LIST);
      backend.on(ANY_PAGE, () => serviceUnavailable());
      void client.invalidateQueries();
      const alert = await screen.findByRole('alert');
      expect(backend.count(LIST)).toBe(before + 4);
      expect(alert).toHaveTextContent(t('refreshFailed'));
      expect(screen.getByText('Synthetic fact 33')).toBeInTheDocument();
      expect(
        screen.getByRole('textbox', { name: t('searchPlaceholder') }),
      ).toHaveValue('fact 3');

      // Retry refreshes the same rows; the query and the selection stay.
      backend.on(ANY_PAGE, pagedEntries(ENTRIES));
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      );
      expect(
        screen.getByRole('textbox', { name: t('searchPlaceholder') }),
      ).toHaveValue('fact 3');
      const kept = screen.getByText('Synthetic fact 33').closest('tr');
      expect(within(kept as HTMLElement).getByRole('checkbox')).toBeChecked();
    });

    it('stops a search at a failed page instead of re-requesting it, and resumes from that page', async () => {
      backend.on(ANY_PAGE, pagedEntries(ENTRIES));
      backend.on(NEXT_PAGE, () => serviceUnavailable());
      const { user } = renderTable();
      await screen.findByText('Synthetic fact 34');

      // "Synthetic fact 01" is on the second page: the search drains to it.
      await search(user, 'fact 01');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(t('refreshFailed'));
      // One policy run of four attempts — not a loop that re-issues the page
      // on every render while the search is active.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(backend.count(NEXT_PAGE)).toBe(4);
      // Nothing is loading any more, so no skeleton stands in for the answer,
      // and the table says it searched only what loaded.
      expect(
        screen.getByText(i18n.t('search.noLoadedResults', { ns: 'common' })),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(i18n.t('search.noResults', { ns: 'common' })),
      ).not.toBeInTheDocument();

      backend.on(NEXT_PAGE, pagedEntries(ENTRIES));
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));
      expect(await screen.findByText('Synthetic fact 01')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(
        screen.getByRole('textbox', { name: t('searchPlaceholder') }),
      ).toHaveValue('fact 01');
      // The retry fetched the failed page once, not the whole list again.
      expect(backend.count(NEXT_PAGE)).toBe(5);
    });

    it('says the rest could not be loaded, not "scroll for more", once a page fails', async () => {
      backend.on(ANY_PAGE, pagedEntries(ENTRIES));
      backend.on(NEXT_PAGE, () => serviceUnavailable());
      const { user } = renderTable();
      await screen.findByText('Synthetic fact 34');

      // Every loaded row matches, so the search drains into the failed page.
      await search(user, 'Synthetic');
      await screen.findByRole('alert');
      expect(
        screen.getByText(
          i18n.t('pagination.showingLoadedFailed', {
            ns: 'common',
            count: 20,
            entityOne: t('entityLabelOne'),
            entityOther: t('title').toLowerCase(),
          }),
        ),
      ).toBeInTheDocument();
      expect(backend.count(NEXT_PAGE)).toBe(4);
    });

    // #3814 review: a refresh that failed again re-created the notice, and
    // a Try again the reader had focused lost its focus.
    it('keeps a focused Try again focused through another failed refresh, and hands focus to the list once it heals', async () => {
      backend.on(ANY_PAGE, pagedEntries(ENTRIES));
      renderTable();
      await screen.findByText('Synthetic fact 34');
      backend.on(ANY_PAGE, () => serviceUnavailable());
      void client.invalidateQueries();
      const alert = await screen.findByRole('alert');
      const retry = within(alert).getByRole('button', { name: tryAgain() });
      retry.focus();

      const before = backend.count(LIST);
      void client.invalidateQueries();
      await waitFor(() => expect(backend.count(LIST)).toBe(before + 4));
      await waitFor(() =>
        expect(
          within(alert).getByRole('button', { name: tryAgain() }),
        ).not.toHaveAttribute('aria-busy'),
      );
      expect(screen.getByRole('alert')).toBe(alert);
      expect(within(alert).getByRole('button', { name: tryAgain() })).toBe(
        retry,
      );
      expect(retry).toHaveFocus();

      backend.on(ANY_PAGE, pagedEntries(ENTRIES));
      void client.invalidateQueries();
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(screen.getByRole('region', { name: t('title') })).toHaveFocus(),
      );
    });

    describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
      it('names a failed refresh and its retry in the reader language', async () => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        backend.on(ANY_PAGE, pagedEntries(ENTRIES));
        renderTable();
        await screen.findByText('Synthetic fact 34');

        backend.on(ANY_PAGE, () => serviceUnavailable());
        void client.invalidateQueries();
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(t('refreshFailed'));
        expect(
          within(alert).getByRole('button', { name: tryAgain() }),
        ).toBeInTheDocument();
        expect(t('refreshFailed')).not.toBe('refreshFailed');
      });
    });
  },
);
