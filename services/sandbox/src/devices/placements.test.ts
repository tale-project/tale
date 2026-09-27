import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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

  test('an unreadable file is moved aside, not trusted and not fatal', async () => {
    const file = await fileIn();
    const seed = new PlacementStore(file);
    await seed.set('pa-1', {
      deviceId: 'd1',
      organizationId: 'o',
      placedAtMs: 1,
    });
    await writeFile(file, '{not json');
    const store = new PlacementStore(file);
    await store.load();
    expect(store.get('pa-1')).toBeUndefined();
    const names = await readdir(join(file, '..'));
    expect(names.some((n) => n.startsWith('placements.json.corrupt-'))).toBe(
      true,
    );
  });
});
