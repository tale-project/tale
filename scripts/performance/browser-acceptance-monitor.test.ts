import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  acknowledgeMonitorStop,
  publishResourceCheckpoint,
  stopResourceMonitor,
} from './browser/acceptance-monitor.ts';

const owned: string[] = [];
afterEach(async () => {
  await Promise.all(
    owned.splice(0).map((path) => rm(path, { recursive: true })),
  );
});
async function directory() {
  const value = await mkdtemp(join(tmpdir(), 'acceptance-monitor-'));
  owned.push(value);
  return value;
}
const token = 'a'.repeat(32);
test('atomic checkpoints replace a complete previous value and preserve it when the owned next write cannot start', async () => {
  const root = await directory();
  await publishResourceCheckpoint(root, { valid: true, at: 1 });
  await publishResourceCheckpoint(root, {
    valid: false,
    error: 'quota changed',
    at: 2,
  });
  expect(
    JSON.parse(await readFile(join(root, 'resource-live.json'), 'utf8')),
  ).toEqual({ valid: false, error: 'quota changed', at: 2 });
  await writeFile(
    join(root, 'resource-live.next'),
    'owned incomplete evidence',
  );
  await expect(
    publishResourceCheckpoint(root, { valid: true, at: 3 }),
  ).rejects.toThrow();
  expect(
    JSON.parse(await readFile(join(root, 'resource-live.json'), 'utf8')).valid,
  ).toBe(false);
  expect(await readFile(join(root, 'resource-live.next'), 'utf8')).toBe(
    'owned incomplete evidence',
  );
});
test('stop acknowledgment requires the owned token and does not appear before a request', async () => {
  const root = await directory();
  expect(await acknowledgeMonitorStop(root, token)).toBe(false);
  await writeFile(join(root, 'resource-monitor-stop'), 'b'.repeat(32));
  await expect(acknowledgeMonitorStop(root, token)).rejects.toThrow('Unowned');
  await expect(
    readFile(join(root, 'resource-monitor-stopped')),
  ).rejects.toThrow();
});
test('runner waits for host acknowledgment before teardown, bounded at10seconds without retrying the request', async () => {
  for (const acknowledge of [true, false]) {
    const root = await directory();
    await writeFile(join(root, 'resource-token'), token);
    let clock = 0;
    const waits: number[] = [];
    const result = stopResourceMonitor(root, {
      now: () => clock,
      wait: async (ms) => {
        waits.push(ms);
        clock += ms;
        if (acknowledge) await acknowledgeMonitorStop(root, token);
      },
    });
    if (acknowledge) {
      await result;
      expect(clock).toBe(100);
    } else {
      await expect(result).rejects.toThrow('within10s');
      expect(clock).toBe(10_000);
    }
    expect(Math.max(...waits)).toBe(100);
    expect(await readFile(join(root, 'resource-monitor-stop'), 'utf8')).toBe(
      token,
    );
  }
});
