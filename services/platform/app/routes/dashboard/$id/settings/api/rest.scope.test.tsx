import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiKey } from '@/app/features/settings/api-keys/types';
import { i18n } from '@/lib/i18n/i18n';
import { render, screen } from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

// Which keys the page lists: an Owner or Admin chooses between the keys they
// manage and every key that works here, the members' own keys included;
// anyone else is asked for the keys they manage alone. The page runs for real
// (`useApiKeys`, `backendFetch`, `ApiKeysTable`) against a closed synthetic
// transport.

const h = vi.hoisted(() => ({
  member: undefined as
    | undefined
    | { status: 'ok'; userId: string; role: string; isAdmin: boolean },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useParams: () => ({ id: 'org-1' }),
  }),
}));
vi.mock(
  '@/app/features/settings/model-endpoints/hooks/use-api-settings-access',
  () => ({ useApiSettingsAccess: () => ({ createApiKeys: true }) }),
);
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: h.member }),
}));
// The create dialog has its own suites, and stays closed here.
vi.mock(
  '@/app/features/settings/api-keys/components/api-key-create-dialog',
  () => ({ ApiKeyCreateDialog: () => null }),
);

const { Route } = await import('./rest');
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- createFileRoute is mocked to return the config
const ApiRestPage = (
  Route as unknown as { component: () => React.ReactElement }
).component;

const MANAGED = /^GET \/api\/app\/api-keys\?orgId=org-1$/;
const ALL = /^GET \/api\/app\/api-keys\?scope=all&orgId=org-1$/;

const OWN: ApiKey = {
  id: 'key-own',
  name: 'CI deploy key',
  start: 'tale_abc',
  prefix: 'tale_',
  suffix: 'wxyz',
  enabled: true,
  expiresAt: null,
  createdAt: Date.UTC(2026, 9, 1),
  lastRequest: null,
  owner: { kind: 'user' },
  role: null,
  createdBy: null,
  canRevoke: true,
};

const MIAS_LAPTOP: ApiKey = {
  ...OWN,
  id: 'key-mia',
  name: 'Laptop',
  owner: {
    kind: 'personal',
    userId: 'mia',
    name: 'Mia Keller',
    email: 'mia@example.test',
  },
  canRevoke: false,
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  backend = syntheticBackend();
  backend.on(MANAGED, () => Response.json({ keys: [OWN] }));
  backend.on(ALL, () =>
    Response.json({ keys: [OWN, MIAS_LAPTOP], personalKeys: 'admitted' }),
  );
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
});

afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <QueryClientProvider client={client}>
      <ApiRestPage />
    </QueryClientProvider>,
  );
}

const scopeLabel = () => i18n.t('apiKeys.scope.label', { ns: 'settings' });
const allKeys = () => i18n.t('apiKeys.scope.all', { ns: 'settings' });
const allKeysDescription = () =>
  i18n.t('apiKeys.allKeysDescription', { ns: 'settings' });
const refusedNotice = () =>
  i18n.t('apiKeys.scope.personalKeysRefused', { ns: 'settings' });
const unavailableNotice = () =>
  i18n.t('apiKeys.scope.personalKeysUnavailable', { ns: 'settings' });

describe('the API keys page’s choice of keys [APIKEY-R8]', () => {
  it('lists every key that works here when an Owner or Admin asks for it', async () => {
    h.member = { status: 'ok', userId: 'ada', role: 'admin', isAdmin: true };
    const { user } = renderPage();

    expect(await screen.findByText('CI deploy key')).toBeInTheDocument();
    expect(
      screen.getByRole('radiogroup', { name: scopeLabel() }),
    ).toBeVisible();
    expect(screen.queryByText('Laptop')).not.toBeInTheDocument();
    expect(backend.count(ALL)).toBe(0);

    await user.click(screen.getByRole('radio', { name: allKeys() }));
    expect(await screen.findByText('Laptop')).toBeInTheDocument();
    expect(screen.getByText('Mia Keller')).toBeInTheDocument();
    expect(document.body).toHaveTextContent(allKeysDescription());
    expect(document.body).not.toHaveTextContent(refusedNotice());
    expect(document.body).not.toHaveTextContent(unavailableNotice());
    expect(backend.count(ALL)).toBe(1);
  });

  it.each([
    ['refused', refusedNotice],
    ['unavailable', unavailableNotice],
  ] as const)(
    'says why every key here holds no member’s own key while they are %s [APIKEY-R12]',
    async (personalKeys, notice) => {
      h.member = { status: 'ok', userId: 'ada', role: 'owner', isAdmin: true };
      // The door refuses every person's own key then, the Owner's too, so
      // the server lists only the keys bound here.
      backend.on(ALL, () => Response.json({ keys: [], personalKeys }));
      const { user } = renderPage();

      expect(await screen.findByText('CI deploy key')).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(notice());

      await user.click(screen.getByRole('radio', { name: allKeys() }));
      expect(await screen.findByText(notice())).toBeVisible();
      expect(screen.queryByText('Laptop')).not.toBeInTheDocument();
      expect(screen.queryByText('CI deploy key')).not.toBeInTheDocument();

      // The keys the Owner manages still hold their own, with no notice.
      await user.click(
        screen.getByRole('radio', {
          name: i18n.t('apiKeys.scope.managed', { ns: 'settings' }),
        }),
      );
      expect(await screen.findByText('CI deploy key')).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(notice());
    },
  );

  it('gives a member no choice, and asks only for the keys they manage', async () => {
    h.member = { status: 'ok', userId: 'mia', role: 'member', isAdmin: false };
    renderPage();

    expect(await screen.findByText('CI deploy key')).toBeInTheDocument();
    expect(
      screen.queryByRole('radiogroup', { name: scopeLabel() }),
    ).not.toBeInTheDocument();
    expect(backend.count(MANAGED)).toBe(1);
    expect(backend.count(ALL)).toBe(0);
  });
});
