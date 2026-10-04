import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PlacementStore } from './placements.ts';

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function fileIn(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tale-placements-'));
  dirs.push(dir);
  return join(dir, 'hub', 'placements.json');
}

describe('PlacementStore', () => {
  test('survives a restart and forgets a removed device', async () => {
    const file = await fileIn();
    const store = new PlacementStore(file);
    await store.load();
    await Promise.all([
      store.set('pa-1', { deviceId: 'd1', organizationId: 'o', placedAtMs: 1 }),
      store.set('pa-2', { deviceId: 'd1', organizationId: 'o', placedAtMs: 2 }),
      store.set('wf-3', { deviceId: 'd2', organizationId: 'o', placedAtMs: 3 }),
    ]);
    const again = new PlacementStore(file);
    await again.load();
    expect(again.forOrganization('o')).toHaveLength(3);
    expect(await again.deleteDevice('d1')).toBe(2);
    await again.delete('missing');
    const third = new PlacementStore(file);
    await third.load();
    expect(third.forOrganization('o')).toEqual([
      { sessionId: 'wf-3', deviceId: 'd2' },
    ]);
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1);
  });

  test("a destroyed session's route to the device still deleting its bytes survives a restart, and is no session", async () => {
    const file = await fileIn();
    const store = new PlacementStore(file);
    await store.load();
    await store.set('pa-1', {
      deviceId: 'd1',
      organizationId: 'o',
      placedAtMs: 1,
    });
    await store.markDeleting('pa-1');
    await store.markDeleting('missing');
    const again = new PlacementStore(file);
    await again.load();
    expect(again.get('pa-1')).toEqual({
      deviceId: 'd1',
      organizationId: 'o',
      placedAtMs: 1,
      deleting: true,
    });
    expect(again.get('missing')).toBeUndefined();
    expect(again.forOrganization('o')).toEqual([]);
    expect(again.deleting()).toEqual([{ sessionId: 'pa-1', deviceId: 'd1' }]);
  });

  test.each([
    '{not json',
    '{}',
    '{"version":2,"placements":{}}',
    '{"version":1,"placements":[]}',
    '{"version":1,"placements":{"pa-1":{"deviceId":"d1","organizationId":"o","placedAtMs":-1}}}',
    '{"version":1,"placements":{"bad/id":{"deviceId":"d1","organizationId":"o","placedAtMs":1}}}',
    '{"version":1,"placements":{"pa-1":{"deviceId":"d1","organizationId":"o","placedAtMs":1},"pa-2":null}}',
  ])(
    'invalid placement snapshots refuse startup without changing the file: %s',
    async (invalid) => {
      const file = await fileIn();
      const seed = new PlacementStore(file);
      await seed.set('pa-1', {
        deviceId: 'd1',
        organizationId: 'o',
        placedAtMs: 1,
      });
      await writeFile(file, invalid);
      const store = new PlacementStore(file);
      const error: unknown = await store.load().catch((err: unknown) => err);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
        message: `Invalid device placement snapshot at ${file}`,
      });
      expect(store.get('pa-1')).toBeUndefined();
      expect(await readFile(file, 'utf8')).toBe(invalid);
      expect(await readdir(join(file, '..'))).toEqual(['placements.json']);
    },
  );

  test('a failed write neither publishes a route nor forgets one and later writes can recover', async () => {
    const file = await fileIn();
    const store = new PlacementStore(file);
    const placement = { deviceId: 'd1', organizationId: 'o', placedAtMs: 1 };
    await store.set('pa-1', placement);
    await rename(file, `${file}.saved`);
    await mkdir(file);
    expect(
      await store.set('pa-2', placement).catch((err: unknown) => err),
    ).toBeInstanceOf(Error);
    expect(store.get('pa-2')).toBeUndefined();
    expect(
      await store.delete('pa-1').catch((err: unknown) => err),
    ).toBeInstanceOf(Error);
    expect(store.get('pa-1')).toEqual(placement);
    expect(
      (await readdir(join(file, '..'))).filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
    await rm(file, { recursive: true });
    await rename(`${file}.saved`, file);
    await store.set('pa-3', placement);
    const restarted = new PlacementStore(file);
    await restarted.load();
    expect(restarted.forOrganization('o').map((p) => p.sessionId)).toEqual([
      'pa-1',
      'pa-3',
    ]);
  });

  test('a failed directory flush retains the renamed snapshot for subsequent mutations', async () => {
    const file = await fileIn();
    const store = new PlacementStore(file);
    const placement = { deviceId: 'd1', organizationId: 'o', placedAtMs: 1 };
    await store.set('pa-1', placement);
    const flushDirectory: unknown = Reflect.get(store, 'flushDirectory');
    Reflect.set(store, 'flushDirectory', async () => {
      throw new Error('directory flush failed after rename');
    });
    expect(
      await store.set('pa-2', placement).catch((err: unknown) => err),
    ).toMatchObject({ message: 'directory flush failed after rename' });
    expect(store.get('pa-2')).toEqual(placement);
    const renamed = new PlacementStore(file);
    await renamed.load();
    expect(renamed.get('pa-2')).toEqual(placement);

    Reflect.set(store, 'flushDirectory', flushDirectory);
    await store.set('pa-3', placement);
    const restarted = new PlacementStore(file);
    await restarted.load();
    expect(restarted.forOrganization('o').map((p) => p.sessionId)).toEqual([
      'pa-1',
      'pa-2',
      'pa-3',
    ]);
  });
});
