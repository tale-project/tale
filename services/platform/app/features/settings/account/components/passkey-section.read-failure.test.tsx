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
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import { syntheticBackend } from '@/tests/utils/synthetic-backend';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #3845: when the passkey list failed to load, the section showed no rows —
// the same as a user with no passkeys, right next to the button that adds
// one. The list read runs for real here (query, the four-attempt retry
// policy) against a mocked Better Auth client; the 2FA status that opens the
// section comes over a closed synthetic transport.

type ListResult =
  | { data: PasskeyRowData[]; error: null }
  | { data: null; error: { status: number; message: string } };

interface PasskeyRowData {
  id: string;
  name: string | null;
  createdAt: number;
}

const { listUserPasskeys } = vi.hoisted(() => ({
  listUserPasskeys: vi.fn<() => Promise<ListResult>>(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    passkey: {
      listUserPasskeys,
      deletePasskey: vi.fn(),
      addPasskey: vi.fn(),
    },
  },
}));

// The register dialog drives its own browser ceremony; it plays no part in
// how the list reads.
vi.mock('./passkey-register-dialog', () => ({
  PasskeyRegisterDialog: () => null,
}));

import { PasskeySection } from './passkey-section';

const YUBIKEY: PasskeyRowData = {
  id: 'pk-1',
  name: 'YubiKey 5C',
  createdAt: 1_700_000_000_000,
};

/** A local, credentialed session: the precondition for the section. */
const STATUS = {
  authenticated: true,
  twoFactorEnabled: false,
  hasPasskey: true,
  enforced: false,
  decision: 'ok',
  graceUntil: null,
  hasCredential: true,
  exemptSsoUsers: false,
  backupCodesRemaining: null,
};

const listOf = (rows: PasskeyRowData[]) => (): Promise<ListResult> =>
  Promise.resolve({ data: rows, error: null });
/** Better Auth answers a server fault in `error`, not by throwing. */
const serverError = (): Promise<ListResult> =>
  Promise.resolve({
    data: null,
    error: { status: 503, message: 'Service unavailable' },
  });
/** No answer at all: the request itself rejects. */
const lostConnection = (): Promise<ListResult> =>
  Promise.reject(new TypeError('Failed to fetch'));

let answer: () => Promise<ListResult>;
let client: QueryClient;

beforeEach(() => {
  const backend = syntheticBackend();
  backend.on(/^GET \/api\/app\/two-factor\/status$/, () =>
    Response.json(STATUS),
  );
  listUserPasskeys.mockReset();
  listUserPasskeys.mockImplementation(() => answer());
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'twoFactor', ...options });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const section = () => screen.getByRole('region', { name: t('passkeys.title') });

/** Render the section and wait for the status read that opens it. */
async function renderSection() {
  const rendered = render(
    <QueryClientProvider client={client}>
      <PasskeySection />
    </QueryClientProvider>,
  );
  await screen.findByRole('region', { name: t('passkeys.title') });
  return rendered;
}

describe(
  'PasskeySection when the passkey list read fails',
  { timeout: 30_000 },
  () => {
    it('lists the passkeys a read returns', async () => {
      answer = listOf([YUBIKEY]);
      await renderSection();

      expect(await within(section()).findByText('YubiKey 5C')).toBeVisible();
      expect(
        within(section()).getByRole('button', {
          name: t('passkeys.revokeButton'),
        }),
      ).toBeVisible();
      expect(within(section()).queryByRole('alert')).not.toBeInTheDocument();
    });

    it.each([
      ['a server fault', serverError],
      ['a lost connection', lostConnection],
    ])(
      'says the list could not load after %s, instead of showing no passkeys',
      async (_cause, failure) => {
        answer = failure;
        await renderSection();

        const alert = await within(section()).findByRole('alert');
        expect(alert).toHaveTextContent(t('passkeys.errors.listFailed'));
        expect(
          within(alert).getByRole('button', { name: tryAgain() }),
        ).toBeVisible();
        expect(listUserPasskeys).toHaveBeenCalledTimes(4);
        // Unavailable is not "no passkeys yet".
        expect(
          within(section()).queryByText(t('passkeys.empty')),
        ).not.toBeInTheDocument();
        expect(within(section()).queryByRole('table')).not.toBeInTheDocument();
        // Adding a passkey does not depend on the list.
        expect(
          within(section()).getByRole('button', {
            name: t('passkeys.addButton'),
          }),
        ).toBeVisible();
      },
    );

    it('says a user with no passkeys has none yet', async () => {
      answer = listOf([]);
      await renderSection();

      expect(
        await within(section()).findByText(t('passkeys.empty')),
      ).toBeVisible();
      expect(within(section()).queryByRole('alert')).not.toBeInTheDocument();
      expect(within(section()).queryByRole('table')).not.toBeInTheDocument();
    });

    it('claims nothing about the passkeys while the first read is in flight', async () => {
      answer = () => new Promise<ListResult>(() => {});
      await renderSection();

      await waitFor(() => expect(listUserPasskeys).toHaveBeenCalledTimes(1));
      expect(
        within(section()).queryByText(t('passkeys.empty')),
      ).not.toBeInTheDocument();
      expect(within(section()).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('keeps Try again, busy and focused, while its retry runs, then hands the focus to the section', async () => {
      answer = serverError;
      const { user } = await renderSection();
      const alert = await within(section()).findByRole('alert');
      const retry = within(alert).getByRole('button', { name: tryAgain() });

      let land: (result: ListResult) => void = () => {};
      answer = () => new Promise<ListResult>((resolve) => (land = resolve));
      retry.focus();
      await user.keyboard('{Enter}');

      await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
      expect(listUserPasskeys).toHaveBeenCalledTimes(5);
      // A retry starts the read over; the failure and its control stay up
      // until it settles, so the focus is not dropped on the page.
      expect(within(section()).getByRole('alert')).toBe(alert);
      expect(retry).toHaveAttribute('aria-disabled', 'true');
      expect(retry).toHaveFocus();

      await act(async () => land({ data: [YUBIKEY], error: null }));
      expect(await within(section()).findByText('YubiKey 5C')).toBeVisible();
      expect(within(section()).queryByRole('alert')).not.toBeInTheDocument();
      await waitFor(() => expect(section()).toHaveFocus());
    });

    it('keeps Try again and its focus when the retry fails again, and says so afresh', async () => {
      answer = serverError;
      const { user } = await renderSection();
      const alert = await within(section()).findByRole('alert');
      const retry = within(alert).getByRole('button', { name: tryAgain() });
      const firstMessage = within(alert).getByText(
        t('passkeys.errors.listFailed'),
      );

      retry.focus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(listUserPasskeys).toHaveBeenCalledTimes(8));
      await waitFor(() =>
        expect(
          within(alert).getByText(t('passkeys.errors.listFailed')),
        ).not.toBe(firstMessage),
      );
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));

      expect(within(section()).getByRole('alert')).toBe(alert);
      expect(within(alert).getByRole('button', { name: tryAgain() })).toBe(
        retry,
      );
      expect(retry).toHaveFocus();
    });

    // The app refetches an errored read when the tab regains focus; a Try
    // again the reader had focused (not pressed) must survive it.
    it('keeps a focused Try again focused when a background refresh fails again', async () => {
      answer = serverError;
      await renderSection();
      const alert = await within(section()).findByRole('alert');
      const retry = within(alert).getByRole('button', { name: tryAgain() });
      const firstMessage = within(alert).getByText(
        t('passkeys.errors.listFailed'),
      );
      retry.focus();

      void client.invalidateQueries();
      await waitFor(() => expect(listUserPasskeys).toHaveBeenCalledTimes(8));
      // The new message is the refresh's failure settling, not its start.
      await waitFor(() =>
        expect(
          within(alert).getByText(t('passkeys.errors.listFailed')),
        ).not.toBe(firstMessage),
      );
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));

      expect(within(section()).getByRole('alert')).toBe(alert);
      expect(retry).toHaveFocus();
    });

    it('moves the focus to the section when a background refresh heals the list behind a focused Try again', async () => {
      answer = serverError;
      await renderSection();
      const alert = await within(section()).findByRole('alert');
      within(alert).getByRole('button', { name: tryAgain() }).focus();

      answer = listOf([YUBIKEY]);
      void client.invalidateQueries();
      expect(await within(section()).findByText('YubiKey 5C')).toBeVisible();
      await waitFor(() => expect(section()).toHaveFocus());
    });

    it('keeps the listed passkeys through a failed refresh, with a retry', async () => {
      answer = listOf([YUBIKEY]);
      const { user } = await renderSection();
      await within(section()).findByText('YubiKey 5C');

      answer = serverError;
      void client.invalidateQueries();
      const alert = await within(section()).findByRole('alert');
      expect(alert).toHaveTextContent(t('passkeys.errors.refreshFailed'));
      expect(within(section()).getByText('YubiKey 5C')).toBeVisible();

      answer = listOf([YUBIKEY]);
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));
      await waitFor(() =>
        expect(within(section()).queryByRole('alert')).not.toBeInTheDocument(),
      );
      expect(within(section()).getByText('YubiKey 5C')).toBeVisible();
      await waitFor(() => expect(section()).toHaveFocus());
    });

    it('passes an axe audit with the failure shown', async () => {
      answer = serverError;
      const { baseElement } = await renderSection();
      await within(section()).findByRole('alert');

      await checkAccessibility(baseElement);
    });

    describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
      it('names the failed list, its retry and an empty list in the reader language', async () => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        answer = serverError;
        await renderSection();

        const alert = await within(section()).findByRole('alert');
        expect(alert).toHaveTextContent(t('passkeys.errors.listFailed'));
        expect(
          within(alert).getByRole('button', { name: tryAgain() }),
        ).toBeInTheDocument();
        for (const key of [
          'passkeys.empty',
          'passkeys.errors.listFailed',
          'passkeys.errors.refreshFailed',
        ]) {
          expect(t(key)).not.toBe(key);
          if (locale !== 'en') {
            expect(t(key)).not.toBe(t(key, { lng: 'en' }));
          }
        }
      });
    });
  },
);
