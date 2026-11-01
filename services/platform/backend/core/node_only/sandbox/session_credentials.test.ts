// Unit gate for the session-credential broker: every equipped connector that
// declares a git host resolves — under the credential the agent pins, else the
// connector's default — into one `TALE_GIT_CREDENTIALS` line the in-image
// `tale-git-credential` helper answers that host from (GitHub's token also as
// GITHUB_TOKEN for its CLI), the commit identity rides along (the agent's own,
// else Tale's, never a person's), and every failure mode downgrades instead of
// throwing. Mocks the credential seam + api refs so the broker is callable
// directly with a fake ctx — no spawner, no real DB. The connector catalog is
// the shipped one (`configs/platform/system/connectors`). The runtime image's
// helper (`services/sandbox-runtime/tale-git-credential`) runs under /bin/sh
// on what the broker writes, so the env name, the line format and the path
// the image installs it at are held from both ends.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/handler_names', () => ({
  internal: {
    sandbox: {
      session_mutations: {
        recordCredentialAccess: 'recordCredentialAccess',
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
  GIT_CREDENTIAL_HELPER,
  GIT_CREDENTIALS_ENV,
  gitCredentialLine,
  isBrokerableGrant,
  resolveSessionCredentialEnv,
  resolveSessionGitIdentityEnv,
  TALE_GIT_IDENTITY,
} = await import('./session_credentials');

const SANDBOX_RUNTIME = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../sandbox-runtime',
);

/** The broker reads nothing about the session: no owner, no person. */
function makeCtx() {
  const runQuery = vi.fn((ref: unknown) => {
    throw new Error(`unexpected runQuery ref: ${String(ref)}`);
  });
  const runMutation = vi.fn().mockResolvedValue(undefined);
  return { runQuery, runMutation };
}

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
    const ctx = makeCtx();

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
      credentialId: 'cred-github',
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
    const ctx = makeCtx();

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
        endpoint: 'https://git.tale.dev:3000',
      }),
    );
    const out = await resolveSessionCredentialEnv(
      makeCtx() as never,
      { ...ARGS, grants: ['forgejo'] },
    );
    expect(out.env[GIT_CREDENTIALS_ENV]).toBe(
      'git.tale.dev:3000 x-access-token fj-token',
    );
  });

  it('maps a subdomain of an allowed host, as the connector’s own calls reach it', async () => {
    resolveConnectorCredential.mockResolvedValue(
      credential('forgejo', 'fj-token', {
        endpoint: 'https://client-a.git.tale.dev',
      }),
    );
    const out = await resolveSessionCredentialEnv(
      makeCtx() as never,
      { ...ARGS, grants: ['forgejo'] },
    );
    expect(out.env[GIT_CREDENTIALS_ENV]).toBe(
      'client-a.git.tale.dev x-access-token fj-token',
    );
  });

  it.each([
    ['outside the connector’s allowed hosts', 'https://forge.example.com'],
    ['a look-alike of an allowed host', 'https://evil-git.tale.dev'],
    ['a cloud-metadata address', 'https://169.254.169.254'],
    ['a private address', 'https://10.0.0.5'],
  ])(
    'opens no git host for an endpoint %s, which the connector’s calls are refused',
    async (_why, endpoint) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      resolveConnectorCredential.mockResolvedValue(
        credential('forgejo', 'fj-token', { endpoint }),
      );
      const ctx = makeCtx();
      const out = await resolveSessionCredentialEnv(ctx as never, {
        ...ARGS,
        grants: ['forgejo'],
      });
      expect(out.env[GIT_CREDENTIALS_ENV]).toBeUndefined();
      expect(out.git).toEqual([]);
      expect(Object.values(out.env)).not.toContain('fj-token');
      expect(ctx.runMutation).not.toHaveBeenCalled();
      // The warning names the refusal, never the token.
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('fj-token');
      warn.mockRestore();
    },
  );

  it('sends a basic credential’s own username beside its password', async () => {
    resolveConnectorCredential.mockResolvedValue(
      credential('forgejo', 'pw', {
        endpoint: 'https://git.tale.dev',
        authMethod: 'basic',
        username: 'deploy-bot',
      }),
    );
    const out = await resolveSessionCredentialEnv(
      makeCtx() as never,
      { ...ARGS, grants: ['forgejo'] },
    );
    expect(out.env[GIT_CREDENTIALS_ENV]).toBe('git.tale.dev deploy-bot pw');
  });

  it('resolves nothing for a connector that declares no git host', async () => {
    const ctx = makeCtx();
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
    const ctx = makeCtx();
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
      makeCtx() as never,
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

/** What the runtime image's helper answers git for a request on `host`,
 * given the env the broker wrote. */
function helperAnswers(
  env: Record<string, string>,
  request: { protocol: string; host: string },
): string {
  const run = spawnSync(
    '/bin/sh',
    [path.join(SANDBOX_RUNTIME, 'tale-git-credential'), 'get'],
    {
      env: { PATH: '/usr/bin:/bin', ...env },
      input: `protocol=${request.protocol}\nhost=${request.host}\n\n`,
      encoding: 'utf8',
    },
  );
  expect(run.status).toBe(0);
  return run.stdout;
}

describe('the runtime image’s helper reads what the broker writes [SBX-R40]', () => {
  beforeEach(() => {
    resolveConnectorCredential.mockReset();
  });

  it('answers each brokered host from the broker’s own env, and no other host', async () => {
    resolveConnectorCredential.mockImplementation(
      (_ctx: unknown, args: { connectorSlug: string }) =>
        Promise.resolve(
          args.connectorSlug === 'github'
            ? credential('github', 'gh-token')
            : credential('forgejo', 'fj-token', {
                endpoint: 'https://git.tale.dev:3000',
              }),
        ),
    );
    const out = await resolveSessionCredentialEnv(
      makeCtx() as never,
      { ...ARGS, grants: ['github', 'forgejo'] },
    );

    expect(
      helperAnswers(out.env, { protocol: 'https', host: 'github.com' }),
    ).toBe('username=x-access-token\npassword=gh-token\n');
    expect(
      helperAnswers(out.env, { protocol: 'https', host: 'Git.Tale.dev:3000' }),
    ).toBe('username=x-access-token\npassword=fj-token\n');
    expect(
      helperAnswers(out.env, { protocol: 'https', host: 'gitlab.com' }),
    ).toBe('');
    expect(
      helperAnswers(out.env, { protocol: 'http', host: 'github.com' }),
    ).toBe('');
    // The token variable GitHub's CLI reads is no answer for git.
    expect(
      helperAnswers(
        { GITHUB_TOKEN: 'gh-token' },
        { protocol: 'https', host: 'github.com' },
      ),
    ).toBe('');
  });

  it('reads one entry per line as the broker formats it', () => {
    const env = {
      [GIT_CREDENTIALS_ENV]: [
        gitCredentialLine('github.com', 'x-access-token', 'gh-token'),
        gitCredentialLine('git.tale.dev', 'deploy-bot', 'pw'),
      ].join('\n'),
    };
    expect(
      helperAnswers(env, { protocol: 'https', host: 'git.tale.dev' }),
    ).toBe('username=deploy-bot\npassword=pw\n');
  });

  it('arms the helper at the path the runtime image installs it', () => {
    const dockerfile = readFileSync(
      path.join(SANDBOX_RUNTIME, 'Dockerfile'),
      'utf8',
    );
    expect(dockerfile).toContain(
      `COPY services/sandbox-runtime/tale-git-credential ${GIT_CREDENTIAL_HELPER}\n`,
    );
    expect(dockerfile).toMatch(
      new RegExp(`RUN chmod \\+x [^\\n]*${GIT_CREDENTIAL_HELPER}`),
    );
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
      makeCtx() as never,
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
    const ctx = makeCtx();
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
    const ctx = makeCtx();
    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      grants: ['github'],
    });
    expect(out.env.GITHUB_TOKEN).toBeUndefined();
    expect(out.git).toEqual([]);
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(out.env[GIT_CREDENTIALS_ENV]).toBeUndefined();
    expect(Object.values(out.env)).not.toContain(GIT_CREDENTIAL_HELPER);
  });
});

/** A git that reads no config of the machine it runs on and inherits no
 * identity from the environment that runs the tests. */
function isolatedGit(dir: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value;
  }
  Object.assign(env, {
    HOME: dir,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(dir, 'global.gitconfig'),
  });
  return (args: string[], extraEnv: Record<string, string> = {}) =>
    spawnSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: { ...env, ...extraEnv },
    });
}

describe('commits carry the agent’s identity, else Tale’s, never a person’s [SBX-R42]', () => {
  beforeEach(() => {
    resolveConnectorCredential.mockReset();
  });

  it('commits under the agent’s own identity, as author and as committer', async () => {
    const out = await resolveSessionCredentialEnv(makeCtx() as never, {
      ...ARGS,
      grants: [],
      gitIdentity: CODER,
    });
    expect(out.env).toEqual({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'user.name',
      GIT_CONFIG_VALUE_0: CODER.name,
      GIT_CONFIG_KEY_1: 'user.email',
      GIT_CONFIG_VALUE_1: CODER.email,
      GIT_AUTHOR_NAME: CODER.name,
      GIT_AUTHOR_EMAIL: CODER.email,
      GIT_COMMITTER_NAME: CODER.name,
      GIT_COMMITTER_EMAIL: CODER.email,
    });
  });

  it('commits as Tale when the agent has no identity of its own, never as nobody', async () => {
    expect(TALE_GIT_IDENTITY).toEqual({
      name: 'Tale',
      email: 'noreply@tale.dev',
    });
    for (const args of [
      { ...ARGS, grants: [] },
      { ...ARGS, grants: [], gitIdentity: null },
    ]) {
      const out = await resolveSessionCredentialEnv(makeCtx() as never, args);
      expect(out.env.GIT_AUTHOR_NAME).toBe('Tale');
      expect(out.env.GIT_AUTHOR_EMAIL).toBe('noreply@tale.dev');
      expect(out.env.GIT_COMMITTER_NAME).toBe('Tale');
      expect(out.env.GIT_COMMITTER_EMAIL).toBe('noreply@tale.dev');
      expect(out.env.GIT_CONFIG_VALUE_0).toBe('Tale');
      expect(out.env.GIT_CONFIG_VALUE_1).toBe('noreply@tale.dev');
    }
  });

  it('never asks whose workspace it is, so a person’s own never reaches a commit', async () => {
    const ctx = makeCtx();
    const out = await resolveSessionCredentialEnv(ctx as never, {
      ...ARGS,
      sessionId: 'sess-of-ada',
      grants: [],
    });
    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(out.env.GIT_AUTHOR_NAME).toBe('Tale');
  });

  it('numbers the identity pairs after the helper', async () => {
    resolveConnectorCredential.mockResolvedValue(
      credential('github', 'gh-token'),
    );
    const out = await resolveSessionCredentialEnv(makeCtx() as never, {
      ...ARGS,
      grants: ['github'],
      gitIdentity: null,
    });
    expect(out.env.GIT_CONFIG_COUNT).toBe('3');
    expect(out.env.GIT_CONFIG_KEY_0).toBe('credential.helper');
    expect(out.env.GIT_CONFIG_KEY_1).toBe('user.name');
    expect(out.env.GIT_CONFIG_VALUE_1).toBe('Tale');
    expect(out.env.GIT_CONFIG_KEY_2).toBe('user.email');
    expect(out.env.GIT_AUTHOR_NAME).toBe('Tale');
  });

  it('gives a confined run the same identity, and nothing else', () => {
    expect(resolveSessionGitIdentityEnv(CODER)).toEqual({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'user.name',
      GIT_CONFIG_VALUE_0: CODER.name,
      GIT_CONFIG_KEY_1: 'user.email',
      GIT_CONFIG_VALUE_1: CODER.email,
      GIT_AUTHOR_NAME: CODER.name,
      GIT_AUTHOR_EMAIL: CODER.email,
      GIT_COMMITTER_NAME: CODER.name,
      GIT_COMMITTER_EMAIL: CODER.email,
    });
    expect(resolveSessionGitIdentityEnv().GIT_AUTHOR_NAME).toBe('Tale');
  });

  it('holds in a real commit against the identity a repository configures for itself', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sbx-r42-'));
    try {
      const git = isolatedGit(dir);
      expect(git(['init', '-q', '.']).status).toBe(0);
      for (const [key, value] of [
        ['user.name', 'Ada Lovelace'],
        ['user.email', 'ada@example.com'],
        ['author.name', 'Ada Lovelace'],
        ['author.email', 'ada@example.com'],
        ['committer.name', 'Ada Lovelace'],
        ['committer.email', 'ada@example.com'],
      ] as const) {
        expect(git(['config', key, value]).status).toBe(0);
      }

      const commit = git(
        ['commit', '--allow-empty', '-q', '-m', 'probe'],
        resolveSessionGitIdentityEnv(),
      );
      expect(commit.stderr).toBe('');
      expect(commit.status).toBe(0);
      expect(git(['log', '-1', '--format=%an <%ae>|%cn <%ce>']).stdout).toBe(
        'Tale <noreply@tale.dev>|Tale <noreply@tale.dev>\n',
      );
      // What reads the config instead of committing sees the same name.
      expect(
        git(['config', 'user.name'], resolveSessionGitIdentityEnv()).stdout,
      ).toBe('Tale\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
