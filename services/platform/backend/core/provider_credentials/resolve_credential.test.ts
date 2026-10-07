/**
 * The subscription-broker resolution path fetches an admin-supplied URL from
 * the backend. These tests pin that the deployment's outbound-host policy
 * gates that fetch: cloud-metadata hosts are refused unconditionally,
 * private hosts unless the operator opted in, and a policy-admitted private
 * host is named to `safeFetch`'s allowlist so its own private-IP gate does
 * not refuse what the policy just allowed. Regression: the fetch relied on
 * `safeFetch` alone, whose auto-derived own-host allowlist admits the very
 * URL it is handed — an org admin could aim the backend at the IMDS.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { safeFetch } from '../../../lib/net/safe-fetch';
import { AppError } from '../../../lib/shared/errors/app-error';
import type { ActionCtx } from '../lib/ctx';
import { encryptSecret } from '../lib/secret_box';
import type { BrokerSelectionResult } from './broker_pool';
import {
  credentialRefusalCode,
  credentialRefusalMessage,
  credentialRetryAtMs,
  isTerminalCredentialRefusal,
  resolveProviderCredential,
} from './resolve_credential';
import { hashBrokerAccount, hashBrokerToken } from './token_hash';

vi.mock('../../../lib/net/safe-fetch', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../lib/net/safe-fetch')>();
  return { ...original, safeFetch: vi.fn() };
});

// The org's providers are the shipped YAML, so the test reads the real
// Anthropic and Z.ai `subscription-key` entries rather than a stand-in.
vi.mock('../lib/providers/org_providers', async () => {
  const { loadProviderDefinitions } =
    await import('../lib/providers/load_system_config');
  return { resolveProvidersForOrgId: async () => loadProviderDefinitions() };
});

const mockedFetch = vi.mocked(safeFetch);

const ORG = 'org_a';

function brokerDocument(endpoint: string) {
  return {
    endpoint,
    httpMethod: 'GET',
    auth: { method: 'none' },
    responseMapping: { tokensPath: '$.tokens', tokenField: 'access_token' },
    targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    selection: 'first',
  };
}

/** A ctx whose default-credential read serves one broker row. */
function ctxServingBroker(endpoint: string) {
  const row = {
    _id: 'cred-1',
    organizationId: ORG,
    providerSlug: 'anthropic',
    authMethod: 'subscription-broker',
    name: 'Broker pool',
    encryptedData: encryptSecret(JSON.stringify(brokerDocument(endpoint))),
    status: 'active',
  };
  const runMutation = vi.fn(
    async (
      _ref: unknown,
      args: { candidates: { hash: string }[] },
    ): Promise<BrokerSelectionResult> => ({
      hash: args.candidates[0]?.hash ?? null,
      fellBack: false,
    }),
  );
  return Object.assign(
    { runQuery: vi.fn(async () => row), runMutation } as unknown as ActionCtx,
    { mockRunMutation: runMutation },
  );
}

function poolResponse() {
  return {
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    body: JSON.stringify({ tokens: [{ access_token: 'tok-a' }] }),
    finalUrl: 'https://broker.example/pool',
  };
}

async function caughtCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) {
      const data: unknown = err.data;
      if (data && typeof data === 'object' && 'code' in data) {
        const code = (data as { code?: unknown }).code;
        if (typeof code === 'string') return code;
      }
    }
    throw err;
  }
  throw new Error('expected the resolver to throw');
}

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
  vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '');
  mockedFetch.mockReset();
});

describe('broker account selection boundary', () => {
  it('hands only scoped hashes to durable selection and preserves vendor metadata', async () => {
    mockedFetch.mockResolvedValue({
      ...poolResponse(),
      body: JSON.stringify({
        tokens: [
          { id: 'gateway-a', account_id: 'vendor-a', access_token: 'token-a' },
          { id: 'gateway-b', account_id: 'vendor-b', access_token: 'token-b' },
        ],
      }),
    });
    const ctx = ctxServingBroker('https://broker.example/pool');
    const firstHash = hashBrokerAccount('cred-1', {
      id: 'gateway-a',
      token: 'previous-token-a',
    });
    const secondHash = hashBrokerAccount('cred-1', {
      id: 'gateway-b',
      token: 'token-b',
    });
    ctx.mockRunMutation.mockResolvedValue({
      hash: secondHash,
      fellBack: false,
    });
    const result = await resolveProviderCredential(ctx, {
      organizationId: ORG,
      providerSlug: 'anthropic',
      excludeBrokerTokenHashes: [firstHash, hashBrokerToken('token-b')],
    });
    expect(result).toMatchObject({
      token: 'token-b',
      accountId: 'vendor-b',
      brokerTokenHash: secondHash,
    });
    expect(ctx.mockRunMutation).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      credentialId: 'cred-1',
      selection: 'first',
      candidates: [
        { hash: firstHash, excluded: true },
        { hash: secondHash, excluded: true },
      ],
    });
    expect(JSON.stringify(ctx.mockRunMutation.mock.calls)).not.toContain(
      'token-a',
    );
  });

  it('never sends quota-exhausted or explicitly excluded tokens to the selector', async () => {
    mockedFetch.mockResolvedValue({
      ...poolResponse(),
      body: JSON.stringify({
        tokens: [
          { access_token: 'quota-exhausted', available: false },
          { access_token: 'already-tried' },
          { access_token: 'healthy' },
        ],
      }),
    });
    const ctx = ctxServingBroker('https://broker.example/pool');
    const result = await resolveProviderCredential(ctx, {
      organizationId: ORG,
      providerSlug: 'anthropic',
      excludeBrokerTokens: ['already-tried'],
    });
    expect(result).toMatchObject({ token: 'healthy' });
    expect(ctx.mockRunMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidates: [{ hash: hashBrokerToken('healthy'), excluded: false }],
      }),
    );
  });

  it('vends the account the broker holds for its refresh while the available one cools down', async () => {
    // TALE-101: a two-account pool. A 429 cooled A down for a minute, and the
    // broker — which counts A as able to take the work and knows nothing of
    // the cooldown — holds B back for its coming token refresh. Refusing B
    // as well left the pool with no account, and the retries burned out.
    mockedFetch.mockResolvedValue({
      ...poolResponse(),
      body: JSON.stringify({
        tokens: [
          {
            id: 'gateway-a',
            access_token: 'token-a',
            available: true,
            hold: null,
          },
          {
            id: 'gateway-b',
            access_token: 'token-b',
            available: false,
            available_at: new Date(Date.now() + 40 * 60_000).toISOString(),
            hold: 'refresh',
          },
        ],
      }),
    });
    const ctx = ctxServingBroker('https://broker.example/pool');
    const hashA = hashBrokerAccount('cred-1', {
      id: 'gateway-a',
      token: 'token-a',
    });
    const hashB = hashBrokerAccount('cred-1', {
      id: 'gateway-b',
      token: 'token-b',
    });
    ctx.mockRunMutation.mockResolvedValue({
      hash: hashB,
      fellBack: false,
      held: true,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await resolveProviderCredential(ctx, {
      organizationId: ORG,
      providerSlug: 'anthropic',
      excludeBrokerTokenHashes: [hashA],
    });

    expect(result).toMatchObject({ token: 'token-b', brokerTokenHash: hashB });
    // The held account rides behind the available one, marked, so the
    // durable pick falls back to it only when A cannot serve.
    expect(ctx.mockRunMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidates: [
          { hash: hashA, excluded: true },
          { hash: hashB, excluded: false, held: true },
        ],
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('holds back for its coming token refresh'),
    );
  });

  it('vends a held OpenAI account when the available one lacks its vendor account id', async () => {
    mockedFetch.mockResolvedValue({
      ...poolResponse(),
      body: JSON.stringify({
        tokens: [
          { id: 'gateway-a', provider: 'openai', access_token: 'token-a' },
          {
            id: 'gateway-b',
            provider: 'openai',
            account_id: 'vendor-b',
            access_token: 'token-b',
            available: false,
            available_at: new Date(Date.now() + 40 * 60_000).toISOString(),
            hold: 'refresh',
          },
        ],
      }),
    });
    const ctx = ctxServingBroker('https://broker.example/pool');
    const hashB = hashBrokerAccount('cred-1', {
      id: 'gateway-b',
      token: 'token-b',
    });
    ctx.mockRunMutation.mockResolvedValue({
      hash: hashB,
      fellBack: false,
      held: true,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await resolveProviderCredential(ctx, {
      organizationId: ORG,
      providerSlug: 'openai',
    });

    expect(result).toMatchObject({ token: 'token-b', accountId: 'vendor-b' });
    expect(ctx.mockRunMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidates: [{ hash: hashB, excluded: false, held: true }],
      }),
    );
  });

  it('keeps a broker that names no hold exactly as before: its unavailable account is never a candidate', async () => {
    // A gateway from before `hold` serves its floor as a bare
    // `available: false`; the platform ships first and must not read it as
    // a refresh hold.
    mockedFetch.mockResolvedValue({
      ...poolResponse(),
      body: JSON.stringify({
        tokens: [
          { id: 'gateway-a', access_token: 'token-a', available: true },
          {
            id: 'gateway-b',
            access_token: 'token-b',
            available: false,
            available_at: new Date(Date.now() + 40 * 60_000).toISOString(),
          },
        ],
      }),
    });
    const ctx = ctxServingBroker('https://broker.example/pool');
    const hashA = hashBrokerAccount('cred-1', {
      id: 'gateway-a',
      token: 'token-a',
    });
    const retryAtMs = Date.now() + 42_000;
    ctx.mockRunMutation.mockResolvedValue({
      hash: null,
      fellBack: false,
      retryAtMs,
    });

    const refusal = await resolveProviderCredential(ctx, {
      organizationId: ORG,
      providerSlug: 'anthropic',
    }).catch((error: unknown) => error);

    expect(ctx.mockRunMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidates: [{ hash: hashA, excluded: false }],
      }),
    );
    expect(credentialRefusalCode(refusal)).toBe('CREDENTIAL_BROKER_EXHAUSTED');
    // The refusal says when the first account is back, for a retry to wait.
    expect(credentialRetryAtMs(refusal)).toBe(retryAtMs);
    expect(credentialRefusalMessage(refusal)).toMatch(
      /cooling down after a rate limit — try again in \d+ seconds/,
    );
  });

  it('refuses the pool during shared cooldown without undoing the hard exclusion', async () => {
    mockedFetch.mockResolvedValue(poolResponse());
    const ctx = ctxServingBroker('https://broker.example/pool');
    ctx.mockRunMutation.mockResolvedValue({
      hash: null,
      fellBack: false,
      retryAtMs: Date.now() + 60_000,
    });
    await expect(
      resolveProviderCredential(ctx, {
        organizationId: ORG,
        providerSlug: 'anthropic',
        excludeBrokerTokenHashes: [hashBrokerToken('tok-a')],
      }),
    ).rejects.toThrow(/cooling down/);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveProviderCredential — subscription-broker host policy', () => {
  it('refuses a cloud-metadata broker endpoint before any request', async () => {
    for (const endpoint of [
      'http://169.254.169.254/latest/meta-data/',
      'https://metadata.google.internal/computeMetadata/v1/?alt=json',
    ]) {
      const code = await caughtCode(
        resolveProviderCredential(ctxServingBroker(endpoint), {
          organizationId: ORG,
          providerSlug: 'anthropic',
        }),
      );
      expect(code).toBe('CREDENTIAL_BROKER_ENDPOINT_BLOCKED');
    }
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('refuses a private broker host unless the operator opted in, then names it to safeFetch', async () => {
    const endpoint = 'http://10.0.0.5:8080/pool';
    expect(
      await caughtCode(
        resolveProviderCredential(ctxServingBroker(endpoint), {
          organizationId: ORG,
          providerSlug: 'anthropic',
        }),
      ),
    ).toBe('CREDENTIAL_BROKER_ENDPOINT_BLOCKED');
    expect(mockedFetch).not.toHaveBeenCalled();

    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '1');
    mockedFetch.mockResolvedValue(poolResponse());
    const resolved = await resolveProviderCredential(
      ctxServingBroker(endpoint),
      { organizationId: ORG, providerSlug: 'anthropic' },
    );
    expect(resolved.authMethod).toBe('subscription-broker');
    expect(mockedFetch).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({ allowedHosts: ['10.0.0.5'] }),
    );
  });

  it('fetches a public https broker without an explicit allowlist and picks a token', async () => {
    mockedFetch.mockResolvedValue(poolResponse());
    const resolved = await resolveProviderCredential(
      ctxServingBroker('https://broker.example/pool'),
      { organizationId: ORG, providerSlug: 'anthropic' },
    );
    expect(resolved).toMatchObject({
      authMethod: 'subscription-broker',
      token: 'tok-a',
      targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    });
    const [, options] = mockedFetch.mock.calls[0] ?? [];
    expect(options).not.toHaveProperty('allowedHosts');
  });
});

describe('credentialRetryAtMs', () => {
  it('reads when a cooling pool has an account back, and nothing else', () => {
    expect(
      credentialRetryAtMs(
        new AppError({
          code: 'CREDENTIAL_BROKER_EXHAUSTED',
          message: 'cooling down',
          retryAtMs: 1_790_000_000_000,
        }),
      ),
    ).toBe(1_790_000_000_000);
    // Duck-typed, like the other refusal readers.
    expect(
      credentialRetryAtMs({
        data: { code: 'CREDENTIAL_BROKER_EXHAUSTED', retryAtMs: 5 },
      }),
    ).toBe(5);
    // Every token tried this turn: no wait lifts that.
    expect(
      credentialRetryAtMs(
        new AppError({ code: 'CREDENTIAL_BROKER_EXHAUSTED', message: 'x' }),
      ),
    ).toBeUndefined();
    expect(
      credentialRetryAtMs(
        new AppError({ code: 'CREDENTIAL_BROKER_EMPTY', retryAtMs: 5 }),
      ),
    ).toBeUndefined();
    expect(
      credentialRetryAtMs({
        data: { code: 'CREDENTIAL_BROKER_EXHAUSTED', retryAtMs: 'soon' },
      }),
    ).toBeUndefined();
    expect(credentialRetryAtMs(new Error('plain'))).toBeUndefined();
    expect(credentialRetryAtMs(undefined)).toBeUndefined();
  });
});

describe('credentialRefusalCode', () => {
  it('reads the resolver refusal code off an error, duck-typed', () => {
    expect(
      credentialRefusalCode(
        new AppError({ code: 'CREDENTIAL_NOT_FOUND', message: 'x' }),
      ),
    ).toBe('CREDENTIAL_NOT_FOUND');
    expect(
      credentialRefusalCode({ data: { code: 'CREDENTIAL_KEY_ROTATED' } }),
    ).toBe('CREDENTIAL_KEY_ROTATED');
    expect(credentialRefusalCode(new AppError({ code: 'OTHER' }))).toBeNull();
    expect(credentialRefusalCode(new Error('plain'))).toBeNull();
    expect(credentialRefusalCode(null)).toBeNull();
  });
});

describe('isTerminalCredentialRefusal / credentialRefusalMessage', () => {
  // Every refusal an admin has to lift: retrying reproduces it, so the
  // callers (indexing, search, transcription, the chat assistant's search
  // tool) end on the first one.
  it.each([
    'CREDENTIAL_NOT_FOUND',
    'CREDENTIAL_NONE_CONFIGURED',
    'CREDENTIAL_PROVIDER_MISMATCH',
    'CREDENTIAL_DISABLED',
    'CREDENTIAL_KEY_ROTATED',
    'CREDENTIAL_SHAPE_INVALID',
    'CREDENTIAL_ENV_NAME_INVALID',
    'CREDENTIAL_ENV_UNSET',
  ])('holds %s terminal', (code) => {
    expect(
      isTerminalCredentialRefusal(new AppError({ code, message: 'x' })),
    ).toBe(true);
  });

  // A pool cooling down after a rate limit, or a broker that is briefly
  // unreachable, heals by itself — those keep their retries.
  it.each([
    'CREDENTIAL_BROKER_EXHAUSTED',
    'CREDENTIAL_BROKER_FETCH_FAILED',
    'CREDENTIAL_SOMETHING_NEW',
  ])('leaves %s to the retries', (code) => {
    expect(
      isTerminalCredentialRefusal(new AppError({ code, message: 'x' })),
    ).toBe(false);
  });

  it('holds nothing terminal that is not a resolver refusal', () => {
    expect(isTerminalCredentialRefusal(new Error('CREDENTIAL_DISABLED'))).toBe(
      false,
    );
    expect(isTerminalCredentialRefusal(new AppError({ code: 'OTHER' }))).toBe(
      false,
    );
    expect(isTerminalCredentialRefusal(undefined)).toBe(false);
  });

  it("reads the resolver's own sentence, never the serialized payload", () => {
    const refusal = new AppError({
      code: 'CREDENTIAL_DISABLED',
      message: 'Credential "Primary" is disabled — enable it.',
    });
    expect(refusal.message).toContain('"code"');
    expect(credentialRefusalMessage(refusal)).toBe(
      'Credential "Primary" is disabled — enable it.',
    );
    expect(
      credentialRefusalMessage(
        new AppError({ code: 'CREDENTIAL_DISABLED', message: '  ' }),
      ),
    ).toBeNull();
    expect(
      credentialRefusalMessage(new AppError({ code: 'OTHER', message: 'x' })),
    ).toBeNull();
    expect(credentialRefusalMessage(new Error('plain'))).toBeNull();
  });
});

describe('subscription-key delivery variable', () => {
  function ctxServingKey(providerSlug: string) {
    const row = {
      _id: 'cred-2',
      organizationId: ORG,
      providerSlug,
      authMethod: 'subscription-key',
      name: 'Pasted token',
      encryptedData: encryptSecret('pasted-secret'),
      status: 'active',
    };
    return { runQuery: vi.fn(async () => row) } as unknown as ActionCtx;
  }

  it("names the OAuth variable the Anthropic provider's entry declares", async () => {
    const resolved = await resolveProviderCredential(
      ctxServingKey('anthropic'),
      { organizationId: ORG, providerSlug: 'anthropic' },
    );
    expect(resolved).toMatchObject({
      authMethod: 'subscription-key',
      secret: 'pasted-secret',
      targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    });
  });

  it("leaves a coding-plan key on the harness's default variable", async () => {
    const resolved = await resolveProviderCredential(ctxServingKey('zai'), {
      organizationId: ORG,
      providerSlug: 'zai',
    });
    expect(resolved).toMatchObject({
      authMethod: 'subscription-key',
      secret: 'pasted-secret',
    });
    expect(resolved).not.toHaveProperty('targetEnvVar');
  });
});
