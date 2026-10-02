// The reaper finds an exec's processes by the tag in their environment and
// signals them with the exec's process group. A fake process table stands in
// for /proc, so this runs on any host.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  EXEC_TAG_ENV,
  signalExecProcesses,
  taggedPids,
} from './process-reaper.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A process table: pid → environment entries (`null`: no environ file). */
function procTable(processes: Record<string, string[] | null>): string {
  const root = mkdtempSync(`${tmpdir()}/reaper-proc-`);
  roots.push(root);
  for (const [pid, environ] of Object.entries(processes)) {
    mkdirSync(`${root}/${pid}`);
    if (environ !== null) {
      writeFileSync(`${root}/${pid}/environ`, `${environ.join('\0')}\0`);
    }
  }
  return root;
}

describe('taggedPids', () => {
  test('finds exactly the processes carrying the exec tag', () => {
    const procRoot = procTable({
      '1': [`${EXEC_TAG_ENV}=e1`],
      '20': ['PATH=/bin', `${EXEC_TAG_ENV}=e1`],
      '21': [`${EXEC_TAG_ENV}=e10`],
      '22': [`X_${EXEC_TAG_ENV}=e1`],
      '23': ['PATH=/bin'],
      '24': null,
      '30': [`${EXEC_TAG_ENV}=e1`],
      self: [`${EXEC_TAG_ENV}=e1`],
    });
    expect(taggedPids('e1', { procRoot, selfPid: 30 })).toEqual([20]);
  });

  test('a host without a process table yields nothing', () => {
    expect(taggedPids('e1', { procRoot: '/nonexistent-proc-root' })).toEqual(
      [],
    );
  });
});

describe('signalExecProcesses', () => {
  test('signals the process group and every tagged process', () => {
    const procRoot = procTable({
      '40': [`${EXEC_TAG_ENV}=e2`],
      '41': [`${EXEC_TAG_ENV}=e2`],
    });
    const sent: Array<[number, string]> = [];
    const reached = signalExecProcesses('e2', 39, 'SIGTERM', {
      procRoot,
      kill: (pid, signal) => {
        sent.push([pid, signal]);
      },
    });
    expect(sent.sort((a, b) => a[0] - b[0])).toEqual([
      [-39, 'SIGTERM'],
      [40, 'SIGTERM'],
      [41, 'SIGTERM'],
    ]);
    expect(reached).toBe(3);
  });

  test('targets already gone are skipped quietly', () => {
    const procRoot = procTable({ '50': [`${EXEC_TAG_ENV}=e3`] });
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const reached = signalExecProcesses('e3', 49, 'SIGKILL', {
        procRoot,
        kill: () => {
          throw Object.assign(new Error('gone'), { code: 'ESRCH' });
        },
      });
      expect(reached).toBe(0);
      expect(warnings).toEqual([]);
    } finally {
      console.warn = warn;
    }
  });

  test('never signals init or a group id of 1', () => {
    const sent: number[] = [];
    signalExecProcesses('e4', 1, 'SIGKILL', {
      procRoot: procTable({ '1': [`${EXEC_TAG_ENV}=e4`] }),
      kill: (pid) => {
        sent.push(pid);
      },
    });
    expect(sent).toEqual([]);
  });
});
