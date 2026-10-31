// @vitest-environment node

/**
 * Every embedding — a search's query, a document or an email being indexed,
 * a crawled page — gets its embedder from `embedderForOrg`. With the
 * organization's EU/EEA rule on, the endpoint that embedder would call is
 * judged there, once the credential names it and before any client is built,
 * so a refused one sends no text anywhere and is audited (GOV-R17).
 */

import type { KnowledgeEmbeddingConfig } from '@tale/shared/schemas/knowledge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedProviderCredential } from '../provider_credentials/resolve_credential';

const { constructed, resolveCredential, resolveProviders } = vi.hoisted(() => ({
  constructed: [] as Record<string, unknown>[],
  resolveCredential:
    vi.fn<(...args: unknown[]) => Promise<ResolvedProviderCredential>>(),
  resolveProviders: vi.fn(),
}));

vi.mock('../provider_credentials/resolve_credential', () => ({
  resolveProviderCredential: resolveCredential,
}));
vi.mock('../lib/providers/org_providers', () => ({
  resolveProvidersForOrgId: resolveProviders,
}));
vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>();
  class ObservedOpenAI extends actual.default {
    constructor(options: ConstructorParameters<typeof actual.default>[0]) {
      super(options);
      constructed.push({ ...options });
    }
  }
  return { ...actual, default: ObservedOpenAI };
});

import { createCtxShim } from '../../lib/ctx-shim';
import {
  ModelEndpointRefusal,
  type ModelEndpointPolicy,
} from '../governance/model_endpoint_gate';
import type { ActionCtx } from '../lib/ctx';
import type { Id } from '../lib/rows';
import { embedderForOrg } from './embedding';

const EU: ModelEndpointPolicy = {
  kind: 'eu',
  attestedHosts: ['llm.example.eu'],
};

const OPENAI: KnowledgeEmbeddingConfig = {
  providerSlug: 'openai',
  model: 'text-embedding-3-small',
  dimensions: 3,
};

function credential(endpointUrl?: string): ResolvedProviderCredential {
  return {
    authMethod: 'api-key',
    credentialId: 'cred_1' as Id<'providerCredentials'>,
    name: 'default',
    secret: 'sk-synthetic',
    ...(endpointUrl !== undefined ? { endpointUrl } : {}),
  };
}

function gateCtx(policy: ModelEndpointPolicy) {
  const audit = vi.fn(async (_args: unknown) => null);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the embedder reaches only the credential row, the mocked resolvers and the governance seams
  const ctx = createCtxShim({
    'provider_credentials/queries:getDefaultCredentialInternal': async () => ({
      _id: 'cred_1',
      organizationId: 'org_1',
      providerSlug: 'openai',
      status: 'active',
      authMethod: 'api-key',
    }),
    'governance/internal_queries:getModelEndpointPolicyInternal': async () =>
      policy,
    'governance/internal_mutations:recordModelEndpointRefusal': audit,
  }) as unknown as ActionCtx;
  return { ctx, audit };
}

function embedder(
  ctx: ActionCtx,
  config: KnowledgeEmbeddingConfig = OPENAI,
  actor?: { id: string; type: 'user' },
) {
  return embedderForOrg(ctx, {
    organizationId: 'org_1',
    orgSlug: 'acme',
    config,
    ...(actor !== undefined ? { actor } : {}),
  });
}

beforeEach(() => {
  constructed.length = 0;
  vi.clearAllMocks();
  resolveCredential.mockResolvedValue(credential());
  resolveProviders.mockResolvedValue([
    { name: 'openai', baseUrl: 'https://api.openai.com/v1' },
    { name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
    { name: 'house-llm', baseUrl: 'https://llm.example.eu/v1' },
    { name: 'no-endpoint' },
  ]);
});

describe('embedderForOrg — the EU/EEA rule [GOV-R17]', () => {
  it('refuses a vendor’s global endpoint before any client is built, and audits who asked', async () => {
    const { ctx, audit } = gateCtx(EU);
    const refused = embedder(ctx, OPENAI, { id: 'user_1', type: 'user' });
    await expect(refused).rejects.toBeInstanceOf(ModelEndpointRefusal);
    await expect(refused).rejects.toMatchObject({
      data: {
        code: 'MODEL_ENDPOINT_OUTSIDE_EU',
        provider: 'openai',
        host: 'api.openai.com',
        reason: 'vendor-global',
        message: expect.stringContaining('eu.api.openai.com'),
      },
    });
    expect(constructed).toEqual([]);
    expect(audit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        organizationId: 'org_1',
        surface: 'embedding',
        provider: 'openai',
        model: 'text-embedding-3-small',
        actor: { id: 'user_1', type: 'user' },
      }),
    );
  });

  it('lets the credential’s EU endpoint through', async () => {
    resolveCredential.mockResolvedValue(
      credential('https://eu.api.openai.com/v1'),
    );
    const { ctx, audit } = gateCtx(EU);
    await expect(embedder(ctx)).resolves.toMatchObject({ dimensions: 3 });
    expect(constructed).toEqual([
      expect.objectContaining({ baseURL: 'https://eu.api.openai.com/v1' }),
    ]);
    expect(audit).not.toHaveBeenCalled();
  });

  it('sends OpenRouter only to its EU endpoint', async () => {
    const openrouter = { ...OPENAI, providerSlug: 'openrouter' };
    const { ctx } = gateCtx(EU);
    await expect(embedder(ctx, openrouter)).rejects.toMatchObject({
      data: { code: 'MODEL_ENDPOINT_OUTSIDE_EU', host: 'openrouter.ai' },
    });
    await expect(
      embedder(ctx, {
        ...openrouter,
        baseUrl: 'https://eu.openrouter.ai/api/v1',
      }),
    ).resolves.toMatchObject({ dimensions: 3 });
    expect(constructed).toEqual([
      expect.objectContaining({ baseURL: 'https://eu.openrouter.ai/api/v1' }),
    ]);
  });

  it('lets a custom provider an admin marked as processing in the EU/EEA through', async () => {
    const { ctx, audit } = gateCtx(EU);
    await expect(
      embedder(ctx, { ...OPENAI, providerSlug: 'house-llm' }),
    ).resolves.toMatchObject({ dimensions: 3 });
    expect(constructed).toEqual([
      expect.objectContaining({ baseURL: 'https://llm.example.eu/v1' }),
    ]);
    expect(audit).not.toHaveBeenCalled();
  });

  it('refuses when nothing names an endpoint: the SDK’s default host is not one the rule vouches for', async () => {
    const { ctx, audit } = gateCtx(EU);
    await expect(
      embedder(ctx, { ...OPENAI, providerSlug: 'no-endpoint' }),
    ).rejects.toMatchObject({
      data: { code: 'MODEL_ENDPOINT_OUTSIDE_EU', reason: 'unknown-endpoint' },
    });
    expect(constructed).toEqual([]);
    expect(audit).toHaveBeenCalledOnce();
  });

  it('refuses every endpoint while the policy cannot be read', async () => {
    resolveCredential.mockResolvedValue(
      credential('https://eu.api.openai.com/v1'),
    );
    const { ctx } = gateCtx({ kind: 'unreadable' });
    await expect(embedder(ctx)).rejects.toMatchObject({
      data: { code: 'MODEL_ENDPOINT_POLICY_UNREADABLE' },
    });
    expect(constructed).toEqual([]);
  });

  it('changes nothing while the switch is off', async () => {
    const { ctx, audit } = gateCtx({ kind: 'open' });
    await expect(embedder(ctx)).resolves.toMatchObject({ dimensions: 3 });
    expect(constructed).toEqual([
      expect.objectContaining({ baseURL: 'https://api.openai.com/v1' }),
    ]);
    expect(audit).not.toHaveBeenCalled();
  });
});
