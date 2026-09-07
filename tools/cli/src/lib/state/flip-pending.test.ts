import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearFlipPending,
  getFlipPending,
  setFlipPending,
} from './flip-pending';
import { getFlipPendingFilePath } from './get-flip-pending-file-path';

const dirs: string[] = [];

async function deployDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tale-flip-pending-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe('flip-pending', () => {
  test('round-trips a recorded flip', async () => {
    const dir = await deployDir();
    await setFlipPending(dir, { promoting: 'green', retiring: 'blue' });
    expect(await getFlipPending(dir)).toEqual({
      promoting: 'green',
      retiring: 'blue',
    });
    expect(getFlipPendingFilePath(dir)).toBe(
      join(dir, '.tale', 'deployment-flip-pending'),
    );
  });

  test('accepts a first-install flip with no colour to retire', async () => {
    const dir = await deployDir();
    await setFlipPending(dir, { promoting: 'blue', retiring: null });
    expect(await getFlipPending(dir)).toEqual({
      promoting: 'blue',
      retiring: null,
    });
  });

  test('treats missing or garbage files as no pending flip', async () => {
    const dir = await deployDir();
    expect(await getFlipPending(dir)).toBeNull();
    await Bun.write(getFlipPendingFilePath(dir), '{not json');
    expect(await getFlipPending(dir)).toBeNull();
  });

  test('clear removes the file', async () => {
    const dir = await deployDir();
    await setFlipPending(dir, { promoting: 'green', retiring: 'blue' });
    await clearFlipPending(dir);
    expect(await getFlipPending(dir)).toBeNull();
    await clearFlipPending(dir);
  });
});
