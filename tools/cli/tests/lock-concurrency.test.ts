import { expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { temporary } from '../src/lib/config/releases/tests/fixture';

const script = fileURLToPath(
  new URL('./fixtures/lock-holder.ts', import.meta.url),
);
async function holder(directory: string) {
  const process = Bun.spawn([Bun.which('bun')!, script, directory], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const reader = process.stdout.getReader();
  const first = await reader.read();
  const state = JSON.parse(new TextDecoder().decode(first.value)) as {
    acquired: boolean;
    pid: number;
  };
  reader.releaseLock();
  return { process, ...state };
}

test('three independent contenders never steal a live lock through stale metadata', async () => {
  const directory = temporary();
  const metadata = path.join(directory, '.tale', 'deployment-lock');
  mkdirSync(path.dirname(metadata));
  writeFileSync(
    metadata,
    JSON.stringify({
      pid: 2_000_000_000,
      startedAt: '2026-01-01T00:00:00Z',
      command: 'dead holder',
    }),
  );
  const contenders = await Promise.all([
    holder(directory),
    holder(directory),
    holder(directory),
  ]);
  const winner = contenders.find((item) => item.acquired)!;
  try {
    expect(contenders.filter((item) => item.acquired)).toHaveLength(1);
    expect(winner.process.exitCode).toBeNull();
    const database = path.join(directory, '.tale', 'deployment-lock.sqlite');
    expect(existsSync(database)).toBe(true);
    const bytes = readFileSync(database);
    // Even absent or stale diagnostic metadata cannot admit another process.
    unlinkSync(metadata);
    const withoutMetadata = await holder(directory);
    expect(withoutMetadata.acquired).toBe(false);
    await withoutMetadata.process.exited;
    writeFileSync(
      metadata,
      JSON.stringify({
        pid: 2_000_000_000,
        startedAt: '2026-01-01T00:00:00Z',
        command: 'stale observer',
      }),
    );
    const withStale = await holder(directory);
    expect(withStale.acquired).toBe(false);
    await withStale.process.exited;
    expect(readFileSync(database)).toEqual(bytes);
    winner.process.kill('SIGKILL');
    await winner.process.exited;
    const recovered = await holder(directory);
    expect(recovered.acquired).toBe(true);
    recovered.process.stdin.write('release\n');
    recovered.process.stdin.end();
    expect(await recovered.process.exited).toBe(0);
    expect(existsSync(database)).toBe(true);
    expect(existsSync(metadata)).toBe(false);
  } finally {
    for (const child of contenders) {
      if (child.process.exitCode === null) child.process.kill();
      await child.process.exited;
    }
  }
}, 15_000);

test('active legacy PID metadata is respected, then dead or corrupt metadata recovers', async () => {
  const directory = temporary();
  const metadata = path.join(directory, '.tale', 'deployment-lock');
  mkdirSync(path.dirname(metadata));
  writeFileSync(
    metadata,
    JSON.stringify({
      pid: process.pid,
      startedAt: '2026-01-01T00:00:00Z',
      command: 'legacy operation',
    }),
  );
  const held = await holder(directory);
  expect(held.acquired).toBe(false);
  await held.process.exited;
  writeFileSync(metadata, '{interrupted metadata');
  const recovered = await holder(directory);
  expect(recovered.acquired).toBe(true);
  recovered.process.stdin.write('release\n');
  recovered.process.stdin.end();
  expect(await recovered.process.exited).toBe(0);
}, 15_000);
