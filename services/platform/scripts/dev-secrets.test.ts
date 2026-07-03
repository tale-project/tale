import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ensureWebdavHmacKey } from '../lib/webdav/hmac-key';
import {
  deriveDevSecrets,
  ENCRYPTION_SECRET_TAG,
  ensureEncryptionSecret,
  ensureKnowledgeDatabaseUrl,
  ensureSandboxLlmGatewayUrl,
} from './dev-secrets';

function envWith(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...overrides };
}

describe('deriveDevSecrets', () => {
  it('fills all four secrets from a bare env', () => {
    const env = envWith();
    deriveDevSecrets(env);
    expect(env.INSTANCE_SECRET).toBeTruthy();
    expect(env.BETTER_AUTH_SECRET).toBeTruthy();
    expect(env.WEBDAV_APP_PASSWORD_HMAC_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(env.ENCRYPTION_SECRET_HEX).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives the WebDAV key via the SAME shared fn (no second formula)', () => {
    const env = envWith({ INSTANCE_SECRET: 'fixed-secret' });
    deriveDevSecrets(env);
    const direct = ensureWebdavHmacKey({
      INSTANCE_SECRET: 'fixed-secret',
    });
    expect(env.WEBDAV_APP_PASSWORD_HMAC_KEY).toBe(direct);
  });

  it('derives ENCRYPTION_SECRET_HEX as sha256(INSTANCE_SECRET + tag)', () => {
    const env = envWith({ INSTANCE_SECRET: 'fixed-secret' });
    ensureEncryptionSecret(env);
    const expected = createHash('sha256')
      .update(`fixed-secret${ENCRYPTION_SECRET_TAG}`)
      .digest('hex');
    expect(env.ENCRYPTION_SECRET_HEX).toBe(expected);
    expect(ENCRYPTION_SECRET_TAG).toBe(':encryption-secret:v1');
  });

  it('derives KNOWLEDGE_DATABASE_URL from DB_PASSWORD (localhost:5433)', () => {
    const env = envWith({ DB_PASSWORD: 'p@ss/word' });
    ensureKnowledgeDatabaseUrl(env);
    expect(env.KNOWLEDGE_DATABASE_URL).toBe(
      'postgresql://tale:p%40ss%2Fword@localhost:5433/tale_knowledge',
    );
  });

  it('skips KNOWLEDGE_DATABASE_URL when RAG_DATABASE_URL or no DB_PASSWORD', () => {
    const withRag = envWith({ RAG_DATABASE_URL: 'x', DB_PASSWORD: 'p' });
    ensureKnowledgeDatabaseUrl(withRag);
    expect(withRag.KNOWLEDGE_DATABASE_URL).toBeUndefined();
    const noPw = envWith({});
    ensureKnowledgeDatabaseUrl(noPw);
    expect(noPw.KNOWLEDGE_DATABASE_URL).toBeUndefined();
  });

  it('derives SANDBOX_LLM_GATEWAY_URL at the loopback port (host can reach it)', () => {
    const env = envWith();
    ensureSandboxLlmGatewayUrl(env);
    // The compose alias `sandbox-llm-gateway` is unresolvable from the host, so
    // host-run Convex must use the loopback port compose publishes.
    expect(env.SANDBOX_LLM_GATEWAY_URL).toBe('http://127.0.0.1:8080');
    expect(env.SANDBOX_LLM_GATEWAY_URL).not.toContain('sandbox-llm-gateway');
  });

  it('skips SANDBOX_LLM_GATEWAY_URL when it (or the pre-rename name) is set', () => {
    const explicit = envWith({ SANDBOX_LLM_GATEWAY_URL: 'http://gw:9000' });
    ensureSandboxLlmGatewayUrl(explicit);
    expect(explicit.SANDBOX_LLM_GATEWAY_URL).toBe('http://gw:9000');
    const legacy = envWith({ LLM_GATEWAY_URL: 'http://legacy:9000' });
    ensureSandboxLlmGatewayUrl(legacy);
    expect(legacy.SANDBOX_LLM_GATEWAY_URL).toBeUndefined();
  });

  it('is idempotent — explicit values are never overwritten', () => {
    const env = envWith({
      INSTANCE_SECRET: 's',
      BETTER_AUTH_SECRET: 'ba',
      WEBDAV_APP_PASSWORD_HMAC_KEY: 'explicit-webdav',
      ENCRYPTION_SECRET_HEX: 'explicit-enc',
    });
    deriveDevSecrets(env);
    expect(env.BETTER_AUTH_SECRET).toBe('ba');
    expect(env.WEBDAV_APP_PASSWORD_HMAC_KEY).toBe('explicit-webdav');
    expect(env.ENCRYPTION_SECRET_HEX).toBe('explicit-enc');
  });

  it('orders derivation after the instance-secret fallback (keys hash from the fallback)', () => {
    const env = envWith(); // INSTANCE_SECRET unset → fallback installed first
    deriveDevSecrets(env);
    const fromFallback = ensureWebdavHmacKey({
      INSTANCE_SECRET: env.INSTANCE_SECRET,
    });
    expect(env.WEBDAV_APP_PASSWORD_HMAC_KEY).toBe(fromFallback);
    // a different instance secret yields a different key — proves the dependency
    const other = ensureWebdavHmacKey({
      INSTANCE_SECRET: 'something-else',
    });
    expect(env.WEBDAV_APP_PASSWORD_HMAC_KEY).not.toBe(other);
  });
});
