import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import {
  findShellTool,
  hogArguments,
  hogProgram,
  hogResult,
  type ShellTool,
} from '../../src/mock/hog.ts';
import { createRandom } from '../../src/mock/random.ts';
import type { OfferedTool } from '../../src/mock/tool-args.ts';

/** Claude Code's shell tool, as its schema reaches a provider. */
const BASH: OfferedTool = {
  name: 'Bash',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      timeout: { type: 'number' },
      description: { type: 'string' },
      run_in_background: { type: 'boolean' },
    },
    required: ['command'],
  },
};

const WEATHER: OfferedTool = {
  name: 'get_weather',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
};

const HINTS = { keywords: [], locale: 'en' };

const PYTHON = spawnSync('python3', ['--version']).status === 0;
/** Linux's count of each process's time on a CPU and queued for one. */
const SCHEDSTAT = existsSync('/proc/self/schedstat');

describe('the shell tool', () => {
  test('is the tool that takes a command, one named like a shell first', () => {
    expect(findShellTool([WEATHER, BASH])).toEqual({ tool: BASH, argv: false });
    const device: OfferedTool = {
      name: 'device_control',
      parameters: { properties: { command: { type: 'string' } } },
    };
    const shell: OfferedTool = {
      name: 'shell',
      parameters: {
        properties: { command: { type: 'array', items: { type: 'string' } } },
      },
    };
    expect(findShellTool([device, shell])).toEqual({ tool: shell, argv: true });
    expect(findShellTool([device])).toEqual({ tool: device, argv: false });
    expect(findShellTool([WEATHER])).toBeNull();
    expect(findShellTool([])).toBeNull();
  });
});

describe('the hog call', () => {
  test("gives Claude Code's Bash a quoted line and room to finish", () => {
    const shell: ShellTool = { tool: BASH, argv: false };
    const args = hogArguments(
      createRandom(1),
      shell,
      { mib: 2048, seconds: 60 },
      HINTS,
    );
    expect(args).toEqual({
      command: `python3 -c '${hogProgram({ mib: 2048, seconds: 60 })}'`,
      description: 'Hold 2048 MiB and keep a CPU busy for 60 s',
      timeout: 120_000,
    });
  });

  test('gives an argv tool its argv, and fills what else it requires', () => {
    const exec: OfferedTool = {
      name: 'shell',
      parameters: {
        properties: {
          command: { type: 'array', items: { type: 'string' } },
          workdir: { type: 'string' },
          timeout_ms: { type: 'integer' },
        },
        required: ['command', 'workdir'],
      },
    };
    const args = hogArguments(
      createRandom(1),
      { tool: exec, argv: true },
      { mib: 1, seconds: 1 },
      HINTS,
    );
    expect(args.command).toEqual([
      'python3',
      '-c',
      hogProgram({ mib: 1, seconds: 1 }),
    ]);
    expect(typeof args.workdir).toBe('string');
    expect(args.timeout_ms).toBe(61_000);
  });

  test('stays inside its bounds and inside the 600 s a command may take', () => {
    const program = hogProgram({ mib: 1e9, seconds: 1e9 });
    expect(program).toContain('(16384 << 20)');
    expect(program).toContain('time.monotonic() + 540');
    expect(program).not.toContain("'");
    const args = hogArguments(
      createRandom(1),
      { tool: BASH, argv: false },
      { mib: 1e9, seconds: 1e9 },
      HINTS,
    );
    expect(args.timeout).toBe(600_000);
  });
});

describe('the hog result', () => {
  test('is the line the program prints once it held and spun', () => {
    expect(hogResult('held 2048 MiB and spun 60 s\n')).toEqual({
      mib: 2048,
      seconds: 60,
    });
    expect(hogResult('Output:\nheld 64 MiB and spun 2 s')).toEqual({
      mib: 64,
      seconds: 2,
    });
  });

  test('is none when the command failed or was killed', () => {
    expect(hogResult('')).toBeNull();
    expect(hogResult('Exit code 137\nKilled')).toBeNull();
    expect(hogResult('MemoryError')).toBeNull();
    expect(hogResult('/bin/sh: 1: python3: not found')).toBeNull();
  });
});

describe.skipIf(!PYTHON)('the hog program', () => {
  test('holds its memory resident', () => {
    const usage = [
      hogProgram({ mib: 64, seconds: 0 }),
      'import resource',
      'print(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)',
    ].join('\n');
    const run = spawnSync('python3', ['-c', usage], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    const [held, peakKib] = run.stdout.trim().split('\n');
    expect(held).toBe('held 64 MiB and spun 0 s');
    // Linux reports the peak resident set in KiB.
    expect(Number(peakKib)).toBeGreaterThan(64 * 1024);
  });

  // A spin waits for nothing but a CPU: Linux counts it on one or queued for
  // one for all of its time, however small a share of a CPU a busy runner
  // gives it, and its CPU time is only that share. A hog that slept would be
  // blocked for its whole second; a spinning one is blocked for next to none.
  test.skipIf(!SCHEDSTAT)(
    'spins a CPU for its time, however much of one it gets',
    () => {
      const usage = [
        'import time',
        'def runnable():',
        '    with open("/proc/self/schedstat") as stat:',
        '        on_cpu, queued = stat.read().split()[:2]',
        '    return (int(on_cpu) + int(queued)) / 1e9',
        'start_wall, start_runnable = time.monotonic(), runnable()',
        hogProgram({ mib: 1, seconds: 1 }),
        'print(time.monotonic() - start_wall, runnable() - start_runnable)',
      ].join('\n');
      const run = spawnSync('python3', ['-c', usage], { encoding: 'utf8' });
      expect(run.status).toBe(0);
      const [held, measured] = run.stdout.trim().split('\n');
      const [wallSeconds, runnableSeconds] = (measured ?? '')
        .split(' ')
        .map(Number);
      expect(held).toBe('held 1 MiB and spun 1 s');
      expect(wallSeconds).toBeGreaterThanOrEqual(1);
      expect(wallSeconds - runnableSeconds).toBeLessThan(0.5);
    },
  );

  test('runs as the shell line Bash is given', () => {
    const args = hogArguments(
      createRandom(1),
      { tool: BASH, argv: false },
      { mib: 8, seconds: 0 },
      HINTS,
    );
    const run = spawnSync('sh', ['-c', String(args.command)], {
      encoding: 'utf8',
    });
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('held 8 MiB and spun 0 s');
    expect(hogResult(run.stdout)).toEqual({ mib: 8, seconds: 0 });
  });
});
