// Unit gate for the session-credential broker: the `tale-git-credential`
// helper injection (pre-existing) and the git author-identity injection
// (#2586) it now carries alongside it, both expressed as contiguous
// GIT_CONFIG_* env pairs via `buildGitConfigEnv`. Mocks the generated action
// factory + api refs (the `credential_queries.test.ts` pattern) so the
// handler is callable directly with a fake ctx — no spawner, no real DB.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_generated/server', () => ({
  internalAction: (config: Record<string, unknown>) => config,
}));

vi.mock('../../_generated/api', () => ({
  internal: {
    integrations: {
      credential_queries: { getBySlugInternal: 'getBySlugInternal' },
    },
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

const getDecryptedCredentials = vi.fn();
vi.mock('../../integrations/get_decrypted_credentials', () => ({
  getDecryptedCredentials: (...args: unknown[]) =>
    getDecryptedCredentials(...args),
}));

const { resolveSessionCredentials, buildGitConfigEnv } =
  await import('./session_credentials');

interface ActionHandler<TArgs, TReturn> {
  handler: (ctx: unknown, args: TArgs) => Promise<TReturn>;
}

interface ResolveArgs {
  organizationId: string;
  sessionId: string;
  grants: string[];
  kind: 'bootstrap' | 'git';
}

interface ResolveReturn {
  env: Record<string, string>;
  git: Array<{ slug: string; hosts: string[]; username: string }>;
}

const resolve = resolveSessionCredentials as unknown as ActionHandler<
  ResolveArgs,
  ResolveReturn
>;

function makeCtx(opts: {
  credential?: { _id: string } | null;
  identity?: { name: string; email: string } | null;
}) {
  const runQuery = vi.fn((ref: unknown) => {
    if (ref === 'getBySlugInternal') {
      return Promise.resolve(opts.credential ?? null);
    }
    if (ref === 'getSessionOwnerIdentity') {
      return Promise.resolve(opts.identity ?? null);
    }
    throw new Error(`unexpected runQuery ref: ${String(ref)}`);
  });
  const runMutation = vi.fn().mockResolvedValue(undefined);
  return { runQuery, runMutation };
}

const OWNER = { name: 'Ada Lovelace', email: 'ada@example.com' };

describe('resolveSessionCredentials — git identity + credential-helper injection', () => {
  beforeEach(() => {
    getDecryptedCredentials.mockReset();
    getDecryptedCredentials.mockResolvedValue({ accessToken: 'gh-token' });
  });

  it('resolves a github grant to no credentials while integrations are offline, still injecting identity', async () => {
    const ctx = makeCtx({ credential: { _id: 'cred-1' }, identity: OWNER });
    const out = await resolve.handler(ctx as never, {
      organizationId: 'org-1',
      sessionId: 'sess-1',
      grants: ['github'],
      kind: 'bootstrap',
    });

    // Integration credential grants are offline while that backend is
    // rebuilt: no token, no git credential entry, so no credential.helper
    // pair — but the owner git identity is always-on and unaffected.
    expect(out.env.GITHUB_TOKEN).toBeUndefined();
    expect(out.git).toEqual([]);
    expect(out.env.GIT_CONFIG_COUNT).toBe('2');
    expect(out.env.GIT_CONFIG_KEY_0).toBe('user.name');
    expect(out.env.GIT_CONFIG_VALUE_0).toBe(OWNER.name);
    expect(out.env.GIT_CONFIG_KEY_1).toBe('user.email');
    expect(out.env.GIT_CONFIG_VALUE_1).toBe(OWNER.email);
    expect(Object.values(out.env)).not.toContain('credential.helper');
  });

  it('still injects identity when there is no git grant at all (always-on, not gated on git.length)', async () => {
    const ctx = makeCtx({ credential: null, identity: OWNER });
    const out = await resolve.handler(ctx as never, {
      organizationId: 'org-1',
      sessionId: 'sess-1',
      grants: [],
      kind: 'bootstrap',
    });

    expect(out.git).toEqual([]);
    expect(out.env.GIT_CONFIG_COUNT).toBe('2');
    expect(out.env.GIT_CONFIG_KEY_0).toBe('user.name');
    expect(out.env.GIT_CONFIG_VALUE_0).toBe(OWNER.name);
    expect(out.env.GIT_CONFIG_KEY_1).toBe('user.email');
    expect(out.env.GIT_CONFIG_VALUE_1).toBe(OWNER.email);
    // No credential.helper pair anywhere in the count.
    expect(Object.values(out.env)).not.toContain('credential.helper');
  });

  it('sets no git env for a granted session whose owner has no resolvable identity (system/workflow-owned)', async () => {
    const ctx = makeCtx({ credential: { _id: 'cred-1' }, identity: null });
    const out = await resolve.handler(ctx as never, {
      organizationId: 'org-1',
      sessionId: 'sess-1',
      grants: ['github'],
      kind: 'bootstrap',
    });

    // With grants resolving empty (integrations offline) and no identity,
    // there is nothing to inject at all — no helper pair, no count.
    expect(out.env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(out.env.GIT_CONFIG_KEY_0).toBeUndefined();
  });

  it('sets no GIT_CONFIG_* env at all with neither a git grant nor a resolvable identity', async () => {
    const ctx = makeCtx({ credential: null, identity: null });
    const out = await resolve.handler(ctx as never, {
      organizationId: 'org-1',
      sessionId: 'sess-1',
      grants: [],
      kind: 'bootstrap',
    });

    expect(out.env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(Object.keys(out.env)).toHaveLength(0);
  });

  it('audits the grant fetch and still resolves identity when a grant has no active credential', async () => {
    const ctx = makeCtx({ credential: null, identity: OWNER });
    const out = await resolve.handler(ctx as never, {
      organizationId: 'org-1',
      sessionId: 'sess-1',
      grants: ['github'],
      kind: 'bootstrap',
    });

    // Missing credential → no GITHUB_TOKEN, no git-helper entry, but the
    // always-on identity resolution still runs.
    expect(out.env.GITHUB_TOKEN).toBeUndefined();
    expect(out.git).toEqual([]);
    expect(out.env.GIT_CONFIG_COUNT).toBe('2');
    expect(out.env.GIT_CONFIG_KEY_0).toBe('user.name');
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
