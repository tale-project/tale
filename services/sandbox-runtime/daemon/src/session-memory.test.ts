import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  admissionMemoryPercentFromEnv,
  DEFAULT_ADMISSION_MEMORY_PERCENT,
  memoryRefusesExec,
  readSessionMemory,
  statValue,
} from './session-memory.ts';

const MiB = 1_048_576;
let cgroup: string;

beforeEach(() => {
  cgroup = mkdtempSync(`${tmpdir()}/session-memory-`);
});
afterEach(() => {
  rmSync(cgroup, { recursive: true, force: true });
});

function write(files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files))
    writeFileSync(`${cgroup}/${name}`, content);
}

describe('admissionMemoryPercentFromEnv', () => {
  test('reads a whole percentage, 0 admitting every exec', () => {
    expect(admissionMemoryPercentFromEnv({})).toBe(90);
    expect(DEFAULT_ADMISSION_MEMORY_PERCENT).toBe(90);
    expect(
      admissionMemoryPercentFromEnv({
        TALE_EXEC_ADMISSION_MEMORY_PERCENT: '80',
      }),
    ).toBe(80);
    expect(
      admissionMemoryPercentFromEnv({
        TALE_EXEC_ADMISSION_MEMORY_PERCENT: '0',
      }),
    ).toBe(0);
  });

  test('keeps the default for a value that is no whole percentage', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const raw of ['101', '-1', '85.5', 'most'])
        expect(
          admissionMemoryPercentFromEnv({
            TALE_EXEC_ADMISSION_MEMORY_PERCENT: raw,
          }),
        ).toBe(90);
      expect(warn).toHaveBeenCalledTimes(4);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('readSessionMemory', () => {
  test('reads the limit and the working set without the inactive file cache', async () => {
    write({
      'memory.current': `${900 * MiB}\n`,
      'memory.max': `${1024 * MiB}\n`,
      'memory.stat': `anon ${500 * MiB}\nfile ${400 * MiB}\nactive_file ${100 * MiB}\ninactive_file ${300 * MiB}\n`,
    });
    expect(await readSessionMemory(cgroup)).toEqual({
      currentBytes: 900 * MiB,
      maxBytes: 1024 * MiB,
      workingSetBytes: 600 * MiB,
    });
  });

  test('reads no limit as none, and a session without memory.stat whole', async () => {
    write({ 'memory.current': `${100 * MiB}\n`, 'memory.max': 'max\n' });
    expect(await readSessionMemory(cgroup)).toEqual({
      currentBytes: 100 * MiB,
      maxBytes: null,
      workingSetBytes: 100 * MiB,
    });
  });

  test('reads nothing where the cgroup has no memory controller', async () => {
    expect(await readSessionMemory(cgroup)).toBeNull();
    expect(await readSessionMemory(`${cgroup}/missing`)).toBeNull();
  });

  test('statValue reads one key of a stat file', () => {
    expect(statValue('anon 1\ninactive_file 42\n', 'inactive_file')).toBe(42);
    expect(statValue('anon 1\n', 'inactive_file')).toBeNull();
  });
});

describe('memoryRefusesExec', () => {
  const memory = (workingSetMiB: number, maxMiB: number | null) => ({
    currentBytes: workingSetMiB * MiB,
    maxBytes: maxMiB === null ? null : maxMiB * MiB,
    workingSetBytes: workingSetMiB * MiB,
  });

  test('refuses at or past the share of the limit', () => {
    expect(memoryRefusesExec(memory(900, 1000), 90)).toBe(true);
    expect(memoryRefusesExec(memory(950, 1000), 90)).toBe(true);
    expect(memoryRefusesExec(memory(899, 1000), 90)).toBe(false);
  });

  test('admits without a limit, a reading, or with the check off', () => {
    expect(memoryRefusesExec(memory(950, null), 90)).toBe(false);
    expect(memoryRefusesExec(null, 90)).toBe(false);
    expect(memoryRefusesExec(memory(1000, 1000), 0)).toBe(false);
  });
});
