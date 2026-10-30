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
} from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

/**
 * The **Sign in with SSO** step over the org list's real read: the hook,
 * `backendFetch` and the read's retry policy (four attempts for a fault, one
 * for a refusal) against a closed synthetic transport. A list that has not
 * answered never says that no organization is available (#4606).
 */

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ component: null }),
  useNavigate: () => vi.fn(),
  useSearch: () => ({ method: 'sso' }),
}));
vi.mock('@/lib/utils/seo', () => ({ seo: () => [] }));
// The step's own read stays real; the page's other reads answer as on a
// deployment where several organizations enable SSO.
vi.mock('@/app/features/auth/hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/features/auth/hooks/queries')
  >()),
  useHasAnyUsers: () => ({ data: true, isLoading: false }),
  useIsSsoConfigured: () => ({
    data: { enabled: true, providerType: 'entra-id', multiple: true },
  }),
  useTrustedHeadersHandoff: () => ({ data: false, isLoading: false }),
}));
vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { email: vi.fn() } },
}));

import { LogInPage } from '@/app/routes/_auth/log-in';

const DOOR = /^GET \/api\/app\/sso\/discovery\/selectable$/;
const ORGS = () =>
  Response.json({
    connections: [
      { organizationId: 'org_x', displayName: 'Org X', protocol: 'oidc' },
      { organizationId: 'org_y', displayName: 'Org Y', protocol: 'saml' },
    ],
  });
const FAILED = {
  en: "Couldn't load the organizations.",
  de: 'Die Organisationen konnten nicht geladen werden.',
  fr: 'Impossible de charger les organisations.',
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState({}, '', '/log-in?method=sso');
  window.__ENV__ = { SITE_URL: 'http://localhost:3000', BASE_PATH: '' };
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
  delete window.__ENV__;
  await forgetSavedLocale();
});

async function renderStep() {
  const view = render(
    <QueryClientProvider client={client}>
      <LogInPage />
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
const noOrganizations = () =>
  i18n.t('login.ssoNoOrganizations', { ns: 'auth' });

describe(
  'the SSO step when its org list read fails',
  { timeout: 30_000 },
  () => {
    it('names the failure after its retries, never "none available", and recovers from the keyboard', async () => {
      backend.on(DOOR, serviceUnavailable);
      const { user } = await renderStep();

      // The policy's four attempts; meanwhile and after them, nothing says
      // that no organization is available.
      await waitFor(() => expect(backend.count(DOOR)).toBe(4));
      const alert = await alertSaying(FAILED.en);
      expect(screen.queryByText(noOrganizations())).not.toBeInTheDocument();
      expect(screen.queryByRole('option')).not.toBeInTheDocument();

      // Try again reads the list once more; the alert gives way to the
      // organizations, and the first one takes the focus Try again held.
      backend.on(DOOR, ORGS);
      const retry = screen.getByRole('button', { name: tryAgain() });
      expect(alert).toContainElement(retry);
      retry.focus();
      await user.keyboard('{Enter}');
      await waitFor(() =>
        expect(screen.getByRole('option', { name: /Org X/ })).toHaveFocus(),
      );
      expect(screen.queryByText(FAILED.en)).not.toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Org Y/ })).toBeInTheDocument();
      expect(backend.count(DOOR)).toBe(5);
    });

    it('keeps the failure and the focus on Try again while a retry fails again', async () => {
      backend.on(DOOR, serviceUnavailable);
      const { user } = await renderStep();
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
      expect(screen.queryByText(noOrganizations())).not.toBeInTheDocument();
    });

    it('names a refusal at once, without retrying it', async () => {
      backend.on(DOOR, () =>
        Response.json(
          { error: 'FORBIDDEN', code: 'FORBIDDEN' },
          { status: 403 },
        ),
      );
      await renderStep();

      await alertSaying(FAILED.en);
      expect(backend.count(DOOR)).toBe(1);
      expect(screen.queryByText(noOrganizations())).not.toBeInTheDocument();
    });

    it('masks the picker while the first read is pending, then offers what it answered', async () => {
      let release = () => {};
      backend.on(
        DOOR,
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(ORGS());
          }),
      );
      await renderStep();
      await waitFor(() => expect(backend.count(DOOR)).toBe(1));

      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(noOrganizations())).not.toBeInTheDocument();

      await act(async () => release());
      await waitFor(() =>
        expect(
          screen.getByRole('option', { name: /Org X/ }),
        ).not.toHaveAttribute('inert'),
      );
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('says that no organization is available only once the list answers empty', async () => {
      backend.on(DOOR, () => Response.json({ connections: [] }));
      await renderStep();

      expect(await screen.findByText(noOrganizations())).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: tryAgain() }),
      ).not.toBeInTheDocument();
    });

    it.each(SHIPPED_LOCALES)(
      'names the failure in %s and passes axe',
      async (locale) => {
        saveLocale(locale);
        backend.on(DOOR, serviceUnavailable);
        const { container } = await renderStep();

        const alert = await alertSaying(FAILED[locale]);
        expect(alert).toContainElement(
          screen.getByRole('button', { name: tryAgain() }),
        );
        await checkAccessibility(container);
      },
    );
  },
);
