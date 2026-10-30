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

import { i18n } from '@/tests/utils/i18n-all-languages';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

// #4768: a second window that still shows the old two-factor state offers
// what Better Auth then refuses: new backup codes once two-factor is off
// (`TWO_FACTOR_NOT_ENABLED`), setup once it is on (`TOTP_ALREADY_ENABLED`).
// The refusal's words are English in every language. The section says what
// happened in the reader's language, and reads the status again, so it shows
// the state the account is in. The query cache and the toaster are real; the
// Better Auth client and the status door are stubbed.

const { twoFactor, showBackupCodes } = vi.hoisted(() => ({
  twoFactor: {
    enable: vi.fn(),
    disable: vi.fn(),
    verifyTotp: vi.fn(),
    generateBackupCodes: vi.fn(),
  },
  showBackupCodes: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: vi.fn(), twoFactor },
}));

// The backup-codes dialog lives in a root provider; the section only needs
// the show() callback.
vi.mock('./backup-codes-dialog-provider', () => ({
  useShowBackupCodes: () => showBackupCodes,
}));

// FormDialog resolves the org id from router params for its unsaved-changes
// guard; there is no router in a component test.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

import { TwoFactorSection } from './two-factor-section';

const STATUS_PATH = '/api/app/two-factor/status';

function status(twoFactorEnabled: boolean) {
  return {
    authenticated: true,
    twoFactorEnabled,
    hasPasskey: false,
    enforced: false,
    decision: 'ok',
    graceUntil: null,
    hasCredential: true,
    exemptSsoUsers: false,
    backupCodesRemaining: twoFactorEnabled ? 10 : null,
  };
}

/** A Better Auth client refusal, as `authClient` resolves it. */
function refusal(code: string, message: string) {
  return {
    data: null,
    error: { status: 400, statusText: 'BAD_REQUEST', code, message },
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

/** Renders the section as this window last read it, then lets another
 * window change the account. */
async function renderSection(readAs: boolean) {
  twoFactorEnabled = readAs;
  const result = render(
    <QueryClientProvider client={queryClient}>
      <TwoFactorSection />
      <Toaster />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', {
    name: tf(
      readAs ? 'enrollment.regenerateButton' : 'enrollment.enableButton',
    ),
  });
  expect(statusReads()).toBe(1);
  return result;
}

async function confirmPassword(
  user: ReturnType<typeof render>['user'],
  button: string,
) {
  await user.click(screen.getByRole('button', { name: tf(button) }));
  const dialog = await screen.findByRole('dialog');
  await user.type(
    within(dialog).getByLabelText(tf('confirmPassword.label')),
    'synthetic-password',
  );
  await user.click(
    within(dialog).getByRole('button', { name: tf('confirmPassword.submit') }),
  );
}

describe('TwoFactorSection – a change made in another window (#4768)', () => {
  it.each([
    [
      'de',
      'Neue Backup-Codes konnten nicht erzeugt werden.',
      'Die Zwei-Faktor-Authentifizierung wurde deaktiviert, während diese Seite offen war.',
    ],
    [
      'fr',
      'Échec de la génération de nouveaux codes de secours.',
      "L'authentification à double facteur a été désactivée pendant que cette page était ouverte.",
    ],
  ])(
    'says in %s that two-factor was turned off, and shows it off',
    async (locale, title, detail) => {
      await readIn(locale);
      twoFactor.generateBackupCodes.mockResolvedValue(
        refusal('TWO_FACTOR_NOT_ENABLED', "Two factor isn't enabled"),
      );
      const { user } = await renderSection(true);
      twoFactorEnabled = false;

      await confirmPassword(user, 'enrollment.regenerateButton');

      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(screen.getByText(detail)).toBeInTheDocument();
      expect(screen.queryByText("Two factor isn't enabled")).toBeNull();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      // The status is read again, and the section shows it off.
      expect(
        await screen.findByRole('button', {
          name: tf('enrollment.enableButton'),
        }),
      ).toBeInTheDocument();
      expect(statusReads()).toBe(2);
      expect(
        screen.queryByRole('button', {
          name: tf('enrollment.regenerateButton'),
        }),
      ).toBeNull();
      expect(showBackupCodes).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'de',
      'Die Zwei-Faktor-Authentifizierung wurde aktiviert, während diese Seite offen war.',
    ],
    [
      'fr',
      "L'authentification à double facteur a été activée pendant que cette page était ouverte.",
    ],
  ])(
    'says in %s that two-factor was turned on, and shows it on',
    async (locale, notice) => {
      await readIn(locale);
      twoFactor.enable.mockResolvedValue(
        refusal('TOTP_ALREADY_ENABLED', 'TOTP is already enabled'),
      );
      const { user } = await renderSection(false);
      twoFactorEnabled = true;

      await confirmPassword(user, 'enrollment.enableButton');

      expect(await screen.findByText(notice)).toBeInTheDocument();
      expect(screen.queryByText('TOTP is already enabled')).toBeNull();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      // The status is read again, and the section shows it on.
      expect(
        await screen.findByRole('button', {
          name: tf('enrollment.disableButton'),
        }),
      ).toBeInTheDocument();
      expect(statusReads()).toBe(2);
      expect(
        screen.getByRole('button', { name: tf('enrollment.regenerateButton') }),
      ).toBeInTheDocument();
    },
  );
});

describe('TwoFactorSection – a refusal it has no words for', () => {
  // Any refusal other than a wrong password, the sign-in lock, the session's
  // authority or a change made elsewhere reads as the prompt's own failure,
  // never as the server's English sentence.
  const SERVER_WORDS = 'An English sentence from the server';

  it.each([
    [
      'de',
      'enable',
      false,
      'enrollment.enableButton',
      'Zwei-Faktor-Authentifizierung konnte nicht aktiviert werden. Versuch es nochmal.',
    ],
    [
      'de',
      'disable',
      true,
      'enrollment.disableButton',
      'Zwei-Faktor-Authentifizierung konnte nicht deaktiviert werden.',
    ],
    [
      'de',
      'generateBackupCodes',
      true,
      'enrollment.regenerateButton',
      'Neue Backup-Codes konnten nicht erzeugt werden.',
    ],
    [
      'fr',
      'enable',
      false,
      'enrollment.enableButton',
      'Impossible de démarrer la configuration du double facteur. Réessaie.',
    ],
    [
      'fr',
      'disable',
      true,
      'enrollment.disableButton',
      "Échec de la désactivation de l'authentification à double facteur.",
    ],
    [
      'fr',
      'generateBackupCodes',
      true,
      'enrollment.regenerateButton',
      'Échec de la génération de nouveaux codes de secours.',
    ],
  ] as const)(
    'in %s, words a refused %s as its failure',
    async (locale, call, enrolled, button, failure) => {
      await readIn(locale);
      twoFactor[call].mockResolvedValue(
        refusal('SOMETHING_UNEXPECTED', SERVER_WORDS),
      );
      const { user } = await renderSection(enrolled);

      await confirmPassword(user, button);

      const dialog = screen.getByRole('dialog');
      expect(await within(dialog).findByText(failure)).toBeInTheDocument();
      expect(screen.queryByText(SERVER_WORDS)).toBeNull();
      // Nothing says the state moved, so nothing reads it again.
      expect(statusReads()).toBe(1);
    },
  );
});
