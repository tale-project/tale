import { describe, expect, it } from 'bun:test';

import {
  descendantsOf,
  endProcesses,
  parseProcessTable,
  procStartTime,
  type ProcessEntry,
  type RawProcesses,
} from './raw-processes.ts';

describe('parseProcessTable', () => {
  it('reads the columns ps prints on Linux and macOS, zombies marked', () => {
    expect(
      parseProcessTable(
        '  101     1   101   501 Ss\n  202   101   202   501 Z\n bad line\n  303 1 303 0\n',
      ),
    ).toEqual([
      { pid: 101, ppid: 1, pgid: 101, uid: 501 },
      { pid: 202, ppid: 101, pgid: 202, uid: 501, zombie: true },
      { pid: 303, ppid: 1, pgid: 303, uid: 0 },
    ]);
  });
});

describe('procStartTime', () => {
  it('reads field 22 past a name with spaces and parentheses', () => {
    const fields = Array.from({ length: 50 }, (_, i) => String(i + 3));
    fields[19] = '987654';
    expect(procStartTime(`42 (tale (x) y) ${fields.join(' ')}`)).toBe('987654');
    expect(procStartTime('garbage')).toBeNull();
  });
});

describe('descendantsOf', () => {
  it('walks every level below a process', () => {
    const table: ProcessEntry[] = [
      { pid: 10, ppid: 1, pgid: 10, uid: 5 },
      { pid: 11, ppid: 10, pgid: 11, uid: 5 },
      { pid: 12, ppid: 11, pgid: 11, uid: 5 },
      { pid: 20, ppid: 1, pgid: 20, uid: 5 },
    ];
    expect(
      descendantsOf(table, 10)
        .map((e) => e.pid)
        .sort((a, b) => a - b),
    ).toEqual([11, 12]);
  });
});

function fakeTable(entries: ProcessEntry[], ignoresTerm: Set<number>) {
  const signals: Array<[number, string]> = [];
  let table = [...entries];
  const processes: RawProcesses = {
    list: async () => table.map((e) => ({ ...e })),
    identity: async () => null,
    signal: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === 'SIGKILL' || !ignoresTerm.has(pid))
        table = table.filter((e) => e.pid !== pid);
      return true;
    },
    launch: async () => 0,
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
  };
  return { processes, signals, left: () => table };
}

describe('endProcesses', () => {
  it('asks first when there is a grace, then kills what stays', async () => {
    const { processes, signals, left } = fakeTable(
      [
        { pid: 1, ppid: 0, pgid: 1, uid: 0 },
        { pid: 50, ppid: 1, pgid: 50, uid: 61001 },
        { pid: 51, ppid: 1, pgid: 51, uid: 61001 },
      ],
      new Set([51]),
    );
    await endProcesses(processes, (t) => t.filter((e) => e.uid === 61001), {
      graceMs: 50,
      what: 'slot',
    });
    expect(signals).toContainEqual([50, 'SIGTERM']);
    expect(signals).toContainEqual([51, 'SIGKILL']);
    expect(left().map((e) => e.pid)).toEqual([1]);
  });

  it('never counts a zombie as one still running', async () => {
    const { processes } = fakeTable(
      [{ pid: 60, ppid: 1, pgid: 60, uid: 61001, zombie: true }],
      new Set(),
    );
    expect(
      await endProcesses(processes, (t) => t.filter((e) => e.uid === 61001), {
        what: 'slot',
      }),
    ).toBe(0);
  });

  it('throws when a process outlives every SIGKILL round', async () => {
    const processes: RawProcesses = {
      list: async () => [{ pid: 70, ppid: 1, pgid: 70, uid: 61001 }],
      identity: async () => null,
      signal: () => true,
      launch: async () => 0,
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
    };
    let error: unknown = null;
    try {
      await endProcesses(processes, (t) => [...t], {
        what: 'slot tale-slot-01',
      });
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).toMatch(/still run after SIGKILL: 70/);
  });
});
