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
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import type { MaskedCredential, ProviderCatalog } from '../hooks/queries';
import { ProvidersSettings } from './providers-settings';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #4831: a failed catalog read sent the Add credential picker to "This
// deployment ships no provider files", a failed credential list showed the
// invitation to add a first credential under its alert, and both alerts
// showed the server's English text in every locale. The page's reads run for
// real here (hooks, adapter rows, `backendFetch`, the four-attempt retry
// policy) against a closed synthetic transport.

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));

// The `?provider=` seed lives in the URL; this page test needs no router.
vi.mock('@/app/hooks/use-url-state', () => ({
  useUrlState: () => ({
    state: { provider: null },
    setState: () => {},
    setStates: () => {},
    clearState: () => {},
    clearAll: () => {},
    isPending: false,
  }),
}));

// The add dialog's error boundary reads the org id.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const CATALOGS = /^GET \/api\/app\/providers\/catalogs\?orgId=org-1$/;
const CREDENTIALS = /^GET \/api\/app\/provider-credentials\?orgId=org-1$/;
const HARNESS_STATUS =
  /^GET \/api\/app\/providers\/harness-status\?orgId=org-1$/;
const HARNESS_HEALTH = /^GET \/api\/app\/sandbox\/harness-health\?orgId=org-1$/;

/** A fault's own words — for logs, never for the admin. */
const SERVER_SENTENCE = 'config root unreadable: EACCES /etc/tale/providers';

const ANTHROPIC = {
  name: 'anthropic',
  displayName: 'Anthropic',
  apiFormat: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  catalogSource: 'static',
  authMethods: ['api-key', 'env'],
  models: [],
} as unknown as ProviderCatalog;

const PRODUCTION_KEY = {
  id: 'cred-1',
  name: 'Production key',
  providerSlug: 'anthropic',
  authMethod: 'api-key',
  maskedPreview: 'sk-a…4f2',
  isDefault: true,
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
} as unknown as MaskedCredential;

function serverFault(): Response {
  return Response.json(
    { error: 'INTERNAL', message: SERVER_SENTENCE },
    { status: 500 },
  );
}

/** A request that got no answer, as the browser's `fetch` rejects it. */
function connectionLost(): never {
  throw new TypeError('Failed to fetch');
}

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  backend = syntheticBackend();
  backend.on(CATALOGS, () => Response.json({ catalogs: [ANTHROPIC] }));
  backend.on(CREDENTIALS, () =>
    Response.json({ credentials: [PRODUCTION_KEY] }),
  );
  // The runtimes section below the table reads on its own; it answers.
  backend.on(HARNESS_STATUS, () => Response.json({ statuses: [] }));
  backend.on(HARNESS_HEALTH, () => Response.json({ health: [] }));
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderPage() {
  return render(
    <QueryClientProvider client={client}>
      <ProvidersSettings organizationId="org-1" />
    </QueryClientProvider>,
  );
}

const t = (key: string) => i18n.t(key, { ns: 'settings' });
const tCommon = (key: string) => i18n.t(key, { ns: 'common' });
const tryAgain = () => tCommon('actions.tryAgain');
const catalogEmpty = () =>
  screen.queryByText(t('providers.catalogs.emptyBody'));
const emptyState = () =>
  screen.queryByText(i18n.t('providers.title', { ns: 'emptyStates' }));

async function openPicker(user: ReturnType<typeof renderPage>['user']) {
  await user.click(
    await screen.findByRole('button', { name: t('credentials.addCredential') }),
  );
  return within(
    await screen.findByRole('dialog', { name: t('credentials.catalog.title') }),
  );
}

describe('ProvidersSettings when a read fails', { timeout: 30_000 }, () => {
  it('says the providers could not be loaded, in the picker too, and lists them on Try again', async () => {
    backend.on(CATALOGS, () => serverFault());
    const { user } = renderPage();

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(t('providers.catalogs.listFailed'));
    expect(notice).not.toHaveTextContent(SERVER_SENTENCE);
    expect(backend.count(CATALOGS)).toBe(4);
    // The credentials answered: their row stays.
    expect(screen.getByText('Production key')).toBeVisible();

    const picker = await openPicker(user);
    const pickerNotice = picker.getByRole('alert');
    expect(pickerNotice).toHaveTextContent(t('providers.catalogs.listFailed'));
    // Not a deployment that ships nothing: the read failed.
    expect(catalogEmpty()).not.toBeInTheDocument();
    // The way to define a provider of one's own stays.
    expect(
      picker.getByRole('button', { name: /Custom provider/ }),
    ).toBeVisible();

    backend.on(CATALOGS, () => Response.json({ catalogs: [ANTHROPIC] }));
    await user.click(
      within(pickerNotice).getByRole('button', { name: tryAgain() }),
    );

    expect(
      await picker.findByRole('button', { name: /^Anthropic/ }),
    ).toBeVisible();
    expect(picker.queryByRole('alert')).not.toBeInTheDocument();
    // The Try again that held the focus is gone: the search took it.
    await waitFor(() =>
      expect(
        picker.getByPlaceholderText(t('providers.searchPlaceholder')),
      ).toHaveFocus(),
    );
  });

  it('keeps the picker saying it failed while Try again runs', async () => {
    backend.on(CATALOGS, () => serverFault());
    const { user } = renderPage();
    await screen.findByRole('alert');
    const picker = await openPicker(user);
    const retry = within(picker.getByRole('alert')).getByRole('button', {
      name: tryAgain(),
    });

    let answer: (response: Response) => void = () => {};
    backend.on(
      CATALOGS,
      () => new Promise<Response>((resolve) => (answer = resolve)),
    );
    await user.click(retry);

    // react-query resets a read that never answered to `pending` as the
    // retry starts; the notice holds, its button busy and focused, and the
    // picker neither turns into its loading state nor calls itself empty.
    await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
    expect(retry).toHaveFocus();
    expect(catalogEmpty()).not.toBeInTheDocument();

    answer(Response.json({ catalogs: [ANTHROPIC] }));
    expect(
      await picker.findByRole('button', { name: /^Anthropic/ }),
    ).toBeVisible();
  });

  it('shows a credential list that never loaded as one error with Try again, never as empty', async () => {
    backend.on(CREDENTIALS, () => serverFault());
    const { user } = renderPage();

    const retry = await screen.findByRole('button', {
      name: tCommon('errors.tryAgain'),
    });
    expect(backend.count(CREDENTIALS)).toBe(4);
    expect(emptyState()).not.toBeInTheDocument();
    // One error: the table's own, no notice above it.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(SERVER_SENTENCE);

    backend.on(CREDENTIALS, () =>
      Response.json({ credentials: [PRODUCTION_KEY] }),
    );
    await user.click(retry);

    expect(await screen.findByText('Production key')).toBeVisible();
    expect(emptyState()).not.toBeInTheDocument();
  });

  it('keeps the rows a failed refresh left, under a notice that says so', async () => {
    const { user } = renderPage();
    await screen.findByText('Production key');

    backend.on(CREDENTIALS, () => serverFault());
    void client.invalidateQueries();
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(t('credentials.refreshFailed'));
    expect(screen.getByText('Production key')).toBeVisible();

    backend.on(CREDENTIALS, () =>
      Response.json({ credentials: [PRODUCTION_KEY] }),
    );
    await user.click(within(notice).getByRole('button', { name: tryAgain() }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Production key')).toBeVisible();
  });

  it('passes an axe audit with both failures shown', async () => {
    backend.on(CATALOGS, () => serverFault());
    backend.on(CREDENTIALS, () => serverFault());
    const { container } = renderPage();
    await screen.findByRole('alert');
    // The catalog notice's Try again, and the table's.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: tryAgain() })).toHaveLength(
        2,
      ),
    );

    await checkAccessibility(container);
  });

  describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
    beforeEach(async () => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
    });

    it('names a failed catalog read without the server text', async () => {
      backend.on(CATALOGS, () => serverFault());
      renderPage();

      const notice = await screen.findByRole('alert');
      // A fault has nothing to add to the page's own sentence.
      expect(notice).toHaveTextContent(t('providers.catalogs.listFailed'));
      expect(notice).not.toHaveTextContent(SERVER_SENTENCE);
      expect(
        within(notice).getByRole('button', { name: tryAgain() }),
      ).toBeVisible();
    });

    it('names a lost connection in the reader language, never "Failed to fetch"', async () => {
      backend.on(CATALOGS, () => connectionLost());
      renderPage();

      const notice = await screen.findByRole('alert');
      expect(notice).toHaveTextContent(t('providers.catalogs.listFailed'));
      expect(notice).toHaveTextContent(tCommon('errors.connectionLost'));
      expect(notice).not.toHaveTextContent('Failed to fetch');
    });

    it('shows a credential list it could not reach as the table error', async () => {
      backend.on(CREDENTIALS, () => connectionLost());
      renderPage();

      expect(
        await screen.findByRole('button', {
          name: tCommon('errors.tryAgain'),
        }),
      ).toBeVisible();
      expect(emptyState()).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent('Failed to fetch');
    });

    it('has its own words for every new sentence', () => {
      for (const key of [
        'providers.catalogs.listFailed',
        'credentials.refreshFailed',
      ]) {
        expect(t(key)).not.toBe(key);
        if (locale !== 'en') {
          expect(t(key)).not.toBe(i18n.t(key, { ns: 'settings', lng: 'en' }));
        }
      }
    });
  });
});
