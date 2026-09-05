/**
 * The admin write boundary refuses what every later consumer would refuse —
 * with a coded 400 the admin can act on, before any row or audit entry is
 * written. Regressions pinned: a broker document was encrypted verbatim and
 * failed only at turn time ("delete and recreate it"); a per-credential
 * endpoint was checked with `startsWith('https://')` while every turn ran
 * the full URL + host policy; a secret rotation on an env credential wrote
 * ciphertext nothing reads and audited a no-op as an update.
 */

import type { TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertCredentialEndpointUrl,
  createCredential,
  CredentialAdminError,
  parseBrokerConfigDocument,
  updateCredential,
} from './service.ts';

const SCOPE = {
  organizationId: 'org_a',
  userId: 'user_1',
  role: 'admin',
};

const VALID_BROKER = {
  endpoint: 'https://broker.example.com/api/tokens',
  httpMethod: 'GET',
  auth: { method: 'none' },
  responseMapping: { tokensPath: '$.tokens', tokenField: 'access_token' },
  targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
  selection: 'first',
};

/** A transaction that refuses every statement — proves a refusal lands
 * before the first read or write. */
function refusingTx(): TransactionSql {
  const tx = (): never => {
    throw new Error('unexpected database statement');
  };
  return tx as unknown as TransactionSql;
}

/** A transaction whose first statement serves the addressed row and whose
 * second refuses — the update must stop after its lookup. */
function txServingRow(row: Record<string, unknown>): TransactionSql {
  let calls = 0;
  const tx = async (): Promise<Record<string, unknown>[]> => {
    calls += 1;
    if (calls === 1) return [row];
    throw new Error('unexpected database statement after the row lookup');
  };
  return tx as unknown as TransactionSql;
}

async function caught(
  promise: Promise<unknown>,
): Promise<CredentialAdminError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CredentialAdminError) return error;
    throw error;
  }
  throw new Error('expected a CredentialAdminError');
}

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
  vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseBrokerConfigDocument', () => {
  it('accepts the document the broker form builds', () => {
    const parsed = parseBrokerConfigDocument(JSON.stringify(VALID_BROKER));
    expect(parsed.endpoint).toBe(VALID_BROKER.endpoint);
    expect(parsed.timeoutMs).toBe(10_000);
  });

  it('refuses non-JSON and a document missing the resolver-required fields', () => {
    expect(() => parseBrokerConfigDocument('not json')).toThrow(
      expect.objectContaining({ code: 'CREDENTIAL_BROKER_CONFIG_INVALID' }),
    );
    let error: unknown;
    try {
      parseBrokerConfigDocument(
        JSON.stringify({ endpoint: 'https://broker.example.com/v1' }),
      );
    } catch (caughtError) {
      error = caughtError;
    }
    expect(error).toBeInstanceOf(CredentialAdminError);
    if (error instanceof CredentialAdminError) {
      expect(error.code).toBe('CREDENTIAL_BROKER_CONFIG_INVALID');
      expect(error.status).toBe(400);
      expect(error.message).toContain('httpMethod');
    }
  });

  it('refuses a broker endpoint the deployment host policy refuses', () => {
    expect(() =>
      parseBrokerConfigDocument(
        JSON.stringify({
          ...VALID_BROKER,
          endpoint: 'http://169.254.169.254/latest/meta-data/',
        }),
      ),
    ).toThrow(
      expect.objectContaining({ code: 'CREDENTIAL_BROKER_CONFIG_INVALID' }),
    );
    expect(() =>
      parseBrokerConfigDocument(
        JSON.stringify({ ...VALID_BROKER, endpoint: 'http://10.0.0.5/pool' }),
      ),
    ).toThrow(
      expect.objectContaining({ code: 'CREDENTIAL_BROKER_CONFIG_INVALID' }),
    );
    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '1');
    expect(
      parseBrokerConfigDocument(
        JSON.stringify({ ...VALID_BROKER, endpoint: 'http://10.0.0.5/pool' }),
      ).endpoint,
    ).toBe('http://10.0.0.5/pool');
  });
});

describe('assertCredentialEndpointUrl', () => {
  it('accepts a well-formed https endpoint', () => {
    expect(() =>
      assertCredentialEndpointUrl('https://itest.openai.azure.com/openai/v1'),
    ).not.toThrow();
  });

  it('refuses a malformed URL, a bare scheme, public http, and a blocked host', () => {
    for (const url of [
      'https://',
      'https://a b/',
      'not a url',
      'http://api.example.com/v1',
      'https://169.254.169.254/openai/v1',
      'https://metadata.google.internal./v1',
    ]) {
      expect(() => assertCredentialEndpointUrl(url)).toThrow(
        expect.objectContaining({ code: 'CREDENTIAL_ENDPOINT_INVALID' }),
      );
    }
  });
});

describe('createCredential — refusals land before any statement', () => {
  it('refuses an invalid broker document with a 400', async () => {
    const error = await caught(
      createCredential(refusingTx(), SCOPE, {
        providerSlug: 'anthropic',
        authMethod: 'subscription-broker',
        name: 'Broker pool',
        secret: JSON.stringify({ endpoint: 'https://broker.example.com/v1' }),
      }),
    );
    expect(error.code).toBe('CREDENTIAL_BROKER_CONFIG_INVALID');
    expect(error.status).toBe(400);
  });

  it('refuses a per-credential endpoint on a metadata host', async () => {
    const error = await caught(
      createCredential(refusingTx(), SCOPE, {
        providerSlug: 'azure-openai',
        authMethod: 'api-key',
        name: 'Azure',
        secret: 'sk-azure',
        endpointUrl: 'https://169.254.169.254/openai/v1',
      }),
    );
    expect(error.code).toBe('CREDENTIAL_ENDPOINT_INVALID');
  });

  it('holds the env name to the shared schema — prefix and documented cap', async () => {
    const outside = await caught(
      createCredential(refusingTx(), SCOPE, {
        providerSlug: 'openai',
        authMethod: 'env',
        name: 'Env',
        envName: 'OPENAI_API_KEY',
      }),
    );
    expect(outside.code).toBe('CREDENTIAL_ENV_NAME_INVALID');
    const tooLong = await caught(
      createCredential(refusingTx(), SCOPE, {
        providerSlug: 'openai',
        authMethod: 'env',
        name: 'Env',
        envName: `TALE_PROVIDER_KEY_${'A'.repeat(40)}`,
      }),
    );
    expect(tooLong.code).toBe('CREDENTIAL_ENV_NAME_INVALID');
  });
});

describe('updateCredential — an env credential has no secret to rotate', () => {
  it('refuses a secret patch on an env row after the lookup, writing nothing', async () => {
    const error = await caught(
      updateCredential(
        txServingRow({
          providerSlug: 'openai',
          isDefault: true,
          name: 'Env',
          authMethod: 'env',
          status: 'active',
        }),
        SCOPE,
        'cred-env',
        { secret: 'sk-new' },
      ),
    );
    expect(error.code).toBe('CREDENTIAL_SECRET_INVALID');
    expect(error.status).toBe(400);
  });

  it('refuses an invalid broker document on rotation', async () => {
    const error = await caught(
      updateCredential(
        txServingRow({
          providerSlug: 'anthropic',
          isDefault: true,
          name: 'Broker pool',
          authMethod: 'subscription-broker',
          status: 'active',
        }),
        SCOPE,
        'cred-broker',
        {
          secret: JSON.stringify({
            ...VALID_BROKER,
            responseMapping: { tokensPath: 'tokens', tokenField: 'token' },
          }),
        },
      ),
    );
    expect(error.code).toBe('CREDENTIAL_BROKER_CONFIG_INVALID');
    expect(error.message).toContain('tokensPath');
  });
});
