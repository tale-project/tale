// Unit gate for the session-credential broker: brokerable grants resolve
// through the connector-credentials seam into per-exec env (GITHUB_TOKEN +
// the `tale-git-credential` helper activation), the git author-identity
// injection (#2586) rides along unconditionally, and every failure mode
// downgrades instead of throwing. Mocks the credential seam + api refs so the
// broker is callable directly with a fake ctx — no spawner, no real DB.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_generated/api', () => ({
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

const { BROKERABLE_GRANTS, buildGitConfigEnv, resolveSessionCredentialEnv } =
  await import('./session_credentials');

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

const ARGS = {
  organizationId: 'org-1',
  sessionId: 'sess-1',
  kind: 'bootstrap' as const,
};

describe('resolveSessionCredentialEnv — git credential + identity injection', () => {
  beforeEach(() => {
    resolveConnectorCredential.mockReset();
  });

  it('resolves a github grant to GITHUB_TOKEN/GH_TOKEN, arms the credential helper, audits, and injects identity', async () => {
    resolveConnectorCredential.mockResolvedValue({
      credentialId: 'cred-1',
      connectorSlug: 'github',
      authMethod: 'bearer',
      secrets: { token: 'gh-token', accessToken: 'gh-token' },
      config: {},
    });
    const ctx = makeCtx({ identity: OWNER });

    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      grants: ['github'],
    });

    expect(out.env.GITHUB_TOKEN).toBe('gh-token');
    expect(out.env.GH_TOKEN).toBe('gh-token');
    expect(out.git).toEqual([
      { slug: 'github', hosts: ['github.com'], username: 'x-access-token' },
    ]);
    // Helper first, then the identity pairs — contiguous from 0.
    expect(out.env.GIT_CONFIG_COUNT).toBe('3');
    expect(out.env.GIT_CONFIG_KEY_0).toBe('credential.helper');
    expect(out.env.GIT_CONFIG_VALUE_0).toBe(
      '/usr/local/bin/tale-git-credential',
    );
    expect(out.env.GIT_CONFIG_KEY_1).toBe('user.name');
    expect(out.env.GIT_CONFIG_VALUE_1).toBe(OWNER.name);
    expect(out.env.GIT_CONFIG_KEY_2).toBe('user.email');
    expect(out.env.GIT_CONFIG_VALUE_2).toBe(OWNER.email);
    // The Tier-2 traceability requirement: the fetch is audited.
    expect(ctx.runMutation).toHaveBeenCalledWith('recordCredentialAccess', {
      organizationId: 'org-1',
      sessionId: 'sess-1',
      slug: 'github',
      kind: 'bootstrap',
    });
  });

  it('prefers an OAuth access token when the bindings carry one', async () => {
    resolveConnectorCredential.mockResolvedValue({
      credentialId: 'cred-1',
      connectorSlug: 'github',
      authMethod: 'oauth2',
      secrets: { accessToken: 'oauth-token' },
      config: {},
    });
    const ctx = makeCtx({ identity: null });

    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      grants: ['github'],
    });

    expect(out.env.GITHUB_TOKEN).toBe('oauth-token');
  });

  it('skips a grant the credential seam refuses (no credential / disabled), without auditing, keeping identity', async () => {
    resolveConnectorCredential.mockRejectedValue(
      new Error(
        'No default credential is configured for "github" — add one in Settings → Connectors.',
      ),
    );
    const ctx = makeCtx({ identity: OWNER });

    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      grants: ['github'],
    });

    expect(out.env.GITHUB_TOKEN).toBeUndefined();
    expect(out.git).toEqual([]);
    expect(ctx.runMutation).not.toHaveBeenCalled();
    // No credential.helper pair — only the always-on identity.
    expect(out.env.GIT_CONFIG_COUNT).toBe('2');
    expect(out.env.GIT_CONFIG_KEY_0).toBe('user.name');
    expect(Object.values(out.env)).not.toContain('credential.helper');
  });

  it('skips a grant whose bindings carry no usable secret', async () => {
    resolveConnectorCredential.mockResolvedValue({
      credentialId: 'cred-1',
      connectorSlug: 'github',
      authMethod: 'api-key',
      secrets: {},
      config: {},
    });
    const ctx = makeCtx({ identity: null });

    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      grants: ['github'],
    });

    expect(Object.keys(out.env)).toHaveLength(0);
    expect(out.git).toEqual([]);
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('still injects identity when there is no grant at all (always-on, not gated on git.length)', async () => {
    const ctx = makeCtx({ identity: OWNER });

    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      grants: [],
    });

    expect(resolveConnectorCredential).not.toHaveBeenCalled();
    expect(out.git).toEqual([]);
    expect(out.env.GIT_CONFIG_COUNT).toBe('2');
    expect(out.env.GIT_CONFIG_KEY_0).toBe('user.name');
    expect(out.env.GIT_CONFIG_VALUE_0).toBe(OWNER.name);
    expect(out.env.GIT_CONFIG_KEY_1).toBe('user.email');
    expect(out.env.GIT_CONFIG_VALUE_1).toBe(OWNER.email);
    expect(Object.values(out.env)).not.toContain('credential.helper');
  });

  it('arms the helper without identity pairs for a granted session whose owner has none (system/workflow-owned)', async () => {
    resolveConnectorCredential.mockResolvedValue({
      credentialId: 'cred-1',
      connectorSlug: 'github',
      authMethod: 'bearer',
      secrets: { token: 'gh-token' },
      config: {},
    });
    const ctx = makeCtx({ identity: null });

    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      grants: ['github'],
    });

    expect(out.env.GITHUB_TOKEN).toBe('gh-token');
    expect(out.env.GIT_CONFIG_COUNT).toBe('1');
    expect(out.env.GIT_CONFIG_KEY_0).toBe('credential.helper');
    expect(out.env.GIT_CONFIG_KEY_1).toBeUndefined();
  });

  it('sets no env at all with neither a grant nor a resolvable identity', async () => {
    const ctx = makeCtx({ identity: null });

    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      grants: [],
    });

    expect(Object.keys(out.env)).toHaveLength(0);
  });

  it('keeps the brokerable allowlist explicit — github only, extended one deliberate entry at a time', () => {
    expect(BROKERABLE_GRANTS).toEqual(['github']);
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
