import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

import { EnvStore } from './env-store.ts';
import { ExecManager } from './exec-manager.ts';
import { pendingProcReads } from './process-reaper.ts';
import type { RunnerdExecEvent } from './protocol.ts';

const ROOT = realpathSync(mkdtempSync(`${tmpdir()}/rotation-test-`));
const shim = `${ROOT}/tale-exec-shim`;
const previousRoot = process.env.TALE_WORKSPACE_ROOT;
const request = {
  cwd: ROOT,
  timeoutMs: 30_000,
  stdoutMaxBytes: 100_000,
  stderrMaxBytes: 100_000,
};

beforeAll(() => {
  process.env.TALE_WORKSPACE_ROOT = ROOT;
});

function realShim(): string {
  if (existsSync(shim)) return shim;
  const built = spawnSync('cc', [
    '-Wall',
    '-Wextra',
    '-Werror',
    '-O2',
    '-o',
    shim,
    new URL('../exec-shim/tale-exec-shim.c', import.meta.url).pathname,
  ]);
  if (built.status !== 0)
    throw new Error(`shim build failed: ${String(built.stderr)}`);
  return shim;
}

afterAll(() => {
  if (previousRoot === undefined) delete process.env.TALE_WORKSPACE_ROOT;
  else process.env.TALE_WORKSPACE_ROOT = previousRoot;
  rmSync(ROOT, { recursive: true, force: true });
});

function running(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
  } catch {
    return false;
  }
}

async function until(predicate: () => boolean, timeout = 8_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition did not settle');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function output(): {
  emit: (event: RunnerdExecEvent) => void;
  pid: () => number;
} {
  let text = '';
  return {
    emit: (event) => {
      if (event.t === 'stdout')
        text += Buffer.from(event.b64, 'base64').toString();
    },
    pid: () => Number(text.trim()),
  };
}

for (const execShim of [null, shim]) {
  test.skipIf(process.platform !== 'linux')(
    `rotation kills an untagged TERM-proof group survivor after its leader exits (${execShim === null ? 'no shim' : 'real shim'})`,
    async () => {
      using mgr = new ExecManager(
        new EnvStore(),
        () => {},
        undefined,
        {},
        { execShim: execShim === null ? null : realShim() },
      );
      const seen = output();
      let pid = 0;
      const done = mgr.run(
        {
          ...request,
          execId: 'survivor',
          shell:
            'env -i /bin/sh -c \'trap "" TERM; echo $$; exec sleep 30\' & wait',
        },
        seen.emit,
      );
      try {
        await until(() => seen.pid() > 1);
        pid = seen.pid();
        expect(mgr.cancel('survivor', { keepLeftovers: true })).toBe(true);
        await done;
        expect(running(pid)).toBe(true);
        await until(() => !running(pid));
        expect(running(pid)).toBe(false);
      } finally {
        if (pid > 1 && running(pid)) process.kill(pid, 'SIGKILL');
        await mgr.terminateAll();
        await done;
      }
    },
    15_000,
  );
}

test.skipIf(process.platform !== 'linux')(
  'real-shim chained rotations keep a scrubbed detached server until the final successor ends',
  async () => {
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      {},
      { execShim: realShim() },
    );
    const seen = output();
    let pid = 0;
    const first = mgr.run(
      {
        ...request,
        execId: 'chain-first',
        shell: "setsid env -i /bin/sh -c 'echo $$; exec sleep 30' & wait",
      },
      seen.emit,
    );
    try {
      await until(() => seen.pid() > 1);
      pid = seen.pid();
      expect(mgr.cancel('chain-first', { keepLeftovers: true })).toBe(true);
      await first;
      const second = mgr.run(
        { ...request, execId: 'chain-second', shell: 'sleep 30' },
        () => {},
      );
      expect(mgr.cancel('chain-second', { keepLeftovers: true })).toBe(true);
      await second;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(running(pid)).toBe(true);
      expect(mgr.leftoverCount()).toBe(2);
      await mgr.run(
        { ...request, execId: 'chain-final', command: ['true'] },
        () => {},
      );
      await until(() => !running(pid));
      expect(running(pid)).toBe(false);
    } finally {
      if (pid > 1 && running(pid)) process.kill(pid, 'SIGKILL');
      await mgr.terminateAll();
      await first;
    }
  },
  15_000,
);

test.skipIf(process.platform !== 'linux')(
  'the manager skips the delayed process scan after a real shim completes normally',
  async () => {
    let listings = 0;
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      {
        listDir: async () => {
          listings += 1;
          return [];
        },
      },
      { execShim: realShim() },
    );
    await mgr.run(
      { ...request, execId: 'normal-shim', command: ['true'] },
      () => {},
    );
    await new Promise((resolve) => setTimeout(resolve, 5_300));
    expect(listings).toBeLessThanOrEqual(1);
    expect(pendingProcReads()).toBe(0);
  },
  10_000,
);
