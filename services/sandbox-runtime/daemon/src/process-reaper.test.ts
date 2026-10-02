// The reaper finds an exec's processes by the tag in their environment and
// signals each of them once: the exec's process group as a whole, and on
// their own only the tagged processes that left it. A fake process table
// stands in for /proc, so this runs on any host.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  EXEC_TAG_ENV,
  execsWithProcesses,
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
    const pgrp = proc.pgrp ?? pid;
    const comm = proc.comm ?? 'sleep';
    writeFileSync(
      `${root}/${pid}/stat`,
      `${pid} (${comm}) S 1 ${pgrp} ${pgrp} 0 -1 4194560 0 0\n`,
    );
  }
  return root;
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

describe('execsWithProcesses', () => {
  test('names every exec with a tagged process left', async () => {
    const procRoot = procTable({
      '20': tagged('e1'),
      '21': tagged('e1'),
      '22': tagged('e2'),
      '23': { env: ['PATH=/bin'] },
    });
    expect(await execsWithProcesses({ procRoot })).toEqual(
      new Set(['e1', 'e2']),
    );
    expect(
      await execsWithProcesses({ procRoot: '/nonexistent-proc-root' }),
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
    const reached = await signalExecProcesses(
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
    expect(sent).toEqual([
      [-39, 'SIGTERM'],
      [51, 'SIGTERM'],
      [-60, 'SIGTERM'],
    ]);
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
      const reached = await signalExecProcesses(
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
