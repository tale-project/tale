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

const { listModelApiModels, modelApiId, splitModelApiId } =
  await import('./models.ts');

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
      harnessEndpoint: {
        baseUrl: 'https://openrouter.ai/api',
        apiFormat: 'anthropic',
      },
    },
    { name: 'deepseek' },
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

    expect(composer.listGovernedChatModels).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-1', userId: 'user-1' },
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
        connector: { name: 'deepseek' },
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
