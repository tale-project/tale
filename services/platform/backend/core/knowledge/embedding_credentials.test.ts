// @vitest-environment node

import type { KnowledgeEmbeddingConfig } from '@tale/shared/schemas/knowledge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import type { Id } from '../lib/rows';
import type { ResolvedProviderCredential } from '../provider_credentials/resolve_credential';

const { constructed, resolveCredential, resolveProviders } = vi.hoisted(() => ({
  constructed: [] as Record<string, unknown>[],
  resolveCredential:
    vi.fn<(...args: unknown[]) => Promise<ResolvedProviderCredential>>(),
  resolveProviders: vi.fn(async () => [
    { name: 'openai', baseUrl: 'https://provider.example/v1' },
  ]),
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

const { classifyEmbeddingFailure, embedderForOrg } =
  await import('./embedding');
const CREDENTIAL_ID = 'credential-a' as Id<'providerCredentials'>;
const CONFIG: KnowledgeEmbeddingConfig = {
  providerSlug: 'openai',
  model: 'text-embedding-3-small',
  dimensions: 3,
  baseUrl: 'https://configured.example/v1',
};
const BASE_ROW = {
  _id: CREDENTIAL_ID,
  organizationId: 'org-a',
  providerSlug: 'openai',
  status: 'active',
};
const runQuery = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const ctx = { runQuery } as unknown as ActionCtx;

function resolve(config: KnowledgeEmbeddingConfig = CONFIG) {
  return embedderForOrg(ctx, {
    organizationId: 'org-a',
    orgSlug: 'example',
    config,
  });
}

function credential(
  authMethod: ResolvedProviderCredential['authMethod'],
): ResolvedProviderCredential {
  const common = { credentialId: CREDENTIAL_ID, name: 'Fixture' };
  switch (authMethod) {
    case 'api-key':
      return {
        ...common,
        authMethod,
        secret: 'synthetic-api-key',
        endpointUrl: 'https://credential.example/v1',
      };
    case 'env':
      return {
        ...common,
        authMethod,
        envName: 'TALE_PROVIDER_KEY_FIXTURE',
        secret: 'synthetic-env-key',
      };
    case 'subscription-key':
      return { ...common, authMethod, secret: 'synthetic-subscription-secret' };
    case 'subscription-broker':
      return {
        ...common,
        authMethod,
        token: 'synthetic-oauth-token',
        targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
        brokerTokenHash: 'synthetic-account-hash',
      };
    default:
      throw new Error('Unsupported test credential');
  }
}

beforeEach(() => {
  constructed.length = 0;
  resolveCredential.mockReset();
  resolveProviders.mockClear();
  runQuery.mockReset();
});

describe('direct embedding credentials', () => {
  it.each(['subscription-key', 'subscription-broker'] as const)(
    'rejects a default %s before fetching or allocating a secret',
    async (authMethod) => {
      runQuery.mockResolvedValue({ ...BASE_ROW, authMethod });
      resolveCredential.mockResolvedValue(credential(authMethod));

      const refusal = await resolve().catch((error: unknown) => error);

      expect(classifyEmbeddingFailure(refusal)).toBe('credential');
      expect(resolveCredential).not.toHaveBeenCalled();
      expect(constructed).toEqual([]);
      expect(runQuery).toHaveBeenCalledWith(
        internal.provider_credentials.queries.getDefaultCredentialInternal,
        { organizationId: 'org-a', providerSlug: 'openai' },
      );
      expect(resolveProviders).not.toHaveBeenCalled();
    },
  );

  it.each(['subscription-key', 'subscription-broker'] as const)(
    'rejects an explicitly selected %s before resolving its secret',
    async (authMethod) => {
      runQuery.mockResolvedValue({ ...BASE_ROW, authMethod });
      resolveCredential.mockResolvedValue(credential(authMethod));

      const refusal = await resolve({
        ...CONFIG,
        credentialId: CREDENTIAL_ID,
      }).catch((error: unknown) => error);

      expect(classifyEmbeddingFailure(refusal)).toBe('credential');
      expect(resolveCredential).not.toHaveBeenCalled();
      expect(constructed).toEqual([]);
      expect(runQuery).toHaveBeenCalledWith(
        internal.provider_credentials.queries.getCredentialInternal,
        { credentialId: CREDENTIAL_ID },
      );
    },
  );

  it.each(['subscription-key', 'subscription-broker'] as const)(
    'rechecks resolved %s credentials after a concurrent settings change',
    async (authMethod) => {
      runQuery.mockResolvedValue({ ...BASE_ROW, authMethod: 'api-key' });
      resolveCredential.mockResolvedValue(credential(authMethod));

      const refusal = await resolve().catch((error: unknown) => error);

      expect(resolveCredential).toHaveBeenCalledOnce();
      expect(classifyEmbeddingFailure(refusal)).toBe('credential');
      expect(constructed).toEqual([]);
    },
  );

  it.each(['api-key', 'env'] as const)(
    'preserves direct %s delivery and credential endpoint precedence',
    async (authMethod) => {
      runQuery.mockResolvedValue({ ...BASE_ROW, authMethod });
      const resolved = credential(authMethod);
      resolveCredential.mockResolvedValue(resolved);

      const embedder = await resolve({
        ...CONFIG,
        credentialId: CREDENTIAL_ID,
      });

      expect(embedder.dimensions).toBe(3);
      expect(constructed).toHaveLength(1);
      expect(constructed[0]).toMatchObject({
        apiKey:
          authMethod === 'api-key' ? 'synthetic-api-key' : 'synthetic-env-key',
        baseURL:
          authMethod === 'api-key'
            ? 'https://credential.example/v1'
            : CONFIG.baseUrl,
      });
      expect(resolveCredential).toHaveBeenCalledWith(ctx, {
        organizationId: 'org-a',
        providerSlug: 'openai',
        credentialId: CREDENTIAL_ID,
      });
    },
  );

  it.each([
    {
      ...BASE_ROW,
      organizationId: 'org-other',
      authMethod: 'subscription-broker',
    },
    {
      ...BASE_ROW,
      providerSlug: 'other-provider',
      authMethod: 'subscription-broker',
    },
    null,
  ])(
    'leaves tenant, provider and missing-row refusals to the credential resolver',
    async (row) => {
      const failure = new Error('credential resolver refusal');
      runQuery.mockResolvedValue(row);
      resolveCredential.mockRejectedValue(failure);

      await expect(
        resolve({ ...CONFIG, credentialId: CREDENTIAL_ID }),
      ).rejects.toBe(failure);
      expect(resolveCredential).toHaveBeenCalledOnce();
      expect(constructed).toEqual([]);
    },
  );
});
