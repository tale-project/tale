// The standby script is run for real, in a temporary directory, against a stub
// entrypoint: it must sit idle until a COMPLETE claim arrives, then become the
// entrypoint with the claim's variables, the claim removed and the workspace
// as its working directory.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  claimFile,
  STANDBY_CLAIM_END,
  STANDBY_COMMAND,
  standbyScript,
} from './incus-standby.ts';

// `read -t` with a fraction needs bash 4; the runtime image has 5, a Mac's
// /bin/bash has 3.2.
const bash = Bun.which('bash');
const modernBash =
  bash !== null &&
  Number(
    spawnSync(bash, ['-c', 'echo "${BASH_VERSINFO[0]}"'], {
      encoding: 'utf8',
    }).stdout.trim(),
  ) >= 4;

let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'incus-standby-test-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function fixture(name: string) {
  const dir = join(root, name);
  const run = join(dir, 'run');
  const agent = join(dir, 'agent');
  const bin = join(dir, 'bin');
  mkdirSync(agent, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const entrypoint = join(dir, 'entrypoint.sh');
  const report = join(dir, 'report.txt');
  writeFileSync(
    entrypoint,
    `#!/bin/sh
{
  echo "args=$*"
  echo "token=\${TALE_RUNNERD_TOKEN:-}"
  echo "incarnation=\${TALE_RUNNERD_INCARNATION:-}"
  echo "uid-var=\${TALE_STANDBY_UID:-unset}"
  echo "cwd=$(pwd -P)"
  if [ -e '${run}' ]; then echo "dir=present"; else echo "dir=gone"; fi
} > '${report}'
`,
  );
  chmodSync(entrypoint, 0o755);
  // A setpriv that only reports what it was asked, then runs the command.
  writeFileSync(
    join(bin, 'setpriv'),
    `#!/bin/sh
echo "setpriv $*" >> '${join(dir, 'setpriv.txt')}'
while [ "$1" != "--" ]; do shift; done
shift
exec "$@"
`,
  );
  chmodSync(join(bin, 'setpriv'), 0o755);
  const script = join(dir, 'standby.sh');
  writeFileSync(
    script,
    standbyScript({ dir: run, entrypoint, workdir: agent }),
  );
  return { dir, run, agent, bin, entrypoint, report, script };
}

async function until(check: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await Bun.sleep(20);
  }
}

function start(f: ReturnType<typeof fixture>) {
  return Bun.spawn([bash ?? 'bash', f.script], {
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH ?? ''}` },
    stdout: 'ignore',
    stderr: 'pipe',
  });
}

// Skipped where there is no bash 4+ to run the script (a Mac with only its
// /bin/bash 3.2); where the suite is expected to run it, that is a failure, so
// a missing bash cannot turn the three runs below into a green that ran nothing.
test('a bash that can run the script is there wherever CI runs this suite', () => {
  if (process.env.CI !== undefined && process.env.CI !== '') {
    expect(modernBash).toBe(true);
  }
});

describe('the standby script', () => {
  test.skipIf(!modernBash)(
    'waits for a complete claim, then becomes the entrypoint',
    async () => {
      const f = fixture('claim');
      const child = start(f);
      await until(() => existsSync(join(f.run, 'ready')));
      await Bun.sleep(200);
      expect(existsSync(f.report)).toBe(false);

      // A claim that is still being written does not start the session.
      writeFileSync(
        join(f.run, 'claim.env'),
        "export TALE_RUNNERD_TOKEN='abc123'\n",
      );
      await Bun.sleep(300);
      expect(existsSync(f.report)).toBe(false);

      writeFileSync(
        join(f.run, 'claim.env'),
        claimFile({
          TALE_RUNNERD_TOKEN: 'abc123',
          TALE_RUNNERD_INCARNATION: '1700000000000',
        }),
      );
      expect(await child.exited).toBe(0);
      const report = readFileSync(f.report, 'utf8');
      expect(report).toContain('args=daemon');
      expect(report).toContain('token=abc123');
      expect(report).toContain('incarnation=1700000000000');
      expect(report).toContain('uid-var=unset');
      // The workspace is the working directory, and the claim (a token) is
      // gone from the filesystem.
      expect(report).toContain(`cwd=${realpathSync(f.agent)}`);
      expect(report).toContain('dir=gone');
      expect(existsSync(join(f.dir, 'setpriv.txt'))).toBe(false);
    },
    15_000,
  );

  test.skipIf(!modernBash)(
    'drops to the session user itself when the entrypoint would not',
    async () => {
      const f = fixture('drop');
      const child = start(f);
      await until(() => existsSync(join(f.run, 'ready')));
      writeFileSync(
        join(f.run, 'claim.env'),
        claimFile({
          TALE_RUNNERD_TOKEN: 'def456',
          TALE_STANDBY_UID: '10001',
          TALE_STANDBY_GID: '10002',
        }),
      );
      expect(await child.exited).toBe(0);
      expect(readFileSync(join(f.dir, 'setpriv.txt'), 'utf8').trim()).toBe(
        `setpriv --reuid 10001 --regid 10002 --init-groups -- ${f.entrypoint} daemon`,
      );
      // The variables that steered the drop do not reach the session.
      expect(readFileSync(f.report, 'utf8')).toContain('uid-var=unset');
    },
    15_000,
  );

  test.skipIf(!modernBash)(
    'refuses to start a session without its workspace',
    async () => {
      const f = fixture('no-workspace');
      rmSync(f.agent, { recursive: true });
      const child = start(f);
      await until(() => existsSync(join(f.run, 'ready')));
      writeFileSync(
        join(f.run, 'claim.env'),
        claimFile({ TALE_RUNNERD_TOKEN: 'aa' }),
      );
      expect(await child.exited).toBe(71);
      expect(existsSync(f.report)).toBe(false);
    },
    15_000,
  );

  test('the production script waits in the places the spawner pushes to', () => {
    const script = standbyScript();
    expect(script.startsWith('#!/bin/bash\n')).toBe(true);
    expect(script).toContain("dir='/run/tale-standby'");
    expect(script).toContain("'/docker-entrypoint.sh' daemon");
    expect(script).toContain(`'^${STANDBY_CLAIM_END}$'`);
    expect(STANDBY_COMMAND).toBe('/bin/bash /usr/local/lib/tale/standby.sh');
  });
});

describe('claimFile', () => {
  test('writes plain assignments and ends with the sentinel', () => {
    expect(
      claimFile({ TALE_RUNNERD_TOKEN: 'abc', TALE_STANDBY_UID: '1' }),
    ).toBe(
      `export TALE_RUNNERD_TOKEN='abc'\nexport TALE_STANDBY_UID='1'\n${STANDBY_CLAIM_END}\n`,
    );
  });

  test.each([
    ["x'; touch /tmp/pwned; '", 'a quote'],
    ['a b', 'a space'],
    ['a\nb', 'a newline'],
    ['$(id)', 'a substitution'],
    ['`id`', 'a backtick'],
    ['a;b', 'a semicolon'],
  ])('refuses the value %j (%s)', (value) => {
    expect(() => claimFile({ TALE_RUNNERD_TOKEN: value })).toThrow('not plain');
  });

  test.each(['lower', '1START', 'A B', 'A-B', ''])(
    'refuses the variable name %j',
    (name) => {
      expect(() => claimFile({ [name]: 'x' })).toThrow('name rejected');
    },
  );
});
