import { createHash } from 'node:crypto';

import type { ProviderDefinition } from '@tale/shared/schemas/providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../../lib/shared/errors/app-error';
import { createCtxShim } from '../../../lib/ctx-shim';
import {
  ModelEndpointRefusal,
  type ModelEndpointPolicy,
} from '../../governance/model_endpoint_gate';
import type { ActionCtx } from '../../lib/ctx';
import { getProviderCatalog } from '../../lib/providers/catalog_fetch';
import { loadProviderDefinitions as loadShippedProviders } from '../../lib/providers/load_system_config';
import { resolveProvidersForOrgId } from '../../lib/providers/org_providers';
import type { Id } from '../../lib/rows';
import { resolveProviderCredential } from '../../provider_credentials/resolve_credential';
import {
  buildProviderProvision,
  gatewayProvisioningFailureStage,
  issueRelayKey,
} from './gateway_provisioning';

vi.mock('../../provider_credentials/resolve_credential', () => ({
  resolveProviderCredential: vi.fn(),
}));
vi.mock('../../lib/providers/catalog_fetch', () => ({
  getProviderCatalog: vi.fn(async () => [
    {
      id: 'anthropic/claude-sonnet-5',
      pricing: { inputCentsPerMillion: 300, outputCentsPerMillion: 1500 },
    },
    // No published price.
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
/** The audit seam a refusal of the EU/EEA rule writes to. */
const audit = vi.fn(async (_entry: unknown) => null);

/** Fake ActionCtx serving the credential-row read and the EU/EEA rule's two
 * seams; the rule is off unless a test names one. */
function fakeCtx(
  row: { modelAllowlist?: string[] } | null = {},
  policy: ModelEndpointPolicy = { kind: 'open' },
): ActionCtx {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the module reaches only these seams
  return createCtxShim({
    'provider_credentials/queries:getCredentialInternal': async () => row,
    'governance/internal_queries:getModelEndpointPolicyInternal': async () =>
      policy,
    'governance/internal_mutations:recordModelEndpointRefusal': audit,
  }) as unknown as ActionCtx;
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
  it('builds an api-key provision from the shipped connector', async () => {
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
      // The connector's Anthropic endpoint, which the Claude Code lane rides.
      harnessEndpoint: {
        baseUrl: 'https://openrouter.ai/api',
        apiFormat: 'anthropic',
      },
      // The credential resolved, which a relay key serves its turn with.
      credentialId: 'cred-1',
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

  it('reads no catalog: the turn named its models when it was resolved', async () => {
    mockedResolve.mockResolvedValue(apiKeyResolution());
    await buildProviderProvision(fakeCtx(), {
      organizationId: 'org_1',
      providerSlug: 'openrouter',
    });
    expect(mockedCatalog).not.toHaveBeenCalled();
  });

  it('returns null for a subscription-broker credential (never relay-served)', async () => {
    mockedResolve.mockResolvedValue({
      authMethod: 'subscription-broker',
      credentialId: asCredId('cred-3'),
      name: 'Claude sub',
      token: 'tok',
      targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
      brokerTokenHash: 'synthetic-broker-account-hash',
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

/** A subscription credential: its forced harness authenticates directly, so
 * the relay has nothing to serve it with. */
const SUBSCRIPTION_RESOLUTION = {
  authMethod: 'subscription-broker',
  credentialId: asCredId('cred-3'),
  name: 'Claude sub',
  token: 'tok',
  targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
  brokerTokenHash: 'synthetic-broker-account-hash',
} as const;

/** What a call threw — failing the test when it did not throw. */
async function refusalOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => {
      throw new Error('expected the provisioning to refuse');
    },
    (error: unknown) => error,
  );
}

describe('gatewayProvisioningFailureStage', () => {
  const ARGS = {
    organizationId: 'org_1',
    allowedModels: [
      { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
    ],
    surface: 'task' as const,
  };

  describe('credential — the credential could not be resolved or used', () => {
    it('a disabled or deleted credential, keeping its message and cause', async () => {
      const cause = new AppError({
        code: 'CREDENTIAL_DISABLED',
        message: 'Credential "Main key" is disabled',
      });
      mockedResolve.mockRejectedValueOnce(cause);

      const refusal = await refusalOf(issueRelayKey(fakeCtx(), ARGS));

      expect(gatewayProvisioningFailureStage(refusal)).toBe('credential');
      expect((refusal as Error).message).toBe(
        'Provider "openrouter" cannot serve this session: Credential "Main key" is disabled',
      );
      expect((refusal as Error).cause).toBe(cause);
    });

    it('an unknown provider', async () => {
      const refusal = await refusalOf(
        issueRelayKey(fakeCtx(), {
          ...ARGS,
          allowedModels: [{ providerSlug: 'not-a-provider', modelId: 'm' }],
        }),
      );

      expect(gatewayProvisioningFailureStage(refusal)).toBe('credential');
      expect((refusal as Error).message).toMatch(
        /^Provider "not-a-provider" cannot serve this session: Unknown provider/,
      );
    });

    it('a secret that could not be read', async () => {
      const cause = new Error('the credential secret could not be decrypted');
      mockedResolve.mockRejectedValueOnce(cause);

      const refusal = await refusalOf(issueRelayKey(fakeCtx(), ARGS));

      expect(gatewayProvisioningFailureStage(refusal)).toBe('credential');
      expect((refusal as Error).cause).toBe(cause);
    });

    it('a subscription-only credential', async () => {
      mockedResolve.mockResolvedValue(SUBSCRIPTION_RESOLUTION);

      const refusal = await refusalOf(
        issueRelayKey(fakeCtx(), {
          ...ARGS,
          allowedModels: [
            { providerSlug: 'anthropic', modelId: 'claude-fable-5' },
          ],
        }),
      );

      expect(gatewayProvisioningFailureStage(refusal)).toBe('credential');
    });
  });

  describe('gateway — anything else', () => {
    it('a policy read that failed, whose own error comes through as it was', async () => {
      const failure = new Error('the governance policy could not be read');
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the module reaches only these seams
      const ctx = createCtxShim({
        'provider_credentials/queries:getCredentialInternal': async () => ({}),
        'governance/internal_queries:getModelEndpointPolicyInternal':
          async () => {
            throw failure;
          },
        'governance/internal_mutations:recordModelEndpointRefusal': audit,
      }) as unknown as ActionCtx;

      const refusal = await refusalOf(issueRelayKey(ctx, ARGS));

      expect(refusal).toBe(failure);
      expect(gatewayProvisioningFailureStage(refusal)).toBe('gateway');
    });

    it('anything else, including a foreign error that claims a stage', () => {
      expect(gatewayProvisioningFailureStage(new Error('boom'))).toBe(
        'gateway',
      );
      expect(gatewayProvisioningFailureStage('boom')).toBe('gateway');
      expect(gatewayProvisioningFailureStage(undefined)).toBe('gateway');
      expect(
        gatewayProvisioningFailureStage(
          Object.assign(new Error('not ours'), { stage: 'credential' }),
        ),
      ).toBe('gateway');
    });
  });
});

describe('issueRelayKey — the EU/EEA rule [GOV-R17]', () => {
  const EU: ModelEndpointPolicy = { kind: 'eu', attestedHosts: [] };
  const DEEPSEEK = { providerSlug: 'deepseek', modelId: 'deepseek-v4-flash' };
  const SONNET = 'anthropic/claude-sonnet-5';

  /** A connector of the org's own, shaped like the shipped `shippedName`:
   * an entry named like a shipped one replaces it. */
  function ownConnector(
    shippedName: string,
    own: { name?: string; baseUrl: string; harnessBaseUrl?: string },
  ): ProviderDefinition {
    const shipped = loadShippedProviders().find(
      (entry) => entry.name === shippedName,
    );
    if (shipped === undefined) {
      throw new Error(`no shipped connector "${shippedName}"`);
    }
    const { harnessEndpoint: _shippedHarness, ...rest } = shipped;
    return {
      ...rest,
      name: own.name ?? shipped.name,
      baseUrl: own.baseUrl,
      ...(own.harnessBaseUrl !== undefined
        ? {
            harnessEndpoint: {
              baseUrl: own.harnessBaseUrl,
              apiFormat: 'anthropic' as const,
            },
          }
        : {}),
    };
  }

  /** Serve the shipped connectors with the org's own `extra` on top. */
  function withConnectors(...extra: ProviderDefinition[]): void {
    vi.mocked(resolveProvidersForOrgId).mockImplementation(async () => [
      ...loadShippedProviders().filter(
        (entry) => !extra.some((own) => own.name === entry.name),
      ),
      ...extra,
    ]);
  }

  /** The rule refused before any credential resolved. */
  function expectNothingResolved(): void {
    expect(mockedResolve).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    mockedResolve.mockResolvedValue(apiKeyResolution());
  });

  afterEach(() => {
    vi.mocked(resolveProvidersForOrgId).mockImplementation(async () => [
      ...loadShippedProviders(),
    ]);
  });

  it('refuses an upstream outside the EU/EEA before any credential resolves, and audits it', async () => {
    const refusal = await refusalOf(
      issueRelayKey(fakeCtx({}, EU), {
        organizationId: 'org_1',
        allowedModels: [DEEPSEEK],
        surface: 'task',
        actor: { id: 'user-7', type: 'user' },
      }),
    );

    expect(refusal).toBeInstanceOf(ModelEndpointRefusal);
    expect(refusal).toMatchObject({
      data: {
        code: 'MODEL_ENDPOINT_OUTSIDE_EU',
        provider: 'deepseek',
        host: 'api.deepseek.com',
        reason: 'not-attested',
      },
    });
    expect(audit).toHaveBeenCalledWith({
      organizationId: 'org_1',
      surface: 'task',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      host: 'api.deepseek.com',
      reason: 'not-attested',
      code: 'MODEL_ENDPOINT_OUTSIDE_EU',
      message: expect.stringContaining('api.deepseek.com is not an endpoint'),
      actor: { id: 'user-7', type: 'user' },
    });
    expectNothingResolved();
  });

  it("lets a provider on a vendor's EU endpoint through", async () => {
    withConnectors(
      ownConnector('openai', {
        name: 'openai-eu',
        baseUrl: 'https://eu.api.openai.com/v1',
      }),
    );

    const key = await issueRelayKey(fakeCtx({}, EU), {
      organizationId: 'org_1',
      allowedModels: [{ providerSlug: 'openai-eu', modelId: 'gpt-5.5' }],
      surface: 'task',
    });

    expect(key.servingCredentials).toEqual({ 'openai-eu': 'cred-1' });
    expect(audit).not.toHaveBeenCalled();
  });

  it('lets a host an admin attested through', async () => {
    const key = await issueRelayKey(
      fakeCtx({}, { kind: 'eu', attestedHosts: ['api.deepseek.com'] }),
      {
        organizationId: 'org_1',
        allowedModels: [DEEPSEEK],
        surface: 'task',
      },
    );

    expect(key.relayModels).toEqual([DEEPSEEK]);
    expect(audit).not.toHaveBeenCalled();
  });

  describe('OpenRouter passes only through eu.openrouter.ai', () => {
    it('lets the OpenRouter provider through where it names eu.openrouter.ai, as the relay calls it there', async () => {
      withConnectors(
        ownConnector('openrouter', {
          baseUrl: 'https://eu.openrouter.ai/api/v1',
        }),
      );

      const key = await issueRelayKey(fakeCtx({}, EU), {
        organizationId: 'org_1',
        allowedModels: [{ providerSlug: 'openrouter', modelId: SONNET }],
        surface: 'task',
      });

      expect(key.servingCredentials).toEqual({ openrouter: 'cred-1' });
      expect(audit).not.toHaveBeenCalled();
    });

    it('refuses it at openrouter.ai, on the chat wire and the Anthropic lane alike', async () => {
      for (const anthropicHarnessLane of [false, true]) {
        vi.mocked(audit).mockClear();
        const refusal = await refusalOf(
          issueRelayKey(fakeCtx({}, EU), {
            organizationId: 'org_1',
            allowedModels: [
              {
                providerSlug: 'openrouter',
                modelId: SONNET,
                ...(anthropicHarnessLane ? { anthropicHarnessLane } : {}),
              },
            ],
            surface: 'task',
          }),
        );

        expect(refusal).toBeInstanceOf(ModelEndpointRefusal);
        expect(refusal).toMatchObject({
          data: {
            provider: 'openrouter',
            host: 'openrouter.ai',
            reason: 'vendor-global',
          },
        });
        expect(audit).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: 'openrouter',
            model: SONNET,
            reason: 'vendor-global',
          }),
        );
      }
      expectNothingResolved();
    });

    it('lets through the Anthropic lane of a provider whose coding-agent endpoint is eu.openrouter.ai', async () => {
      withConnectors(
        ownConnector('openrouter', {
          baseUrl: 'https://openrouter.ai/api/v1',
          harnessBaseUrl: 'https://eu.openrouter.ai/api',
        }),
      );

      await issueRelayKey(fakeCtx({}, EU), {
        organizationId: 'org_1',
        allowedModels: [
          {
            providerSlug: 'openrouter',
            modelId: SONNET,
            anthropicHarnessLane: true,
          },
        ],
        surface: 'task',
      });

      expect(audit).not.toHaveBeenCalled();
    });
  });

  it('refuses at the first model the rule refuses, before any credential resolves', async () => {
    const refusal = await refusalOf(
      issueRelayKey(
        fakeCtx({}, { kind: 'eu', attestedHosts: ['api.deepseek.com'] }),
        {
          organizationId: 'org_1',
          allowedModels: [
            DEEPSEEK,
            { providerSlug: 'openai', modelId: 'gpt-5.5' },
          ],
          surface: 'task',
        },
      ),
    );

    expect(refusal).toBeInstanceOf(ModelEndpointRefusal);
    expect(refusal).toMatchObject({
      data: {
        provider: 'openai',
        host: 'api.openai.com',
        reason: 'vendor-global',
      },
    });
    expectNothingResolved();
  });

  it('refuses a credential the relay cannot serve as a credential failure, not the rule', async () => {
    withConnectors(
      ownConnector('openai', {
        name: 'openai-eu',
        baseUrl: 'https://eu.api.openai.com/v1',
      }),
    );
    mockedResolve.mockResolvedValue(SUBSCRIPTION_RESOLUTION);

    const refusal = await refusalOf(
      issueRelayKey(fakeCtx({}, EU), {
        organizationId: 'org_1',
        allowedModels: [{ providerSlug: 'openai-eu', modelId: 'gpt-5.5' }],
        surface: 'task',
      }),
    );

    expect(refusal).not.toBeInstanceOf(ModelEndpointRefusal);
    expect(gatewayProvisioningFailureStage(refusal)).toBe('credential');
    expect((refusal as Error).message).toContain(
      'Provider "openai-eu" cannot serve this session',
    );
    expect(audit).not.toHaveBeenCalled();
  });

  it('refuses every model while the policy cannot be read', async () => {
    const refusal = await refusalOf(
      issueRelayKey(fakeCtx({}, { kind: 'unreadable' }), {
        organizationId: 'org_1',
        allowedModels: [DEEPSEEK],
        surface: 'task',
      }),
    );

    expect(refusal).toMatchObject({
      data: { code: 'MODEL_ENDPOINT_POLICY_UNREADABLE', provider: 'deepseek' },
    });
    expectNothingResolved();
  });

  it('names the model API request and its key owner in the audit entry', async () => {
    await refusalOf(
      issueRelayKey(fakeCtx({}, EU), {
        organizationId: 'org_1',
        allowedModels: [DEEPSEEK],
        surface: 'model-api',
        actor: { id: 'user-9', type: 'api' },
      }),
    );

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'model-api',
        actor: { id: 'user-9', type: 'api' },
      }),
    );
  });

  it('changes nothing with the switch off', async () => {
    const key = await issueRelayKey(fakeCtx(), {
      organizationId: 'org_1',
      allowedModels: [
        DEEPSEEK,
        { providerSlug: 'openrouter', modelId: SONNET },
      ],
      surface: 'task',
    });

    expect(key.servingCredentials).toEqual({
      deepseek: 'cred-1',
      openrouter: 'cred-1',
    });
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('issueRelayKey — a turn key for the model relay', () => {
  beforeEach(() => {
    mockedResolve.mockResolvedValue(apiKeyResolution());
  });

  it('mints a key the relay serves, with each connector’s credential', async () => {
    const key = await issueRelayKey(fakeCtx(), {
      organizationId: 'org_1',
      allowedModels: [
        { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
        {
          providerSlug: 'openrouter',
          modelId: 'anthropic/claude-sonnet-5',
          anthropicHarnessLane: true,
        },
      ],
      surface: 'task',
    });

    expect(key.token).toMatch(/^tale-rt-[A-Za-z0-9_-]{43}$/);
    expect(key.keyId).toMatch(/^tr_[0-9a-f-]{36}$/);
    expect(key.keyHash).toBe(
      createHash('sha256').update(key.token).digest('hex'),
    );
    expect(key.relayModels).toEqual([
      { providerSlug: 'openrouter', modelId: 'anthropic/claude-sonnet-5' },
      {
        providerSlug: 'openrouter',
        modelId: 'anthropic/claude-sonnet-5',
        anthropicHarnessLane: true,
      },
    ]);
    expect(key.servingCredentials).toEqual({ openrouter: 'cred-1' });
    // Each key is its own.
    const again = await issueRelayKey(fakeCtx(), {
      organizationId: 'org_1',
      allowedModels: [
        { providerSlug: 'openrouter', modelId: 'openai/gpt-5.5' },
      ],
      surface: 'task',
    });
    expect(again.token).not.toBe(key.token);
    expect(again.keyId).not.toBe(key.keyId);
  });

  it('refuses, as a credential failure, a connector whose credential does not resolve', async () => {
    mockedResolve.mockRejectedValue(new Error('the credential was deleted'));
    const refusal = await refusalOf(
      issueRelayKey(fakeCtx(), {
        organizationId: 'org_1',
        allowedModels: [
          { providerSlug: 'openrouter', modelId: 'openai/gpt-5.5' },
        ],
        surface: 'task',
      }),
    );
    expect(gatewayProvisioningFailureStage(refusal)).toBe('credential');
    expect((refusal as Error).message).toContain('the credential was deleted');
  });

  it('refuses a subscription credential, which runs only in its vendor’s own harness', async () => {
    mockedResolve.mockResolvedValue({
      authMethod: 'subscription-key',
      credentialId: asCredId('cred-sub'),
      name: 'Claude subscription',
      secret: 'sk-ant-oat-x',
    } as const);
    const refusal = await refusalOf(
      issueRelayKey(fakeCtx(), {
        organizationId: 'org_1',
        allowedModels: [
          { providerSlug: 'anthropic', modelId: 'claude-sonnet-5' },
        ],
        surface: 'task',
      }),
    );
    expect(gatewayProvisioningFailureStage(refusal)).toBe('credential');
    expect((refusal as Error).message).toContain(
      'cannot be served through the model relay',
    );
  });
});
