import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../../lib/shared/errors/app-error';
import type { ActionCtx } from '../../lib/ctx';
import { getProviderCatalog } from '../../lib/providers/catalog_fetch';
import type { Id } from '../../lib/rows';
import { resolveProviderCredential } from '../../provider_credentials/resolve_credential';
import {
  buildProviderProvision,
  provisionSessionGatewayKey,
} from './gateway_provisioning';
import {
  applyGatewayConfig,
  mintVirtualKey,
  provisionProviders,
} from './llm_gateway_admin';

vi.mock('./llm_gateway_admin', async (importOriginal) => {
  const original = await importOriginal<typeof import('./llm_gateway_admin')>();
  return {
    ...original,
    provisionProviders: vi.fn(async () => []),
    applyGatewayConfig: vi.fn(async () => {}),
    mintVirtualKey: vi.fn(async () => ({ key: 'sk-bf-t', keyId: 'vk-9' })),
  };
});
vi.mock('../../provider_credentials/resolve_credential', () => ({
  resolveProviderCredential: vi.fn(),
}));
vi.mock('../../lib/providers/catalog_fetch', () => ({
  getProviderCatalog: vi.fn(async () => [
    { id: 'anthropic/claude-sonnet-5' },
    { id: 'openai/gpt-5.5' },
  ]),
}));
// The org-aware connector resolution needs a live org-slug lookup; serve the
// SHIPPED connector set directly so the tests pin the real system YAMLs.
vi.mock('../../lib/providers/org_providers', () => ({
  resolveProvidersForOrgId: vi.fn(async () => {
    const { loadProviderDefinitions } =
      await import('../../lib/providers/load_system_config');
    return loadProviderDefinitions();
  }),
}));

const mockedResolve = vi.mocked(resolveProviderCredential);
const mockedCatalog = vi.mocked(getProviderCatalog);

/** Fake ActionCtx whose runQuery serves the credential-row read. */
function fakeCtx(row: { modelAllowlist?: string[] } | null = {}): ActionCtx {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only runQuery is exercised by this module
  return { runQuery: vi.fn(async () => row) } as unknown as ActionCtx;
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- opaque branded id in a unit test
const asCredId = (id: string) => id as Id<'providerCredentials'>;

function apiKeyResolution(secret = 'sk-live') {
  return {
    authMethod: 'api-key',
    credentialId: asCredId('cred-1'),
    name: 'Main key',
    secret,
  } as const;
}

// The provisioning entry fails closed on the gateway admin password; give
// every test a default so only the precondition test below removes it.
beforeEach(() => {
  vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', 'pw-test');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('buildProviderProvision', () => {
  it('builds an api-key provision from the shipped connector + full catalog', async () => {
    mockedResolve.mockResolvedValue(apiKeyResolution());
    const provision = await buildProviderProvision(fakeCtx(), {
      organizationId: 'org_1',
      providerSlug: 'openrouter',
    });
    expect(provision).toEqual({
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiFormat: 'openai',
      apiKey: 'sk-live',
      models: ['anthropic/claude-sonnet-5', 'openai/gpt-5.5'],
    });
  });

  it('uses an env credential secret the same way', async () => {
    mockedResolve.mockResolvedValue({
      authMethod: 'env',
      credentialId: asCredId('cred-2'),
      name: 'Env key',
      envName: 'TALE_PROVIDER_KEY_OPENROUTER',
      secret: 'from-env',
    });
    const provision = await buildProviderProvision(fakeCtx(), {
      organizationId: 'org_1',
      providerSlug: 'openrouter',
    });
    expect(provision?.apiKey).toBe('from-env');
  });

  it("prefers the credential's own model allowlist over the catalog", async () => {
    mockedResolve.mockResolvedValue(apiKeyResolution());
    const provision = await buildProviderProvision(
      fakeCtx({ modelAllowlist: ['anthropic/claude-fable-5'] }),
      { organizationId: 'org_1', providerSlug: 'openrouter' },
    );
    expect(provision?.models).toEqual(['anthropic/claude-fable-5']);
    expect(mockedCatalog).not.toHaveBeenCalled();
  });

  it('returns null for a subscription-broker credential (never gateway-served)', async () => {
    mockedResolve.mockResolvedValue({
      authMethod: 'subscription-broker',
      credentialId: asCredId('cred-3'),
      name: 'Claude sub',
      token: 'tok',
      targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
      poolSize: 2,
    });
    await expect(
      buildProviderProvision(fakeCtx(), {
        organizationId: 'org_1',
        providerSlug: 'anthropic',
      }),
    ).resolves.toBeNull();
  });

  it('rejects an unknown provider slug', async () => {
    await expect(
      buildProviderProvision(fakeCtx(), {
        organizationId: 'org_1',
        providerSlug: 'not-a-provider',
      }),
    ).rejects.toThrow('no shipped or org-defined connector');
    expect(mockedResolve).not.toHaveBeenCalled();
  });
});

describe('provisionSessionGatewayKey', () => {
  const MODELS = [
    { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
    { providerSlug: 'openrouter', modelId: 'openai/gpt-5.5' },
  ];

  it('provisions each involved provider once, hardens config, mints, and hashes', async () => {
    mockedResolve.mockResolvedValue(apiKeyResolution());
    const result = await provisionSessionGatewayKey(fakeCtx(), {
      organizationId: 'org_1',
      sessionId: 'sess-1',
      allowedModels: MODELS,
      budgetCents: 500,
    });
    // One provision for the one unique provider, despite two models.
    expect(mockedResolve).toHaveBeenCalledTimes(1);
    expect(provisionProviders).toHaveBeenCalledWith('org_1', [
      expect.objectContaining({ name: 'openrouter', apiKey: 'sk-live' }),
    ]);
    expect(applyGatewayConfig).toHaveBeenCalledTimes(1);
    expect(mintVirtualKey).toHaveBeenCalledWith({
      budgetCents: 500,
      allowedModels: MODELS,
      organizationId: 'org_1',
      sessionId: 'sess-1',
    });
    expect(result.token).toBe('sk-bf-t');
    expect(result.keyId).toBe('vk-9');
    expect(result.keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("provisions a custom provider under the org's per-model record so the mint can bind", async () => {
    // deepseek is NOT a standard gateway provider, so it routes per (org,
    // model) (`org_1__deepseek__deepseek-v4-flash`). The provision record
    // must carry that exact name, or the mint's key lookup 404s and fails
    // closed.
    mockedResolve.mockResolvedValue(apiKeyResolution('sk-ds'));
    // Only `id` is read by buildProviderProvision; the rest of the catalog
    // shape is irrelevant here.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    mockedCatalog.mockResolvedValue([
      { id: 'deepseek-v4-flash' },
      { id: 'deepseek-v4-pro' },
    ] as unknown as Awaited<ReturnType<typeof getProviderCatalog>>);
    await provisionSessionGatewayKey(fakeCtx(), {
      organizationId: 'org_1',
      sessionId: 'sess-ds',
      allowedModels: [
        { providerSlug: 'deepseek', modelId: 'deepseek-v4-flash' },
      ],
      budgetCents: 500,
    });
    // One credential resolve for the connector, one per-model gateway record.
    expect(mockedResolve).toHaveBeenCalledTimes(1);
    expect(provisionProviders).toHaveBeenCalledWith('org_1', [
      expect.objectContaining({
        name: 'org_1__deepseek__deepseek-v4-flash',
        models: ['deepseek-v4-flash'],
        apiKey: 'sk-ds',
      }),
    ]);
  });

  it('keeps two orgs sharing a custom connector name on separate gateway records', async () => {
    // A custom connector is an org-defined file; two orgs may both ship an
    // `internal.yml`-style connector under one name (here the shipped
    // `deepseek` stands in) with different endpoints or wire formats. One
    // shared record let the last org to provision rewrite base_url for
    // both — org A's inference, carrying A's key, went to B's endpoint.
    mockedResolve.mockResolvedValue(apiKeyResolution('sk-shared-name'));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    mockedCatalog.mockResolvedValue([
      { id: 'deepseek-v4-flash' },
    ] as unknown as Awaited<ReturnType<typeof getProviderCatalog>>);
    const models = [{ providerSlug: 'deepseek', modelId: 'deepseek-v4-flash' }];
    await provisionSessionGatewayKey(fakeCtx(), {
      organizationId: 'org_a',
      sessionId: 'sess-a',
      allowedModels: models,
      budgetCents: 100,
    });
    await provisionSessionGatewayKey(fakeCtx(), {
      organizationId: 'org_b',
      sessionId: 'sess-b',
      allowedModels: models,
      budgetCents: 100,
    });
    const names = vi
      .mocked(provisionProviders)
      .mock.calls.map(([org, provisions]) => [org, provisions[0]?.name]);
    expect(names).toEqual([
      ['org_a', 'org_a__deepseek__deepseek-v4-flash'],
      ['org_b', 'org_b__deepseek__deepseek-v4-flash'],
    ]);
  });

  it('refuses to mint when a needed credential is disabled (no stale-key fallback)', async () => {
    // The gateway still holds the org's upstream key from the last
    // successful provision. Continuing past the failed resolve used to bind
    // a fresh virtual key to that stale secret — a credential the admin just
    // disabled kept serving sandbox turns.
    mockedResolve.mockRejectedValueOnce(
      new AppError({
        code: 'CREDENTIAL_DISABLED',
        message: 'Credential "Main key" is disabled',
      }),
    );
    await expect(
      provisionSessionGatewayKey(fakeCtx(), {
        organizationId: 'org_1',
        sessionId: 'sess-2',
        allowedModels: [
          { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
        ],
        budgetCents: 100,
      }),
    ).rejects.toThrow(
      'Provider "openrouter" cannot serve this session: Credential "Main key" is disabled',
    );
    expect(provisionProviders).not.toHaveBeenCalled();
    expect(mintVirtualKey).not.toHaveBeenCalled();
  });

  it('refuses to mint when a needed provider has no default credential left', async () => {
    // Deleting the default credential leaves the provider unresolvable; the
    // vision provider's failure fails the session exactly like the serving
    // provider's — every model on the key must be backed by a live credential.
    mockedResolve.mockResolvedValueOnce(apiKeyResolution('sk-a'));
    mockedResolve.mockRejectedValueOnce(
      new AppError({
        code: 'CREDENTIAL_NONE_CONFIGURED',
        message: 'No default credential is configured for provider "anthropic"',
      }),
    );
    await expect(
      provisionSessionGatewayKey(fakeCtx(), {
        organizationId: 'org_1',
        sessionId: 'sess-2b',
        allowedModels: [
          { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
          { providerSlug: 'anthropic', modelId: 'claude-fable-5' },
        ],
        budgetCents: 100,
      }),
    ).rejects.toThrow(
      'Provider "anthropic" cannot serve this session: No default credential is configured for provider "anthropic"',
    );
    expect(provisionProviders).not.toHaveBeenCalled();
    expect(mintVirtualKey).not.toHaveBeenCalled();
  });

  it('fails closed before any credential resolve or gateway call when the admin password is unset', async () => {
    // An anonymous management plane on the sandbox network would let sandboxed
    // code mint its own keys — refuse the whole session up front, once.
    vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', undefined);
    vi.stubEnv('LLM_GATEWAY_ADMIN_PASSWORD', undefined);
    mockedResolve.mockResolvedValue(apiKeyResolution());
    await expect(
      provisionSessionGatewayKey(fakeCtx(), {
        organizationId: 'org_1',
        sessionId: 'sess-5',
        allowedModels: MODELS,
        budgetCents: 100,
      }),
    ).rejects.toThrow('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD is not set');
    expect(mockedResolve).not.toHaveBeenCalled();
    expect(provisionProviders).not.toHaveBeenCalled();
    expect(applyGatewayConfig).not.toHaveBeenCalled();
    expect(mintVirtualKey).not.toHaveBeenCalled();
  });

  it("refuses to mint when a needed provider's gateway push failed (no stale-key mint)", async () => {
    // provisionProviders never throws — it returns what did not land. The
    // gateway still holds the org's key from the last successful push under
    // the same stable name, so a mint here would bind the session to that
    // pre-rotation secret: opaque upstream 401s after a key rotation, or
    // spend on a credential the admin revoked.
    mockedResolve.mockResolvedValue(apiKeyResolution());
    vi.mocked(provisionProviders).mockResolvedValueOnce([
      {
        name: 'openrouter',
        error: new Error(
          'llm-gateway update key for openrouter/org org_1 failed (503): upstream unavailable',
        ),
      },
    ]);
    await expect(
      provisionSessionGatewayKey(fakeCtx(), {
        organizationId: 'org_1',
        sessionId: 'sess-2c',
        allowedModels: MODELS,
        budgetCents: 100,
      }),
    ).rejects.toThrow(
      'Provider "openrouter" cannot serve this session: its credential could not be pushed to the sandbox LLM gateway (llm-gateway update key for openrouter/org org_1 failed (503): upstream unavailable)',
    );
    expect(applyGatewayConfig).not.toHaveBeenCalled();
    expect(mintVirtualKey).not.toHaveBeenCalled();
  });

  it("names the CONNECTOR, not the per-model record, when a custom provider's push failed", async () => {
    mockedResolve.mockResolvedValue(apiKeyResolution('sk-ds'));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    mockedCatalog.mockResolvedValue([
      { id: 'deepseek-v4-flash' },
    ] as unknown as Awaited<ReturnType<typeof getProviderCatalog>>);
    vi.mocked(provisionProviders).mockResolvedValueOnce([
      {
        name: 'org_1__deepseek__deepseek-v4-flash',
        error: new Error('llm-gateway create key failed (500)'),
      },
    ]);
    await expect(
      provisionSessionGatewayKey(fakeCtx(), {
        organizationId: 'org_1',
        sessionId: 'sess-2d',
        allowedModels: [
          { providerSlug: 'deepseek', modelId: 'deepseek-v4-flash' },
        ],
        budgetCents: 100,
      }),
    ).rejects.toThrow(/^Provider "deepseek" cannot serve this session/);
    expect(mintVirtualKey).not.toHaveBeenCalled();
  });

  it('propagates an auth-posture failure (fail-closed, never mints)', async () => {
    mockedResolve.mockResolvedValue(apiKeyResolution());
    vi.mocked(applyGatewayConfig).mockRejectedValueOnce(
      new Error('config PUT failed'),
    );
    await expect(
      provisionSessionGatewayKey(fakeCtx(), {
        organizationId: 'org_1',
        sessionId: 'sess-3',
        allowedModels: MODELS,
        budgetCents: 100,
      }),
    ).rejects.toThrow('config PUT failed');
    expect(mintVirtualKey).not.toHaveBeenCalled();
  });

  it('passes an explicit credential selection through to resolution', async () => {
    mockedResolve.mockResolvedValue(apiKeyResolution());
    await provisionSessionGatewayKey(fakeCtx(), {
      organizationId: 'org_1',
      sessionId: 'sess-4',
      allowedModels: [
        { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
      ],
      credentialIds: { openrouter: asCredId('cred-42') },
      budgetCents: 100,
    });
    expect(mockedResolve).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      providerSlug: 'openrouter',
      credentialId: 'cred-42',
    });
  });
});
