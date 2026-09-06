import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  DEV_SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD,
  DEV_SANDBOX_TOKEN,
  ensureKnowledgeDatabaseUrl,
  ensureSandboxLlmGatewayAdminPassword,
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

// The host `bun dev` backend signs spawner requests (and logs into the gateway)
// with the values below, while the dockerized spawner / gateway boot from
// compose.dev.yml's defaults — the two MUST be byte-identical or every sandbox
// call in the dev stack is a 401.
describe('dev sandbox control-plane secrets — lockstep with compose.dev.yml', () => {
  it('SANDBOX_TOKEN fallback equals the compose.dev.yml dev default', () => {
    expect(composeDevDefault('SANDBOX_TOKEN')).toBe(DEV_SANDBOX_TOKEN);
  });

  it('gateway admin password fallback equals the compose.dev.yml dev default', () => {
    expect(composeDevDefault('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD')).toBe(
      DEV_SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD,
    );
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

describe('ensureSandboxLlmGatewayAdminPassword', () => {
  it('fills only the gap — an explicit value is never overwritten', () => {
    const env: NodeJS.ProcessEnv = {
      SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD: 'real-pw',
    };
    ensureSandboxLlmGatewayAdminPassword(env);
    expect(env.SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD).toBe('real-pw');
  });

  it('treats the pre-rename LLM_GATEWAY_ADMIN_PASSWORD as present', () => {
    const env: NodeJS.ProcessEnv = { LLM_GATEWAY_ADMIN_PASSWORD: 'old-pw' };
    ensureSandboxLlmGatewayAdminPassword(env);
    expect(env.SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD).toBeUndefined();
  });

  it('supplies the insecure default when unset', () => {
    const env: NodeJS.ProcessEnv = {};
    ensureSandboxLlmGatewayAdminPassword(env);
    expect(env.SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD).toBe(
      DEV_SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD,
    );
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
