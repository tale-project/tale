// A child a signal ended keeps `exitCode` null: a harness that asked only that
// believed a killed spawner still ran, and never started its successor.

import { describe, expect, test } from 'bun:test';

import { hasEnded } from './util.ts';

describe('hasEnded', () => {
  test('a child that runs has not ended', async () => {
    const proc = Bun.spawn(['sleep', '30']);
    try {
      expect(hasEnded(proc)).toBe(false);
    } finally {
      proc.kill('SIGKILL');
      await proc.exited;
    }
  });

  test('a child that exited has ended', async () => {
    const proc = Bun.spawn(['sh', '-c', 'exit 3']);
    expect(await proc.exited).toBe(3);
    expect(hasEnded(proc)).toBe(true);
  });

  test('a child a signal ended has ended, with no exit code and 128 plus the signal as its status', async () => {
    const proc = Bun.spawn(['sleep', '30']);
    proc.kill('SIGKILL');
    expect(await proc.exited).toBe(137);
    expect(proc.exitCode).toBeNull();
    expect(proc.signalCode).toBe('SIGKILL');
    expect(hasEnded(proc)).toBe(true);
  });
});
