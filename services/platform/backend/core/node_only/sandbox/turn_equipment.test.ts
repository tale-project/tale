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

/** A host context. The equipment reads nothing about the session: whose
 * workspace it is never decides whose name a commit carries. */
function context() {
  const runAction = vi
    .fn()
    .mockResolvedValue({ env: { REPO_SSH_KEY: 'synthetic-secret' } });
  const runQuery = vi.fn().mockRejectedValue(new Error('unexpected query'));
  const runMutation = vi.fn().mockResolvedValue(undefined);
  const ctx = { runAction, runQuery, runMutation } as unknown as ActionCtx;
  return { ctx, runAction, runQuery, runMutation };
}

/** The env Tale's own identity sets, as author, committer and config. */
const TALE_ENV = {
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'user.name',
  GIT_CONFIG_VALUE_0: 'Tale',
  GIT_CONFIG_KEY_1: 'user.email',
  GIT_CONFIG_VALUE_1: 'noreply@tale.dev',
  GIT_AUTHOR_NAME: 'Tale',
  GIT_AUTHOR_EMAIL: 'noreply@tale.dev',
  GIT_COMMITTER_NAME: 'Tale',
  GIT_COMMITTER_EMAIL: 'noreply@tale.dev',
};

beforeEach(() => vi.clearAllMocks());

describe('every turn commits under an identity, never a person’s [SBX-R42]', () => {
  it('an SSH-only turn commits as Tale without resolving any connector token', async () => {
    const fx = context();
    const env = await resolveTurnEquipmentEnv(fx.ctx, {
      ...args,
      secrets: ['REPO_SSH_KEY'],
    });
    expect(env.REPO_SSH_KEY).toBe('synthetic-secret');
    expect(resolveConnectorCredential).not.toHaveBeenCalled();
    expect(fx.runMutation).not.toHaveBeenCalled();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(Object.values(env)).not.toContain('credential.helper');
    const identity = (name: string) =>
      execFileSync('git', ['var', name], {
        env: {
          PATH: process.env.PATH,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          ...env,
        },
        encoding: 'utf8',
      });
    expect(identity('GIT_AUTHOR_IDENT')).toMatch(/^Tale <noreply@tale.dev> /);
    expect(identity('GIT_COMMITTER_IDENT')).toMatch(
      /^Tale <noreply@tale.dev> /,
    );
  });

  it('a session no person owns (system:task-agent, system:automation) gets Tale’s identity, not none', async () => {
    const fx = context();
    expect(await resolveTurnEquipmentEnv(fx.ctx, args)).toEqual(TALE_ENV);
    expect(fx.runAction).not.toHaveBeenCalled();
    expect(fx.runQuery).not.toHaveBeenCalled();
    expect(resolveConnectorCredential).not.toHaveBeenCalled();
  });

  it('a broker failure drops the credential but keeps the secrets and the identity', async () => {
    resolveConnectorCredential.mockResolvedValue({
      credentialId: 'cred-github',
      connectorSlug: 'github',
      authMethod: 'bearer',
      secrets: { token: 'gh-token' },
      config: {},
    });
    const fx = context();
    fx.runMutation.mockRejectedValue(new Error('audit unavailable'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        await resolveTurnEquipmentEnv(fx.ctx, {
          ...args,
          connectors: ['github'],
          secrets: ['REPO_SSH_KEY'],
        }),
      ).toEqual({ REPO_SSH_KEY: 'synthetic-secret', ...TALE_ENV });
      expect(warning).toHaveBeenCalledWith(
        '[turn-equipment] connector broker failed (continuing):',
        'audit unavailable',
      );
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
  it('a pinned agent’s run resolves the pinned credential and commits as the agent [SBX-R41] [SBX-R42]', async () => {
    resolveConnectorCredential.mockResolvedValue(CLIENT_A);
    const fx = context();
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
    expect(env.GIT_AUTHOR_NAME).toBe('Coder');
    expect(env.GIT_COMMITTER_EMAIL).toBe('coder@tale.dev');
  });

  it('a confined run of the same agent is handed none of its secrets or credentials, only its commit identity [TASK-R79] [SBX-R42]', () => {
    // The host holds the agent's whole equipment; the confined resolver
    // takes nothing from it but the identity.
    expect(resolveConfinedTurnEnv(equipped.gitIdentity)).toEqual({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'user.name',
      GIT_CONFIG_VALUE_0: 'Coder',
      GIT_CONFIG_KEY_1: 'user.email',
      GIT_CONFIG_VALUE_1: 'coder@tale.dev',
      GIT_AUTHOR_NAME: 'Coder',
      GIT_AUTHOR_EMAIL: 'coder@tale.dev',
      GIT_COMMITTER_NAME: 'Coder',
      GIT_COMMITTER_EMAIL: 'coder@tale.dev',
    });
    expect(resolveConnectorCredential).not.toHaveBeenCalled();
  });

  it('a confined run in a person’s workspace commits as the agent, else as Tale, never as that person [SBX-R42]', () => {
    // The confined resolver takes no session and no context: the workspace's
    // owner has no way to reach the commit.
    expect(resolveConfinedTurnEnv(CODER).GIT_AUTHOR_NAME).toBe('Coder');
    expect(resolveConfinedTurnEnv(null)).toEqual(TALE_ENV);
    expect(resolveConfinedTurnEnv()).toEqual(TALE_ENV);
  });
});
