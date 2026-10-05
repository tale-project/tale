import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { act, configure, render, screen, waitFor } from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import {
  CloudImportConnectDialog,
  type CloudImportConnectProvider,
} from './cloud-import-connect-dialog';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// The connect dialog asks whether an OAuth app is set up before it offers
// Connect. When that check failed, it read as an app that is there: the
// ordinary "not connected" words and a live Connect, no failure named and
// no way to run the check again (#3864). The read runs for real here (the
// hook, the adapter row, `backendFetch` and the retry policy) against a
// closed synthetic transport.

const ability = vi.hoisted(() => ({ admin: true }));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => ability.admin,
    cannot: () => !ability.admin,
  }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}));

const PROVIDERS: ReadonlyArray<{
  provider: CloudImportConnectProvider;
  label: string;
  ns: 'googledrive' | 'onedrive';
  title: string;
  description: string;
}> = [
  {
    provider: 'google-drive',
    label: 'Google Drive',
    ns: 'googledrive',
    title: 'googledrive.notConnected',
    description: 'googledrive.notConnectedDescription',
  },
  {
    provider: 'onedrive',
    label: 'Microsoft 365',
    ns: 'onedrive',
    title: 'onedrive.microsoftNotConnected',
    description: 'onedrive.microsoftNotConnectedDescription',
  },
];

const statusOf = (provider: CloudImportConnectProvider) =>
  new RegExp(
    `^GET /api/app/cloud-import/oauth-app-status\\?provider=${provider}&`,
  );
const configured = (value: boolean) => () =>
  Response.json({ configured: value, source: value ? 'env' : null });

/** A reply the test lets through when it chooses. */
function held() {
  let release: (response: Response) => void = () => {};
  const answer = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { reply: () => answer, release };
}

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  ability.admin = true;
  navigate.mockClear();
  backend = syntheticBackend();
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

function renderDialog(
  provider: CloudImportConnectProvider,
  interruption?: { imported: number; total: number },
) {
  return render(
    <QueryClientProvider client={client}>
      <CloudImportConnectDialog
        open
        onOpenChange={() => {}}
        provider={provider}
        interruption={interruption}
      />
    </QueryClientProvider>,
  );
}

const t = (key: string, ns = 'documents', values = {}) =>
  i18n.t(key, { ns, ...values });
const tryAgain = () =>
  screen.findByRole('button', { name: t('actions.tryAgain', 'common') });
const failure = (label: string) =>
  t('cloudImport.appStatusLoadFailed', 'documents', { provider: label });
const connect = (ns: string) =>
  screen.queryByRole('button', { name: t(`${ns}.connect`) });

describe.each(PROVIDERS)(
  'the $label connect dialog when the setup check fails',
  { timeout: 30_000 },
  ({ provider, label, ns, title, description }) => {
    it('names the failed check and offers no Connect', async () => {
      backend.on(statusOf(provider), () => serviceUnavailable());
      renderDialog(provider);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(failure(label));
      expect(await tryAgain()).toBeEnabled();
      expect(screen.getByRole('dialog', { name: t(title) })).toBeVisible();
      expect(connect(ns)).toBeNull();
      expect(screen.queryByText(t(description))).toBeNull();
      expect(
        screen.queryByText(t('cloudImport.appNotConfiguredAdmin')),
      ).toBeNull();
      expect(
        screen.queryByRole('button', {
          name: t('cloudImport.openConnectorSettings'),
        }),
      ).toBeNull();
    });

    it('runs the check again, holds Try again while it runs, and offers Connect once it works', async () => {
      backend.on(statusOf(provider), () => serviceUnavailable());
      const { user } = renderDialog(provider);
      const retry = await tryAgain();
      const attempts = backend.count(statusOf(provider));

      const answer = held();
      backend.on(statusOf(provider), answer.reply);
      await user.click(retry);

      await waitFor(() =>
        expect(backend.count(statusOf(provider))).toBe(attempts + 1),
      );
      // In flight: the failure stands, Try again is busy but keeps its focus.
      expect(screen.getByRole('alert')).toHaveTextContent(failure(label));
      expect(retry).toHaveAttribute('aria-busy', 'true');
      expect(retry).toHaveAttribute('aria-disabled', 'true');
      expect(retry).toHaveFocus();
      expect(connect(ns)).toBeNull();
      await user.click(retry);
      expect(backend.count(statusOf(provider))).toBe(attempts + 1);

      await act(async () => {
        answer.release(configured(true)());
      });

      expect(
        await screen.findByRole('button', { name: t(`${ns}.connect`) }),
      ).toBeEnabled();
      expect(screen.queryByRole('alert')).toBeNull();
      const guidance = screen.getByText(t(description));
      await waitFor(() => expect(guidance).toHaveFocus());
    });

    it('keeps the alert and the focus on Try again when the retry fails too', async () => {
      backend.on(statusOf(provider), () => serviceUnavailable());
      const { user } = renderDialog(provider);
      const retry = await tryAgain();
      const attempts = backend.count(statusOf(provider));

      await user.click(retry);

      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
      expect(backend.count(statusOf(provider))).toBeGreaterThan(attempts);
      expect(screen.getByRole('alert')).toHaveTextContent(failure(label));
      expect(retry).toBeInTheDocument();
      expect(retry).toHaveFocus();
      expect(connect(ns)).toBeNull();
    });

    it('says the app is missing, with the settings path for an admin, once a retry finds none', async () => {
      backend.on(statusOf(provider), () => serviceUnavailable());
      const { user } = renderDialog(provider);
      const retry = await tryAgain();

      backend.on(statusOf(provider), configured(false));
      await user.click(retry);

      expect(
        await screen.findByText(t('cloudImport.appNotConfiguredAdmin')),
      ).toBeVisible();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(connect(ns)).toBeNull();
      await user.click(
        screen.getByRole('button', {
          name: t('cloudImport.openConnectorSettings'),
        }),
      );
      expect(navigate).toHaveBeenCalledWith({
        to: '/dashboard/$id/settings/connectors',
        params: { id: 'org-1' },
      });
    });

    it('keeps the reconnect words in the description of an interrupted import', async () => {
      backend.on(statusOf(provider), () => serviceUnavailable());
      renderDialog(provider, { imported: 1, total: 4 });

      expect(await screen.findByRole('alert')).toHaveTextContent(
        failure(label),
      );
      expect(
        screen.getByRole('dialog', { name: t(`${ns}.reconnect`) }),
      ).toHaveAccessibleDescription(
        t('cloudImport.importInterrupted', 'documents', {
          provider: label,
          imported: 1,
          total: 4,
        }),
      );
      expect(
        screen.queryByRole('button', { name: t(`${ns}.reconnect`) }),
      ).toBeNull();
    });
  },
);

describe.each(PROVIDERS)(
  'the $label connect dialog when the setup check answers',
  ({ provider, ns, description }) => {
    it('holds Connect until the answer is in', async () => {
      const answer = held();
      backend.on(statusOf(provider), answer.reply);
      renderDialog(provider);

      await waitFor(() => expect(backend.count(statusOf(provider))).toBe(1));
      expect(screen.getByText(t(description))).toBeVisible();
      expect(
        screen.getByRole('button', { name: t(`${ns}.connect`) }),
      ).toBeDisabled();

      await act(async () => {
        answer.release(configured(true)());
      });

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: t(`${ns}.connect`) }),
        ).toBeEnabled(),
      );
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('offers Connect when an app is set up', async () => {
      backend.on(statusOf(provider), configured(true));
      renderDialog(provider);

      await waitFor(() => expect(connect(ns)).toBeEnabled());
      expect(screen.getByText(t(description))).toBeVisible();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('tells a member to ask an admin when no app is set up', async () => {
      ability.admin = false;
      backend.on(statusOf(provider), configured(false));
      renderDialog(provider);

      expect(
        await screen.findByText(t('cloudImport.appNotConfigured')),
      ).toBeVisible();
      expect(connect(ns)).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(
        screen.queryByRole('button', {
          name: t('cloudImport.openConnectorSettings'),
        }),
      ).toBeNull();
    });
  },
);

describe(
  'the failed setup check in every shipped locale',
  { timeout: 30_000 },
  () => {
    it.each(SHIPPED_LOCALES)('names the failure (%s)', async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      backend.on(statusOf('google-drive'), () => serviceUnavailable());
      renderDialog('google-drive');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        failure('Google Drive'),
      );
      expect(failure('Google Drive')).toContain('Google Drive');
      expect(
        screen.getByRole('button', { name: t('actions.tryAgain', 'common') }),
      ).toBeVisible();
    });
  },
);
