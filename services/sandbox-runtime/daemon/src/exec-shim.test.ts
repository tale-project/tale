// Execs under the subreaper shim (exec-shim/tale-exec-shim.c), built from its
// source for this run. Everything an exec starts stays the shim's
// descendant, so a process that leaves the exec's group, moves to a session
// of its own and drops the exec's tag is still ended with the exec. Linux
// only, and only where a C compiler is at hand; a compiler that fails to
// build the shim fails the run. What runnerd makes of the shim's status
// pipe is checked everywhere, against stand-in shims.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { EnvStore } from './env-store.ts';
import { ExecManager } from './exec-manager.ts';
import type { RunnerdExecEvent, RunnerdExecRequest } from './protocol.ts';

const SOURCE = fileURLToPath(
  new URL('../exec-shim/tale-exec-shim.c', import.meta.url),
);

/** The shim built for this run, or null where it cannot run: not Linux, or
 * no C compiler. */
function buildShim(): string | null {
  if (process.platform !== 'linux') return null;
  const dir = mkdtempSync(`${tmpdir()}/exec-shim-`);
  const out = `${dir}/tale-exec-shim`;
  const built = spawnSync('cc', [
    '-O2',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-o',
    out,
    SOURCE,
  ]);
  if (built.error !== undefined) {
    if ('code' in built.error && built.error.code === 'ENOENT') {
      rmSync(dir, { recursive: true, force: true });
      return null;
    }
    throw built.error;
  }
  if (built.status !== 0) {
    throw new Error(`building the exec shim failed:\n${String(built.stderr)}`);
  }
  return out;
}

const SHIM = buildShim();
const ROOT = realpathSync(mkdtempSync(`${tmpdir()}/runnerd-shim-test-`));

beforeAll(() => {
  process.env.TALE_WORKSPACE_ROOT = ROOT;
});
afterAll(() => {
  delete process.env.TALE_WORKSPACE_ROOT;
  rmSync(ROOT, { recursive: true, force: true });
  if (SHIM !== null) {
    rmSync(SHIM.slice(0, SHIM.lastIndexOf('/')), {
      recursive: true,
      force: true,
    });
  }
});

const base: Omit<RunnerdExecRequest, 'execId' | 'command' | 'shell' | 'cwd'> = {
  timeoutMs: 10_000,
  stdoutMaxBytes: 1_000_000,
  stderrMaxBytes: 1_000_000,
};

/** A process that escapes everything but the subreaper: double-forked, in
 * a session and group of its own, its environment (and the exec's tag)
 * wiped. Prints its pid once it runs. `seconds` keeps it apart from every
 * other test's sleeps. */
function escapee(seconds: number): string {
  return `(setsid env -i /bin/sleep ${seconds} >/dev/null 2>&1 </dev/null &); for _ in $(seq 100); do pid=$(pgrep -n -f "^/bin/sleep ${seconds}$") && break; sleep 0.02; done; echo "$pid"`;
}

function collect(): {
  events: RunnerdExecEvent[];
  emit: (e: RunnerdExecEvent) => void;
} {
  const events: RunnerdExecEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

function decode(
  events: RunnerdExecEvent[],
  stream: 'stdout' | 'stderr',
): string {
  return events
    .filter(
      (e): e is Extract<RunnerdExecEvent, { t: 'stdout' | 'stderr' }> =>
        e.t === stream,
    )
    .map((e) => Buffer.from(e.b64, 'base64').toString('utf8'))
    .join('');
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err instanceof Error && 'code' in err && err.code === 'EPERM';
  }
}

async function waitGone(pid: number, ms = 3_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (isAlive(pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** The pid an exec printed first, once it has. */
async function stdoutPid(events: RunnerdExecEvent[]): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    const pid = Number(decode(events, 'stdout').trim().split('\n')[0]);
    if (pid > 1) return pid;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('the exec never printed its pid');
}

function finalKill(pid: number): void {
  if (pid > 1 && isAlive(pid)) process.kill(pid, 'SIGKILL');
}

describe.skipIf(SHIM === null)('ExecManager under the subreaper shim', () => {
  const shimmed = (
    reaper: ConstructorParameters<typeof ExecManager>[3] = {},
  ): ExecManager =>
    new ExecManager(new EnvStore(), () => {}, undefined, reaper, {
      execShim: SHIM,
    });

  test('reports the command’s output and exit status', async () => {
    const mgr = shimmed();
    const { events, emit } = collect();
    await mgr.run(
      {
        ...base,
        execId: 'sh-out',
        shell: 'echo out; echo err >&2; exit 3',
        cwd: ROOT,
      },
      emit,
    );
    expect(decode(events, 'stdout')).toBe('out\n');
    expect(decode(events, 'stderr')).toBe('err\n');
    expect(events[events.length - 1]).toMatchObject({
      t: 'exit',
      exitCode: 3,
    });
  });

  test('a command ended by a signal exits with 128 + its number', async () => {
    const mgr = shimmed();
    const { events, emit } = collect();
    await mgr.run(
      {
        ...base,
        execId: 'sh-sig',
        command: ['/bin/sh', '-c', 'kill -KILL $$'],
        cwd: ROOT,
      },
      emit,
    );
    expect(events[events.length - 1]).toMatchObject({
      t: 'exit',
      exitCode: 137,
    });
  });

  test('a command that cannot be executed fails the exec', async () => {
    const mgr = shimmed();
    const { events, emit } = collect();
    await mgr.run(
      {
        ...base,
        execId: 'sh-enoent',
        command: ['/nonexistent/tale-cmd'],
        cwd: ROOT,
      },
      emit,
    );
    expect(events[events.length - 1]).toEqual({
      t: 'fail',
      code: 'BAD_REQUEST',
      message: 'spawn failed: spawn /nonexistent/tale-cmd ENOENT',
      seq: 2,
    });
    expect(mgr.liveCount()).toBe(0);
  });

  test('a process that left the group, its session and its tag ends with the exec', async () => {
    const mgr = shimmed();
    const { events, emit } = collect();
    let pid = 0;
    try {
      await mgr.run(
        { ...base, execId: 'sh-escape', shell: escapee(411), cwd: ROOT },
        emit,
      );
      pid = Number(decode(events, 'stdout').trim());
      expect(pid).toBeGreaterThan(1);
      await waitGone(pid);
      expect(isAlive(pid)).toBe(false);
    } finally {
      finalKill(pid);
    }
  });

  test('without the shim, the same process is out of reach', async () => {
    const mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      {},
      {
        execShim: null,
      },
    );
    const { events, emit } = collect();
    let pid = 0;
    try {
      await mgr.run(
        { ...base, execId: 'sh-direct', shell: escapee(412), cwd: ROOT },
        emit,
      );
      pid = Number(decode(events, 'stdout').trim());
      expect(pid).toBeGreaterThan(1);
      await new Promise((r) => setTimeout(r, 1_000));
      expect(isAlive(pid)).toBe(true);
    } finally {
      finalKill(pid);
    }
  });

  test('what an exec left waits under its shim while another exec runs, and ends with the last', async () => {
    const mgr = shimmed();
    const long = collect();
    const longDone = mgr.run(
      { ...base, execId: 'sh-long', shell: 'sleep 30', cwd: ROOT },
      long.emit,
    );
    const short = collect();
    let pid = 0;
    try {
      await mgr.run(
        { ...base, execId: 'sh-short', shell: escapee(413), cwd: ROOT },
        short.emit,
      );
      pid = Number(decode(short.events, 'stdout').trim());
      expect(pid).toBeGreaterThan(1);
      await new Promise((r) => setTimeout(r, 300));
      expect(isAlive(pid)).toBe(true);
      expect(mgr.leftoverCount()).toBe(1);
      expect(mgr.cancel('sh-long')).toBe(true);
      await longDone;
      await waitGone(pid);
      expect(isAlive(pid)).toBe(false);
    } finally {
      finalKill(pid);
    }
  });

  test('a cancel that comes before the shim named the group signals the group once it does', async () => {
    const sent: Array<[number, NodeJS.Signals]> = [];
    const mgr = shimmed({
      kill: (pid, signal) => {
        sent.push([pid, signal]);
        process.kill(pid, signal);
      },
    });
    const { events, emit } = collect();
    const done = mgr.run(
      { ...base, execId: 'sh-early', command: ['sleep', '30'], cwd: ROOT },
      emit,
    );
    // At once: the shim has not reported the command's pid yet.
    expect(mgr.cancel('sh-early')).toBe(true);
    expect(sent).toEqual([]);
    await done;
    expect(events[events.length - 1]).toMatchObject({
      t: 'exit',
      cancelled: true,
      exitCode: 143,
    });
    const terms = sent.filter(([, signal]) => signal === 'SIGTERM');
    expect(terms).toHaveLength(1);
    expect(terms[0]?.[0]).toBeLessThan(0);
  });

  test('a rotation’s cancel ends the command’s group and holds what it left for the exec after it', async () => {
    const mgr = shimmed();
    const { events, emit } = collect();
    let pid = 0;
    try {
      const done = mgr.run(
        {
          ...base,
          execId: 'sh-rot',
          shell: `${escapee(414)}; exec sleep 30`,
          cwd: ROOT,
        },
        emit,
      );
      pid = await stdoutPid(events);
      expect(mgr.cancel('sh-rot', { keepLeftovers: true })).toBe(true);
      await done;
      expect(events[events.length - 1]).toMatchObject({
        t: 'exit',
        cancelled: true,
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(isAlive(pid)).toBe(true);
      await mgr.run(
        { ...base, execId: 'sh-rot-next', command: ['true'], cwd: ROOT },
        () => {},
      );
      await waitGone(pid);
      expect(isAlive(pid)).toBe(false);
    } finally {
      finalKill(pid);
    }
  });

  test('what an exec left holding its pipes ends with it, and its exit is not held back', async () => {
    const mgr = shimmed();
    const { events, emit } = collect();
    await mgr.run(
      { ...base, execId: 'sh-pipe', shell: 'sleep 30 & echo $!', cwd: ROOT },
      emit,
    );
    const pid = Number(decode(events, 'stdout').trim());
    expect(pid).toBeGreaterThan(1);
    const last = events[events.length - 1];
    expect(last?.t).toBe('exit');
    if (last?.t === 'exit') expect(last.durationMs).toBeLessThan(1_500);
    await waitGone(pid);
    expect(isAlive(pid)).toBe(false);
  });
});

/** A stand-in shim: a script that says on the status pipe what `lines`
 * say, then exits with `code`. */
function standIn(name: string, lines: string[], code = 0): string {
  const path = `${ROOT}/${name}`;
  const says = lines.map((line) => `echo "${line}" >&3`).join('\n');
  writeFileSync(path, `#!/bin/sh\n${says}\nexit ${code}\n`, { mode: 0o755 });
  return path;
}

describe('the shim’s status pipe', () => {
  // Fake pids the stand-ins name: only recorded, never signalled.
  const recorder = () => {
    const sent: Array<[number, NodeJS.Signals]> = [];
    return {
      sent,
      kill: (pid: number, signal: NodeJS.Signals) =>
        void sent.push([pid, signal]),
    };
  };

  test('the command’s end as the pipe reports it wins over the shim’s own exit', async () => {
    const { kill } = recorder();
    const mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      { kill },
      {
        execShim: standIn('says-exit', ['pid 99981', 'exit 7'], 0),
      },
    );
    const { events, emit } = collect();
    await mgr.run(
      { ...base, execId: 'sp-exit', command: ['true'], cwd: ROOT },
      emit,
    );
    expect(events[events.length - 1]).toMatchObject({ t: 'exit', exitCode: 7 });
  });

  test('a command ended by a signal is reported as 128 + its number', async () => {
    const { kill } = recorder();
    const mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      { kill },
      {
        execShim: standIn('says-signal', ['pid 99982', 'signal 15'], 143),
      },
    );
    const { events, emit } = collect();
    await mgr.run(
      { ...base, execId: 'sp-signal', command: ['true'], cwd: ROOT },
      emit,
    );
    expect(events[events.length - 1]).toMatchObject({
      t: 'exit',
      exitCode: 143,
    });
  });

  test('a shim killed before it reported the command’s end leaves the exit to its own', async () => {
    const { kill } = recorder();
    const path = `${ROOT}/killed`;
    writeFileSync(path, '#!/bin/sh\necho "pid 99983" >&3\nkill -KILL $$\n', {
      mode: 0o755,
    });
    const mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      { kill },
      { execShim: path },
    );
    const { events, emit } = collect();
    await mgr.run(
      { ...base, execId: 'sp-killed', command: ['true'], cwd: ROOT },
      emit,
    );
    expect(events[events.length - 1]).toMatchObject({
      t: 'exit',
      exitCode: 137,
    });
  });

  test('a command that could not be executed fails the exec, whatever follows', async () => {
    const { kill } = recorder();
    const mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      { kill },
      {
        execShim: standIn(
          'says-enoent',
          ['pid 99984', 'spawn-error ENOENT', 'exit 127'],
          127,
        ),
      },
    );
    const { events, emit } = collect();
    await mgr.run(
      { ...base, execId: 'sp-enoent', command: ['tale-nope'], cwd: ROOT },
      emit,
    );
    expect(events.map((e) => e.t)).toEqual(['start', 'fail']);
    expect(events[1]).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'spawn failed: spawn tale-nope ENOENT',
    });
  });

  test('a refused subreaper is said once, and the exec still runs', async () => {
    const { kill } = recorder();
    const mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      { kill },
      {
        execShim: standIn(
          'says-refused',
          ['no-subreaper EINVAL', 'pid 99985', 'exit 0'],
          0,
        ),
      },
    );
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) =>
      void warnings.push(args.map(String).join(' '));
    try {
      for (const execId of ['sp-refused-1', 'sp-refused-2']) {
        const { events, emit } = collect();
        await mgr.run({ ...base, execId, command: ['true'], cwd: ROOT }, emit);
        expect(events[events.length - 1]).toMatchObject({
          t: 'exit',
          exitCode: 0,
        });
      }
    } finally {
      console.warn = warn;
    }
    expect(
      warnings.filter((w) => w.includes('cannot become a subreaper (EINVAL)')),
    ).toHaveLength(1);
  });
});
