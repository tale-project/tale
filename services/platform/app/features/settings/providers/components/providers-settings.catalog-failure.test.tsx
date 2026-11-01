import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SettingsHeaderActionsSetter,
  type SettingsHeaderAction,
} from '@/app/features/settings/components/settings-secondary-action-context';
import type { ProviderCatalogFailureCode } from '@/app/lib/backend/contract/lib';
import { i18n } from '@/lib/i18n/i18n';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { configure, render, screen } from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import type { MaskedCredential, ProviderCatalog } from '../hooks/queries';
import { ProvidersSettings } from './providers-settings';

// The real retry policy may ask again before a read settles; on a loaded
// runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #5223: a provider whose model listing failed showed the server's English
// words on its credential row and in the Refresh catalogs report ("Request
// timed out after 20000ms", "catalog fetch returned HTTP 401") in every
// locale; only a listing that answered without a model list had a sentence.
// The page's reads and the refresh run for real here (hooks, adapter rows,
// `backendFetch`) against a closed synthetic transport.

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
const REFRESH = /^POST \/api\/app\/providers\/catalogs\/refresh\?orgId=org-1$/;

/** What the server says of a listing that got no answer in time. */
const TIMED_OUT = 'Request timed out after 20000ms';
/** What it says of a listing whose endpoint refused the key. */
const KEY_REFUSED = 'catalog fetch returned HTTP 401';

/** OpenRouter, whose listing failed for the reason `code` names. */
function failedOpenRouter(
  catalogError: string,
  catalogErrorCode: ProviderCatalogFailureCode,
): ProviderCatalog {
  return {
    name: 'openrouter',
    displayName: 'OpenRouter',
    apiFormat: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    catalogSource: 'openrouter-api',
    authMethods: ['api-key'],
    models: [],
    catalogError,
    catalogErrorCode,
  } as unknown as ProviderCatalog;
}

const ROUTER_KEY = {
  id: 'cred-1',
  name: 'Router key',
  providerSlug: 'openrouter',
  authMethod: 'api-key',
  maskedPreview: 'sk-or…4f2',
  isDefault: true,
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
} as unknown as MaskedCredential;

/** "Refresh catalogs" registers into the settings shell's header; the test
 * stands up the slot the route provides. */
function WithHeaderSlot({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<SettingsHeaderAction[]>([]);
  return (
    <SettingsHeaderActionsSetter.Provider value={setActions}>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </button>
      ))}
      {children}
    </SettingsHeaderActionsSetter.Provider>
  );
}

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  backend = syntheticBackend();
  backend.on(CATALOGS, () =>
    Response.json({
      catalogs: [failedOpenRouter(TIMED_OUT, 'PROVIDER_CATALOG_UNREACHABLE')],
    }),
  );
  backend.on(CREDENTIALS, () => Response.json({ credentials: [ROUTER_KEY] }));
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
      <WithHeaderSlot>
        <ProvidersSettings organizationId="org-1" />
      </WithHeaderSlot>
    </QueryClientProvider>,
  );
}

const t = (key: string) => i18n.t(key, { ns: 'settings' });
const inEnglish = (key: string) => i18n.t(key, { ns: 'settings', lng: 'en' });

const FAILURE_SENTENCES = [
  'providers.custom.errors.catalogUnreachable',
  'providers.custom.errors.catalogKeyRefused',
  'providers.custom.errors.catalogUpstreamError',
];

describe(
  'ProvidersSettings when a model listing fails',
  { timeout: 30_000 },
  () => {
    describe('in de', () => {
      beforeEach(async () => {
        saveLocale('de');
        await i18n.changeLanguage('de');
      });

      it('names the failure in German on its row and in the refresh report, the server words after it', async () => {
        const { user } = renderPage();

        // The row: the sentence of the failure's code, then what the server
        // said of it.
        expect(
          await screen.findByText(
            'Modellkatalog nicht verfügbar: Der Endpunkt ist nicht erreichbar oder hat nicht rechtzeitig geantwortet. Prüfe, ob er läuft und ob diese Bereitstellung ihn erreicht. (Request timed out after 20000ms)',
          ),
        ).toBeVisible();

        // Asked again, the endpoint refuses the key, and the listing read
        // afresh says so too.
        backend.on(REFRESH, () =>
          Response.json({
            results: [
              {
                name: 'openrouter',
                modelCount: 0,
                error: KEY_REFUSED,
                errorCode: 'PROVIDER_CATALOG_KEY_REFUSED',
              },
            ],
          }),
        );
        backend.on(CATALOGS, () =>
          Response.json({
            catalogs: [
              failedOpenRouter(KEY_REFUSED, 'PROVIDER_CATALOG_KEY_REFUSED'),
            ],
          }),
        );
        await user.click(
          screen.getByRole('button', { name: 'Kataloge aktualisieren' }),
        );

        expect(
          await screen.findByText(
            'OpenRouter: Der Endpunkt hat den API-Schlüssel abgelehnt oder braucht einen. Prüfe die Standard-Zugangsdaten des Anbieters und ihren Schlüssel. (catalog fetch returned HTTP 401)',
          ),
        ).toBeVisible();
        expect(
          await screen.findByText(
            'Modellkatalog nicht verfügbar: Der Endpunkt hat den API-Schlüssel abgelehnt oder braucht einen. Prüfe die Standard-Zugangsdaten des Anbieters und ihren Schlüssel. (catalog fetch returned HTTP 401)',
          ),
        ).toBeVisible();
        expect(backend.count(REFRESH)).toBe(1);
        for (const key of FAILURE_SENTENCES) {
          expect(document.body).not.toHaveTextContent(inEnglish(key));
        }
      });
    });

    describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
      beforeEach(async () => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
      });

      it('names an unreachable listing on its row in the reader language', async () => {
        renderPage();

        expect(
          await screen.findByText(
            t('providers.custom.errors.catalogUnreachable'),
            { exact: false },
          ),
        ).toBeVisible();
        expect(document.body).toHaveTextContent(TIMED_OUT);
      });

      it('has its own words for every listing failure', () => {
        for (const key of FAILURE_SENTENCES) {
          expect(t(key)).not.toBe(key);
          if (locale !== 'en') expect(t(key)).not.toBe(inEnglish(key));
        }
      });
    });
  },
);
