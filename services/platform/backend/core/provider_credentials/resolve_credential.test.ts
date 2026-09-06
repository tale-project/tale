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
import { resolveProviderCredential } from './resolve_credential';

vi.mock('../../../lib/net/safe-fetch', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../lib/net/safe-fetch')>();
  return { ...original, safeFetch: vi.fn() };
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
function ctxServingBroker(endpoint: string): ActionCtx {
  const row = {
    _id: 'cred-1',
    organizationId: ORG,
    providerSlug: 'anthropic',
    authMethod: 'subscription-broker',
    name: 'Broker pool',
    encryptedData: encryptSecret(JSON.stringify(brokerDocument(endpoint))),
    status: 'active',
  };
  return { runQuery: vi.fn(async () => row) } as unknown as ActionCtx;
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
