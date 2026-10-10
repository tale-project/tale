import { describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  DEFAULT_EXEC_STALL_MS,
  execStallMsFromEnv,
  isStalled,
  parseStatCpu,
  processesOfTarget,
  readEngineCpuUsec,
  readProcCpu,
  StallWatch,
  type ProcCpu,
} from './exec-stall.ts';

/** A `/proc/<pid>/stat` line with the given parent, group, start time and
 * CPU times (utime, stime, cutime, cstime). */
function statLine(
  pid: number,
  args: {
    ppid: number;
    pgrp: number;
    times?: [number, number, number, number];
    startTime?: number;
    comm?: string;
  },
): string {
  const [utime, stime, cutime, cstime] = args.times ?? [0, 0, 0, 0];
  // Fields 3 onwards: state, ppid, pgrp, session, tty, tpgid, flags, minflt,
  // cminflt, majflt, cmajflt, utime, stime, cutime, cstime, priority, nice,
  // threads, itrealvalue, starttime, vsize.
  return `${pid} (${args.comm ?? 'node'}) S ${args.ppid} ${args.pgrp} ${args.pgrp} 0 -1 4194304 10 0 0 0 ${utime} ${stime} ${cutime} ${cstime} 20 0 1 0 ${args.startTime ?? 1000} 1234567\n`;
}

function proc(pid: number, ppid: number, pgrp: number, ticks = 0): ProcCpu {
  return { pid, ppid, pgrp, startTime: '1000', ticks };
}

describe('execStallMsFromEnv', () => {
  test('reads the window in milliseconds, 0 switching the watch off', () => {
    expect(execStallMsFromEnv({})).toBe(DEFAULT_EXEC_STALL_MS);
    expect(execStallMsFromEnv({ TALE_EXEC_STALL_MS: '' })).toBe(
      DEFAULT_EXEC_STALL_MS,
    );
    expect(execStallMsFromEnv({ TALE_EXEC_STALL_MS: '0' })).toBe(0);
    expect(execStallMsFromEnv({ TALE_EXEC_STALL_MS: '600000' })).toBe(600_000);
  });

  test('keeps the default for a value that is no whole number of milliseconds', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const raw of ['soon', '-1', '1.5'])
        expect(execStallMsFromEnv({ TALE_EXEC_STALL_MS: raw })).toBe(
          DEFAULT_EXEC_STALL_MS,
        );
      expect(warn).toHaveBeenCalledTimes(3);
    } finally {
      warn.mockRestore();
    }
  });

  test('defaults to 45 minutes', () => {
    expect(DEFAULT_EXEC_STALL_MS).toBe(45 * 60_000);
  });
});

describe('parseStatCpu', () => {
  test('reads the parent, group, start time and all four CPU times', () => {
    expect(
      parseStatCpu(
        42,
        statLine(42, {
          ppid: 7,
          pgrp: 40,
          times: [100, 20, 3, 4],
          startTime: 9876,
        }),
      ),
    ).toEqual({ pid: 42, ppid: 7, pgrp: 40, startTime: '9876', ticks: 127 });
  });

  test('counts fields from the last parenthesis of a command name', () => {
    const parsed = parseStatCpu(
      5,
      statLine(5, { ppid: 1, pgrp: 5, times: [1, 1, 0, 0], comm: 'a) S (b' }),
    );
    expect(parsed?.ppid).toBe(1);
    expect(parsed?.ticks).toBe(2);
  });

  test('refuses a line it cannot read', () => {
    expect(parseStatCpu(1, 'garbage')).toBeNull();
    expect(parseStatCpu(1, '1 (x) S nope 1 1')).toBeNull();
  });
});

describe('processesOfTarget', () => {
  const table = [
    proc(10, 1, 10),
    proc(11, 10, 11),
    proc(12, 11, 12),
    proc(13, 12, 99),
    proc(20, 1, 20),
    proc(21, 20, 20),
    proc(30, 1, 30),
  ];

  test('takes the shim and every descendant, whatever group they moved to', () => {
    expect(
      processesOfTarget(table, { rootPid: 10, groupId: 11 })
        .map((p) => p.pid)
        .toSorted((a, b) => a - b),
    ).toEqual([10, 11, 12, 13]);
  });

  test('takes the group and its descendants without a shim', () => {
    expect(
      processesOfTarget(table, { groupId: 20 })
        .map((p) => p.pid)
        .toSorted((a, b) => a - b),
    ).toEqual([20, 21]);
  });

  test('falls back to the group when the shim is not in the table', () => {
    expect(
      processesOfTarget(table, { rootPid: 99, groupId: 30 }).map((p) => p.pid),
    ).toEqual([30]);
  });

  test('takes nothing for no target, and never init', () => {
    expect(processesOfTarget(table, {})).toEqual([]);
    expect(processesOfTarget(table, { rootPid: 1, groupId: 1 })).toEqual([]);
  });
});

describe('isStalled', () => {
  const stallMs = 1_000;

  test('judges nothing before the whole window was watched', () => {
    expect(
      isStalled({
        samples: [{ at: 500, ticks: 0 }],
        lastOutputAt: 0,
        now: 1_400,
        stallMs,
      }),
    ).toBe(false);
  });

  test('a quiet exec under 1% of one CPU over the window stalled', () => {
    // 0.9 ticks over 1 s is 9 ms: under 10 ms, a hundredth of the span.
    expect(
      isStalled({
        samples: [
          { at: 0, ticks: 5 },
          { at: 1_000, ticks: 5.9 },
        ],
        lastOutputAt: 0,
        now: 1_000,
        stallMs,
      }),
    ).toBe(true);
  });

  test('1% of one CPU or more is work', () => {
    expect(
      isStalled({
        samples: [
          { at: 0, ticks: 5 },
          { at: 1_000, ticks: 6 },
        ],
        lastOutputAt: 0,
        now: 1_000,
        stallMs,
      }),
    ).toBe(false);
  });

  test('output inside the window is work', () => {
    expect(
      isStalled({
        samples: [
          { at: 0, ticks: 0 },
          { at: 1_000, ticks: 0 },
        ],
        lastOutputAt: 1,
        now: 1_000,
        stallMs,
      }),
    ).toBe(false);
  });

  test('a window of 0 switches the judgment off', () => {
    expect(
      isStalled({
        samples: [
          { at: 0, ticks: 0 },
          { at: 1_000, ticks: 0 },
        ],
        lastOutputAt: 0,
        now: 1_000,
        stallMs: 0,
      }),
    ).toBe(false);
  });
});

describe('StallWatch', () => {
  /** A watch on a fake clock and process table, sampled by hand. */
  function harness(
    options: {
      stallMs?: number;
      table?: () => readonly ProcCpu[] | null;
      engine?: () => number | null;
    } = {},
  ) {
    let now = 0;
    const stalled: string[] = [];
    const watch = new StallWatch(
      options.stallMs ?? 1_000,
      (execId) => stalled.push(execId),
      {
        sampleMs: 60_000,
        now: () => now,
        readTable: async () =>
          options.table !== undefined ? options.table() : [proc(10, 1, 10)],
        readEngineUsec: async () =>
          options.engine !== undefined ? options.engine() : null,
      },
    );
    return {
      watch,
      stalled,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  test('ends a quiet, idle exec once, after its whole window', async () => {
    const { watch, stalled, advance } = harness();
    using _ = watch;
    watch.watch('e1', () => ({ groupId: 10 }));
    // Samples at 250, 500, 750 and 1000 ms: none is old enough yet to open
    // a whole window.
    for (let round = 0; round < 4; round += 1) {
      advance(250);
      await watch.sample();
    }
    expect(stalled).toEqual([]);
    advance(250);
    await watch.sample();
    expect(stalled).toEqual(['e1']);
    advance(250);
    await watch.sample();
    expect(stalled).toEqual(['e1']);
  });

  test('output starts the quiet clock again', async () => {
    const { watch, stalled, advance } = harness();
    using _ = watch;
    watch.watch('e1', () => ({ groupId: 10 }));
    for (let round = 0; round < 12; round += 1) {
      advance(250);
      if (round % 3 === 0) watch.output('e1');
      await watch.sample();
    }
    expect(stalled).toEqual([]);
  });

  test('an exec whose processes keep computing is never ended', async () => {
    let ticks = 0;
    const { watch, stalled, advance } = harness({
      // One tick per 250 ms is 4% of one CPU.
      table: () => [proc(10, 1, 10, (ticks += 1))],
    });
    using _ = watch;
    watch.watch('e1', () => ({ groupId: 10 }));
    for (let round = 0; round < 12; round += 1) {
      advance(250);
      await watch.sample();
    }
    expect(stalled).toEqual([]);
  });

  test('the inner engine’s containers computing count as work', async () => {
    let usec = 0;
    const { watch, stalled, advance } = harness({
      // 25 ms per 250 ms is 10% of one CPU.
      engine: () => (usec += 25_000),
    });
    using _ = watch;
    watch.watch('e1', () => ({ groupId: 10 }));
    for (let round = 0; round < 12; round += 1) {
      advance(250);
      await watch.sample();
    }
    expect(stalled).toEqual([]);
  });

  test('a process table it cannot read judges nothing', async () => {
    const { watch, stalled, advance } = harness({ table: () => null });
    using _ = watch;
    watch.watch('e1', () => ({ groupId: 10 }));
    for (let round = 0; round < 12; round += 1) {
      advance(250);
      await watch.sample();
    }
    expect(stalled).toEqual([]);
  });

  test('an ended exec and a window of 0 are not watched', async () => {
    const off = harness({ stallMs: 0 });
    using _off = off.watch;
    off.watch.watch('e1', () => ({ groupId: 10 }));
    const on = harness();
    using _on = on.watch;
    on.watch.watch('e2', () => ({ groupId: 10 }));
    on.watch.unwatch('e2');
    for (let round = 0; round < 12; round += 1) {
      off.advance(250);
      on.advance(250);
      await off.watch.sample();
      await on.watch.sample();
    }
    expect(off.stalled).toEqual([]);
    expect(on.stalled).toEqual([]);
  });
});

describe('reading the CPU counters', () => {
  test('reads every process of a process table, skipping what it cannot', async () => {
    const root = mkdtempSync(`${tmpdir()}/stall-proc-`);
    try {
      for (const [pid, line] of [
        [10, statLine(10, { ppid: 1, pgrp: 10, times: [1, 2, 3, 4] })],
        [11, 'not a stat line'],
      ] as const) {
        mkdirSync(`${root}/${pid}`);
        writeFileSync(`${root}/${pid}/stat`, line);
      }
      // Gone between the listing and the read.
      mkdirSync(`${root}/12`);
      mkdirSync(`${root}/self`);
      expect(await readProcCpu(root)).toEqual([
        { pid: 10, ppid: 1, pgrp: 10, startTime: '1000', ticks: 10 },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('answers no table where there is none', async () => {
    expect(await readProcCpu(`${tmpdir()}/no-such-proc-${process.pid}`)).toBe(
      null,
    );
  });

  test('reads the inner engine’s container CPU, none without its cgroup', async () => {
    const cgroup = mkdtempSync(`${tmpdir()}/stall-engine-`);
    try {
      writeFileSync(
        `${cgroup}/cpu.stat`,
        'usage_usec 123456\nuser_usec 100000\nsystem_usec 23456\n',
      );
      expect(await readEngineCpuUsec(cgroup)).toBe(123_456);
      expect(await readEngineCpuUsec(`${cgroup}/missing`)).toBeNull();
    } finally {
      rmSync(cgroup, { recursive: true, force: true });
    }
  });
});
