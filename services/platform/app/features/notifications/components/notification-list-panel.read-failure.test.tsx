// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MouseEventHandler, ReactNode } from 'react';
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

import { NotificationListPanel } from './notification-list-panel';

// #4665: a bell panel whose reads failed said "You're all caught up" on
// Unread and "No notifications yet" on All, with no way to ask again. The
// read lane runs for real — both paginated hooks, their adapter rows,
// `backendFetch` and the read retry policy (four attempts for a fault); only
// `fetch` is answered.

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>(
    '@tanstack/react-router',
  );
  return {
    ...actual,
    Link: ({
      children,
      onClick,
    }: {
      children: ReactNode;
      onClick?: MouseEventHandler<HTMLAnchorElement>;
    }) => (
      <a href="#notification" onClick={onClick}>
        {children}
      </a>
    ),
  };
});

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

const ORG_PAGE = /^GET \/api\/app\/notifications\?limit=25&orgId=org-1$/;
const PERSONAL_PAGE =
  /^GET \/api\/app\/collab\/notifications\?limit=25&orgId=org-1$/;

const orgAlert = {
  id: 'org-credit-request',
  createdAt: 1_770_000_000_000,
  read: false,
  titleKey: 'creditRequestTitle',
  bodyKey: 'creditRequestBody',
  params: { name: 'Robin' },
};
const personalMention = {
  id: 'personal-mention',
  createdAt: 1_770_000_001_000,
  read: false,
  type: 'mention',
  titleKey: 'mention',
  bodyKey: 'mentionBody',
  params: { title: 'Quarterly review' },
};
const ORG_ROW_TITLE = 'Usage credits requested';
const PERSONAL_ROW_TITLE = 'You were mentioned';

const t = (key: string) => i18n.t(key, { ns: 'notifications' });

describe(
  'NotificationListPanel when its reads fail',
  { timeout: 30_000 },
  () => {
    let backend: SyntheticBackend;
    let client: QueryClient;

    beforeEach(() => {
      window.history.replaceState({}, '', '/dashboard/org-1/chat');
      backend = syntheticBackend();
      backend.on(/^GET \/api\/app\/notifications\/unread-count\?/, () =>
        Response.json({ count: 0 }),
      );
      backend.on(/^GET \/api\/app\/collab\/notifications\/unread-count\?/, () =>
        Response.json({ count: 0 }),
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

    function renderPanel() {
      return render(
        <QueryClientProvider client={client}>
          <NotificationListPanel organizationId="org-1" />
        </QueryClientProvider>,
      );
    }

    const failOrg = () => backend.on(ORG_PAGE, () => serviceUnavailable());
    const failPersonal = () =>
      backend.on(PERSONAL_PAGE, () => serviceUnavailable());
    const answerOrg = (items: unknown[]) =>
      backend.on(ORG_PAGE, () => Response.json({ items, nextCursor: null }));
    const answerPersonal = (rows: unknown[]) =>
      backend.on(PERSONAL_PAGE, () =>
        Response.json({ rows, nextCursor: null }),
      );

    /** Both reads asked four times — the retry policy has given up on each. */
    async function bothSettledFailing(attempts = 4) {
      await waitFor(() => {
        expect(backend.count(ORG_PAGE)).toBe(attempts);
        expect(backend.count(PERSONAL_PAGE)).toBe(attempts);
      });
    }

    const region = () =>
      screen.getByRole('region', { name: t('title') as string });
    const tryAgain = (alert: HTMLElement) =>
      within(alert).getByRole('button', {
        name: i18n.t('actions.tryAgain', { ns: 'common' }),
      });

    it('names a failure of both reads with Try again, never "You\'re all caught up", and recovers from the keyboard', async () => {
      failOrg();
      failPersonal();
      const { user } = renderPanel();

      await bothSettledFailing();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(t('loadFailed'));
      expect(
        screen.queryByText(t('emptyCaughtUpTitle')),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(t('loading'))).not.toBeInTheDocument();

      // The same mounted panel recovers on Try again, with no reload; the
      // notice goes, and the focus it held lands on the list.
      answerOrg([orgAlert]);
      answerPersonal([personalMention]);
      tryAgain(alert).focus();
      await user.keyboard('{Enter}');
      expect(await screen.findByText(ORG_ROW_TITLE)).toBeInTheDocument();
      expect(await screen.findByText(PERSONAL_ROW_TITLE)).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      );
      await waitFor(() => expect(region()).toHaveFocus());
    });

    it('says so on All too, never "No notifications yet"', async () => {
      failOrg();
      failPersonal();
      const { user } = renderPanel();
      await user.click(screen.getByRole('tab', { name: t('filterAll') }));

      await bothSettledFailing();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        t('loadFailed'),
      );
      expect(screen.queryByText(t('emptyAllTitle'))).not.toBeInTheDocument();
    });

    it('keeps a focused Try again focused through a retry that fails again', async () => {
      failOrg();
      failPersonal();
      const { user } = renderPanel();
      await bothSettledFailing();
      const alert = await screen.findByRole('alert');
      const retry = tryAgain(alert);
      retry.focus();

      await user.keyboard('{Enter}');
      await bothSettledFailing(8);
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
      expect(screen.getByRole('alert')).toBe(alert);
      expect(tryAgain(alert)).toBe(retry);
      expect(retry).toHaveFocus();
      expect(
        screen.queryByText(t('emptyCaughtUpTitle')),
      ).not.toBeInTheDocument();
    });

    it('shows the personal rows under a notice when only the organization read fails, and Try again asks for that read alone', async () => {
      failOrg();
      answerPersonal([personalMention]);
      const { user } = renderPanel();

      await waitFor(() => expect(backend.count(ORG_PAGE)).toBe(4));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(t('loadPartlyFailed'));
      expect(screen.getByText(PERSONAL_ROW_TITLE)).toBeInTheDocument();
      const personalReads = backend.count(PERSONAL_PAGE);

      answerOrg([orgAlert]);
      await user.click(tryAgain(alert));
      expect(await screen.findByText(ORG_ROW_TITLE)).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      );
      expect(screen.getByText(PERSONAL_ROW_TITLE)).toBeInTheDocument();
      expect(backend.count(PERSONAL_PAGE)).toBe(personalReads);
    });

    it('keeps "You\'re all caught up" for reads that answered empty', async () => {
      answerOrg([]);
      answerPersonal([]);
      renderPanel();

      expect(
        await screen.findByText(t('emptyCaughtUpTitle')),
      ).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
      it('names the failure and its retry in the reader language', async () => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        failOrg();
        answerPersonal([personalMention]);
        renderPanel();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(t('loadPartlyFailed'));
        expect(tryAgain(alert)).toBeInTheDocument();
        expect(region()).toBeInTheDocument();
        // A catalog without the keys would show them, or fall back to English.
        for (const key of ['loadFailed', 'loadPartlyFailed']) {
          expect(t(key)).not.toBe(key);
          if (locale !== 'en') {
            expect(t(key)).not.toBe(
              i18n.t(key, { ns: 'notifications', lng: 'en' }),
            );
          }
        }
      });
    });
  },
);
