// The runtime image's entrypoint dispatches on ONE positional arg: `daemon`
// (a session) or `egress-sidecar` (the K8s redsocks sidecar). The former
// per-call language lane (`python <packages.json> <options.json> <entry>`)
// has no producer any more; the tail of the script must fail CLOSED on any
// other argv instead of falling through to an install/run of whatever
// arrived. Runs the real script under sh — nothing before the dispatch has a
// side effect, so this is hermetic on any host.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ENTRYPOINT = resolve(import.meta.dir, '../../entrypoint.sh');

function run(args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync('sh', [ENTRYPOINT, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('entrypoint dispatch', () => {
  test('the retired language lane exits 65 and installs nothing', () => {
    const r = run([
      'python',
      '/agent/code/packages.json',
      '/agent/code/options.json',
      'main.py',
    ]);
    expect(r.status).toBe(65);
    expect(r.stderr).toContain('unknown dispatch arg: python');
    expect(r.stdout).not.toContain('PHASE:');
    expect(r.stdout).toBe('');
  });

  test('every non-dispatch argv fails closed, including none at all', () => {
    for (const args of [
      [],
      ['node'],
      ['bash', 'x'],
      ['polyglot', 'a', 'b', 'c'],
    ]) {
      const r = run(args);
      expect(r.status).toBe(65);
      expect(r.stderr).toContain('unknown dispatch arg:');
      expect(r.stderr).toContain("expected 'daemon' or 'egress-sidecar'");
    }
    expect(run([]).stderr).toContain('unknown dispatch arg: <none>');
  });
});

describe('session environment', () => {
  test('every session execs runnerd with a persistent, writable Node compile cache', () => {
    const root = mkdtempSync(join(tmpdir(), 'tale-entrypoint-env-'));
    try {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      // tini is the last thing the plain dispatch execs; report what runnerd
      // would inherit instead of starting it.
      writeFileSync(
        join(bin, 'tini'),
        '#!/bin/sh\nprintf "CACHE=%s\\n" "$NODE_COMPILE_CACHE"\n[ -d "$NODE_COMPILE_CACHE" ] && [ -w "$NODE_COMPILE_CACHE" ] && printf "WRITABLE\\n"\ncase "$NODE_COMPILE_CACHE" in "$TMPDIR"/*) printf "UNDER_TMPDIR\\n" ;; esac\n',
        { mode: 0o755 },
      );
      const script = join(root, 'entrypoint.sh');
      writeFileSync(
        script,
        readFileSync(ENTRYPOINT, 'utf8').replaceAll(
          '/agent/',
          `${root}/agent/`,
        ),
      );
      const r = spawnSync('sh', [script, 'daemon'], {
        encoding: 'utf8',
        env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}` },
      });
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(
        `CACHE=${root}/agent/.runtime/home/.cache/node-compile-cache\nWRITABLE\n`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the root Docker supervisor never loads the agent-writable compile cache', () => {
    const source = readFileSync(ENTRYPOINT, 'utf8');
    const exec = source.slice(
      source.indexOf('exec /usr/bin/env -u NODE_OPTIONS'),
      source.indexOf('lazy-docker.mjs'),
    );
    expect(exec).toContain('-u NODE_COMPILE_CACHE');
    expect(source).toContain(
      'export TALE_RUNNER_NODE_COMPILE_CACHE="$NODE_COMPILE_CACHE"',
    );
  });
});

// A bigger /dev/shm for the Incus backend, whose project admits no tmpfs disk
// device: the spawner names the size, the entrypoint mounts it while root.
describe('the session /dev/shm', () => {
  interface Outcome {
    status: number | null;
    stdout: string;
    stderr: string;
    mounts: string;
  }

  /** The real daemon dispatch, with `mount`, `id`, `setpriv` and `tini` replaced. */
  function runDaemon(
    env: Record<string, string>,
    uid = 0,
    mountStatus = 0,
  ): Outcome {
    const root = mkdtempSync(join(tmpdir(), 'tale-entrypoint-shm-'));
    try {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      const stub = (name: string, body: string) =>
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
      stub('mount', `echo "$*" >> "${root}/mounts"\nexit ${mountStatus}`);
      stub('id', `echo ${uid}`);
      // The drop to the session user: skip its options, run what follows.
      stub(
        'setpriv',
        'while [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"',
      );
      stub('tini', 'echo "tini $*"');
      const script = join(root, 'entrypoint.sh');
      writeFileSync(
        script,
        readFileSync(ENTRYPOINT, 'utf8')
          .replaceAll('/agent/', `${root}/agent/`)
          .replace('_MOUNT=/usr/bin/mount', `_MOUNT=${bin}/mount`),
      );
      const r = spawnSync('sh', [script, 'daemon'], {
        encoding: 'utf8',
        env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, ...env },
      });
      let mounts = '';
      try {
        mounts = readFileSync(join(root, 'mounts'), 'utf8');
      } catch (error) {
        // No mount was made, which is what several cases below expect.
        mounts = error instanceof Error && 'code' in error ? '' : String(error);
      }
      return { status: r.status, stdout: r.stdout, stderr: r.stderr, mounts };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test('without a size it mounts nothing and starts runnerd as before', () => {
    const r = runDaemon({});
    expect(r.status).toBe(0);
    expect(r.mounts).toBe('');
    expect(r.stdout).toBe('tini -g -- node /usr/local/lib/tale/runnerd.mjs\n');
  });

  test('with a size, as root, it mounts a tmpfs of it and drops to the session user', () => {
    const r = runDaemon({
      TALE_SHM_SIZE: '512m',
      TALE_DROP_UID: '10001',
      TALE_DROP_GID: '10001',
    });
    expect(r.status).toBe(0);
    expect(r.mounts).toBe(
      '-t tmpfs -o size=512m,mode=1777,nosuid,nodev,noexec tmpfs /dev/shm\n',
    );
    expect(r.stdout).toContain('[entrypoint] /dev/shm is a tmpfs of 512m');
    expect(r.stdout).toContain(
      'tini -g -- setpriv --reuid 10001 --regid 10001 --init-groups -- node /usr/local/lib/tale/runnerd.mjs',
    );
  });

  test("the drop follows the profile's user, not a default", () => {
    const r = runDaemon({
      TALE_SHM_SIZE: '64m',
      TALE_DROP_UID: '65534',
      TALE_DROP_GID: '65534',
    });
    expect(r.stdout).toContain('setpriv --reuid 65534 --regid 65534');
  });

  test('a size that is not one is refused with a warning, whatever it holds', () => {
    for (const bad of [
      'abc',
      '0m',
      '512mm',
      '12;reboot',
      '5 12m',
      '-1m',
      '1.5g',
    ]) {
      const r = runDaemon({ TALE_SHM_SIZE: bad, TALE_DROP_UID: '10001' });
      expect({ bad, mounts: r.mounts }).toEqual({ bad, mounts: '' });
      expect(r.stderr).toContain('is not a size');
      expect(r.status).toBe(0);
    }
  });

  test('without root it warns and leaves /dev/shm alone', () => {
    const r = runDaemon(
      { TALE_SHM_SIZE: '512m', TALE_DROP_UID: '10001' },
      1000,
    );
    expect(r.mounts).toBe('');
    expect(r.stderr).toContain('is not root');
  });

  test('a mount that fails is a warning, not the end of the session', () => {
    const r = runDaemon(
      { TALE_SHM_SIZE: '512m', TALE_DROP_UID: '10001' },
      0,
      1,
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('could not mount a 512m tmpfs on /dev/shm');
    expect(r.stdout).toContain('tini -g -- setpriv');
  });
});

// The container ends with runnerd: Incus's lxc-init keeps a container up while
// any process of it lives, so under TALE_END_WITH_RUNNERD=1 the entrypoint runs
// the dispatch as a child and ends every other process itself afterwards. The
// kill is replaced by a marker in the copy under test: signalling "every
// process" would reach the test runner too.
describe('ending the container with runnerd', () => {
  const KILL = 'kill -s KILL -- -1';

  interface Outcome {
    status: number | null;
    stdout: string;
    stderr: string;
  }

  function runDaemon(env: Record<string, string>, tiniStatus = 0): Outcome {
    const root = mkdtempSync(join(tmpdir(), 'tale-entrypoint-end-'));
    try {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      // tini is what the dispatch finally execs: report what runnerd would
      // inherit and how it ended.
      writeFileSync(
        join(bin, 'tini'),
        `#!/bin/sh\necho "tini ran; TALE_END_WITH_RUNNERD=[$TALE_END_WITH_RUNNERD]"\nexit ${tiniStatus}\n`,
        { mode: 0o755 },
      );
      const source = readFileSync(ENTRYPOINT, 'utf8');
      expect(source).toContain(KILL);
      const script = join(root, 'entrypoint.sh');
      writeFileSync(
        script,
        source
          .replaceAll('/agent/', `${root}/agent/`)
          .replace(KILL, 'echo "everything else is ended"'),
      );
      const r = spawnSync('sh', [script, 'daemon'], {
        encoding: 'utf8',
        env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, ...env },
      });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test('without the variable the dispatch execs as before and ends nothing itself', () => {
    const r = runDaemon({});
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('tini ran; TALE_END_WITH_RUNNERD=[]\n');
  });

  test("with it, everything else is ended once runnerd's supervisor has, and its status is kept", () => {
    const r = runDaemon({ TALE_END_WITH_RUNNERD: '1' }, 7);
    expect(r.status).toBe(7);
    // tini ran first, without the variable; the end of everything came after.
    expect(r.stdout).toBe(
      'tini ran; TALE_END_WITH_RUNNERD=[]\neverything else is ended\n',
    );
  });

  test('a clean end is a clean end too', () => {
    const r = runDaemon({ TALE_END_WITH_RUNNERD: '1' }, 0);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('everything else is ended');
  });

  test('only 1 turns it on', () => {
    for (const value of ['0', 'true', '']) {
      const r = runDaemon({ TALE_END_WITH_RUNNERD: value });
      expect({ value, ended: r.stdout.includes('everything else') }).toEqual({
        value,
        ended: false,
      });
    }
  });

  test('no other dispatch argument starts it', () => {
    const r = spawnSync('sh', [ENTRYPOINT, 'python'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        TALE_END_WITH_RUNNERD: '1',
      },
    });
    expect(r.status).toBe(65);
  });
});
