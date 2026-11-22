import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProviderCatalog } from '../../core/lib/providers/catalog_fetch.ts';
import { resolveProvidersForOrgId } from '../../core/lib/providers/org_providers.ts';
import { buildProviderProvision } from '../../core/node_only/sandbox/gateway_provisioning.ts';
import { relayDeps } from './deps.ts';
import { UpstreamUnavailableError } from './endpoint.ts';
import type { RelayGrant } from './store.ts';

vi.mock('../../core/node_only/sandbox/gateway_provisioning.ts', () => ({
  buildProviderProvision: vi.fn(),
}));
vi.mock('../../core/lib/providers/org_providers.ts', () => ({
  resolveProvidersForOrgId: vi.fn(),
}));
vi.mock('../../core/lib/providers/catalog_fetch.ts', () => ({
  getProviderCatalog: vi.fn(),
}));
vi.mock('../../lib/ctx-shim.ts', () => ({ createCtxShim: vi.fn(() => ({})) }));
vi.mock('../../lib/org-config.ts', () => ({
  orgAdapterShimHandlers: vi.fn(() => ({})),
}));
vi.mock('../provider_credentials/service.ts', () => ({
  credentialShimHandlers: vi.fn(() => ({})),
}));
vi.mock('./store.ts', () => ({
  grantOf: vi.fn(),
  remainingCents: vi.fn(),
  bookCall: vi.fn(),
}));

const LARGE: ModelCatalogEntry = {
  id: 'acme-large',
  provider: 'acme',
  tags: ['chat'],
  supportsTools: true,
  supportsVision: false,
  contextWindow: 128_000,
};

const GRANT: RelayGrant = {
  organizationId: 'org_1',
  sessionId: 'session_1',
  keyId: 'tr_1',
  allowedModels: [{ providerSlug: 'acme', modelId: 'acme-large' }],
  servingCredentials: { acme: 'cred_turn' },
};

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the resolution under test never reaches Postgres
const SQL = (() => Promise.resolve([])) as unknown as Sql;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_000_000);
  vi.mocked(buildProviderProvision).mockResolvedValue({
    name: 'acme',
    baseUrl: 'https://llm.acme.example/v1',
    apiKey: 'sk-acme',
    models: ['acme-large'],
    credentialId: 'cred_turn',
  });
  vi.mocked(resolveProvidersForOrgId).mockResolvedValue([
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the name is read
    { name: 'acme' } as Awaited<
      ReturnType<typeof resolveProvidersForOrgId>
    >[number],
  ]);
  vi.mocked(getProviderCatalog).mockResolvedValue([LARGE]);
});

afterEach(() => {
  vi.useRealTimers();
});

/** The connector a relayed call is served by (tale-project/tale#4942). */
describe('relayDeps().connectorFor', () => {
  it('serves a model with the credential its turn was minted with, on the OpenAI wire when the provider names no format', async () => {
    const served = await relayDeps(SQL).connectorFor(
      GRANT,
      'acme',
      'acme-large',
    );

    expect(buildProviderProvision).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      providerSlug: 'acme',
      credentialId: 'cred_turn',
    });
    expect(served).toEqual({
      connector: {
        name: 'acme',
        apiFormat: 'openai',
        baseUrl: 'https://llm.acme.example/v1',
        apiKey: 'sk-acme',
      },
      entry: LARGE,
    });
  });

  it('serves a connector its grant names no credential for with the default one', async () => {
    await relayDeps(SQL).connectorFor(
      { ...GRANT, servingCredentials: {} },
      'acme',
      'acme-large',
    );

    expect(buildProviderProvision).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      providerSlug: 'acme',
    });
  });

  it('resolves a connector once for 30 s, then asks again, so a disabled credential stops serving', async () => {
    const deps = relayDeps(SQL);
    await deps.connectorFor(GRANT, 'acme', 'acme-large');
    vi.setSystemTime(1_000_000 + 29_999);
    await deps.connectorFor(GRANT, 'acme', 'acme-large');
    expect(buildProviderProvision).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000_000 + 30_000);
    await deps.connectorFor(GRANT, 'acme', 'acme-large');
    expect(buildProviderProvision).toHaveBeenCalledTimes(2);
  });

  it('keeps no failed resolution: the next call asks again', async () => {
    vi.mocked(buildProviderProvision).mockRejectedValueOnce(
      new Error('credential disabled'),
    );
    const deps = relayDeps(SQL);

    await expect(
      deps.connectorFor(GRANT, 'acme', 'acme-large'),
    ).rejects.toThrow('credential disabled');
    await expect(
      deps.connectorFor(GRANT, 'acme', 'acme-large'),
    ).resolves.toMatchObject({ connector: { name: 'acme' } });
    expect(buildProviderProvision).toHaveBeenCalledTimes(2);
  });

  it('refuses a credential the relay cannot serve', async () => {
    vi.mocked(buildProviderProvision).mockResolvedValueOnce(null);

    await expect(
      relayDeps(SQL).connectorFor(GRANT, 'acme', 'acme-large'),
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it('serves a model its catalog does not list without a catalog entry', async () => {
    const served = await relayDeps(SQL).connectorFor(
      GRANT,
      'acme',
      'acme-unlisted',
    );

    expect(served.entry).toBeUndefined();
  });
});
