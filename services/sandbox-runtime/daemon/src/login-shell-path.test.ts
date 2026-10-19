// The PATH a login shell gets in the runtime image. `ENV PATH` does not reach
// one: Debian's /etc/profile resets PATH, then reads /etc/profile.d, and
// without login-shell-path.sh there a `bash -lc` (runnerd's shell exec form,
// Codex's shell tool) finds python3 and bun but not node, npm, the agent CLIs
// or a package the session installed. The file's directories are written
// twice over, in the Dockerfile's ENV and in entrypoint.sh, so what holds
// them together is this test: it reads both and runs the file as /etc/profile
// would, for the agent's uid and for root.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const RUNTIME = resolve(import.meta.dir, '../..');
const SCRIPT = join(RUNTIME, 'login-shell-path.sh');
const dockerfile = readFileSync(join(RUNTIME, 'Dockerfile'), 'utf8');
const entrypoint = readFileSync(join(RUNTIME, 'entrypoint.sh'), 'utf8');

/** What Debian's /etc/profile sets for a login shell before it reads
 * /etc/profile.d, by uid. */
const DEBIAN_USER = [
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/local/games',
  '/usr/games',
];
const DEBIAN_ROOT = [
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin',
];

/** The directories the image puts ahead of the system ones, from the runtime
 * stage's `ENV PATH` (the last in the Dockerfile), and what follows them. */
function imagePath(): { tools: string[]; system: string[] } {
  const all = [...dockerfile.matchAll(/^ENV PATH=(\S+)$/gm)];
  const last = all.at(-1)?.[1];
  if (last === undefined) throw new Error('the Dockerfile has no ENV PATH');
  const dirs = last.split(':');
  const at = dirs.indexOf('/usr/local/bin');
  return { tools: dirs.slice(0, at), system: dirs.slice(at) };
}

/** The dependency directories entrypoint.sh puts in front of PATH. */
function sessionDirs(): string[] {
  const found = [...entrypoint.matchAll(/^\s*export PATH=(\S+):\$PATH$/gm)];
  if (found.length !== 1) {
    throw new Error(
      `entrypoint.sh must put the session directories ahead of PATH once, found ${found.length}`,
    );
  }
  return (found[0]?.[1] ?? '').split(':');
}

/** Source the file in `sh` with `PATH` as /etc/profile left it, as the uid a
 * stand-in `id` answers with. The stand-in's directory stays on PATH, so the
 * result names it where the real image names nothing. */
function loginPath(uid: number, base: string[]): string[] {
  const bin = mkdtempSync(join(tmpdir(), 'tale-login-path-'));
  writeFileSync(join(bin, 'id'), `#!/bin/sh\necho ${uid}\n`);
  chmodSync(join(bin, 'id'), 0o755);
  const result = spawnSync(
    '/bin/sh',
    ['-c', '. "$1" && printf %s "$PATH"', 'sh', SCRIPT],
    { env: { PATH: [bin, ...base].join(':') }, encoding: 'utf8' },
  );
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout.split(':').filter((dir) => dir !== bin);
}

describe('the PATH of a login shell in the runtime image', () => {
  test('the Dockerfile installs the file where /etc/profile reads it', () => {
    expect(dockerfile).toMatch(
      /^COPY (?:--chmod=\d+ )?services\/sandbox-runtime\/login-shell-path\.sh \/etc\/profile\.d\/tale-path\.sh$/m,
    );
  });

  test('the image PATH ends in the system directories the file leaves to /etc/profile', () => {
    // A directory added after /usr/local/bin would reach commands but not
    // login shells: the file only puts back what comes before it.
    expect(imagePath().system).toEqual(['/usr/local/bin', '/usr/bin', '/bin']);
  });

  test("an agent's login shell has the session directories, then the image's, then Debian's", () => {
    expect(loginPath(10001, DEBIAN_USER)).toEqual([
      ...sessionDirs(),
      ...imagePath().tools,
      ...DEBIAN_USER,
    ]);
  });

  test("root's login shell has the image's directories and none of the session's", () => {
    // The session's directories are the agent's to write; root helpers never
    // run with them (entrypoint.sh).
    expect(loginPath(0, DEBIAN_ROOT)).toEqual([
      ...imagePath().tools,
      ...DEBIAN_ROOT,
    ]);
  });

  test('the directories are the ones that hold node, the agent CLIs and the session installs', () => {
    expect(imagePath().tools).toEqual(['/opt/agents/bin', '/opt/node/bin']);
    expect(sessionDirs()).toEqual([
      '/agent/.runtime/deps/python/bin',
      '/agent/.runtime/deps/node/bin',
    ]);
  });
});
