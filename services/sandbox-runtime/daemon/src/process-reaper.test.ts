// The reaper finds an exec's processes by the tag in their environment and
// signals each of them once: the exec's process group as a whole, and on
// their own only the tagged processes that left it. A fake process table
// stands in for /proc, so this runs on any host.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

import {
  EXEC_TAG_ENV,
  groupMembers,
  pendingProcReads,
  processesLeft,
  signalExecProcesses,
  taggedPids,
} from './process-reaper.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface FakeProcess {
  /** Environment entries; `null`: no environ file (gone, or not ours). */
  env: string[] | null;
  /** Process group; defaults to the process's own pid. */
  pgrp?: number;
  /** Command name as `stat` shows it, parentheses and spaces included. */
  comm?: string;
  /** Start time in clock ticks since boot; defaults to 1000 + pid. */
  startTime?: number;
}

/** A process table: pid → its environment and process group. */
function procTable(processes: Record<string, FakeProcess>): string {
  const root = mkdtempSync(`${tmpdir()}/reaper-proc-`);
  roots.push(root);
  for (const [pid, proc] of Object.entries(processes)) {
    mkdirSync(`${root}/${pid}`);
    if (proc.env !== null) {
      writeFileSync(`${root}/${pid}/environ`, `${proc.env.join('\0')}\0`);
    }
    writeStat(root, pid, proc);
  }
  return root;
}

/** A `stat` line as Linux writes it: the group is field 5, the start time
 * field 22. */
function writeStat(root: string, pid: string, proc: FakeProcess): void {
  const pgrp = proc.pgrp ?? pid;
  const comm = proc.comm ?? 'sleep';
  const startTime = proc.startTime ?? 1000 + Number(pid);
  writeFileSync(
    `${root}/${pid}/stat`,
    `${pid} (${comm}) S 1 ${pgrp} ${pgrp} 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 1 0 ${startTime} 1000 100\n`,
  );
}

/** A process whose environment read does not come back — a FIFO no one
 * writes stands in for a process stuck holding its memory lock. */
function stallEnviron(root: string, pid: string, pgrp: number): string {
  mkdirSync(`${root}/${pid}`);
  writeStat(root, pid, { env: null, pgrp });
  const fifo = `${root}/${pid}/environ`;
  const made = spawnSync('mkfifo', [fifo]);
  if (made.status !== 0)
    throw new Error(`mkfifo failed: ${String(made.stderr)}`);
  return fifo;
}

/** Let every read waiting on the FIFO come back (with `data`), and wait
 * until they have. */
async function release(fifo: string, data = ''): Promise<void> {
  const until = Date.now() + 5_000;
  while (pendingProcReads() > 0 && Date.now() < until) {
    try {
      const fd = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
      if (data !== '') writeSync(fd, data);
      closeSync(fd);
    } catch (err) {
      // ENXIO: no reader has the FIFO open yet; ENOENT: it was replaced.
      if (!(err instanceof Error && 'code' in err)) throw err;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

const tagged = (execId: string, pgrp?: number, comm?: string): FakeProcess => ({
  env: ['PATH=/bin', `${EXEC_TAG_ENV}=${execId}`],
  pgrp,
  comm,
});

function recorder() {
  const sent: Array<[number, string]> = [];
  return {
    sent,
    kill: (pid: number, signal: NodeJS.Signals) => {
      sent.push([pid, signal]);
    },
  };
}

describe('taggedPids', () => {
  test('finds exactly the processes carrying the exec tag', async () => {
    const procRoot = procTable({
      '1': tagged('e1'),
      '20': tagged('e1'),
      '21': tagged('e10'),
      '22': { env: [`X_${EXEC_TAG_ENV}=e1`] },
      '23': { env: ['PATH=/bin'] },
      '24': { env: null },
      '25': tagged('e1', 25, 'odd) (name'),
      '30': tagged('e1'),
      self: tagged('e1'),
    });
    expect(await taggedPids('e1', { procRoot, selfPid: 30 })).toEqual([20, 25]);
  });

  test('a host without a process table yields nothing', async () => {
    expect(
      await taggedPids('e1', { procRoot: '/nonexistent-proc-root' }),
    ).toEqual([]);
  });
});

describe('groupMembers', () => {
  test('records the group’s processes from their stat alone', async () => {
    const procRoot = procTable({
      '40': tagged('e1', 39),
      '41': { env: ['PATH=/bin'], pgrp: 39, startTime: 7 },
      '50': tagged('e1', 50),
    });
    // Its environment read would never come back; the record reads none.
    const fifo = stallEnviron(procRoot, '42', 39);
    try {
      const members = await groupMembers(39, {
        procRoot,
        scanDeadlineMs: 2_000,
      });
      expect(members.sort((a, b) => a.pid - b.pid)).toEqual([
        { pid: 40, startTime: '1040' },
        { pid: 41, startTime: '7' },
        { pid: 42, startTime: '1042' },
      ]);
      expect(pendingProcReads()).toBe(0);
      expect(await groupMembers(undefined, { procRoot })).toEqual([]);
    } finally {
      await release(fifo);
    }
  });
});

describe('processesLeft', () => {
  test('a target has processes left while one is tagged with it or a recorded member is still in its group', async () => {
    const procRoot = procTable({
      '20': tagged('e1'),
      // Untagged, still in e2's group under the start time recorded.
      '31': { env: ['PATH=/bin'], pgrp: 30, startTime: 5 },
      // Its pid was reused: a new process in a new group 40.
      '41': { env: ['PATH=/bin'], pgrp: 40, startTime: 9 },
    });
    const left = await processesLeft(
      [
        { execId: 'e1', groupId: 19 },
        {
          execId: 'e2',
          groupId: 30,
          members: Promise.resolve([{ pid: 31, startTime: '5' }]),
        },
        {
          execId: 'e3',
          groupId: 40,
          members: Promise.resolve([{ pid: 41, startTime: '8' }]),
        },
        { execId: 'e4', groupId: 30 },
      ],
      { procRoot },
    );
    expect(left).toEqual([true, true, false, false]);
    expect(
      await processesLeft([{ execId: 'e1', groupId: 19 }], {
        procRoot: '/nonexistent-proc-root',
      }),
    ).toBeNull();
  });
});

describe('signalExecProcesses', () => {
  test('signals the group once, and on its own only a process that left it', async () => {
    const procRoot = procTable({
      '40': tagged('e2', 39),
      '41': tagged('e2', 39),
      // `setsid`: a session and group of its own, still carrying the tag.
      '42': tagged('e2', 42),
    });
    const { sent, kill } = recorder();
    const { reached } = await signalExecProcesses(
      [{ execId: 'e2', groupId: 39, groupKnown: true }],
      'SIGTERM',
      { procRoot, kill },
    );
    expect(sent).toEqual([
      [-39, 'SIGTERM'],
      [42, 'SIGTERM'],
    ]);
    expect(reached).toBe(2);
  });

  test('a group not known to be the exec’s is signalled while a tagged process is in it', async () => {
    const procRoot = procTable({ '40': tagged('e2', 39) });
    const { sent, kill } = recorder();
    await signalExecProcesses([{ execId: 'e2', groupId: 39 }], 'SIGKILL', {
      procRoot,
      kill,
    });
    expect(sent).toEqual([[-39, 'SIGKILL']]);
  });

  test('a group is the exec’s while a member it recorded is still in it, tag or not', async () => {
    const procRoot = procTable({
      // `env -i` dropped the tag; the start time names the same process.
      '40': { env: ['PATH=/bin'], pgrp: 39, startTime: 77 },
    });
    const { sent, kill } = recorder();
    const { members } = await signalExecProcesses(
      [
        {
          execId: 'e2',
          groupId: 39,
          members: Promise.resolve([{ pid: 40, startTime: '77' }]),
        },
      ],
      'SIGKILL',
      { procRoot, kill },
    );
    expect(sent).toEqual([[-39, 'SIGKILL']]);
    // What the round saw in the group, for the next round's proof.
    expect(members).toEqual([[{ pid: 40, startTime: '77' }]]);
  });

  test('a recorded member whose pid now names another process proves nothing', async () => {
    const procRoot = procTable({
      '39': { env: ['PATH=/bin'], pgrp: 39, startTime: 90 },
      '40': { env: ['PATH=/bin'], pgrp: 39, startTime: 91 },
    });
    const { sent, kill } = recorder();
    const { members } = await signalExecProcesses(
      [
        {
          execId: 'e2',
          groupId: 39,
          members: Promise.resolve([{ pid: 40, startTime: '77' }]),
        },
      ],
      'SIGKILL',
      { procRoot, kill },
    );
    expect(sent).toEqual([]);
    expect(members).toEqual([[]]);
  });

  test('a group whose tagged processes all left is never signalled — its number may be someone else’s now', async () => {
    const procRoot = procTable({
      // An untagged leader reusing the old number.
      '39': { env: ['PATH=/bin'], pgrp: 39 },
      '42': tagged('e2', 42),
    });
    const { sent, kill } = recorder();
    await signalExecProcesses([{ execId: 'e2', groupId: 39 }], 'SIGKILL', {
      procRoot,
      kill,
    });
    expect(sent).toEqual([[42, 'SIGKILL']]);
  });

  test('one scan serves every target of a round', async () => {
    const procRoot = procTable({
      '40': tagged('a', 39),
      '51': tagged('b', 51),
    });
    const { sent, kill } = recorder();
    await signalExecProcesses(
      [
        { execId: 'a', groupId: 39 },
        { execId: 'b', groupId: 50 },
        { execId: 'c', groupId: 60, groupKnown: true },
      ],
      'SIGTERM',
      { procRoot, kill },
    );
    // The known group goes first, before the table is read.
    expect(sent).toEqual([
      [-60, 'SIGTERM'],
      [-39, 'SIGTERM'],
      [51, 'SIGTERM'],
    ]);
  });

  test('a known group is signalled before the table is read, so a read that hangs cannot hold it back', async () => {
    const procRoot = procTable({
      '40': tagged('e5', 39),
      '42': tagged('e5', 42),
    });
    const fifo = stallEnviron(procRoot, '41', 39);
    const { sent, kill } = recorder();
    try {
      const round = signalExecProcesses(
        [{ execId: 'e5', groupId: 39, groupKnown: true }],
        'SIGTERM',
        { procRoot, kill, scanDeadlineMs: 200 },
      );
      expect(sent).toEqual([[-39, 'SIGTERM']]);
      await round;
      // The scan answered at its deadline with what it read.
      expect(sent).toEqual([
        [-39, 'SIGTERM'],
        [42, 'SIGTERM'],
      ]);
    } finally {
      await release(fifo);
    }
  });

  test('scans that run at once share one read of a stuck process', async () => {
    const procRoot = procTable({ '42': tagged('e7', 42) });
    const fifo = stallEnviron(procRoot, '41', 41);
    const deps = { procRoot, scanDeadlineMs: 300 };
    try {
      const both = Promise.all([
        taggedPids('e7', deps),
        taggedPids('e7', deps),
        groupMembers(41, deps),
      ]);
      await new Promise((r) => setTimeout(r, 100));
      expect(pendingProcReads()).toBe(1);
      expect(await both).toEqual([
        [42],
        [42],
        [{ pid: 41, startTime: '1041' }],
      ]);
      expect(pendingProcReads()).toBe(1);
    } finally {
      await release(fifo);
    }
  });

  test('a process whose read did not come back is skipped until the read returns or the pid is someone else’s', async () => {
    const procRoot = procTable({ '42': tagged('e6', 42) });
    const fifo = stallEnviron(procRoot, '41', 41);
    const deps = { procRoot, scanDeadlineMs: 300 };
    try {
      let started = Date.now();
      expect(await taggedPids('e6', deps)).toEqual([42]);
      expect(Date.now() - started).toBeGreaterThanOrEqual(250);
      expect(pendingProcReads()).toBe(1);
      // The next scan does not wait on it again, nor add a read of its own.
      started = Date.now();
      expect(await taggedPids('e6', deps)).toEqual([42]);
      expect(Date.now() - started).toBeLessThan(250);
      expect(pendingProcReads()).toBe(1);
      // The read comes back: the process is read again.
      await release(fifo, `${EXEC_TAG_ENV}=e6\0`);
      rmSync(fifo);
      writeFileSync(fifo, `${EXEC_TAG_ENV}=e6\0`);
      expect(await taggedPids('e6', deps)).toEqual([41, 42]);
      expect(pendingProcReads()).toBe(0);
      // A pid whose read stalls, then names a new process, is read again.
      rmSync(fifo);
      spawnSync('mkfifo', [fifo]);
      expect(await taggedPids('e6', deps)).toEqual([42]);
      writeStat(procRoot, '41', { env: null, pgrp: 41, startTime: 99_999 });
      started = Date.now();
      await taggedPids('e6', deps);
      expect(Date.now() - started).toBeGreaterThanOrEqual(250);
      expect(pendingProcReads()).toBe(2);
    } finally {
      await release(fifo);
    }
  });

  test('without a process table only the group can be signalled', async () => {
    const { sent, kill } = recorder();
    await signalExecProcesses([{ execId: 'e2', groupId: 39 }], 'SIGTERM', {
      procRoot: '/nonexistent-proc-root',
      kill,
    });
    expect(sent).toEqual([[-39, 'SIGTERM']]);
  });

  test('targets already gone are skipped quietly', async () => {
    const procRoot = procTable({ '50': tagged('e3', 50) });
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const { reached } = await signalExecProcesses(
        [{ execId: 'e3', groupId: 49, groupKnown: true }],
        'SIGKILL',
        {
          procRoot,
          kill: () => {
            throw Object.assign(new Error('gone'), { code: 'ESRCH' });
          },
        },
      );
      expect(reached).toBe(0);
      expect(warnings).toEqual([]);
    } finally {
      console.warn = warn;
    }
  });

  test('never signals init or a group id of 1', async () => {
    const { sent, kill } = recorder();
    await signalExecProcesses(
      [{ execId: 'e4', groupId: 1, groupKnown: true }],
      'SIGKILL',
      { procRoot: procTable({ '1': tagged('e4', 1) }), kill },
    );
    expect(sent).toEqual([]);
  });
});
