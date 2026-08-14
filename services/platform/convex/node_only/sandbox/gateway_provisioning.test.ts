import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { getProviderCatalog } from '../../lib/providers/catalog_fetch';
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
    provisionProviders: vi.fn(async () => {}),
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

afterEach(() => {
  vi.clearAllMocks();
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

  it('provisions a custom provider under its per-model record so the mint can bind', async () => {
    // deepseek is NOT a standard gateway provider, so it routes per model
    // (`deepseek__deepseek-v4-flash`). The provision record must carry that
    // exact name, or the mint's key lookup 404s and fails closed.
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
        name: 'deepseek__deepseek-v4-flash',
        models: ['deepseek-v4-flash'],
        apiKey: 'sk-ds',
      }),
    ]);
  });

  it('continues past a provider whose provision fails (mint fails closed later)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedResolve.mockRejectedValueOnce(new Error('no default credential'));
    mockedResolve.mockResolvedValueOnce(apiKeyResolution('sk-b'));
    await provisionSessionGatewayKey(fakeCtx(), {
      organizationId: 'org_1',
      sessionId: 'sess-2',
      allowedModels: [
        { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
        { providerSlug: 'anthropic', modelId: 'claude-fable-5' },
      ],
      budgetCents: 100,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("building provision for 'openrouter' failed"),
      expect.anything(),
    );
    expect(provisionProviders).toHaveBeenCalledWith('org_1', [
      expect.objectContaining({ name: 'anthropic', apiKey: 'sk-b' }),
    ]);
    expect(mintVirtualKey).toHaveBeenCalled();
    warn.mockRestore();
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
