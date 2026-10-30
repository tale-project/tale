// @vitest-environment jsdom
import { Toaster } from '@tale/ui/toaster';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import { twoFactorStatusQuery } from '@/app/lib/backend/account';
import { ACCOUNT_AUTHENTICATION_MESSAGE } from '@/lib/shared/constants/session-authority';
import { i18n } from '@/tests/utils/i18n-all-languages';
import { act, cleanup, render, screen, waitFor } from '@/tests/utils/render';

// #4768: the enrollment wall open in two windows. Once one of them has
// enrolled, Better Auth refuses the other's password with
// `TOTP_ALREADY_ENABLED`, in English whatever the reader's language. The wall
// says in the reader's language that two-factor was turned on meanwhile,
// reads the status again and leaves, as it does for anyone already enrolled.
// The query cache and the toaster are real; the router, the Better Auth
// client and the status door are stubbed.

const { mockNavigate, twoFactor } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  twoFactor: { enable: vi.fn(), verifyTotp: vi.fn() },
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  // LogoLink renders a router <Link> in the page header.
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  redirect: vi.fn(),
  useNavigate: () => mockNavigate,
  useSearch: () => ({}),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: vi.fn(), twoFactor },
}));

// The passkey dialog drives a WebAuthn browser ceremony irrelevant here.
vi.mock(
  '@/app/features/settings/account/components/passkey-register-dialog',
  () => ({ PasskeyRegisterDialog: () => null }),
);

import { TwoFactorEnrollPage } from './2fa-enroll';

const STATUS_PATH = '/api/app/two-factor/status';
const SERVER_WORDS = 'An English sentence from the server';

function status(twoFactorEnabled: boolean) {
  return {
    authenticated: true,
    twoFactorEnabled,
    hasPasskey: false,
    enforced: true,
    decision: twoFactorEnabled ? 'ok' : 'blocked',
    graceUntil: null,
    hasCredential: true,
    exemptSsoUsers: false,
    backupCodesRemaining: twoFactorEnabled ? 10 : null,
  };
}

/** A Better Auth client refusal, as `authClient` resolves it. */
function refusal(httpStatus: number, code: string, message: string) {
  return {
    data: null,
    error: { status: httpStatus, statusText: '', code, message },
  };
}

let queryClient: QueryClient;
let fetch: MockInstance<typeof globalThis.fetch>;
/** What the status door answers now: the account's real state. */
let twoFactorEnabled: boolean;

function pathOf(input: Parameters<typeof globalThis.fetch>[0]): string {
  const url = input instanceof Request ? input.url : String(input);
  return new URL(url, 'http://tale.test').pathname;
}
const statusReads = () =>
  fetch.mock.calls.filter(([input]) => pathOf(input) === STATUS_PATH).length;

beforeEach(() => {
  vi.clearAllMocks();
  // The app's stale window: nothing but an invalidation reads the status
  // again while the page is open.
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: false } },
  });
  fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = pathOf(input);
    if (path === STATUS_PATH) return Response.json(status(twoFactorEnabled));
    throw new Error(`Unexpected request to ${path}`);
  });
});

afterEach(async () => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  localStorage.removeItem('user-locale');
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

async function readIn(locale: string) {
  localStorage.setItem('user-locale', locale);
  await act(async () => {
    await i18n.changeLanguage(locale);
  });
}

const tf = (key: string) => i18n.t(key, { ns: 'twoFactor' });

/** Opens the wall as this window read the account: not enrolled. */
async function renderPage() {
  twoFactorEnabled = false;
  const result = render(
    <QueryClientProvider client={queryClient}>
      <TwoFactorEnrollPage />
      <Toaster />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      queryClient.getQueryData(twoFactorStatusQuery().queryKey),
    ).toBeDefined(),
  );
  expect(statusReads()).toBe(1);
  return result;
}

async function submitPassword(user: ReturnType<typeof render>['user']) {
  await user.type(
    screen.getByLabelText(tf('confirmPassword.label')),
    'synthetic-password',
  );
  await user.click(
    screen.getByRole('button', { name: tf('enrollment.enableButton') }),
  );
}

describe('TwoFactorEnrollPage – enrolled in another window (#4768)', () => {
  it.each([
    [
      'de',
      'Die Zwei-Faktor-Authentifizierung wurde aktiviert, während diese Seite offen war.',
      'Zwei-Faktor-Authentifizierung konnte nicht aktiviert werden. Versuch es nochmal.',
    ],
    [
      'fr',
      "L'authentification à double facteur a été activée pendant que cette page était ouverte.",
      'Impossible de démarrer la configuration du double facteur. Réessaie.',
    ],
  ])('says so in %s and leaves the wall', async (locale, notice, failure) => {
    await readIn(locale);
    twoFactor.enable.mockResolvedValue(
      refusal(400, 'TOTP_ALREADY_ENABLED', 'TOTP is already enabled'),
    );
    const { user } = await renderPage();
    // The other window has enrolled since this one read the status.
    twoFactorEnabled = true;

    await submitPassword(user);

    expect(await screen.findByText(notice)).toBeInTheDocument();
    expect(screen.queryByText('TOTP is already enabled')).toBeNull();
    expect(screen.queryByText(failure)).toBeNull();
    // The status is read again, and the wall's guard moves on.
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/dashboard',
        replace: true,
      }),
    );
    expect(statusReads()).toBe(2);
    expect(
      screen.queryByLabelText(tf('setup.verifyCodeLabel')),
    ).not.toBeInTheDocument();
  });
});

describe('TwoFactorEnrollPage – a refusal it has no words for', () => {
  it.each([
    [
      'de',
      'Zwei-Faktor-Authentifizierung konnte nicht aktiviert werden. Versuch es nochmal.',
    ],
    [
      'fr',
      'Impossible de démarrer la configuration du double facteur. Réessaie.',
    ],
  ])(
    'words it in %s as the failure to start setup',
    async (locale, failure) => {
      await readIn(locale);
      twoFactor.enable.mockResolvedValue(
        refusal(400, 'SOMETHING_UNEXPECTED', SERVER_WORDS),
      );
      const { user } = await renderPage();

      await submitPassword(user);

      expect(await screen.findByText(failure)).toBeInTheDocument();
      expect(screen.queryByText(SERVER_WORDS)).toBeNull();
      // Nothing says the state moved: the wall stays, and reads nothing again.
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(statusReads()).toBe(1);
    },
  );

  it('words the session authority’s refusal as the section does', async () => {
    await readIn('de');
    twoFactor.enable.mockResolvedValue(
      refusal(403, 'SESSION_NOT_FRESH', ACCOUNT_AUTHENTICATION_MESSAGE),
    );
    const { user } = await renderPage();

    await submitPassword(user);

    expect(
      await screen.findByText(
        'Bestätige dein Passwort oder einen Passkey für dein Konto, bevor du dein Konto änderst.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(ACCOUNT_AUTHENTICATION_MESSAGE)).toBeNull();
  });
});
