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
  existsSync,
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
  test('runnerd starts without the compile cache, and gets its location for the execs: persistent and writable', () => {
    const root = mkdtempSync(join(tmpdir(), 'tale-entrypoint-env-'));
    try {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      // tini is the last thing the plain dispatch execs; report what runnerd
      // would inherit instead of starting it.
      writeFileSync(
        join(bin, 'tini'),
        '#!/bin/sh\nprintf "RUNNERD=%s\\n" "${NODE_COMPILE_CACHE-<none>}"\nC=$TALE_RUNNER_NODE_COMPILE_CACHE\nprintf "EXECS=%s\\n" "$C"\n[ -d "$C" ] && [ -w "$C" ] && printf "WRITABLE\\n"\ncase "$C" in "$TMPDIR"/*) printf "UNDER_TMPDIR\\n" ;; esac\n',
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
        env: {
          PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
          // Even one the container's environment names is not runnerd's.
          NODE_COMPILE_CACHE: `${root}/elsewhere`,
        },
      });
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(
        `RUNNERD=<none>\nEXECS=${root}/agent/.runtime/home/.cache/node-compile-cache\nWRITABLE\n`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('neither runnerd nor the root Docker supervisor loads the agent-writable compile cache', () => {
    const source = readFileSync(ENTRYPOINT, 'utf8');
    const exec = source.slice(
      source.indexOf('exec /usr/bin/env -u NODE_OPTIONS'),
      source.indexOf('lazy-docker.mjs'),
    );
    expect(exec).toContain('-u NODE_COMPILE_CACHE');
    expect(source).not.toMatch(/export NODE_COMPILE_CACHE\b/);
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
    expect(r.stdout).toBe(
      'tini -g -- node --disable-sigusr1 /usr/local/lib/tale/runnerd.mjs\n',
    );
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
      'tini -g -- setpriv --reuid 10001 --regid 10001 --init-groups -- node --disable-sigusr1 /usr/local/lib/tale/runnerd.mjs',
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

// runnerd's token never stays in an environment a session process can read:
// before anything else, the dispatch moves it onto fd 9, a pipe runnerd reads
// once, and runs the script again. So neither tini nor runnerd starts with it,
// nor does the shell that waits for runnerd under TALE_END_WITH_RUNNERD=1, and
// what the script leaves in the background does not keep the pipe.
describe("runnerd's token", () => {
  // Characters a shell would act on, so that any it acted on shows.
  const TOKEN = 'tok$HOME `id` "dq" \'sq\' \\x ;|&*';
  const KILL = 'kill -s KILL -- -1';

  interface Seen {
    status: number | null;
    stdout: string;
    stderr: string;
    /** The environment tini, and so runnerd, starts with. */
    environ: string[];
    /** The environment of tini's parent: under TALE_END_WITH_RUNNERD=1, the
     * shell that waits for runnerd. */
    parentEnviron: string[];
    /** What fd 9 is, and what two reads of it gave. */
    fd9: string;
    token: string;
    again: string;
    /** What the background purge job's sleep found of fd 9. */
    purgeFd9: string;
  }

  /** The real daemon dispatch with tini, sleep and, as root, id, mount and
   * setpriv replaced; the end of every other process is a marker. */
  async function boot(
    env: Record<string, string>,
    asRoot = false,
  ): Promise<Seen> {
    const root = mkdtempSync(join(tmpdir(), 'tale-entrypoint-token-'));
    try {
      const bin = join(root, 'bin');
      const out = join(root, 'out');
      mkdirSync(bin);
      mkdirSync(out);
      const stub = (name: string, body: string) =>
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
      if (asRoot) {
        stub('id', 'echo 0');
        stub('mount', 'exit 0');
        stub(
          'setpriv',
          'while [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"',
        );
      }
      // The purge job's head start, the only sleep on these paths.
      stub(
        'sleep',
        `if [ -e /proc/$$/fd/9 ]; then echo open; else echo closed; fi > "${out}/purge-fd9"`,
      );
      stub(
        'tini',
        [
          `cat /proc/$$/environ > "${out}/environ"`,
          `cat /proc/$PPID/environ > "${out}/parent-environ"`,
          'if [ -e /proc/$$/fd/9 ]; then',
          `  readlink /proc/$$/fd/9 > "${out}/fd9"`,
          `  cat <&9 > "${out}/token"`,
          `  cat <&9 > "${out}/again"`,
          'fi',
          'echo "tini $*"',
        ].join('\n'),
      );
      const source = readFileSync(ENTRYPOINT, 'utf8');
      expect(source).toContain(KILL);
      const script = join(root, 'entrypoint.sh');
      writeFileSync(
        script,
        source
          .replaceAll('/agent/', `${root}/agent/`)
          .replace('_MOUNT=/usr/bin/mount', `_MOUNT=${bin}/mount`)
          .replace(KILL, 'echo "everything else is ended"'),
      );
      // Started with no fd 9 of the test runner's, whatever it holds.
      const r = spawnSync(
        'sh',
        ['-c', 'exec sh "$@" 9<&-', 'sh', script, 'daemon'],
        {
          encoding: 'utf8',
          env: {
            PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
            ...env,
          },
        },
      );
      // The purge job runs on in the background; wait for its answer.
      for (let i = 0; i < 250 && !existsSync(join(out, 'purge-fd9')); i++)
        await new Promise((done) => setTimeout(done, 20));
      const read = (name: string): string => {
        try {
          return readFileSync(join(out, name), 'utf8');
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            return '<none>';
          throw error;
        }
      };
      return {
        status: r.status,
        stdout: r.stdout,
        stderr: r.stderr,
        environ: read('environ').split('\0'),
        parentEnviron: read('parent-environ').split('\0'),
        fd9: read('fd9'),
        token: read('token'),
        again: read('again'),
        purgeFd9: read('purge-fd9'),
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  /** The entries of `environ` that hold the token or name it. */
  const holding = (environ: string[]) =>
    environ.filter(
      (entry) =>
        entry.includes(TOKEN) || entry.startsWith('TALE_RUNNERD_TOKEN='),
    );

  test('runnerd starts with the token on fd 9, read once, and nowhere in its environment', async () => {
    const seen = await boot({ TALE_RUNNERD_TOKEN: TOKEN });
    expect(seen.stderr).toBe('');
    expect(seen.status).toBe(0);
    expect(seen.stdout).toBe(
      'tini -g -- node --disable-sigusr1 /usr/local/lib/tale/runnerd.mjs\n',
    );
    expect(holding(seen.environ)).toEqual([]);
    expect(seen.environ).toContain('TALE_RUNNERD_TOKEN_FD=9');
    expect(seen.fd9).toStartWith('pipe:');
    expect(seen.token).toBe(`${TOKEN}\n`);
    // Nothing writes to the pipe any more: a second read finds it empty.
    expect(seen.again).toBe('');
    expect(seen.purgeFd9).toBe('closed\n');
  });

  test('so it does where root drops to the session user for runnerd', async () => {
    const seen = await boot(
      {
        TALE_RUNNERD_TOKEN: TOKEN,
        TALE_SHM_SIZE: '64m',
        TALE_DROP_UID: '10001',
        TALE_DROP_GID: '10001',
      },
      true,
    );
    expect(seen.status).toBe(0);
    expect(seen.stdout).toContain(
      'tini -g -- setpriv --reuid 10001 --regid 10001 --init-groups -- node --disable-sigusr1 /usr/local/lib/tale/runnerd.mjs',
    );
    expect(holding(seen.environ)).toEqual([]);
    expect(seen.environ).toContain('TALE_RUNNERD_TOKEN_FD=9');
    expect(seen.token).toBe(`${TOKEN}\n`);
    expect(seen.purgeFd9).toBe('closed\n');
  });

  test('the shell that waits for runnerd under TALE_END_WITH_RUNNERD=1 never held it either', async () => {
    const seen = await boot({
      TALE_RUNNERD_TOKEN: TOKEN,
      TALE_END_WITH_RUNNERD: '1',
    });
    expect(seen.status).toBe(0);
    expect(seen.stdout).toBe(
      'tini -g -- node --disable-sigusr1 /usr/local/lib/tale/runnerd.mjs\neverything else is ended\n',
    );
    expect(seen.parentEnviron).toContain('TALE_END_WITH_RUNNERD=1');
    expect(holding(seen.parentEnviron)).toEqual([]);
    expect(holding(seen.environ)).toEqual([]);
    expect(seen.token).toBe(`${TOKEN}\n`);
  });

  test('without a token there is no descriptor, and runnerd starts unsigned as before', async () => {
    const envs: Array<Record<string, string>> = [
      {},
      { TALE_RUNNERD_TOKEN: '' },
    ];
    for (const env of envs) {
      const seen = await boot(env);
      expect(seen.status).toBe(0);
      expect(
        seen.environ.filter((entry) =>
          entry.startsWith('TALE_RUNNERD_TOKEN_FD='),
        ),
      ).toEqual([]);
      expect(seen.fd9).toBe('<none>');
    }
  });

  test('the redsocks supervisor, left running in the background, does not keep the pipe', () => {
    const source = readFileSync(ENTRYPOINT, 'utf8');
    const launch = source
      .split('\n')
      .find((line) => line.includes('redsocks-supervisor "${_REDSOCKS}"'));
    expect(launch).toEndWith(' 9<&- &');
  });
});
