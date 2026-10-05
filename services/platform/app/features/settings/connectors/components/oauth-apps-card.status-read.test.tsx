import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
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
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import type { ConnectorSummary } from '../hooks/backend';
import { OauthAppsCard } from './oauth-apps-card';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// The OAuth apps card asks the Knowledge import lanes (OneDrive, and Google
// Drive's import half) whether a deployment app stands behind their rows.
// When that read failed, the rows said "Not configured" and offered
// Configure — an admin could override an app that was there — with no
// failure named and no way to read again (#3893). The reads run for real
// here (the hooks, the adapter rows, `backendFetch` and the retry policy)
// against a closed synthetic transport.

type Provider = 'onedrive' | 'google-drive';

const statusOf = (provider: Provider) =>
  new RegExp(
    `^GET /api/app/cloud-import/oauth-app-status\\?provider=${provider}&`,
  );
const APP_LIST = /^GET \/api\/app\/connector-oauth-apps\?/;
const ENTRA_SSO = /^GET \/api\/app\/connector-oauth-apps\/entra-sso-source\?/;

const answered = (source: 'org' | 'env' | null) => () =>
  Response.json({ configured: source !== null, source });

/** A reply the test lets through when it chooses. */
function held() {
  let release: (response: Response) => void = () => {};
  const answer = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { reply: () => answer, release };
}

function oauthConnector(
  slug: string,
  displayName: string,
  source: 'org' | 'env' | null = null,
): ConnectorSummary {
  return {
    slug,
    displayName,
    description: `${displayName} connector.`,
    tags: [],
    endpointMode: 'fixed',
    authMethods: ['oauth2'],
    configFields: [],
    actionCount: 1,
    iconUrl: `/api/connectors/${slug}/icon.svg`,
    oauthApp: { configured: source !== null, source, orgConfigurable: true },
  };
}

const gmail = oauthConnector('gmail', 'Gmail');
const googleDrive = (source: 'org' | 'env' | null = null) =>
  oauthConnector('google-drive', 'Google Drive', source);

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  backend = syntheticBackend();
  backend.on(APP_LIST, () => Response.json({ apps: [] }));
  backend.on(ENTRA_SSO, () =>
    Response.json({ available: true, clientId: 'sso-client', tenantId: 't' }),
  );
  backend.on(statusOf('onedrive'), answered(null));
  backend.on(statusOf('google-drive'), answered(null));
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

function renderCard(connectors: ConnectorSummary[] = [gmail, googleDrive()]) {
  return render(
    <QueryClientProvider client={client}>
      <OauthAppsCard organizationId="org-1" connectors={connectors} />
    </QueryClientProvider>,
  );
}

const t = (key: string, ns = 'settings') => i18n.t(key, { ns });
const label = {
  unavailable: () => t('connectors.oauthApps.statusUnavailable'),
  none: () => t('connectors.oauthApps.statusNone'),
  env: () => t('connectors.oauthApps.statusEnv'),
  org: () => t('connectors.oauthApps.statusOrg'),
  configure: () => t('connectors.oauthApps.configure'),
  reuseSso: () => t('connectors.oauthApps.reuseSso'),
  failure: () => t('connectors.oauthApps.statusLoadFailed'),
  onedrive: () => t('connectors.oauthApps.onedriveTarget'),
};
const tryAgain = () =>
  screen.findByRole('button', { name: t('actions.tryAgain', 'common') });
const card = () =>
  screen.getByRole('region', { name: t('connectors.oauthApps.title') });
/** Every source has answered: the rows are no longer masked. */
const settled = () =>
  waitFor(() => expect(screen.queryByRole('status')).toBeNull());

/** One app row, found by the name it shows. */
function row(name: string) {
  const element = screen
    .getByText(name)
    .closest<HTMLElement>('[class*="justify-between"]');
  if (element === null) throw new Error(`no row named ${name}`);
  return within(element);
}

function expectNoAppAction(name: string) {
  expect(
    row(name).queryByRole('button', { name: label.configure() }),
  ).toBeNull();
  expect(
    row(name).queryByRole('button', { name: label.reuseSso() }),
  ).toBeNull();
}

describe(
  'OauthAppsCard when a Knowledge import status read fails',
  { timeout: 30_000 },
  () => {
    it('says the OneDrive row is unavailable and offers nothing to configure on it', async () => {
      backend.on(statusOf('onedrive'), () => serviceUnavailable());
      renderCard();

      expect(await screen.findByRole('alert')).toHaveTextContent(
        label.failure(),
      );
      expect(await tryAgain()).toBeEnabled();
      expect(
        row(label.onedrive()).getByText(label.unavailable()),
      ).toBeVisible();
      expect(row(label.onedrive()).queryByText(label.none())).toBeNull();
      expectNoAppAction(label.onedrive());
      // The rows the failure does not touch keep their answer and action.
      for (const name of ['Gmail', 'Google Drive']) {
        expect(row(name).getByText(label.none())).toBeVisible();
        expect(
          row(name).getByRole('button', { name: label.configure() }),
        ).toBeEnabled();
      }
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('says the Google Drive row is unavailable when only its import lane could answer', async () => {
      backend.on(statusOf('google-drive'), () => serviceUnavailable());
      renderCard();

      expect(await screen.findByRole('alert')).toHaveTextContent(
        label.failure(),
      );
      expect(row('Google Drive').getByText(label.unavailable())).toBeVisible();
      expectNoAppAction('Google Drive');
      expect(row(label.onedrive()).getByText(label.none())).toBeVisible();
      expect(
        row(label.onedrive()).getByRole('button', { name: label.configure() }),
      ).toBeEnabled();
      expect(
        row(label.onedrive()).getByRole('button', { name: label.reuseSso() }),
      ).toBeEnabled();
    });

    it('keeps a row whose app is known from another answer', async () => {
      backend.on(statusOf('onedrive'), () => serviceUnavailable());
      backend.on(statusOf('google-drive'), () => serviceUnavailable());
      backend.on(APP_LIST, () =>
        Response.json({
          apps: [
            {
              slug: 'onedrive',
              clientId: 'org-client',
              maskedPreview: null,
              tenantId: null,
              updatedAtMs: 1,
            },
          ],
        }),
      );
      // The catalog says the Drive connector lane has a deployment app; the
      // org's own OneDrive row comes from the app list.
      renderCard([gmail, googleDrive('env')]);

      await waitFor(() => {
        expect(backend.count(statusOf('onedrive'))).toBeGreaterThan(1);
        expect(screen.queryByRole('status')).toBeNull();
      });
      await waitFor(() =>
        expect(row(label.onedrive()).getByText(label.org())).toBeVisible(),
      );
      expect(row('Google Drive').getByText(label.env())).toBeVisible();
      for (const name of [label.onedrive(), 'Google Drive']) {
        expect(
          row(name).getByRole('button', { name: label.configure() }),
        ).toBeEnabled();
      }
      expect(screen.queryByText(label.unavailable())).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('runs only the failed read again, holds the row while it runs, and offers Configure once it answers', async () => {
      backend.on(statusOf('onedrive'), () => serviceUnavailable());
      const { user } = renderCard();
      const retry = await tryAgain();
      const attempts = backend.count(statusOf('onedrive'));
      const driveReads = backend.count(statusOf('google-drive'));

      const answer = held();
      backend.on(statusOf('onedrive'), answer.reply);
      await user.click(retry);

      await waitFor(() => {
        expect(backend.count(statusOf('onedrive'))).toBe(attempts + 1);
        expect(retry).toHaveAttribute('aria-busy', 'true');
      });
      // In flight: the row and the failure stand, Try again keeps its focus.
      expect(screen.getByRole('alert')).toHaveTextContent(label.failure());
      expect(retry).toHaveFocus();
      expect(
        row(label.onedrive()).getByText(label.unavailable()),
      ).toBeVisible();
      expectNoAppAction(label.onedrive());
      expect(screen.queryByRole('status')).toBeNull();
      expect(backend.count(statusOf('google-drive'))).toBe(driveReads);

      await act(async () => {
        answer.release(answered(null)());
      });

      expect(
        await row(label.onedrive()).findByRole('button', {
          name: label.configure(),
        }),
      ).toBeEnabled();
      expect(row(label.onedrive()).getByText(label.none())).toBeVisible();
      expect(screen.queryByRole('alert')).toBeNull();
      await waitFor(() => expect(card()).toHaveFocus());
    });

    it('keeps the alert and the focus on Try again when the retry fails too', async () => {
      backend.on(statusOf('onedrive'), () => serviceUnavailable());
      const { user } = renderCard();
      const retry = await tryAgain();
      const attempts = backend.count(statusOf('onedrive'));

      await user.click(retry);

      // The retry runs the policy's attempts again and settles in error.
      await waitFor(() => {
        expect(backend.count(statusOf('onedrive'))).toBe(attempts * 2);
        expect(retry).not.toHaveAttribute('aria-busy');
      });
      expect(screen.getByRole('alert')).toHaveTextContent(label.failure());
      expect(retry).toHaveFocus();
      expect(
        row(label.onedrive()).getByText(label.unavailable()),
      ).toBeVisible();
      expectNoAppAction(label.onedrive());
    });

    it('names one failure for both rows and runs both reads again', async () => {
      backend.on(statusOf('onedrive'), () => serviceUnavailable());
      backend.on(statusOf('google-drive'), () => serviceUnavailable());
      const { user } = renderCard();
      const retry = await tryAgain();

      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expectNoAppAction(label.onedrive());
      expectNoAppAction('Google Drive');

      backend.on(statusOf('onedrive'), answered('env'));
      backend.on(statusOf('google-drive'), answered(null));
      await user.click(retry);

      await waitFor(() =>
        expect(row(label.onedrive()).getByText(label.env())).toBeVisible(),
      );
      expect(row('Google Drive').getByText(label.none())).toBeVisible();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(
        screen.getAllByRole('button', { name: label.configure() }),
      ).toHaveLength(3);
    });
  },
);

describe('OauthAppsCard when the Knowledge import status reads answer', () => {
  it('says Not configured and offers Configure once a read confirms no app', async () => {
    renderCard();

    await settled();
    expect(row(label.onedrive()).getByText(label.none())).toBeVisible();
    expect(
      row(label.onedrive()).getByRole('button', { name: label.configure() }),
    ).toBeEnabled();
    expect(row('Google Drive').getByText(label.none())).toBeVisible();
    expect(screen.queryByText(label.unavailable())).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names the deployment app a read reports', async () => {
    backend.on(statusOf('onedrive'), answered('env'));
    backend.on(statusOf('google-drive'), answered('env'));
    renderCard();

    await settled();
    expect(row(label.onedrive()).getByText(label.env())).toBeVisible();
    expect(row('Google Drive').getByText(label.env())).toBeVisible();
    expect(row('Gmail').getByText(label.none())).toBeVisible();
    expect(
      screen.getAllByRole('button', { name: label.configure() }),
    ).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('masks the rows while a read is on its way, then states them', async () => {
    const answer = held();
    backend.on(statusOf('onedrive'), answer.reply);
    renderCard();

    await waitFor(() => expect(backend.count(statusOf('onedrive'))).toBe(1));
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    for (const claim of [label.none(), label.unavailable()]) {
      expect(
        screen
          .queryAllByText(claim)
          .filter((badge) => badge.closest('[aria-hidden="true"]') === null),
      ).toHaveLength(0);
    }

    await act(async () => {
      answer.release(answered(null)());
    });

    await settled();
    expect(row(label.onedrive()).getByText(label.none())).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe(
  'the failed import status read in every shipped locale',
  { timeout: 30_000 },
  () => {
    it.each(SHIPPED_LOCALES)(
      'names the failure and the row (%s)',
      async (locale) => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        backend.on(statusOf('onedrive'), () => serviceUnavailable());
        renderCard();

        expect(await screen.findByRole('alert')).toHaveTextContent(
          label.failure(),
        );
        expect(label.failure()).not.toBe(
          'connectors.oauthApps.statusLoadFailed',
        );
        expect(
          row(label.onedrive()).getByText(label.unavailable()),
        ).toBeVisible();
        expect(label.unavailable()).not.toBe(
          'connectors.oauthApps.statusUnavailable',
        );
        expect(await tryAgain()).toBeVisible();
      },
    );
  },
);
