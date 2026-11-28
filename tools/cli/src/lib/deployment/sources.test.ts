import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { operationalFailure } from '../../commands/operational-failure';
import { CliError, ExitCode } from '../../utils/fail';
import {
  TALE_REPOSITORY,
  tagsAtRevision,
  withDeploymentSources,
} from './sources';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const revision = 'b'.repeat(40);
const client = { repository: 'https://github.com/north-labs/desk', revision };
const runtime = { repository: TALE_REPOSITORY, revision };
const success = (stdout = '') => ({
  stdout,
  stderr: '',
  exitCode: 0,
  success: true,
});

function syntheticKey() {
  const root = mkdtempSync(join(tmpdir(), 'tale-source-ssh-test-'));
  roots.push(root);
  const file = join(root, 'synthetic-key');
  execFileSync(
    'ssh-keygen',
    [
      '-q',
      '-t',
      'ed25519',
      '-N',
      '',
      '-C',
      'synthetic-source-test',
      '-f',
      file,
    ],
    { stdio: 'pipe', timeout: 5000 },
  );
  return { file, contents: readFileSync(file, 'utf8') };
}

const publicKey = (file: string) =>
  execFileSync('ssh-keygen', ['-y', '-P', '', '-f', file], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 5000,
  });

// Managed source preparation requires a POSIX host. Check the actual OpenSSH
// parser and its private-file permissions on both supported CI host families.
const testPosix = test.skipIf(process.platform === 'win32');
for (const variant of ['LF', 'missing LF', 'CRLF', 'CRLF missing LF']) {
  testPosix(
    `private source acquisition preserves the OpenSSH key identity with ${variant}`,
    async () => {
      const original = syntheticKey();
      const expectedPublicKey = publicKey(original.file);
      const lineEndings = variant.startsWith('CRLF')
        ? original.contents.replaceAll('\n', '\r\n')
        : original.contents;
      const sourceKey = variant.includes('missing')
        ? lineEndings.replace(/[\r\n]+$/, '')
        : lineEndings;
      let keyFile = '';
      let privateFetches = 0;
      let publicFetches = 0;
      await withDeploymentSources(
        [client, runtime],
        {
          sourceKey,
          fetchImpl: async () =>
            Response.json({
              ssh_keys: [
                expectedPublicKey.trim().split(' ').slice(0, 2).join(' '),
              ],
            }),
          run: async (command, args, options) => {
            expect(command).toBe('git');
            expect(options?.silent).toBe(true);
            expect(options?.timeout).toBe(args.includes('fetch') ? 1800 : 300);
            expect(options?.maxOutputBytes).toBe(1_048_576);
            expect(options?.env).not.toHaveProperty('TALE_SOURCE_SSH_KEY');
            expect(JSON.stringify(options?.env)).not.toContain(sourceKey);
            if (args.includes('fetch')) {
              const ssh = options?.env?.GIT_SSH_COMMAND;
              if (ssh) {
                privateFetches++;
                keyFile = /'-i' '([^']+)'/.exec(ssh)?.[1] ?? '';
                expect(ssh).toContain('StrictHostKeyChecking=yes');
                expect(ssh).toContain('IdentitiesOnly=yes');
                expect(ssh).toContain('BatchMode=yes');
                expect(statSync(keyFile).mode & 0o777).toBe(0o600);
                expect(statSync(dirname(keyFile)).mode & 0o777).toBe(0o700);
                // Parsing the actual temporary file catches missing terminal LF;
                // comparing public keys proves the key itself was not changed.
                expect(publicKey(keyFile)).toBe(expectedPublicKey);
                expect(readFileSync(keyFile, 'utf8')).toBe(original.contents);
              } else {
                publicFetches++;
                expect(options?.env).not.toHaveProperty('GIT_SSH_COMMAND');
              }
            }
            return success(args.includes('rev-parse') ? revision : '');
          },
        },
        async (source) => {
          expect(existsSync(source(client))).toBe(true);
          expect(existsSync(source(runtime))).toBe(true);
          expect(existsSync(keyFile)).toBe(true);
        },
      );
      expect(privateFetches).toBe(1);
      expect(publicFetches).toBe(1);
      expect(existsSync(keyFile)).toBe(false);
      expect(existsSync(dirname(keyFile))).toBe(false);
      expect(readFileSync(original.file, 'utf8')).toBe(original.contents);
    },
    30_000,
  );
}

test('public runtime source acquisition does not stage or use a client key', async () => {
  const sourceKey = 'unused-private-source-marker';
  let root = '';
  await withDeploymentSources(
    [runtime],
    {
      sourceKey,
      fetchImpl: () => {
        throw new Error('public source must not request SSH metadata');
      },
      run: async (_command, args, options) => {
        expect(options?.env).not.toHaveProperty('GIT_SSH_COMMAND');
        expect(options?.env).not.toHaveProperty('TALE_SOURCE_SSH_KEY');
        expect(JSON.stringify(options?.env)).not.toContain(sourceKey);
        return success(args.includes('rev-parse') ? revision : '');
      },
    },
    async (source) => {
      root = dirname(source(runtime));
      expect(existsSync(join(root, 'source-key'))).toBe(false);
      expect(existsSync(join(root, 'known-hosts'))).toBe(false);
    },
  );
  expect(existsSync(root)).toBe(false);
});

async function sourceFailure({
  stage = 'fetch',
  request = runtime,
  stderr = '',
  exitCode = 128,
  thrown,
}: {
  stage?: string;
  request?: typeof runtime;
  stderr?: string;
  exitCode?: number;
  thrown?: Error;
}) {
  let root = '';
  let failures = 0;
  try {
    await withDeploymentSources(
      [request],
      {
        run: async (_command, args) => {
          root = dirname(args[1]!);
          if (!args.includes(stage === 'tags' ? 'ls-remote' : stage))
            return success(revision);
          failures++;
          if (thrown) throw thrown;
          return { success: false, stdout: '', stderr, exitCode };
        },
      },
      async () => {
        throw new Error('failed acquisition must not reach its consumer');
      },
    );
    throw new Error('source acquisition must fail');
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    if (!(error instanceof CliError)) throw error;
    expect(error.info.code).toBe(ExitCode.ExternalDep);
    expect(error.info.cause).toBeUndefined();
    expect(failures).toBe(1);
    expect(existsSync(root)).toBe(false);
    expect(
      operationalFailure(error, { schema: 'invalid input', summary: 'failed' }),
    ).toBe(error);
    return error;
  }
}

test('source acquisition distinguishes disk and DNS failures without exposing stderr', async () => {
  const disk = await sourceFailure({
    stderr: 'fatal: No space left on device /private/checkout secret-marker',
  });
  const dns = await sourceFailure({
    stderr: 'fatal: Could not resolve host: private.example secret-marker',
  });
  expect(disk.message).toBe(
    'Git could not acquire the pinned runtime deployment source during fetch (exit 128; failure hint: no-space).',
  );
  expect(dns.message).toBe(
    'Git could not acquire the pinned runtime deployment source during fetch (exit 128; failure hint: name-resolution).',
  );
  for (const error of [disk, dns]) {
    expect(JSON.stringify(error.info)).not.toContain('secret-marker');
    expect(JSON.stringify(error.info)).not.toContain('private');
  }
});

for (const request of [runtime, client]) {
  for (const stage of [
    'init',
    'remote',
    'tags',
    'fetch',
    'checkout',
    'rev-parse',
  ]) {
    test(`source acquisition identifies ${request === runtime ? 'runtime' : 'configuration'} ${stage} failures`, async () => {
      const error = await sourceFailure({
        request,
        stage,
        stderr:
          'unknown secret-marker https://private.example/repo /private/key',
      });
      expect(error.message).toContain(
        `pinned ${request === runtime ? 'runtime' : 'configuration'} deployment source during ${stage} (exit 128; failure hint: unknown)`,
      );
      const rendered = JSON.stringify(error.info);
      for (const privateValue of [
        'secret-marker',
        'private',
        request.repository,
      ])
        expect(rendered).not.toContain(privateValue);
    });
  }
}

for (const exitCode of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 256]) {
  test(`source acquisition refuses invalid exit status ${exitCode}`, async () => {
    const error = await sourceFailure({ exitCode });
    expect(error.message).toContain('(exit unknown; failure hint: unknown)');
  });
}

for (const [message, hint] of [
  ['Command exceeded its time limit.', 'timeout'],
  ['Command output exceeded its byte limit.', 'output-limit'],
  ['unexpected private-source-key-marker /private/key', 'unknown'],
]) {
  test(`source acquisition classifies thrown ${hint} failures safely`, async () => {
    const error = await sourceFailure({ thrown: new Error(message) });
    expect(error.message).toContain(`(exit unknown; failure hint: ${hint})`);
    expect(JSON.stringify(error.info)).not.toContain(message);
  });
}

const forgejo = {
  repository: 'https://git.tale.dev/north-labs/desk',
  revision,
};
const sourceToken = 'synthetic-forgejo-token-marker';

test('a Forgejo configuration source is fetched over HTTPS with the token in git environment config alone', async () => {
  const sourceKey = 'unused-ssh-source-key-marker';
  const calls: { args: string[]; env: Record<string, string | undefined> }[] =
    [];
  await withDeploymentSources(
    [runtime, forgejo],
    {
      sourceKey,
      sourceToken,
      fetchImpl: () => {
        throw new Error('a Forgejo source must not request GitHub metadata');
      },
      run: async (_command, args, options) => {
        calls.push({ args, env: { ...options?.env } });
        return success(args.includes('rev-parse') ? revision : '');
      },
    },
    async (source) => {
      expect(existsSync(source(forgejo))).toBe(true);
    },
  );
  const basic = Buffer.from(`tale-source:${sourceToken}`).toString('base64');
  let tokenFetches = 0;
  for (const { args, env } of calls) {
    expect(args.join(' ')).not.toContain(sourceToken);
    expect(args.join(' ')).not.toContain(basic);
    expect(env).not.toHaveProperty('TALE_SOURCE_TOKEN');
    expect(env).not.toHaveProperty('GIT_SSH_COMMAND');
    expect(JSON.stringify(env)).not.toContain(sourceToken);
    expect(JSON.stringify(env)).not.toContain(sourceKey);
    const directory = args[1] ?? '';
    const isForgejo = calls.some(
      (call) =>
        call.args[1] === directory && call.args.includes(forgejo.repository),
    );
    if (args.includes('remote'))
      // The remote is the canonical HTTPS URL: no userinfo, no token.
      expect(args.at(-1)).toBe(
        isForgejo ? forgejo.repository : TALE_REPOSITORY,
      );
    if (isForgejo && (args.includes('fetch') || args.includes('ls-remote'))) {
      tokenFetches++;
      expect(env).toMatchObject({
        GIT_CONFIG_COUNT: '3',
        GIT_CONFIG_KEY_0: 'http.https://git.tale.dev/.extraHeader',
        GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
        GIT_CONFIG_KEY_1: 'credential.helper',
        GIT_CONFIG_VALUE_1: '',
        GIT_CONFIG_KEY_2: 'http.followRedirects',
        GIT_CONFIG_VALUE_2: 'false',
        GIT_TERMINAL_PROMPT: '0',
      });
    } else {
      // The runtime and every non-fetch step never see the header.
      expect(JSON.stringify(env)).not.toContain(basic);
      expect(env).not.toHaveProperty('GIT_CONFIG_COUNT');
    }
  }
  // The tag listing and the fetch: both read the private repository.
  expect(tokenFetches).toBe(2);
});

testPosix('git reads the token header for the allowed host only', () => {
  // Drive the real Git config parser with the environment prepare builds.
  const captured: Record<string, string | undefined>[] = [];
  return withDeploymentSources(
    [forgejo],
    {
      sourceToken,
      run: async (_command, args, options) => {
        if (args.includes('fetch')) captured.push({ ...options?.env });
        return success(args.includes('rev-parse') ? revision : '');
      },
    },
    async () => {
      const env = captured[0];
      expect(env).toBeDefined();
      const read = (url: string) => {
        try {
          return execFileSync(
            'git',
            ['config', '--get-urlmatch', 'http.extraHeader', url],
            { env: env as NodeJS.ProcessEnv, encoding: 'utf8', stdio: 'pipe' },
          ).trim();
        } catch (error) {
          // `--get-urlmatch` exits 1 when no value matches.
          if ((error as { status?: number }).status === 1) return '';
          throw error;
        }
      };
      const basic = Buffer.from(`tale-source:${sourceToken}`).toString(
        'base64',
      );
      expect(read(forgejo.repository)).toBe(`Authorization: Basic ${basic}`);
      expect(read('https://github.com/north-labs/desk')).toBe('');
      expect(read('https://git.tale.dev.example/north-labs/desk')).toBe('');
      expect(read('http://git.tale.dev/north-labs/desk')).toBe('');
    },
  );
});

test('a Forgejo source without TALE_SOURCE_TOKEN fails before any Git step', async () => {
  let gitRuns = 0;
  const run = async () => {
    gitRuns++;
    return success(revision);
  };
  for (const token of [undefined, '']) {
    await expect(
      withDeploymentSources(
        [runtime, forgejo],
        { sourceToken: token, run },
        async () => {
          throw new Error('must not reach the source consumer');
        },
      ),
    ).rejects.toThrow(
      'A configuration source on an allowed Forgejo host needs TALE_SOURCE_TOKEN in the prepare environment.',
    );
  }
  expect(gitRuns).toBe(0);
});

test('a token that could break the header is refused without echoing it', async () => {
  for (const token of [`${sourceToken}\n`, `${sourceToken} x`, `a\r\nX: y`]) {
    let gitRuns = 0;
    const error = await withDeploymentSources(
      [forgejo],
      {
        sourceToken: token,
        run: async () => {
          gitRuns++;
          return success(revision);
        },
      },
      async () => undefined,
    ).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(CliError);
    if (!(error instanceof CliError)) throw error;
    expect(error.message).toBe(
      'TALE_SOURCE_TOKEN must be one line of printable characters.',
    );
    expect(JSON.stringify(error.info)).not.toContain(sourceToken);
    expect(gitRuns).toBe(0);
  }
});

test('only GitHub and the allowed Forgejo hosts over canonical HTTPS are sources', async () => {
  for (const repository of [
    'https://gitlab.com/north-labs/desk',
    'https://git.tale.dev.example/north-labs/desk',
    'https://evil.example/git.tale.dev/desk',
    'http://git.tale.dev/north-labs/desk',
    'https://git.tale.dev:443/north-labs/desk',
    'https://git.tale.dev:8443/north-labs/desk',
    'https://user@git.tale.dev/north-labs/desk',
    `https://${sourceToken}@git.tale.dev/north-labs/desk`,
    'https://git.tale.dev/north-labs/desk.git',
    'https://git.tale.dev/north-labs/desk?token=private',
    'https://git.tale.dev/north-labs/desk#main',
    'https://git.tale.dev/north-labs/desk/',
    'https://git.tale.dev/north-labs/../desk',
    'https://GIT.TALE.DEV/north-labs/desk',
    'ssh://git@git.tale.dev/north-labs/desk',
  ]) {
    let gitRuns = 0;
    await expect(
      withDeploymentSources(
        [{ repository, revision }],
        {
          sourceToken,
          run: async () => {
            gitRuns++;
            return success(revision);
          },
        },
        async () => undefined,
      ),
    ).rejects.toThrow(
      'Deployment source must be a canonical GitHub repository URL or one on an allowed Forgejo host.',
    );
    expect(gitRuns).toBe(0);
  }
});

test('a GitHub source keeps the SSH path and never receives the Forgejo token', async () => {
  const original = syntheticKey();
  const expectedPublicKey = publicKey(original.file);
  let sshFetches = 0;
  await withDeploymentSources(
    [client, forgejo],
    {
      sourceKey: original.contents,
      sourceToken,
      fetchImpl: async () =>
        Response.json({
          ssh_keys: [expectedPublicKey.trim().split(' ').slice(0, 2).join(' ')],
        }),
      run: async (_command, args, options) => {
        expect(args.join(' ')).not.toContain(sourceToken);
        if (args.includes('remote') && args.at(-1)?.startsWith('git@'))
          expect(args.at(-1)).toBe('git@github.com:north-labs/desk.git');
        if (options?.env?.GIT_SSH_COMMAND) {
          sshFetches++;
          expect(options.env).not.toHaveProperty('GIT_CONFIG_COUNT');
          expect(JSON.stringify(options.env)).not.toContain(
            Buffer.from(`tale-source:${sourceToken}`).toString('base64'),
          );
        }
        return success(args.includes('rev-parse') ? revision : '');
      },
    },
    async () => undefined,
  );
  // The tag listing and the fetch, both over the client key.
  expect(sshFetches).toBe(2);
});

test('a refused Forgejo read says the token cannot read, never the token, URL or server text', async () => {
  for (const stderr of [
    `remote: Unauthorized\nfatal: Authentication failed for '${forgejo.repository}/' ${sourceToken}`,
    `fatal: unable to access '${forgejo.repository}/': The requested URL returned error: 403`,
    "fatal: could not read Username for 'https://git.tale.dev': terminal prompts disabled",
  ]) {
    const error = await withDeploymentSources(
      [forgejo],
      {
        sourceToken,
        run: async (_command, args) =>
          args.includes('fetch')
            ? { success: false, stdout: '', stderr, exitCode: 128 }
            : success(revision),
      },
      async () => undefined,
    ).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(CliError);
    if (!(error instanceof CliError)) throw error;
    expect(error.info.code).toBe(ExitCode.ExternalDep);
    expect(error.message).toBe(
      'Git could not acquire the pinned configuration deployment source during fetch (exit 128; failure hint: authentication). The source token cannot read the repository.',
    );
    const rendered = JSON.stringify(error.info);
    for (const privateValue of [sourceToken, 'git.tale.dev', 'north-labs'])
      expect(rendered).not.toContain(privateValue);
  }
});

test('a supplied Forgejo checkout needs no token and runs no fetch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tale-forgejo-supplied-'));
  roots.push(root);
  const sourcesFile = join(root, 'sources.json');
  writeFileSync(
    sourcesFile,
    JSON.stringify({ [`${forgejo.repository}@${revision}`]: root }),
  );
  const calls: string[][] = [];
  await withDeploymentSources(
    [forgejo],
    {
      sourcesFile,
      run: async (_command, args) => {
        calls.push(args);
        return success(revision);
      },
    },
    async (source) => {
      expect(source(forgejo)).toBe(root);
    },
  );
  expect(calls.map((args) => args.at(-2))).toEqual(['rev-parse']);
});

test('only the tags at the pinned revision are fetched, never every tag', async () => {
  const other = 'c'.repeat(40);
  const annotated = 'd'.repeat(40);
  const listing = [
    `${annotated}\trefs/tags/v0.5.74`,
    `${revision}\trefs/tags/v0.5.74^{}`,
    `${revision}\trefs/tags/marketing-ui-v0.5.74`,
    `${other}\trefs/tags/v0.5.75`,
    `${other}\trefs/tags/v0.5.75^{}`,
  ].join('\n');
  const fetches: string[][] = [];
  const listings: string[][] = [];
  await withDeploymentSources(
    [runtime],
    {
      run: async (_command, args, options) => {
        if (args.includes('ls-remote')) {
          listings.push(args);
          expect(options?.timeout).toBe(300);
          return success(listing);
        }
        if (args.includes('fetch')) {
          fetches.push(args);
          expect(options?.timeout).toBe(1800);
        }
        return success(args.includes('rev-parse') ? revision : '');
      },
    },
    async () => {},
  );
  expect(listings).toHaveLength(1);
  expect(listings[0]!.slice(-3)).toEqual(['ls-remote', '--tags', 'origin']);
  expect(fetches).toHaveLength(1);
  const fetch = fetches[0]!;
  expect(fetch).not.toContain('--tags');
  expect(fetch.slice(fetch.indexOf('fetch'))).toEqual([
    'fetch',
    '--depth=1',
    '--no-tags',
    'origin',
    revision,
    '+refs/tags/marketing-ui-v0.5.74:refs/tags/marketing-ui-v0.5.74',
    '+refs/tags/v0.5.74:refs/tags/v0.5.74',
  ]);
  // A stalled transfer aborts by Git's own low-speed limit, long before the
  // transfer's deadline.
  for (const args of [...listings, ...fetches]) {
    expect(args).toContain('http.lowSpeedLimit=1024');
    expect(args).toContain('http.lowSpeedTime=120');
  }
});

test('a tag listing names no refspec Git would read as an option, pattern or range', () => {
  const at = (reference: string) =>
    tagsAtRevision(`${revision}\t${reference}`, revision);
  expect(at('refs/tags/v0.5.74')).toEqual(['refs/tags/v0.5.74']);
  expect(at('refs/tags/release/v1')).toEqual(['refs/tags/release/v1']);
  for (const refused of [
    'refs/tags/-x',
    'refs/tags/a..b',
    'refs/tags/a*',
    'refs/tags/a:b',
    'refs/tags/a b',
    'refs/tags/a//b',
    'refs/tags/a.',
    'refs/tags/',
    'refs/heads/main',
    'HEAD',
  ])
    expect(at(refused)).toEqual([]);
  // A line for another commit, or one with extra fields, names nothing.
  expect(tagsAtRevision(`${'c'.repeat(40)}\trefs/tags/v1`, revision)).toEqual(
    [],
  );
  expect(tagsAtRevision(`${revision}\trefs/tags/v1\textra`, revision)).toEqual(
    [],
  );
  const many = Array.from(
    { length: 100 },
    (_, index) => `${revision}\trefs/tags/t${String(index).padStart(3, '0')}`,
  ).join('\n');
  expect(tagsAtRevision(many, revision)).toHaveLength(64);
});
