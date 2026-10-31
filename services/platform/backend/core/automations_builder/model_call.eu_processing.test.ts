// @vitest-environment node

/**
 * A builder model call (an automation's llm step, a thread title, a prompt
 * rewrite) resolves its endpoint once, in `prepare` or on the first call:
 * with the organization's EU/EEA rule on, that endpoint is judged there,
 * ahead of the catalog read and of any request, and a refused one throws
 * with the surface and the caller in its audit entry (GOV-R17).
 */

import { providerDefinitionSchema } from '@tale/shared/schemas/providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getProviderCatalog, resolveProviders, safeFetch } = vi.hoisted(() => ({
  getProviderCatalog: vi.fn(),
  resolveProviders: vi.fn(),
  safeFetch: vi.fn(),
}));

vi.mock('../lib/providers/org_providers', () => ({
  resolveProvidersForOrgId: resolveProviders,
}));
vi.mock('../lib/providers/catalog_fetch', () => ({ getProviderCatalog }));
vi.mock('../provider_credentials/resolve_credential', () => ({
  resolveProviderCredential: vi.fn(),
}));
vi.mock('../../../lib/net/safe-fetch', () => ({
  safeFetch,
  SafeFetchError: class SafeFetchError extends Error {},
}));

import { createCtxShim } from '../../lib/ctx-shim';
import {
  ModelEndpointRefusal,
  type ModelEndpointPolicy,
} from '../governance/model_endpoint_gate';
import type { ActionCtx } from '../lib/ctx';
import { resolveProviderCredential } from '../provider_credentials/resolve_credential';
import { type BuilderModelArgs, createBuilderModel } from './model_call';

const openrouter = providerDefinitionSchema.parse({
  name: 'openrouter',
  displayName: 'OpenRouter',
  apiFormat: 'openai',
  baseUrl: 'https://openrouter.ai/api/v1',
  catalog: { source: 'models-endpoint' },
  embedding: 'unknown',
  auth: [{ method: 'api-key' }],
});

const custom = providerDefinitionSchema.parse({
  name: 'house-llm',
  displayName: 'House LLM',
  apiFormat: 'openai',
  baseUrl: 'https://llm.example.eu/v1',
  catalog: { source: 'models-endpoint' },
  embedding: 'unknown',
  auth: [{ method: 'api-key' }],
});

const EU: ModelEndpointPolicy = {
  kind: 'eu',
  attestedHosts: ['llm.example.eu'],
};

const STEP: BuilderModelArgs = {
  organizationId: 'org_1',
  target: { providerSlug: 'openrouter', modelId: 'openai/gpt-5' },
  surface: 'automation',
  actor: { id: 'run_1', type: 'workflow' },
};

function credential(endpointUrl?: string) {
  vi.mocked(resolveProviderCredential).mockResolvedValue({
    authMethod: 'api-key',
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an id the wire never reads
    credentialId: 'cred_1' as never,
    name: 'default',
    secret: 'sk-synthetic',
    ...(endpointUrl !== undefined ? { endpointUrl } : {}),
  });
}

function gateCtx(policy: ModelEndpointPolicy) {
  const audit = vi.fn(async (_args: unknown) => null);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the call reaches only the mocked providers and the governance seams
  const ctx = createCtxShim({
    'governance/internal_queries:getModelEndpointPolicyInternal': async () =>
      policy,
    'governance/internal_mutations:recordModelEndpointRefusal': audit,
  }) as unknown as ActionCtx;
  return { ctx, audit };
}

function send(model: ReturnType<typeof createBuilderModel>) {
  return model({
    messages: [{ role: 'user', content: 'Summarize the ticket.' }],
    temperature: 0,
    turn: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveProviders.mockResolvedValue([openrouter, custom]);
  getProviderCatalog.mockResolvedValue([]);
  safeFetch.mockResolvedValue({
    status: 200,
    body: JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Done.' } }],
    }),
  });
  credential();
});

describe('createBuilderModel — the EU/EEA rule [GOV-R17]', () => {
  it('refuses in prepare, before the catalog read and any request, and audits the step', async () => {
    const { ctx, audit } = gateCtx(EU);
    const model = createBuilderModel(ctx, STEP);
    const refused = model.prepare?.();
    await expect(refused).rejects.toBeInstanceOf(ModelEndpointRefusal);
    await expect(refused).rejects.toMatchObject({
      data: {
        code: 'MODEL_ENDPOINT_OUTSIDE_EU',
        host: 'openrouter.ai',
        reason: 'vendor-global',
      },
    });
    expect(getProviderCatalog).not.toHaveBeenCalled();
    expect(safeFetch).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        organizationId: 'org_1',
        surface: 'automation',
        provider: 'openrouter',
        model: 'openai/gpt-5',
        actor: { id: 'run_1', type: 'workflow' },
      }),
    );
  });

  it('refuses on the first call when nothing prepared it', async () => {
    const { ctx } = gateCtx(EU);
    await expect(
      send(
        createBuilderModel(ctx, {
          ...STEP,
          surface: 'chat-title',
          actor: { id: 'user_1', type: 'user' },
        }),
      ),
    ).rejects.toMatchObject({ data: { code: 'MODEL_ENDPOINT_OUTSIDE_EU' } });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('sends OpenRouter only to its EU endpoint', async () => {
    credential('https://eu.openrouter.ai/api/v1');
    const { ctx, audit } = gateCtx(EU);
    await expect(send(createBuilderModel(ctx, STEP))).resolves.toMatchObject({
      content: 'Done.',
    });
    expect(safeFetch).toHaveBeenCalledExactlyOnceWith(
      'https://eu.openrouter.ai/api/v1/chat/completions',
      expect.anything(),
    );
    expect(audit).not.toHaveBeenCalled();
  });

  it('lets a custom provider an admin marked as processing in the EU/EEA through', async () => {
    const { ctx } = gateCtx(EU);
    await expect(
      send(
        createBuilderModel(ctx, {
          ...STEP,
          target: { providerSlug: 'house-llm', modelId: 'house-model' },
        }),
      ),
    ).resolves.toMatchObject({ content: 'Done.' });
    expect(safeFetch).toHaveBeenCalledExactlyOnceWith(
      'https://llm.example.eu/v1/chat/completions',
      expect.anything(),
    );
  });

  it('names the platform when the call is made for no one', async () => {
    const { ctx, audit } = gateCtx({ kind: 'unreadable' });
    const { actor: _actor, ...platform } = STEP;
    await expect(
      createBuilderModel(ctx, platform).prepare?.(),
    ).rejects.toMatchObject({
      data: { code: 'MODEL_ENDPOINT_POLICY_UNREADABLE' },
    });
    expect(audit).toHaveBeenCalledExactlyOnceWith(
      expect.not.objectContaining({ actor: expect.anything() }),
    );
  });

  it('changes nothing while the switch is off', async () => {
    const { ctx, audit } = gateCtx({ kind: 'open' });
    await expect(send(createBuilderModel(ctx, STEP))).resolves.toMatchObject({
      content: 'Done.',
    });
    expect(safeFetch).toHaveBeenCalledExactlyOnceWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.anything(),
    );
    expect(audit).not.toHaveBeenCalled();
  });
});
