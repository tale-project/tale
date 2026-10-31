/**
 * The models a key holder may call through the model endpoints: the
 * composer's governed listing (credential allowlists and model access
 * already applied) narrowed to what the gateway serves — direct credentials
 * on fixed-endpoint connectors — under the one id both wires take.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const composer = vi.hoisted(() => ({ listGovernedChatModels: vi.fn() }));
vi.mock('../chat/composer.ts', () => composer);

const providers = vi.hoisted(() => ({ resolveProvidersForOrg: vi.fn() }));
vi.mock('../../core/lib/providers/org_providers.ts', () => providers);

const {
  listModelApiModels,
  modelApiId,
  offeredModelApiModels,
  ridesModelApiAnthropicLane,
  splitModelApiId,
} = await import('./models.ts');
type ModelApiModel = import('./models.ts').ModelApiModel;

function option(
  providerSlug: string,
  id: string,
  authMethod: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    label: id,
    providerSlug,
    providerLabel: providerSlug,
    credential:
      authMethod === 'subscription-key'
        ? {
            authMethod,
            constraints: { execution: 'sandbox', harness: 'claude-code' },
          }
        : { authMethod },
    tools: true,
    contextWindow: 128_000,
    tags: ['chat'],
    ...extra,
  };
}

beforeEach(() => {
  providers.resolveProvidersForOrg.mockReturnValue([
    {
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      harnessEndpoint: {
        baseUrl: 'https://openrouter.ai/api',
        apiFormat: 'anthropic',
      },
    },
    { name: 'deepseek', baseUrl: 'https://api.deepseek.com' },
    { name: 'azure', endpointMode: 'per-credential' },
    { name: 'anthropic' },
  ]);
});

describe('listModelApiModels', () => {
  it('keeps the direct, gateway-servable models, under <provider>/<model>', async () => {
    composer.listGovernedChatModels.mockResolvedValue([
      option('openrouter', 'anthropic/claude-sonnet-4.6', 'api-key', {
        vision: true,
        maxOutputTokens: 64_000,
        pricing: { inputCentsPerMillion: 300, outputCentsPerMillion: 1500 },
      }),
      option('deepseek', 'deepseek-v4-flash', 'env'),
      // A subscription credential runs only in its vendor's harness.
      option('anthropic', 'claude-opus-4-8', 'subscription-key'),
      // A per-credential endpoint is not provisioned into the gateway.
      option('azure', 'gpt-5', 'api-key'),
      // A connector the organization no longer defines.
      option('gone', 'x', 'api-key'),
    ]);

    const models = await listModelApiModels({} as never, {
      organizationId: 'org-1',
      orgSlug: 'acme',
      userId: 'user-1',
    });

    // Every model, the ones the EU/EEA rule refuses a direct call too: the
    // endpoints judge the gateway's upstream on each wire instead.
    expect(composer.listGovernedChatModels).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-1', userId: 'user-1', withRefusedEndpoints: true },
    );
    expect(providers.resolveProvidersForOrg).toHaveBeenCalledWith('acme');
    expect(models).toEqual([
      {
        id: 'openrouter/anthropic/claude-sonnet-4.6',
        providerSlug: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4.6',
        label: 'anthropic/claude-sonnet-4.6',
        vision: true,
        tools: true,
        contextWindow: 128_000,
        maxOutputTokens: 64_000,
        pricing: { inputCentsPerMillion: 300, outputCentsPerMillion: 1500 },
        connector: {
          name: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          harnessEndpoint: {
            baseUrl: 'https://openrouter.ai/api',
            apiFormat: 'anthropic',
          },
        },
      },
      {
        id: 'deepseek/deepseek-v4-flash',
        providerSlug: 'deepseek',
        modelId: 'deepseek-v4-flash',
        label: 'deepseek-v4-flash',
        vision: false,
        tools: true,
        contextWindow: 128_000,
        connector: { name: 'deepseek', baseUrl: 'https://api.deepseek.com' },
      },
    ]);
  });

  it('leaves out a model whose tools work only on the Responses API, which these endpoints do not relay', async () => {
    providers.resolveProvidersForOrg.mockReturnValue([{ name: 'openai' }]);
    composer.listGovernedChatModels.mockResolvedValue([
      option('openai', 'gpt-6.1-sol', 'api-key', {
        toolCallingApi: 'responses',
      }),
      option('openai', 'gpt-6-luna', 'api-key'),
    ]);

    const models = await listModelApiModels({} as never, {
      organizationId: 'org-1',
      orgSlug: 'acme',
      userId: 'user-1',
    });

    expect(models.map((model) => model.id)).toEqual(['openai/gpt-6-luna']);
  });
});

describe('model ids', () => {
  it('split at the first slash, the catalog id keeping its own', () => {
    expect(splitModelApiId('openrouter/anthropic/claude-sonnet-4.6')).toEqual({
      providerSlug: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4.6',
    });
    expect(modelApiId('deepseek', 'deepseek-v4-flash')).toBe(
      'deepseek/deepseek-v4-flash',
    );
  });

  it('name no connector without a slash, or with an empty half', () => {
    expect(splitModelApiId('claude-sonnet-4-6')).toBeNull();
    expect(splitModelApiId('/x')).toBeNull();
    expect(splitModelApiId('x/')).toBeNull();
  });
});

describe('the Anthropic lane', () => {
  const native = {
    connector: {
      name: 'openrouter',
      harnessEndpoint: {
        baseUrl: 'https://eu.openrouter.ai/api',
        apiFormat: 'anthropic' as const,
      },
    },
  };

  it('is ridden by the Anthropic wire on a connector with a native Anthropic endpoint, and by nothing else', () => {
    expect(ridesModelApiAnthropicLane('anthropic', native)).toBe(true);
    expect(ridesModelApiAnthropicLane('openai', native)).toBe(false);
    expect(
      ridesModelApiAnthropicLane('anthropic', {
        connector: { name: 'openrouter' },
      }),
    ).toBe(false);
  });
});

describe('what a key holder is offered under the EU/EEA processing rule [GOV-R22]', () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the rule reads only the provider and its connector
  const models = [
    {
      id: 'openrouter/anthropic/claude-sonnet-4.6',
      providerSlug: 'openrouter',
      connector: {
        name: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        harnessEndpoint: {
          baseUrl: 'https://eu.openrouter.ai/api',
          apiFormat: 'anthropic',
        },
      },
    },
    {
      id: 'acme/acme-large',
      providerSlug: 'acme',
      connector: { name: 'acme', baseUrl: 'https://llm.acme.eu/v1' },
    },
    {
      id: 'deepseek/deepseek-v4-flash',
      providerSlug: 'deepseek',
      connector: { name: 'deepseek', baseUrl: 'https://api.deepseek.com' },
    },
  ] as unknown as ModelApiModel[];
  const eu = { kind: 'eu', attestedHosts: ['llm.acme.eu'] } as const;

  function offered(...args: Parameters<typeof offeredModelApiModels>) {
    const { kept, hiddenBy } = offeredModelApiModels(...args);
    return { kept: kept.map((model) => model.id), hiddenBy };
  }

  it('offers every model while the rule is off', () => {
    expect(offered({ kind: 'open' }, models, ['openai', 'anthropic'])).toEqual({
      kept: models.map((model) => model.id),
      hiddenBy: undefined,
    });
  });

  it('judges the upstream of each wire, and keeps a model one of them lets through', () => {
    // The gateway's built-in connection to a vendor never qualifies; an
    // endpoint the connector names does when it processes in the EU/EEA.
    expect(offered(eu, models, ['openai'])).toEqual({
      kept: ['acme/acme-large'],
      hiddenBy: 'eu',
    });
    expect(offered(eu, models, ['openai', 'anthropic'])).toEqual({
      kept: ['openrouter/anthropic/claude-sonnet-4.6', 'acme/acme-large'],
      hiddenBy: 'eu',
    });
  });

  it('offers nothing while the policy cannot be read, and says so', () => {
    expect(
      offered({ kind: 'unreadable' }, models, ['openai', 'anthropic']),
    ).toEqual({ kept: [], hiddenBy: 'unreadable' });
  });
});
