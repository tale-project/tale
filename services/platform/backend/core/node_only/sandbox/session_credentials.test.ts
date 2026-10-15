// Unit gate for the session-credential broker: every equipped connector that
// declares a git host resolves — under the credential the agent pins, else the
// connector's default — into one `TALE_GIT_CREDENTIALS` line the in-image
// `tale-git-credential` helper answers that host from (GitHub's token also as
// GITHUB_TOKEN for its CLI), the git author identity rides along (the session
// owner's, else the agent's own), and every failure mode downgrades instead of
// throwing. Mocks the credential seam + api refs so the broker is callable
// directly with a fake ctx — no spawner, no real DB. The connector catalog is
// the shipped one (`configs/platform/system/connectors`).

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/handler_names', () => ({
  internal: {
    sandbox: {
      session_mutations: {
        recordCredentialAccess: 'recordCredentialAccess',
      },
      session_queries: {
        getSessionOwnerIdentity: 'getSessionOwnerIdentity',
      },
    },
  },
}));

const resolveConnectorCredential = vi.fn();
vi.mock('../../connector_credentials/resolve_credential', () => ({
  resolveConnectorCredential: (...args: unknown[]) =>
    resolveConnectorCredential(...args),
}));

const {
  brokeredCredentialNames,
  buildGitConfigEnv,
  GIT_CREDENTIALS_ENV,
  isBrokerableGrant,
  resolveSessionCredentialEnv,
} = await import('./session_credentials');

function makeCtx(opts: { identity?: { name: string; email: string } | null }) {
  const runQuery = vi.fn((ref: unknown) => {
    if (ref === 'getSessionOwnerIdentity') {
      return Promise.resolve(opts.identity ?? null);
    }
    throw new Error(`unexpected runQuery ref: ${String(ref)}`);
  });
  const runMutation = vi.fn().mockResolvedValue(undefined);
  return { runQuery, runMutation };
}

const OWNER = { name: 'Ada Lovelace', email: 'ada@example.com' };
const CODER = { name: 'Coder', email: 'coder@tale.dev' };

const ARGS = {
  organizationId: 'org-1',
  sessionId: 'sess-1',
  kind: 'bootstrap' as const,
};

/** A resolved credential of `slug`, as the credential seam answers it. */
function credential(
  slug: string,
  token: string,
  extra: { endpoint?: string; authMethod?: string; username?: string } = {},
) {
  return {
    credentialId: `cred-${slug}`,
    connectorSlug: slug,
    authMethod: extra.authMethod ?? 'bearer',
    secrets:
      extra.authMethod === 'basic'
        ? { username: extra.username ?? 'deploy', password: token }
        : { token, accessToken: token },
    config: {},
    ...(extra.endpoint !== undefined ? { endpoint: extra.endpoint } : {}),
  };
}

describe('the broker hands git the hosts of the equipped connectors alone [SBX-R40]', () => {
  beforeEach(() => {
    resolveConnectorCredential.mockReset();
  });

  it('maps github.com to the GitHub credential, offers it to gh, arms the helper and audits', async () => {
    resolveConnectorCredential.mockResolvedValue(
      credential('github', 'gh-token'),
    );
    const ctx = makeCtx({ identity: OWNER });

    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      grants: ['github'],
    });

    expect(out.env[GIT_CREDENTIALS_ENV]).toBe(
      'github.com x-access-token gh-token',
    );
    expect(out.env.GITHUB_TOKEN).toBe('gh-token');
    expect(out.env.GH_TOKEN).toBe('gh-token');
    expect(out.git).toEqual([
      { slug: 'github', host: 'github.com', username: 'x-access-token' },
    ]);
    // Helper first, then the identity pairs — contiguous from 0.
    expect(out.env.GIT_CONFIG_COUNT).toBe('3');
    expect(out.env.GIT_CONFIG_KEY_0).toBe('credential.helper');
    expect(out.env.GIT_CONFIG_VALUE_0).toBe(
      '/usr/local/bin/tale-git-credential',
    );
    expect(out.env.GIT_CONFIG_KEY_1).toBe('user.name');
    expect(out.env.GIT_CONFIG_KEY_2).toBe('user.email');
    // The Tier-2 traceability requirement: the fetch is audited.
    expect(ctx.runMutation).toHaveBeenCalledWith('recordCredentialAccess', {
      organizationId: 'org-1',
      sessionId: 'sess-1',
      slug: 'github',
      kind: 'bootstrap',
    });
  });

  it('maps a Forgejo credential to the host of its own endpoint, beside GitHub', async () => {
    resolveConnectorCredential.mockImplementation(
      (_ctx: unknown, args: { connectorSlug: string }) =>
        Promise.resolve(
          args.connectorSlug === 'github'
            ? credential('github', 'gh-token')
            : credential('forgejo', 'fj-token', {
                endpoint: 'https://Git.Tale.dev',
              }),
        ),
    );
    const ctx = makeCtx({ identity: null });

    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      grants: ['github', 'forgejo'],
    });

    expect(out.env[GIT_CREDENTIALS_ENV]?.split('\n')).toEqual([
      'github.com x-access-token gh-token',
      'git.tale.dev x-access-token fj-token',
    ]);
    // Only GitHub's CLI reads a token variable; Forgejo's stays in the map.
    expect(
      Object.entries(out.env).filter(([, value]) => value === 'fj-token'),
    ).toEqual([]);
    expect(out.env.GITHUB_TOKEN).toBe('gh-token');
  });

  it('keeps a port the endpoint names, which git sends as part of the host', async () => {
    resolveConnectorCredential.mockResolvedValue(
      credential('forgejo', 'fj-token', {
        endpoint: 'https://git.example.com:3000',
      }),
    );
    const out = await resolveSessionCredentialEnv(
      makeCtx({ identity: null }) as never,
      { ...ARGS, grants: ['forgejo'] },
    );
    expect(out.env[GIT_CREDENTIALS_ENV]).toBe(
      'git.example.com:3000 x-access-token fj-token',
    );
  });

  it('sends a basic credential’s own username beside its password', async () => {
    resolveConnectorCredential.mockResolvedValue(
      credential('forgejo', 'pw', {
        endpoint: 'https://git.tale.dev',
        authMethod: 'basic',
        username: 'deploy-bot',
      }),
    );
    const out = await resolveSessionCredentialEnv(
      makeCtx({ identity: null }) as never,
      { ...ARGS, grants: ['forgejo'] },
    );
    expect(out.env[GIT_CREDENTIALS_ENV]).toBe('git.tale.dev deploy-bot pw');
  });

  it('resolves nothing for a connector that declares no git host', async () => {
    const ctx = makeCtx({ identity: null });
    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      grants: ['slack', 'no-such-connector'],
    });
    expect(resolveConnectorCredential).not.toHaveBeenCalled();
    expect(Object.keys(out.env)).toHaveLength(0);
    expect(isBrokerableGrant('github')).toBe(true);
    expect(isBrokerableGrant('forgejo')).toBe(true);
    expect(isBrokerableGrant('slack')).toBe(false);
  });

  it('hands git no token it could not carry on one line', async () => {
    resolveConnectorCredential.mockResolvedValue(
      credential('github', 'bad token\nwith a line'),
    );
    const ctx = makeCtx({ identity: null });
    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      grants: ['github'],
    });
    expect(out.env[GIT_CREDENTIALS_ENV]).toBeUndefined();
    expect(out.env.GITHUB_TOKEN).toBeUndefined();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('skips a per-credential connector whose credential names no endpoint', async () => {
    resolveConnectorCredential.mockResolvedValue(
      credential('forgejo', 'fj-token'),
    );
    const out = await resolveSessionCredentialEnv(
      makeCtx({ identity: null }) as never,
      { ...ARGS, grants: ['forgejo'] },
    );
    expect(out.env[GIT_CREDENTIALS_ENV]).toBeUndefined();
  });

  it('names what a confined run goes without, by the names the model looks for', () => {
    expect(brokeredCredentialNames(['github', 'forgejo', 'slack'])).toEqual([
      'GITHUB_TOKEN',
      'forgejo git access',
    ]);
  });
});

describe('a pinned credential is the only one its connector hands the sandbox [SBX-R41]', () => {
  beforeEach(() => {
    resolveConnectorCredential.mockReset();
  });

  it('asks for the pinned credential by name, and the default for a connector without a pin', async () => {
    resolveConnectorCredential.mockImplementation(
      (_ctx: unknown, args: { connectorSlug: string }) =>
        Promise.resolve(
          args.connectorSlug === 'github'
            ? credential('github', 'gh-default')
            : credential('forgejo', 'fj-client-a', {
                endpoint: 'https://git.tale.dev',
              }),
        ),
    );
    const out = await resolveSessionCredentialEnv(
      makeCtx({ identity: null }) as never,
      {
        ...ARGS,
        grants: ['github', 'forgejo'],
        connectorCredentials: { forgejo: 'Client A' },
      },
    );
    expect(resolveConnectorCredential).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      connectorSlug: 'forgejo',
      credentialRef: 'Client A',
    });
    expect(resolveConnectorCredential).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      connectorSlug: 'github',
    });
    expect(out.env[GIT_CREDENTIALS_ENV]).toContain(
      'git.tale.dev x-access-token fj-client-a',
    );
  });

  it('hands nothing for a pin whose credential is gone — never the default', async () => {
    resolveConnectorCredential.mockImplementation(
      (_ctx: unknown, args: { credentialRef?: string }) =>
        args.credentialRef !== undefined
          ? Promise.reject(
              new Error('No credential "Client A" is configured for "forgejo"'),
            )
          : Promise.resolve(
              credential('forgejo', 'fj-central', {
                endpoint: 'https://git.tale.dev',
              }),
            ),
    );
    const ctx = makeCtx({ identity: OWNER });
    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      grants: ['forgejo'],
      connectorCredentials: { forgejo: 'Client A' },
    });
    expect(resolveConnectorCredential).toHaveBeenCalledTimes(1);
    expect(out.env[GIT_CREDENTIALS_ENV]).toBeUndefined();
    expect(Object.values(out.env)).not.toContain('credential.helper');
    expect(ctx.runMutation).not.toHaveBeenCalled();
    // The identity still rides along.
    expect(out.env.GIT_CONFIG_KEY_0).toBe('user.name');
  });

  it('skips a grant the credential seam refuses (no default / disabled), without auditing', async () => {
    resolveConnectorCredential.mockRejectedValue(
      new Error(
        'No default credential is configured for "github" — add one in Settings → Connectors.',
      ),
    );
    const ctx = makeCtx({ identity: null });
    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      grants: ['github'],
    });
    expect(out.env.GITHUB_TOKEN).toBeUndefined();
    expect(out.git).toEqual([]);
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(Object.keys(out.env)).toHaveLength(0);
  });
});

describe('commits carry the workspace owner’s identity, else the agent’s [SBX-R42]', () => {
  beforeEach(() => {
    resolveConnectorCredential.mockReset();
  });

  it('uses the person who owns the session over the agent’s identity', async () => {
    const out = await resolveSessionCredentialEnv(
      makeCtx({ identity: OWNER }) as never,
      { ...ARGS, grants: [], gitIdentity: CODER },
    );
    expect(out.env.GIT_CONFIG_VALUE_0).toBe(OWNER.name);
    expect(out.env.GIT_CONFIG_VALUE_1).toBe(OWNER.email);
  });

  it('uses the agent’s own identity in a workspace no person owns (dispatch, standing role, schedule)', async () => {
    const out = await resolveSessionCredentialEnv(
      makeCtx({ identity: null }) as never,
      { ...ARGS, grants: [], gitIdentity: CODER },
    );
    expect(out.env.GIT_CONFIG_COUNT).toBe('2');
    expect(out.env.GIT_CONFIG_KEY_0).toBe('user.name');
    expect(out.env.GIT_CONFIG_VALUE_0).toBe(CODER.name);
    expect(out.env.GIT_CONFIG_KEY_1).toBe('user.email');
    expect(out.env.GIT_CONFIG_VALUE_1).toBe(CODER.email);
  });

  it('arms the helper without identity pairs when there is neither', async () => {
    resolveConnectorCredential.mockResolvedValue(
      credential('github', 'gh-token'),
    );
    const out = await resolveSessionCredentialEnv(
      makeCtx({ identity: null }) as never,
      { ...ARGS, grants: ['github'], gitIdentity: null },
    );
    expect(out.env.GIT_CONFIG_COUNT).toBe('1');
    expect(out.env.GIT_CONFIG_KEY_0).toBe('credential.helper');
    expect(out.env.GIT_CONFIG_KEY_1).toBeUndefined();
  });

  it('sets no env at all with neither a grant nor an identity', async () => {
    const out = await resolveSessionCredentialEnv(
      makeCtx({ identity: null }) as never,
      { ...ARGS, grants: [] },
    );
    expect(Object.keys(out.env)).toHaveLength(0);
  });
});

describe('buildGitConfigEnv', () => {
  it('returns no env at all for an empty pair list', () => {
    expect(buildGitConfigEnv([])).toEqual({});
  });

  it('numbers pairs contiguously from 0 and sets the count', () => {
    expect(
      buildGitConfigEnv([
        { key: 'credential.helper', value: '/bin/helper' },
        { key: 'user.name', value: 'Ada Lovelace' },
        { key: 'user.email', value: 'ada@example.com' },
      ]),
    ).toEqual({
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '/bin/helper',
      GIT_CONFIG_KEY_1: 'user.name',
      GIT_CONFIG_VALUE_1: 'Ada Lovelace',
      GIT_CONFIG_KEY_2: 'user.email',
      GIT_CONFIG_VALUE_2: 'ada@example.com',
    });
  });
});
