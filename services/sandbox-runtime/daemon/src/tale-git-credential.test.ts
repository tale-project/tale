import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * The image's git credential helper answers each git host from the map the
 * platform's credential broker hands the exec (`TALE_GIT_CREDENTIALS`, one
 * `<host> <username> <token>` line per equipped git-capable connector) and
 * from nothing else: an unmapped host gets no answer, whatever else the
 * environment holds. Run on the host with `sh`, exactly as git runs it.
 */

const HELPER = resolve(import.meta.dir, '../../tale-git-credential');

const MAP = [
  'github.com x-access-token ghp_central',
  'git.tale.dev x-access-token forgejo_client',
  'git.example.com:3000 deploy basic_pass',
].join('\n');

function ask(
  operation: string,
  request: string,
  env: Record<string, string>,
): { status: number | null; stdout: string } {
  const result = spawnSync('sh', [HELPER, operation], {
    input: request,
    // Only what the test names: no ambient token from the developer's shell.
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env },
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout };
}

const request = (host: string) =>
  `protocol=https\nhost=${host}\npath=tale-project/tale.git\n\n`;

describe('tale-git-credential answers each host from the broker map alone [SBX-R40]', () => {
  test('answers github.com with its own entry', () => {
    expect(
      ask('get', request('github.com'), { TALE_GIT_CREDENTIALS: MAP }),
    ).toEqual({
      status: 0,
      stdout: 'username=x-access-token\npassword=ghp_central\n',
    });
  });

  test('answers a Forgejo host with its own entry, not GitHub’s', () => {
    expect(
      ask('get', request('git.tale.dev'), { TALE_GIT_CREDENTIALS: MAP }),
    ).toEqual({
      status: 0,
      stdout: 'username=x-access-token\npassword=forgejo_client\n',
    });
  });

  test('matches a host with its port, and the host whatever its case', () => {
    expect(
      ask('get', request('git.example.com:3000'), {
        TALE_GIT_CREDENTIALS: MAP,
      }).stdout,
    ).toBe('username=deploy\npassword=basic_pass\n');
    expect(
      ask('get', request('GitHub.com'), { TALE_GIT_CREDENTIALS: MAP }).stdout,
    ).toBe('username=x-access-token\npassword=ghp_central\n');
    // The same host on another port is another remote.
    expect(
      ask('get', request('git.example.com'), { TALE_GIT_CREDENTIALS: MAP })
        .stdout,
    ).toBe('');
  });

  test('says nothing for a host the map does not name', () => {
    expect(
      ask('get', request('gitlab.com'), { TALE_GIT_CREDENTIALS: MAP }),
    ).toEqual({ status: 0, stdout: '' });
  });

  test('never answers from ambient env: GITHUB_TOKEN without a map entry opens nothing', () => {
    expect(
      ask('get', request('github.com'), {
        GITHUB_TOKEN: 'ghp_ambient',
        GH_TOKEN: 'ghp_ambient',
      }),
    ).toEqual({ status: 0, stdout: '' });
    expect(
      ask('get', request('github.com'), {
        GITHUB_TOKEN: 'ghp_ambient',
        TALE_GIT_CREDENTIALS: 'git.tale.dev x-access-token forgejo_client',
      }).stdout,
    ).toBe('');
  });

  test('answers a mapped host over HTTPS only, never a plain http remote', () => {
    expect(
      ask('get', 'protocol=http\nhost=github.com\n\n', {
        TALE_GIT_CREDENTIALS: MAP,
      }),
    ).toEqual({ status: 0, stdout: '' });
    expect(
      ask('get', 'host=github.com\n\n', { TALE_GIT_CREDENTIALS: MAP }).stdout,
    ).toBe('');
  });

  test('ignores a line missing its token, and every operation but get', () => {
    expect(
      ask('get', request('github.com'), {
        TALE_GIT_CREDENTIALS: 'github.com x-access-token',
      }).stdout,
    ).toBe('');
    for (const operation of ['store', 'erase']) {
      expect(
        ask(operation, request('github.com'), { TALE_GIT_CREDENTIALS: MAP }),
      ).toEqual({ status: 0, stdout: '' });
    }
  });
});
