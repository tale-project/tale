import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  DEV_MODEL_RELAY_PORT,
  DEV_SANDBOX_TOKEN,
  deriveDevSecrets,
  ensureKnowledgeDatabaseUrl,
  ensureModelRelayPort,
  ensureObjectStoreEnv,
  ensureSandboxToken,
} from './dev-secrets';

vi.mock('@tale/shared/tux', () => ({ warnLine: vi.fn() }));

const composeDev = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'compose.dev.yml'),
  'utf8',
);

/** The `${NAME:-default}` fallback compose.dev.yml's x-dev-secrets anchor
 * carries for one variable. */
function composeDevDefault(name: string): string {
  const match = composeDev.match(
    new RegExp(`^\\s*${name}: \\$\\{${name}:-([^}]+)\\}\\s*$`, 'm'),
  );
  if (!match?.[1]) {
    throw new Error(`${name} has no dev default in compose.dev.yml`);
  }
  return match[1];
}

// The host `bun dev` backend signs spawner requests with the value below,
// while the dockerized spawner boots from compose.dev.yml's default — the two
// MUST be byte-identical or every sandbox call in the dev stack is a 401.
describe('dev sandbox control-plane secret — lockstep with compose.dev.yml', () => {
  it('SANDBOX_TOKEN fallback equals the compose.dev.yml dev default', () => {
    expect(composeDevDefault('SANDBOX_TOKEN')).toBe(DEV_SANDBOX_TOKEN);
  });
});

describe('ensureSandboxToken', () => {
  it('fills only the gap — an explicit value is never overwritten', () => {
    const env: NodeJS.ProcessEnv = { SANDBOX_TOKEN: 'real-token' };
    ensureSandboxToken(env);
    expect(env.SANDBOX_TOKEN).toBe('real-token');
  });

  it('supplies the insecure default when unset or blank', () => {
    const unset: NodeJS.ProcessEnv = {};
    ensureSandboxToken(unset);
    expect(unset.SANDBOX_TOKEN).toBe(DEV_SANDBOX_TOKEN);
    const blank: NodeJS.ProcessEnv = { SANDBOX_TOKEN: '   ' };
    ensureSandboxToken(blank);
    expect(blank.SANDBOX_TOKEN).toBe(DEV_SANDBOX_TOKEN);
  });
});

describe('deriveDevSecrets', () => {
  // The dev stack runs no sandbox LLM gateway: nothing is derived for one,
  // so a host backend asks none.
  it('derives nothing for the retired sandbox LLM gateway', () => {
    const env: NodeJS.ProcessEnv = { DB_PASSWORD: 'pw' };
    deriveDevSecrets(env);
    expect(
      Object.keys(env).filter((name) => name.includes('LLM_GATEWAY')),
    ).toEqual([]);
  });

  it('keeps a gateway setting an existing .env carries, as it was', () => {
    const env: NodeJS.ProcessEnv = {
      DB_PASSWORD: 'pw',
      SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD: 'kept-pw',
    };
    deriveDevSecrets(env);
    expect(env.SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD).toBe('kept-pw');
    expect(env.SANDBOX_LLM_GATEWAY_URL).toBeUndefined();
  });
});

describe('ensureKnowledgeDatabaseUrl', () => {
  it('fills only the gap — an explicit KNOWLEDGE_DATABASE_URL is never overwritten', () => {
    const env: NodeJS.ProcessEnv = {
      DB_PASSWORD: 'pw',
      KNOWLEDGE_DATABASE_URL:
        'postgresql://tale:pw@elsewhere:5432/tale_knowledge',
    };
    ensureKnowledgeDatabaseUrl(env);
    expect(env.KNOWLEDGE_DATABASE_URL).toBe(
      'postgresql://tale:pw@elsewhere:5432/tale_knowledge',
    );
  });

  it('derives the host-side knowledge-db URL from DB_PASSWORD', () => {
    const env: NodeJS.ProcessEnv = { DB_PASSWORD: 'p w' };
    ensureKnowledgeDatabaseUrl(env);
    expect(env.KNOWLEDGE_DATABASE_URL).toBe(
      'postgresql://tale:p%20w@localhost:5433/tale_knowledge',
    );
  });

  // The alias was read only by the retired purge resolver; the live pool never
  // honoured it, so leaving it set must not suppress the derivation.
  it('ignores the retired RAG_DATABASE_URL alias', () => {
    const env: NodeJS.ProcessEnv = {
      DB_PASSWORD: 'pw',
      RAG_DATABASE_URL: 'postgresql://tale:pw@db:5432/tale_knowledge',
    };
    ensureKnowledgeDatabaseUrl(env);
    expect(env.KNOWLEDGE_DATABASE_URL).toBe(
      'postgresql://tale:pw@localhost:5433/tale_knowledge',
    );
  });
});

describe('ensureModelRelayPort', () => {
  it('gives the host backend’s relay the port the dev stack’s bridge forwards the relay address to', () => {
    const env: NodeJS.ProcessEnv = {};
    ensureModelRelayPort(env);
    expect(env.SANDBOX_RELAY_PORT).toBe(DEV_MODEL_RELAY_PORT);
    // `backend-api:8080` on the sandbox network reaches the host backend's
    // relay through `backend-relay` (compose.dev.yml).
    expect(composeDev).toContain(
      `socat TCP-LISTEN:8080,fork,reuseaddr TCP:host.docker.internal:${DEV_MODEL_RELAY_PORT}`,
    );
  });

  it('keeps a port that is set', () => {
    const env: NodeJS.ProcessEnv = { SANDBOX_RELAY_PORT: '9090' };
    ensureModelRelayPort(env);
    expect(env.SANDBOX_RELAY_PORT).toBe('9090');
  });
});

describe('ensureObjectStoreEnv', () => {
  it('hands the browser the app’s own origin for the store, as a deployment does', () => {
    const env: NodeJS.ProcessEnv = { SITE_URL: 'http://localhost:3000' };
    ensureObjectStoreEnv(env);
    expect(env.OBJECT_STORE_ENDPOINT).toBe('http://127.0.0.1:59000');
    expect(env.OBJECT_STORE_PUBLIC_ENDPOINT).toBe('http://localhost:3000');
  });

  it('keeps a public endpoint that is set, an empty one included', () => {
    for (const value of ['https://files.example.com', '']) {
      const env: NodeJS.ProcessEnv = {
        SITE_URL: 'http://localhost:3000',
        OBJECT_STORE_PUBLIC_ENDPOINT: value,
      };
      ensureObjectStoreEnv(env);
      expect(env.OBJECT_STORE_PUBLIC_ENDPOINT).toBe(value);
    }
  });

  it('names no public endpoint while the site has no address', () => {
    const env: NodeJS.ProcessEnv = {};
    ensureObjectStoreEnv(env);
    expect('OBJECT_STORE_PUBLIC_ENDPOINT' in env).toBe(false);
  });
});
