import { execFileSync } from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../lib/ctx';

const resolveConnectorCredential = vi.hoisted(() => vi.fn());
vi.mock('../../connector_credentials/resolve_credential', () => ({
  resolveConnectorCredential,
}));
vi.mock('../../lib/handler_names', () => ({
  internal: {
    agent_secrets: { actions: { resolveAgentSecretsEnv: 'agent-secrets' } },
    sandbox: {
      session_queries: { getSessionOwnerIdentity: 'owner-identity' },
      session_mutations: { recordCredentialAccess: 'credential-access' },
    },
  },
}));

const { resolveTurnEquipmentEnv } = await import('./turn_equipment');
const args = {
  organizationId: 'org',
  sessionId: 'session',
  connectors: [],
  secrets: [],
};

function context(identity: { name: string; email: string } | null) {
  const runAction = vi
    .fn()
    .mockResolvedValue({ env: { REPO_SSH_KEY: 'synthetic-secret' } });
  const runQuery = vi.fn().mockResolvedValue(identity);
  const runMutation = vi.fn().mockResolvedValue(undefined);
  const ctx = { runAction, runQuery, runMutation } as unknown as ActionCtx;
  return { ctx, runAction, runQuery, runMutation };
}

beforeEach(() => vi.clearAllMocks());

describe('credentialed turn git author identity', () => {
  it('an SSH-only turn commits as its session owner without resolving any connector token', async () => {
    const fx = context({ name: 'Alex Rivera', email: 'alex@example.com' });
    const env = await resolveTurnEquipmentEnv(fx.ctx, {
      ...args,
      secrets: ['REPO_SSH_KEY'],
    });
    expect(env.REPO_SSH_KEY).toBe('synthetic-secret');
    expect(resolveConnectorCredential).not.toHaveBeenCalled();
    expect(fx.runMutation).not.toHaveBeenCalled();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(Object.values(env)).not.toContain('credential.helper');
    const author = execFileSync('git', ['var', 'GIT_AUTHOR_IDENT'], {
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        ...env,
      },
      encoding: 'utf8',
    });
    expect(author).toMatch(/^Alex Rivera <alex@example.com> /);
  });

  it('an otherwise unequipped turn receives only its owner identity', async () => {
    const fx = context({ name: 'Alex Rivera', email: 'alex@example.com' });
    const env = await resolveTurnEquipmentEnv(fx.ctx, args);
    expect(fx.runAction).not.toHaveBeenCalled();
    expect(resolveConnectorCredential).not.toHaveBeenCalled();
    expect(env).toEqual({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'user.name',
      GIT_CONFIG_VALUE_0: 'Alex Rivera',
      GIT_CONFIG_KEY_1: 'user.email',
      GIT_CONFIG_VALUE_1: 'alex@example.com',
    });
  });

  it('a system session without an identity stays empty and makes no credential request', async () => {
    const fx = context(null);
    expect(await resolveTurnEquipmentEnv(fx.ctx, args)).toEqual({});
    expect(resolveConnectorCredential).not.toHaveBeenCalled();
  });

  it('an unavailable owner lookup preserves granted secrets without inventing an author', async () => {
    const fx = context(null);
    fx.runQuery.mockRejectedValue(new Error('identity unavailable'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        await resolveTurnEquipmentEnv(fx.ctx, {
          ...args,
          secrets: ['REPO_SSH_KEY'],
        }),
      ).toEqual({ REPO_SSH_KEY: 'synthetic-secret' });
      expect(resolveConnectorCredential).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
});
