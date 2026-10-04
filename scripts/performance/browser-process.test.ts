import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  childEnvironment,
  phaseTimeout,
  processGroupSignaler,
  runCaptured,
  runLogged,
} from './browser/common';

const owned: string[] = [];
afterEach(async () => {
  for (const path of owned.splice(0))
    await rm(path, { recursive: true, force: true });
});

test('child environment permits only runtime inputs, never ambient provider or Actions credentials', () => {
  const env = childEnvironment({ BENCH_PASSWORD: 'synthetic-for-test' });
  expect(Object.keys(env).toSorted()).toEqual([
    'BENCH_PASSWORD',
    'DO_NOT_TRACK',
    'HOME',
    'LANG',
    'NODE_ENV',
    'PATH',
    'SCARF_ANALYTICS',
    'STORYBOOK_DISABLE_TELEMETRY',
    'TURBO_TELEMETRY_DISABLED',
  ]);
});

test('a hung subprocess fails with its partial output retained', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tale-browser-process-'));
  owned.push(directory);
  const log = join(directory, 'partial.log');
  await expect(
    runLogged(
      'node',
      ['-e', "console.log('partial evidence');setInterval(()=>{},1000)"],
      {
        cwd: directory,
        log,
        timeoutMs: 200,
      },
    ),
  ).rejects.toThrow('exceeded its time budget');
  expect(await readFile(log, 'utf8')).toContain('partial evidence');
});

test('a failing subprocess is not silently retried', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tale-browser-process-'));
  owned.push(directory);
  const log = join(directory, 'failure.log');
  await expect(
    runLogged('node', ['-e', "console.log('one attempt');process.exit(7)"], {
      cwd: directory,
      log,
      timeoutMs: 2000,
    }),
  ).rejects.toThrow('Diagnostic phase failed');
  expect(await readFile(log, 'utf8')).toBe('one attempt\n');
});

test('a successful phase closes its log and an existing log is never overwritten', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tale-browser-process-'));
  owned.push(directory);
  const log = join(directory, 'success.log');
  await runLogged('node', ['-e', "console.log('complete')"], {
    cwd: directory,
    log,
    timeoutMs: 2000,
  });
  expect(await readFile(log, 'utf8')).toBe('complete\n');
  await expect(
    runLogged('node', ['-e', "console.log('replacement')"], {
      cwd: directory,
      log,
      timeoutMs: 2000,
    }),
  ).rejects.toThrow();
  expect(await readFile(log, 'utf8')).toBe('complete\n');
});

test('short resource commands enforce deadlines and keep partial output', async () => {
  const result = await runCaptured(
    'node',
    ['-e', "console.log('partial');setInterval(()=>{},1000)"],
    200,
  );
  expect(result.code).toBeNull();
  expect(result.stdout).toBe('partial\n');
});

test('short resource commands cannot fill memory with unbounded output', async () => {
  const kill = spyOn(process, 'kill');
  try {
    const result = await runCaptured(
      'node',
      ['-e', "process.stdout.write('x'.repeat(2*1024*1024))"],
      2000,
    );
    expect(result.code).toBeNull();
    expect(result.stdout.length).toBeLessThanOrEqual(1_048_576);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill.mock.calls[0]?.[0]).toBeLessThan(-1);
    expect(kill.mock.calls[0]?.[1]).toBe('SIGKILL');
  } finally {
    kill.mockRestore();
  }
});

test('the shared deadline caps every phase and cannot consume cleanup reserve', () => {
  expect(phaseTimeout(900_000, '11000', 1000)).toBe(10_000);
  expect(phaseTimeout(500, '11000', 1000)).toBe(500);
  expect(() => phaseTimeout(1000, '1000', 1000)).toThrow('deadline expired');
  expect(() => phaseTimeout(1000, 'not-a-date', 1000)).toThrow('Malformed');
});

test('an unexpected signal failure rejects its owner without escaping an output callback', async () => {
  const actualKill = process.kill.bind(process);
  const kill = spyOn(process, 'kill').mockImplementation((pid, signal) => {
    actualKill(pid, signal);
    throw Object.assign(new Error('owned signal failure'), { code: 'EPERM' });
  });
  try {
    await expect(
      runCaptured(
        'node',
        ['-e', "process.stdout.write('x'.repeat(2*1024*1024))"],
        2000,
      ),
    ).rejects.toThrow('owned signal failure');
    expect(kill).toHaveBeenCalledTimes(1);
  } finally {
    kill.mockRestore();
  }
});

test('missing or invalid spawn identities never target another process group', () => {
  const kill = spyOn(process, 'kill');
  try {
    for (const pid of [0, 1, -1, NaN, Infinity, 1.5]) {
      expect(() => processGroupSignaler(pid)).toThrow(
        'invalid spawned process identity',
      );
    }
    processGroupSignaler(undefined)('SIGKILL');
    expect(kill).not.toHaveBeenCalled();
  } finally {
    kill.mockRestore();
  }
});

test('final cleanup signal failures are surfaced after interrupt listeners are removed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tale-browser-process-'));
  owned.push(directory);
  const before = ['SIGINT', 'SIGTERM'].map((signal) =>
    process.listenerCount(signal),
  );
  const kill = spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('final cleanup signal failure'), {
      code: 'EPERM',
    });
  });
  try {
    await expect(
      runLogged('node', ['-e', "console.log('complete')"], {
        cwd: directory,
        log: join(directory, 'cleanup.log'),
        timeoutMs: 2000,
      }),
    ).rejects.toThrow('final cleanup signal failure');
    expect(
      ['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal)),
    ).toEqual(before);
    expect(kill).toHaveBeenCalledTimes(1);
  } finally {
    kill.mockRestore();
  }
});
