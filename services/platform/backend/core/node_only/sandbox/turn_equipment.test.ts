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

const { resolveConfinedTurnEnv, resolveTurnEquipmentEnv } =
  await import('./turn_equipment');
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

const CODER = { name: 'Coder', email: 'coder@tale.dev' };

/** A project agent's whole equipment, as both hosts hold it: a Forgejo grant
 * pinned to the organization's "Client A" credential, a secret, and the
 * agent's own commit identity. */
const equipped = {
  ...args,
  connectors: ['forgejo'],
  secrets: ['REPO_SSH_KEY'],
  connectorCredentials: { forgejo: 'Client A' },
  gitIdentity: CODER,
};

/** The organization's "Client A" Forgejo credential, as the credential seam
 * answers the pin. */
const CLIENT_A = {
  credentialId: 'cred-client-a',
  connectorSlug: 'forgejo',
  authMethod: 'bearer',
  secrets: { token: 'fj-client-a' },
  config: {},
  endpoint: 'https://git.tale.dev',
};

/** The `-c key=value` pairs a GIT_CONFIG_* env sets, by key. */
function gitConfig(env: Record<string, string>): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (let i = 0; i < Number(env.GIT_CONFIG_COUNT ?? 0); i++) {
    const key = env[`GIT_CONFIG_KEY_${i}`];
    const value = env[`GIT_CONFIG_VALUE_${i}`];
    if (key !== undefined && value !== undefined) pairs[key] = value;
  }
  return pairs;
}

describe('a project agent’s turn is equipped with its own credential and identity', () => {
  it('a pinned agent’s run in a workspace no person owns resolves the pinned credential and commits as the agent [SBX-R41] [SBX-R42]', async () => {
    resolveConnectorCredential.mockResolvedValue(CLIENT_A);
    const fx = context(null);
    const env = await resolveTurnEquipmentEnv(fx.ctx, equipped);
    expect(resolveConnectorCredential).toHaveBeenCalledTimes(1);
    expect(resolveConnectorCredential).toHaveBeenCalledWith(fx.ctx, {
      organizationId: 'org',
      connectorSlug: 'forgejo',
      credentialRef: 'Client A',
    });
    expect(env.TALE_GIT_CREDENTIALS).toBe(
      'git.tale.dev x-access-token fj-client-a',
    );
    expect(fx.runMutation).toHaveBeenCalledWith('credential-access', {
      organizationId: 'org',
      sessionId: 'session',
      slug: 'forgejo',
      kind: 'git',
      credentialId: 'cred-client-a',
    });
    expect(gitConfig(env)).toEqual({
      'credential.helper': '/usr/local/bin/tale-git-credential',
      'user.name': 'Coder',
      'user.email': 'coder@tale.dev',
    });
  });

  it('a confined run of the same agent is handed none of its secrets or credentials, only its commit identity [TASK-R79] [SBX-R42]', async () => {
    resolveConnectorCredential.mockResolvedValue(CLIENT_A);
    const fx = context(null);
    // The host holds the agent's whole equipment; the confined resolver
    // takes nothing from it but the identity.
    const env = await resolveConfinedTurnEnv(fx.ctx, equipped);
    expect(env).toEqual({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'user.name',
      GIT_CONFIG_VALUE_0: 'Coder',
      GIT_CONFIG_KEY_1: 'user.email',
      GIT_CONFIG_VALUE_1: 'coder@tale.dev',
    });
    expect(fx.runAction).not.toHaveBeenCalled();
    expect(resolveConnectorCredential).not.toHaveBeenCalled();
    expect(fx.runMutation).not.toHaveBeenCalled();
  });

  it('a confined run in a person’s workspace commits as that person, not as the agent [SBX-R42]', async () => {
    const fx = context({ name: 'Alex Rivera', email: 'alex@example.com' });
    expect(await resolveConfinedTurnEnv(fx.ctx, equipped)).toEqual({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'user.name',
      GIT_CONFIG_VALUE_0: 'Alex Rivera',
      GIT_CONFIG_KEY_1: 'user.email',
      GIT_CONFIG_VALUE_1: 'alex@example.com',
    });
    expect(fx.runQuery).toHaveBeenCalledWith('owner-identity', {
      sessionId: 'session',
    });
    expect(fx.runAction).not.toHaveBeenCalled();
    expect(fx.runMutation).not.toHaveBeenCalled();
  });
});
