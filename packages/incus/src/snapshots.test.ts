// Volume snapshots and the restore-aside sequence they serve: snapshot,
// detach the device under its ETag, rename the volume aside (its snapshot
// history moves with it), copy a snapshot into a fresh volume, attach it
// again. A rename of a volume anything uses is refused.

import { describe, expect, test } from 'bun:test';

import { FakeIncus } from './fake.ts';
import { readFile, writeFile } from './files.ts';
import {
  copyVolumeFromSnapshot,
  createVolumeSnapshot,
  deleteVolumeSnapshot,
  listVolumeSnapshots,
} from './snapshots.ts';
import {
  attachDisk,
  detachDevice,
  getStoragePoolResources,
  renameVolume,
} from './volumes.ts';

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`rejected with a non-Error: ${String(error)}`, {
      cause: error,
    });
  }
  throw new Error('expected the promise to reject');
}

function setup() {
  const fake = new FakeIncus({ project: 'stack' });
  fake.seedVolume('db-data', { 'security.shifted': 'true' });
  fake.seedInstance(
    'db',
    {},
    {
      ephemeral: false,
      status: 'Stopped',
      devices: {
        data: {
          type: 'disk',
          pool: 'tank',
          source: 'db-data',
          path: '/var/lib/postgresql/data',
        },
      },
    },
  );
  return { fake, client: fake.client() };
}

const owner = { uid: 70, gid: 70, mode: '0600' };
const volume = { pool: 'tank', volume: 'db-data' };

describe('snapshots', () => {
  test('create, list oldest first, delete', async () => {
    const { fake, client } = setup();
    await createVolumeSnapshot(client, 'tank', 'db-data', 'set1');
    await createVolumeSnapshot(client, 'tank', 'db-data', 'set2', {
      expiresAt: new Date('2026-12-01T00:00:00Z'),
    });
    expect(
      fake.seen(
        'POST /1.0/storage-pools/tank/volumes/custom/db-data/snapshots',
      )[1]?.body,
    ).toEqual({
      name: 'set2',
      expires_at: '2026-12-01T00:00:00.000Z',
    });
    const listed = await listVolumeSnapshots(client, 'tank', 'db-data');
    expect(listed.map((snapshot) => snapshot.name)).toEqual(['set1', 'set2']);
    expect(listed[0]?.expiresAtMs).toBe(0);
    expect(listed[1]?.expiresAtMs).toBe(Date.parse('2026-12-01T00:00:00Z'));
    expect(listed[0]?.config['security.shifted']).toBe('true');
    expect(await deleteVolumeSnapshot(client, 'tank', 'db-data', 'set1')).toBe(
      true,
    );
    expect(await deleteVolumeSnapshot(client, 'tank', 'db-data', 'set1')).toBe(
      false,
    );
  });

  test('a snapshot name a path could misread is refused', async () => {
    const { fake, client } = setup();
    expect(
      (await rejection(createVolumeSnapshot(client, 'tank', 'db-data', '../x')))
        .message,
    ).toContain('snapshot name');
    expect(fake.requests).toEqual([]);
  });
});

describe('restore aside', () => {
  test('detach, rename with its history, copy a snapshot into a fresh volume, attach', async () => {
    const { fake, client } = setup();
    await writeFile(client, volume, '/counter', '1', owner);
    await createVolumeSnapshot(client, 'tank', 'db-data', 'set1');
    await writeFile(client, volume, '/counter', '2', owner);

    // A rename while attached is refused before Incus is asked.
    expect(
      (
        await rejection(
          renameVolume(client, 'tank', 'db-data', 'db-data.pre-restore-1'),
        )
      ).message,
    ).toContain('detach it before a rename');
    expect(
      fake.seen('POST /1.0/storage-pools/tank/volumes/custom/db-data'),
    ).toEqual([]);

    const read = await client.getInstance('db');
    if (read?.etag === undefined) throw new Error('no ETag');
    expect(
      await detachDevice(client, 'db', 'data', { ifMatch: read.etag }),
    ).toBe(true);
    const [put] = fake.seen('PUT /1.0/instances/db');
    expect(put?.headers['if-match']).toBe(read.etag);
    expect(fake.instances.get('db')?.devices.data).toBeUndefined();

    await renameVolume(client, 'tank', 'db-data', 'db-data.pre-restore-1');
    expect(
      (await listVolumeSnapshots(client, 'tank', 'db-data.pre-restore-1')).map(
        (snapshot) => snapshot.name,
      ),
    ).toEqual(['set1']);

    await copyVolumeFromSnapshot(
      client,
      'tank',
      { volume: 'db-data.pre-restore-1', snapshot: 'set1' },
      'db-data',
    );
    const copied = fake.volumes.get('db-data');
    expect(copied?.config['security.shifted']).toBe('true');
    expect(copied?.snapshots).toEqual([]);
    const counter = await readFile(client, volume, '/counter');
    expect(
      counter?.type === 'file' && new TextDecoder().decode(counter.content),
    ).toBe('1');

    const again = await client.getInstance('db');
    if (again?.etag === undefined) throw new Error('no ETag');
    await attachDisk(
      client,
      'db',
      'data',
      { pool: 'tank', source: 'db-data', path: '/var/lib/postgresql/data' },
      { ifMatch: again.etag },
    );
    expect(fake.instances.get('db')?.devices.data).toEqual({
      type: 'disk',
      pool: 'tank',
      source: 'db-data',
      path: '/var/lib/postgresql/data',
    });
  });

  test('a rename waits out a volume Incus still holds mounted, and no longer', async () => {
    const { fake, client } = setup();
    fake.seedVolume('free', {});
    const busy = 'Failed to rename "a" to "b": device or resource busy';
    fake.fail({
      match: 'POST /1.0/storage-pools/tank/volumes/custom/free',
      status: 500,
      message: busy,
      times: 2,
    });
    await renameVolume(client, 'tank', 'free', 'free.aside', {
      busyPauseMs: 1,
    });
    expect(fake.volumes.has('free.aside')).toBe(true);
    expect(
      fake.seen('POST /1.0/storage-pools/tank/volumes/custom/free'),
    ).toHaveLength(3);

    fake.seedVolume('stuck', {});
    fake.fail({
      match: 'POST /1.0/storage-pools/tank/volumes/custom/stuck',
      status: 500,
      message: busy,
      times: 100,
    });
    const error = await rejection(
      renameVolume(client, 'tank', 'stuck', 'stuck.aside', {
        busyWaitMs: 20,
        busyPauseMs: 5,
      }),
    );
    expect(error.message).toContain('busy');
    fake.fail({
      match: 'POST /1.0/storage-pools/tank/volumes/custom/other',
      status: 500,
      message: 'disk on fire',
    });
    fake.seedVolume('other', {});
    expect(
      (
        await rejection(
          renameVolume(client, 'tank', 'other', 'x', { busyPauseMs: 1 }),
        )
      ).message,
    ).toContain('disk on fire');
    expect(
      fake.seen('POST /1.0/storage-pools/tank/volumes/custom/other'),
    ).toHaveLength(1);
  });

  test('a stale ETag changes nothing, on detach and on attach', async () => {
    const { fake, client } = setup();
    const read = await client.getInstance('db');
    if (read?.etag === undefined) throw new Error('no ETag');
    await client.patchInstance('db', { config: { 'user.x': '1' } });
    expect(
      (
        await rejection(
          detachDevice(client, 'db', 'data', { ifMatch: read.etag }),
        )
      ).message,
    ).toContain('ETag');
    expect(fake.seen('PUT /1.0/instances/db')).toEqual([]);
    expect(
      (
        await rejection(
          attachDisk(
            client,
            'db',
            'other',
            { pool: 'tank', source: 'db-data', path: '/x', readonly: true },
            { ifMatch: read.etag },
          ),
        )
      ).message,
    ).toContain('412');
    expect(fake.instances.get('db')?.devices.data).toBeDefined();
  });

  test('a device that is not there is no detach', async () => {
    const { client } = setup();
    const read = await client.getInstance('db');
    if (read?.etag === undefined) throw new Error('no ETag');
    expect(
      await detachDevice(client, 'db', 'nope', { ifMatch: read.etag }),
    ).toBe(false);
  });

  test('the pool says how much room it has', async () => {
    const { client } = setup();
    expect(await getStoragePoolResources(client, 'tank')).toEqual({
      space: { used: 1024 ** 3, total: 100 * 1024 ** 3 },
      inodes: { used: 1000, total: 1_000_000 },
    });
  });
});
