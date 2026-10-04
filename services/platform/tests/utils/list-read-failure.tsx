import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
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

/** One paginated collection screen, as `describeListReadFailure` drives it. */
interface ListReadFailureCase {
  /** The list's message namespace: its `title` names the list region, its
   * `refreshFailed` the notice above rows a failed refresh left. */
  namespace: string;
  /** The `emptyStates` key of the list's empty-state title. */
  emptyTitleKey: string;
  /** The page the list lives on; the adapters read the organization from it. */
  path: string;
  /** The first page's read, as `METHOD /path?query`. */
  firstPage: RegExp;
  /** Every page's read, first or later. */
  anyPage: RegExp;
  /** A healthy page holding `rowText`, and a healthy empty collection. */
  rows: (url: URL) => Response;
  empty: (url: URL) => Response;
  rowText: string;
  /** The other doors the screen reads (its count), answered healthy. */
  routes?: (backend: SyntheticBackend) => void;
  render: () => ReactElement;
}

/**
 * A paginated list whose read fails, through the real paginated hook, its
 * adapter row, `backendFetch` and the read retry policy (four attempts for a
 * fault) against a closed synthetic transport — the same mounted screen can
 * be watched failing and recovering. With nothing loaded the failure is the
 * table's error state, never the collection's empty state; rows already on
 * screen stay under a notice; either **Try again** hands its focus to the
 * list region rather than to the page (#3843, after #3777).
 */
export function describeListReadFailure(
  name: string,
  list: ListReadFailureCase,
) {
  // The real retry policy makes four attempts before a failure settles; on a
  // loaded runner that outlasts the default one-second wait.
  configure({ asyncUtilTimeout: 10_000 });

  describe(`${name} when its read fails`, { timeout: 30_000 }, () => {
    let backend: SyntheticBackend;
    let client: QueryClient;

    beforeEach(() => {
      window.history.replaceState({}, '', list.path);
      backend = syntheticBackend();
      list.routes?.(backend);
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

    function renderList() {
      return render(
        <QueryClientProvider client={client}>
          {list.render()}
        </QueryClientProvider>,
      );
    }

    const t = (key: string) => i18n.t(key, { ns: list.namespace });
    const emptyTitle = () => i18n.t(list.emptyTitleKey, { ns: 'emptyStates' });
    const region = () => screen.getByRole('region', { name: t('title') });
    /** The table's error state's retry, once the policy has given up. */
    const errorRetry = () =>
      screen.findByRole(
        'button',
        { name: i18n.t('errors.tryAgain', { ns: 'common' }) },
        { timeout: 5000 },
      );
    const noticeRetry = (alert: HTMLElement) =>
      within(alert).getByRole('button', {
        name: i18n.t('actions.tryAgain', { ns: 'common' }),
      });
    const fail = () => backend.on(list.anyPage, () => serviceUnavailable());
    const heal = () => backend.on(list.anyPage, list.rows);

    it('shows a failed first page as a failure with a retry, never as an empty collection, and recovers from the keyboard', async () => {
      fail();
      const { user } = renderList();

      const retry = await errorRetry();
      // The policy's four attempts, then the error state — not the empty one.
      expect(backend.count(list.firstPage)).toBe(4);
      expect(screen.queryByText(emptyTitle())).not.toBeInTheDocument();

      // The same mounted list recovers on Retry, with no reload. The retry
      // takes its own button away; the focus goes to the list, not the page.
      heal();
      retry.focus();
      await user.keyboard('{Enter}');
      expect(region()).toHaveFocus();
      expect(await screen.findByText(list.rowText)).toBeInTheDocument();
      expect(screen.queryByText(emptyTitle())).not.toBeInTheDocument();
      expect(region()).toHaveFocus();
    });

    it('keeps the focus on the list when a keyboard retry fails again', async () => {
      fail();
      const { user } = renderList();
      (await errorRetry()).focus();

      const before = backend.count(list.firstPage);
      await user.keyboard('{Enter}');
      expect(region()).toHaveFocus();
      await waitFor(() =>
        expect(backend.count(list.firstPage)).toBe(before + 4),
      );
      expect(await errorRetry()).toBeInTheDocument();
      expect(region()).toHaveFocus();
    });

    it('keeps the empty state for a collection that is really empty', async () => {
      backend.on(list.anyPage, list.empty);
      renderList();

      expect(await screen.findByText(emptyTitle())).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('keeps loaded rows through a failed refresh, names the failure with a retry, and recovers', async () => {
      heal();
      const { user } = renderList();
      await screen.findByText(list.rowText);

      // A background refresh (an edit elsewhere, the hint stream) fails.
      const before = backend.count(list.firstPage);
      fail();
      void client.invalidateQueries();
      const alert = await screen.findByRole('alert');
      expect(backend.count(list.firstPage)).toBe(before + 4);
      expect(alert).toHaveTextContent(t('refreshFailed'));
      expect(screen.getByText(list.rowText)).toBeInTheDocument();

      // Retry refreshes the same rows; the notice goes and its focus with it
      // lands on the list.
      heal();
      noticeRetry(alert).focus();
      await user.keyboard('{Enter}');
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      );
      expect(screen.getByText(list.rowText)).toBeInTheDocument();
      expect(region()).toHaveFocus();
    });

    // A refresh the reader did not start re-reads under the notice: failing
    // again keeps its Try again (and the focus on it); healing takes the
    // notice away, and the focus it held goes to the list.
    it('keeps a focused Try again in the notice focused through another failed refresh, and hands its focus to the list once it heals', async () => {
      heal();
      renderList();
      await screen.findByText(list.rowText);
      fail();
      void client.invalidateQueries();
      const alert = await screen.findByRole('alert');
      const retry = noticeRetry(alert);
      retry.focus();

      const before = backend.count(list.firstPage);
      void client.invalidateQueries();
      await waitFor(() =>
        expect(backend.count(list.firstPage)).toBe(before + 4),
      );
      await waitFor(() =>
        expect(noticeRetry(alert)).not.toHaveAttribute('aria-busy'),
      );
      expect(screen.getByRole('alert')).toBe(alert);
      expect(noticeRetry(alert)).toBe(retry);
      expect(retry).toHaveFocus();

      heal();
      void client.invalidateQueries();
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      );
      await waitFor(() => expect(region()).toHaveFocus());
    });

    // With nothing loaded the failure is the table's error state, which a
    // refresh the reader did not start (the tab regaining focus, another
    // session's change) swaps for the loading state.
    it('hands a focused Try again in the error state to the list while a background refresh runs, fails again and heals', async () => {
      fail();
      renderList();
      (await errorRetry()).focus();
      const listRegion = region();

      const before = backend.count(list.firstPage);
      void client.invalidateQueries();
      await waitFor(() => expect(listRegion).toHaveFocus());

      // It fails again: the error state is back, the focus still on the list.
      await waitFor(() =>
        expect(backend.count(list.firstPage)).toBe(before + 4),
      );
      expect(await errorRetry()).toBeInTheDocument();
      expect(listRegion).toHaveFocus();

      heal();
      void client.invalidateQueries();
      expect(await screen.findByText(list.rowText)).toBeInTheDocument();
      expect(listRegion).toHaveFocus();
    });

    it('leaves focus the reader moved away from the error state where it is', async () => {
      fail();
      renderList();
      const retry = await errorRetry();
      const elsewhere = document.createElement('button');
      elsewhere.textContent = 'Elsewhere';
      document.body.append(elsewhere);
      try {
        retry.focus();
        elsewhere.focus();

        const before = backend.count(list.firstPage);
        void client.invalidateQueries();
        await waitFor(() =>
          expect(backend.count(list.firstPage)).toBe(before + 4),
        );
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(elsewhere).toHaveFocus();
      } finally {
        elsewhere.remove();
      }
    });

    describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
      it('names the failure, its retry and the list in the reader language', async () => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        fail();
        renderList();

        expect(await errorRetry()).toBeInTheDocument();
        expect(screen.queryByText(emptyTitle())).not.toBeInTheDocument();
        expect(region()).toBeInTheDocument();

        heal();
        void client.invalidateQueries();
        await screen.findByText(list.rowText);
        fail();
        void client.invalidateQueries();
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(t('refreshFailed'));
        expect(noticeRetry(alert)).toBeInTheDocument();
        // A catalog without the key would show it, or fall back to English.
        expect(t('refreshFailed')).not.toBe('refreshFailed');
        if (locale !== 'en') {
          expect(t('refreshFailed')).not.toBe(
            i18n.t('refreshFailed', { ns: list.namespace, lng: 'en' }),
          );
        }
      });
    });
  });
}
