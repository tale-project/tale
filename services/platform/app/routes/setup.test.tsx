import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
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
} from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

/**
 * First-run setup over the users read it gates on: the hook, `backendFetch`
 * and the read's retry policy (four attempts for a fault, one for a refusal)
 * against a closed synthetic transport. Only an answer that no account
 * exists opens the wizard; a read that failed knows nothing of this install,
 * which may well have accounts (#4606).
 */

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  auth: { isAuthenticated: false, isLoading: false },
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  useNavigate: () => h.navigate,
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('@/lib/utils/seo', () => ({ seo: () => [] }));
vi.mock('@/app/hooks/use-session-user', () => ({ useAuth: () => h.auth }));
vi.mock(
  '@/app/features/organization/components/onboarding/onboarding-wizard',
  () => ({ OnboardingWizard: () => <div data-testid="first-run-wizard" /> }),
);

import { Route } from './setup';

const SetupPage = (Route as unknown as { component: () => ReactNode })
  .component;

const DOOR = /^GET \/api\/app\/users\/has-any$/;
const FAILED = {
  en: "Couldn't check whether this install is already set up.",
  de: 'Es konnte nicht geprüft werden, ob diese Installation bereits eingerichtet ist.',
  fr: 'Impossible de vérifier si cette installation est déjà configurée.',
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState({}, '', '/setup');
  h.navigate.mockReset();
  h.auth = { isAuthenticated: false, isLoading: false };
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

async function renderSetup() {
  const view = render(
    <QueryClientProvider client={client}>
      <SetupPage />
    </QueryClientProvider>,
  );
  // The app shell settles its language once mounted; let that land in act.
  await act(async () => {});
  return view;
}

/** The alert that says `message`, once it does. */
async function alertSaying(message: string): Promise<HTMLElement> {
  const alert = (await screen.findByText(message)).closest<HTMLElement>(
    '[role="alert"]',
  );
  if (alert === null) throw new Error(`"${message}" is in no alert`);
  return alert;
}

const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const wizard = () => screen.queryByTestId('first-run-wizard');
const hasAny = (answer: boolean) => () => Response.json({ hasAny: answer });

describe('/setup when its users read fails', { timeout: 30_000 }, () => {
  it('never opens the first-run wizard, names the failure with Try again, and recovers from the keyboard', async () => {
    backend.on(DOOR, serviceUnavailable);
    const { user } = await renderSetup();

    // The policy's four attempts; meanwhile and after them, no wizard.
    await waitFor(() => expect(backend.count(DOOR)).toBe(4));
    const alert = await alertSaying(FAILED.en);
    expect(wizard()).not.toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalled();

    // The install has accounts after all: Try again sends the person to
    // sign in, still without a wizard.
    backend.on(DOOR, hasAny(true));
    const retry = screen.getByRole('button', { name: tryAgain() });
    expect(alert).toContainElement(retry);
    retry.focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith({ to: '/log-in' }),
    );
    expect(wizard()).not.toBeInTheDocument();
    expect(backend.count(DOOR)).toBe(5);
  });

  it('keeps the failure and the focus on Try again while a retry fails again', async () => {
    backend.on(DOOR, serviceUnavailable);
    const { user } = await renderSetup();
    await alertSaying(FAILED.en);

    const retry = screen.getByRole('button', { name: tryAgain() });
    retry.focus();
    await user.keyboard('{Enter}');
    expect(retry).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(backend.count(DOOR)).toBe(8));
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
    expect(screen.getByText(FAILED.en)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tryAgain() })).toBe(retry);
    expect(retry).toHaveFocus();
    expect(wizard()).not.toBeInTheDocument();
  });

  it('opens the wizard once Try again finds no account', async () => {
    backend.on(DOOR, serviceUnavailable);
    const { user } = await renderSetup();
    await alertSaying(FAILED.en);

    backend.on(DOOR, hasAny(false));
    await user.click(screen.getByRole('button', { name: tryAgain() }));

    expect(await screen.findByTestId('first-run-wizard')).toBeInTheDocument();
    expect(screen.queryByText(FAILED.en)).not.toBeInTheDocument();
  });

  it('names a refusal at once, without retrying it', async () => {
    backend.on(DOOR, () =>
      Response.json({ error: 'FORBIDDEN', code: 'FORBIDDEN' }, { status: 403 }),
    );
    await renderSetup();

    await alertSaying(FAILED.en);
    expect(backend.count(DOOR)).toBe(1);
    expect(wizard()).not.toBeInTheDocument();
  });

  it('sends a signed-in person to the dashboard, with no failure to read', async () => {
    h.auth = { isAuthenticated: true, isLoading: false };
    backend.on(DOOR, serviceUnavailable);
    await renderSetup();

    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith({ to: '/dashboard' }),
    );
    expect(screen.queryByText(FAILED.en)).not.toBeInTheDocument();
    expect(wizard()).not.toBeInTheDocument();
  });

  it.each(SHIPPED_LOCALES)(
    'names the failure in %s and passes axe',
    async (locale) => {
      saveLocale(locale);
      backend.on(DOOR, serviceUnavailable);
      const { container } = await renderSetup();

      const alert = await alertSaying(FAILED[locale]);
      expect(alert).toContainElement(
        screen.getByRole('button', { name: tryAgain() }),
      );
      await checkAccessibility(container);
    },
  );
});

describe('/setup when its users read answers', () => {
  it('shows neither the wizard nor a failure while the read is pending', async () => {
    backend.on(DOOR, () => new Promise<Response>(() => {}));
    await renderSetup();
    await waitFor(() => expect(backend.count(DOOR)).toBe(1));

    expect(wizard()).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('opens the wizard when no account exists', async () => {
    backend.on(DOOR, hasAny(false));
    await renderSetup();

    expect(await screen.findByTestId('first-run-wizard')).toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('sends an install with accounts to sign in', async () => {
    backend.on(DOOR, hasAny(true));
    await renderSetup();

    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith({ to: '/log-in' }),
    );
    expect(wizard()).not.toBeInTheDocument();
  });
});
