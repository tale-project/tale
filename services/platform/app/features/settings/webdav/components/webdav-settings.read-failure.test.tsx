import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import {
  act,
  cleanup,
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

import { WebdavSettings } from './webdav-settings';

/**
 * Settings › API › WebDAV over its real read: `useWebdavAppPasswords`, the
 * adapter row, `backendFetch` and the read retry policy (four attempts for a
 * fault) against a closed synthetic transport. A list read that failed is the
 * table's error state with **Try again**, never skeleton rows that never end,
 * and a failed refresh is named above the passwords it left (#4652).
 */

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ user: { email: 'alex@example.com' } }),
}));

const PASSWORDS = /^GET \/api\/app\/webdav\/app-passwords\?orgId=org-1$/;

function passwordsAnswer(...labels: string[]) {
  return () =>
    Response.json({
      appPasswords: labels.map((label, index) => ({
        _id: `password-${index + 1}`,
        label,
        prefix: `pw0${index + 1}`,
        createdAt: 1_800_000_000_000 - index,
        lastUsedAt: null,
        revokedAt: null,
      })),
    });
}

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/settings/api/webdav');
  backend = syntheticBackend();
  // No backoff between the policy's attempts; the attempt count is real.
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  // Unmount before the language is put back, so no mounted label re-renders
  // outside act.
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

async function renderPage() {
  const view = render(
    <QueryClientProvider client={client}>
      <WebdavSettings
        organizationId="org-1"
        orgSlug="example"
        siteOrigin="https://example.com"
      />
    </QueryClientProvider>,
  );
  // The app shell settles its language once mounted; let that land in act.
  await act(async () => {});
  return view;
}

/** The section the page lists the app-passwords in — where a Try again that
 * gave way hands its focus. */
function passwordsSection(): HTMLElement {
  return screen.getByRole('region', {
    name: i18n.t('list.title', { ns: 'webdav' }),
  });
}

const tryAgain = () => i18n.t('errors.tryAgain', { ns: 'common' });
const emptyTitle = () => i18n.t('list.empty', { ns: 'webdav' });
const refreshFailed = () => i18n.t('list.refreshFailed', { ns: 'webdav' });
/** The table's skeleton is the only part of the page marked busy. */
const busy = () => document.querySelector('[aria-busy="true"]');

/** The table's error state's retry, once the read's policy has given up. */
async function tableRetry(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: tryAgain() });
}

// The Revoke column has an empty header (no `header`), the standard
// data-table pattern `member-table.test.tsx` names too; that is the table's,
// not this read's. Every other rule runs.
const axeOptions = {
  rules: { 'empty-table-header': { enabled: false } },
};

/** The alert that says `message`, once it does. */
async function alertSaying(message: string): Promise<HTMLElement> {
  const alert = (await screen.findByText(message)).closest<HTMLElement>(
    '[role="alert"]',
  );
  if (alert === null) throw new Error(`"${message}" is in no alert`);
  return alert;
}

describe(
  'WebdavSettings when its app-password list read fails',
  { timeout: 30_000 },
  () => {
    it('shows the table’s error state with Try again instead of an endless skeleton, and recovers from the keyboard', async () => {
      backend.on(PASSWORDS, serviceUnavailable);
      const { user } = await renderPage();

      const retry = await tableRetry();
      // Four attempts, then the error state in the list's section: no
      // skeleton rows, no empty state, no table.
      expect(backend.count(PASSWORDS)).toBe(4);
      expect(passwordsSection()).toContainElement(retry);
      expect(busy()).toBeNull();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByText(emptyTitle())).not.toBeInTheDocument();

      backend.on(PASSWORDS, passwordsAnswer('Finance laptop'));
      retry.focus();
      await user.keyboard('{Enter}');

      expect(
        await screen.findByRole('row', { name: /Finance laptop/ }),
      ).toBeInTheDocument();
      expect(backend.count(PASSWORDS)).toBe(5);
      // Try again gave way to the rows: its focus is on the app-password
      // list, not lost to the page.
      await waitFor(() => expect(passwordsSection()).toHaveFocus());
    });

    it('keeps the error state, and the focus on the list, while a retry fails again', async () => {
      backend.on(PASSWORDS, serviceUnavailable);
      const { user } = await renderPage();
      const retry = await tableRetry();

      retry.focus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(backend.count(PASSWORDS)).toBe(8));

      expect(await tableRetry()).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(busy()).toBeNull();
      await waitFor(() => expect(passwordsSection()).toHaveFocus());
    });

    it('keeps the skeleton while the first read is on its way', async () => {
      let answer: (response: Response) => void = () => {};
      backend.on(
        PASSWORDS,
        () => new Promise<Response>((resolve) => (answer = resolve)),
      );
      await renderPage();

      await waitFor(() => expect(backend.count(PASSWORDS)).toBe(1));
      expect(busy()).not.toBeNull();
      expect(
        screen.queryByRole('button', { name: tryAgain() }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(emptyTitle())).not.toBeInTheDocument();

      answer(passwordsAnswer('Finance laptop')());
      expect(
        await screen.findByRole('row', { name: /Finance laptop/ }),
      ).toBeInTheDocument();
      expect(busy()).toBeNull();
    });

    it('says there are no app-passwords only after a read that answered with none', async () => {
      backend.on(PASSWORDS, passwordsAnswer());
      await renderPage();

      expect(await screen.findByText(emptyTitle())).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: tryAgain() }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(busy()).toBeNull();
      expect(backend.count(PASSWORDS)).toBe(1);
    });

    it('keeps the passwords a failed refresh left, revocable, names the failure above them, and heals on Try again', async () => {
      backend.on(PASSWORDS, passwordsAnswer('Finance laptop'));
      const { user } = await renderPage();
      expect(
        await screen.findByRole('row', { name: /Finance laptop/ }),
      ).toBeInTheDocument();

      backend.on(PASSWORDS, serviceUnavailable);
      await act(async () => {
        await client.refetchQueries();
      });
      await waitFor(() => expect(backend.count(PASSWORDS)).toBe(5));

      const alert = await alertSaying(refreshFailed());
      expect(passwordsSection()).toContainElement(alert);
      // The password someone came to revoke is still there to revoke.
      const laptop = screen.getByRole('row', { name: /Finance laptop/ });
      expect(
        within(laptop).getByRole('button', {
          name: i18n.t('list.revoke', { ns: 'webdav' }),
        }),
      ).toBeEnabled();

      backend.on(PASSWORDS, passwordsAnswer('Finance laptop', 'Home NAS'));
      const retry = within(alert).getByRole('button', {
        name: i18n.t('actions.tryAgain', { ns: 'common' }),
      });
      retry.focus();
      await user.keyboard('{Enter}');

      expect(
        await screen.findByRole('row', { name: /Home NAS/ }),
      ).toBeInTheDocument();
      expect(screen.queryByText(refreshFailed())).not.toBeInTheDocument();
      expect(backend.count(PASSWORDS)).toBe(6);
      await waitFor(() => expect(passwordsSection()).toHaveFocus());
    });

    it.each(SHIPPED_LOCALES)(
      'names a failed read and a failed refresh in %s and passes axe',
      async (locale) => {
        saveLocale(locale);
        backend.on(PASSWORDS, serviceUnavailable);
        const { container } = await renderPage();
        await waitFor(() => expect(i18n.resolvedLanguage).toBe(locale));

        await tableRetry();
        await checkAccessibility(container, axeOptions);

        backend.on(PASSWORDS, passwordsAnswer('Finance laptop'));
        await act(async () => {
          await client.refetchQueries();
        });
        await screen.findByRole('row', { name: /Finance laptop/ });
        backend.on(PASSWORDS, serviceUnavailable);
        await act(async () => {
          await client.refetchQueries();
        });

        await alertSaying(refreshFailed());
        if (locale !== 'en') {
          // The notice speaks the reader's language, not English.
          expect(refreshFailed()).not.toBe(
            i18n.t('list.refreshFailed', { ns: 'webdav', lng: 'en' }),
          );
        }
        await checkAccessibility(container, axeOptions);
      },
    );
  },
);
