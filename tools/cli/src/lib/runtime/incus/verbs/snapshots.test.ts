import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FakeIncus, FakeVolume } from '@tale/incus/fake';

import { SNAPSHOT_VOLUMES } from '../../../backup/constants';
import {
  nativeSnapshotName,
  type SnapshotManifest,
} from '../../../backup/manifest';
import { REQUIRED_VOLUMES } from '../../../compose/generators/constants';
import type { HealthState } from '../../types';
import { clientOf, stackIncus } from '../apply/apply-fixture';
import {
  assertNoRestorePending,
  readJournal,
  type RestoreStep,
} from '../apply/journal';
import { BACKUPS_VOLUME } from '../apply/readback';
import { RUNTIME_VOLUMES } from '../compile/translate';
import { runOneShot } from './oneshot';
import {
  FILE_CHUNK_BYTES,
  holderName,
  IncusSnapshotStore,
  type SnapshotStoreOptions,
} from './snapshots';
import { seedStackInstance, STACK } from './verbs-fixture';

// The Incus runtime needs a POSIX host and is refused on Windows
// (assertIncusPlatform): its plan key, journal, credentials and copies are
// held by owner and mode, which Windows files do not carry.
const describePosix = describe.skipIf(process.platform === 'win32');

const POOL = 'tale';
const HELPER = 'tale-proxy-helper';
const ID = '20261113-100000-manual';
const SNAP = nativeSnapshotName(ID);

let fake: FakeIncus;
let stateRoot: string;

beforeEach(() => {
  fake = stackIncus();
  fake.addImage(HELPER);
  stateRoot = mkdtempSync(join(tmpdir(), 'tale-incus-snapshots-'));
});
afterEach(() => {
  fake.close();
  rmSync(stateRoot, { recursive: true, force: true });
});

function seedData(name: string, text: string, size = '1GiB'): FakeVolume {
  const seeded = fake.seedVolume(name, {
    'user.tale.stack': STACK,
    'user.tale.volume': name,
    'user.tale.kind': 'data',
    'security.shifted': 'true',
    size,
  });
  seeded.files = new Map([
    [
      '/data.txt',
      { content: text, mode: '0600', uid: 999, gid: 999, type: 'file' },
    ],
  ]);
  return seeded;
}

function content(name: string): string | undefined {
  // The fake's volumes are read back through the file API like Incus.
  return fakeVolume(name)?.files?.get('/data.txt')?.content;
}

function fakeVolume(name: string): FakeVolume | undefined {
  return (fake as unknown as { volumes: Map<string, FakeVolume> }).volumes.get(
    name,
  );
}

function disk(source: string, path: string) {
  return { type: 'disk', pool: POOL, source, path };
}

/** db on db-data; backend and platform on config-data; backups. */
function seedStack(): void {
  seedData('db-data', 'rows v1');
  seedData('config-data', 'config v1');
  fake.seedVolume(BACKUPS_VOLUME, {
    'user.tale.stack': STACK,
    'user.tale.kind': 'data',
  });
  seedStackInstance(fake, 'db', {
    devices: { 'db-data': disk('db-data', '/var/lib/postgresql/data') },
  });
  seedStackInstance(fake, 'backend', {
    devices: { 'config-data': disk('config-data', '/app/data') },
  });
  seedStackInstance(fake, 'platform', {
    devices: {
      'config-data': { ...disk('config-data', '/app/data'), readonly: 'true' },
    },
  });
}

function store(
  overrides: Partial<SnapshotStoreOptions> = {},
): IncusSnapshotStore {
  // The fake's own client also answers the websocket exec a helper runs.
  const client = fake.client();
  const context = { client, stack: STACK, stateRoot };
  return new IncusSnapshotStore({
    client,
    pool: POOL,
    stack: STACK,
    stateRoot,
    health: async () => 'none',
    healthcheck: () => ({ disabled: true }),
    oneShot: (job) =>
      runOneShot(context, job, {
        image: HELPER,
        pool: POOL,
        active: new Set(),
      }),
    helperImage: 'tale-proxy',
    sleep: async () => undefined,
    ...overrides,
  });
}

/** Take a set `SNAP` of db-data and config-data and write its manifest. */
async function takeSet(target = store()): Promise<SnapshotManifest> {
  const set = await target.snapshot(['db-data', 'config-data'], SNAP);
  const manifest: SnapshotManifest = {
    schemaVersion: 2,
    id: ID,
    createdAt: '2026-11-13T10:00:00.000Z',
    cliVersion: '1.0.0',
    platformVersion: '0.5.9',
    trigger: 'manual',
    runtime: 'incus',
    freeze: set.freeze,
    volumes: Object.fromEntries(
      set.snapshots.map((snapshot) => [
        snapshot.volume,
        {
          native: {
            snapshot: snapshot.snapshot,
            createdAt: snapshot.createdAt,
            usedBytes: snapshot.usedBytes,
            quotaBytes: snapshot.quotaBytes,
          },
        },
      ]),
    ),
  };
  await target.writeManifest(manifest);
  return manifest;
}

function writeLive(name: string, value: string): void {
  const file = fakeVolume(name)?.files?.get('/data.txt');
  if (file === undefined) throw new Error(`no data in ${name}`);
  file.content = value;
  delete file.bytes;
}

function signatures(match: string): string[] {
  return fake.seen(match).map((request) => `${request.method} ${request.path}`);
}

describePosix('a snapshot set (D-28, R3-16)', () => {
  test('freezes every running user, snapshots every volume, then thaws: each phase in parallel', async () => {
    seedStack();
    const release = fake.hold(
      'POST /1.0/storage-pools/tale/volumes/custom/*/snapshots',
    );
    const pending = store().snapshot(['db-data', 'config-data'], SNAP);
    for (
      let i = 0;
      i < 200 &&
      fake.seen('POST /1.0/storage-pools/tale/volumes/custom/*/snapshots')
        .length < 2;
      i += 1
    )
      await Bun.sleep(1);
    // Both snapshot calls are out before either is answered, and every user
    // is frozen by then.
    expect(
      fake.seen('POST /1.0/storage-pools/tale/volumes/custom/*/snapshots'),
    ).toHaveLength(2);
    const freezes = fake
      .seen('PUT /1.0/instances/*/state')
      .filter(
        (request) => (request.body as { action?: string }).action === 'freeze',
      );
    expect(freezes.map((request) => request.path).sort()).toEqual([
      '/1.0/instances/backend/state',
      '/1.0/instances/db/state',
      '/1.0/instances/platform/state',
    ]);
    expect(
      fake
        .seen('PUT /1.0/instances/*/state')
        .some(
          (request) =>
            (request.body as { action?: string }).action === 'unfreeze',
        ),
    ).toBe(false);
    release();
    const set = await pending;
    expect(set.frozenCount).toBe(3);
    expect(
      set.snapshots.map((snapshot) => [snapshot.volume, snapshot.snapshot]),
    ).toEqual([
      ['db-data', SNAP],
      ['config-data', SNAP],
    ]);
    expect(set.snapshots[0]?.quotaBytes).toBe(1024 ** 3);
    expect(set.snapshots[0]?.usedBytes).toBe('rows v1'.length);
    for (const name of ['db', 'backend', 'platform'])
      expect((await clientOf(fake).getInstance(name))?.instance.status).toBe(
        'Running',
      );
  });

  test('sends the freeze calls together, and the thaw calls together (R3-16)', async () => {
    seedStack();
    const snapshots = 'POST /1.0/storage-pools/tale/volumes/custom/*/snapshots';
    const stateCalls = (action: string) =>
      fake
        .seen('PUT /1.0/instances/*/state')
        .filter(
          (request) => (request.body as { action?: string }).action === action,
        );
    const waitUntil = async (done: () => boolean) => {
      for (let i = 0; i < 500 && !done(); i += 1) await Bun.sleep(1);
    };
    const freezes = fake.hold('PUT /1.0/instances/*/state');
    const held = fake.hold(snapshots);
    const pending = store().snapshot(['db-data', 'config-data'], SNAP);
    await waitUntil(() => stateCalls('freeze').length >= 3);
    // All three are out while none is answered.
    expect(stateCalls('freeze')).toHaveLength(3);
    freezes();
    await waitUntil(() => fake.seen(snapshots).length >= 2);
    const thaws = fake.hold('PUT /1.0/instances/*/state');
    held();
    await waitUntil(() => stateCalls('unfreeze').length >= 3);
    expect(stateCalls('unfreeze')).toHaveLength(3);
    thaws();
    expect((await pending).frozenCount).toBe(3);
  });

  test('holds data volumes only: the CLI-owned volumes, backups and holders are refused (D-28a, R-07)', async () => {
    seedStack();
    for (const name of [
      ...Object.keys(RUNTIME_VOLUMES),
      BACKUPS_VOLUME,
      'db-data.pre-restore-20261113000000',
    ])
      await expect(store().snapshot([name], SNAP)).rejects.toThrow(/never/);
    // What a set may hold is the data the deploy keeps: never one the CLI
    // renders, never the backups.
    for (const name of SNAPSHOT_VOLUMES) {
      expect(Object.keys(RUNTIME_VOLUMES)).not.toContain(name);
      expect(name).not.toBe(BACKUPS_VOLUME);
      expect([...REQUIRED_VOLUMES, 'knowledge-db-data']).toContain(name);
    }
  });

  test('a failed snapshot deletes the ones the set took, and thaws the users', async () => {
    seedStack();
    fake.fail({
      match:
        'POST /1.0/storage-pools/tale/volumes/custom/config-data/snapshots',
      status: 500,
      message: 'out of space',
    });
    await expect(
      store().snapshot(['db-data', 'config-data'], SNAP),
    ).rejects.toThrow(/out of space/);
    expect(fakeVolume('db-data')?.snapshots ?? []).toEqual([]);
    for (const name of ['db', 'backend', 'platform'])
      expect((await clientOf(fake).getInstance(name))?.instance.status).toBe(
        'Running',
      );
  });

  test('a user whose health the freeze took away fails the set after the thaw', async () => {
    seedStack();
    let reads = 0;
    let clock = Date.parse('2026-11-13T10:00:00.000Z');
    const health = async (name: string): Promise<HealthState> => {
      if (name !== 'db') return 'none';
      reads += 1;
      return reads === 1 ? 'healthy' : 'unhealthy';
    };
    await expect(
      store({
        health,
        now: () => new Date(clock),
        sleep: async (ms) => {
          clock += ms;
        },
        healthcheck: () => ({
          test: ['CMD', 'true'],
          intervalMs: 0,
          timeoutMs: 0,
          retries: 1,
          startPeriodMs: 0,
        }),
      }).snapshot(['db-data'], SNAP),
    ).rejects.toThrow(/db did not report healthy again/);
    expect((await clientOf(fake).getInstance('db'))?.instance.status).toBe(
      'Running',
    );
  });

  test('is refused while a restore is pending', async () => {
    seedStack();
    await takeSet();
    await store({
      afterRestoreStep: (_volume, step) => {
        if (step === 'renamed') throw new Error('crash');
      },
    })
      .restore(ID, ['db-data'])
      .catch(() => undefined);
    await expect(
      store().snapshot(['config-data'], 'tale-20261113-110000-manual'),
    ).rejects.toThrow(/restore of snapshot .* is not finished/);
  });
});

describePosix('manifests by generation (R3-29)', () => {
  test('a new generation replaces the old after it reads back', async () => {
    seedStack();
    const target = store();
    const manifest = await takeSet(target);
    await target.writeManifest({ ...manifest, platformVersion: '0.5.10' });
    const files = [...(fakeVolume(BACKUPS_VOLUME)?.files?.keys() ?? [])].filter(
      (path) => path.startsWith(`/${ID}/`),
    );
    expect(files).toEqual([`/${ID}/manifest.2.json`]);
    expect((await target.readManifest(ID))?.manifest.platformVersion).toBe(
      '0.5.10',
    );
  });

  test('writes the new generation and reads it back before the old one goes', async () => {
    seedStack();
    const target = store();
    const manifest = await takeSet(target);
    const files = `/1.0/storage-pools/${POOL}/volumes/custom/${BACKUPS_VOLUME}/files`;
    const before = fake.seen(`* ${files}`).length;
    await target.writeManifest({ ...manifest, platformVersion: '0.5.10' });
    const calls = fake
      .seen(`* ${files}`)
      .slice(before)
      .map((request) => `${request.method} ${request.query.path ?? ''}`);
    const write = calls.indexOf(`POST /${ID}/manifest.2.json`);
    const readBack = calls.lastIndexOf(`GET /${ID}/manifest.2.json`);
    const removeOld = calls.indexOf(`DELETE /${ID}/manifest.1.json`);
    expect(write).toBeGreaterThanOrEqual(0);
    expect(readBack).toBeGreaterThan(write);
    expect(removeOld).toBeGreaterThan(readBack);
  });

  test('a torn newest generation leaves the one before it in force', async () => {
    seedStack();
    const target = store();
    await takeSet(target);
    fakeVolume(BACKUPS_VOLUME)?.files?.set(`/${ID}/manifest.7.json`, {
      content: '{"schemaVersion":2,"id":"2026',
      mode: '0600',
      type: 'file',
    });
    const read = await target.readManifest(ID);
    expect(read?.generation).toBe(1);
    expect(
      (await target.listManifests()).map((manifest) => manifest.id),
    ).toEqual([ID]);
  });

  test('a directory without a manifest is torn and never listed', async () => {
    seedStack();
    const target = store();
    await takeSet(target);
    fakeVolume(BACKUPS_VOLUME)?.files?.set(
      '/20261112-090000-deploy/db-data.tar.gz',
      {
        content: 'partial',
        mode: '0600',
        type: 'file',
      },
    );
    expect(await target.manifestlessDirectories()).toEqual([
      '20261112-090000-deploy',
    ]);
    expect(
      (await target.listManifests()).map((manifest) => manifest.id),
    ).toEqual([ID]);
  });
});

describePosix('restore aside (D-29, R3-08, R3-22)', () => {
  test('stops, detaches, renames, copies, attaches and starts, in that order; the manifest follows the holder', async () => {
    seedStack();
    await takeSet();
    writeLive('db-data', 'rows v2');
    const before = fake.requests.length;
    await store({ now: () => new Date('2026-11-13T11:00:00.000Z') }).restore(
      ID,
      ['db-data'],
    );

    expect(content('db-data')).toBe('rows v1');
    const holder = 'db-data.pre-restore-20261113110000';
    expect(content(holder)).toBe('rows v2');
    // The history moved with the rename, and the manifest names the holder.
    expect(
      fakeVolume(holder)?.snapshots?.map((snapshot) => snapshot.name),
    ).toEqual([SNAP]);
    expect(fakeVolume('db-data')?.snapshots ?? []).toEqual([]);
    const manifest = (await store().readManifest(ID))?.manifest;
    expect(manifest?.volumes['db-data']?.native?.volume).toBe(holder);
    expect(manifest?.volumes['config-data']?.native?.volume).toBeUndefined();

    const order = fake.requests.slice(before).flatMap((request) => {
      const body = request.body as
        | { action?: string; source?: unknown; name?: string }
        | undefined;
      if (
        request.method === 'PUT' &&
        request.path === '/1.0/instances/db/state'
      )
        return [`${body?.action}`];
      if (request.method === 'PUT' && request.path === '/1.0/instances/db')
        return ['detach'];
      if (request.method === 'POST' && request.path.endsWith('/custom/db-data'))
        return ['rename'];
      if (
        request.method === 'POST' &&
        request.path.endsWith('/volumes/custom') &&
        body?.source
      )
        return ['copy'];
      if (
        request.method === 'PATCH' &&
        request.path === '/1.0/instances/db' &&
        JSON.stringify(request.body).includes('devices')
      )
        return ['attach'];
      return [];
    });
    expect(order).toEqual([
      'stop',
      'detach',
      'rename',
      'copy',
      'attach',
      'start',
    ]);
    // The copy names the snapshot's size: a project with a pool quota
    // refuses one without (Incus 7.6, measured in the lane's lab run).
    const copy = fake
      .seen('POST /1.0/storage-pools/tale/volumes/custom')
      .find(
        (request) =>
          (request.body as { source?: unknown }).source !== undefined,
      );
    if (copy === undefined) throw new Error('no copy was sent');
    expect(
      (copy.body as { config?: Record<string, string> }).config?.size,
    ).toBe('1GiB');
    const db = await clientOf(fake).getInstance('db');
    expect(db?.instance.status).toBe('Running');
    expect(db?.instance.devices['db-data']).toMatchObject({
      source: 'db-data',
      path: '/var/lib/postgresql/data',
    });
    expect((await readJournal(stateRoot))?.restorePending).toBeNull();
    // Only the volume restored was touched; config-data's users ran on.
    expect(signatures('PUT /1.0/instances/backend')).toEqual([]);
  });

  test('a second restore from the same snapshot follows the manifest to the holder', async () => {
    seedStack();
    await takeSet();
    let tick = 0;
    const now = () =>
      new Date(Date.parse('2026-11-13T11:00:00.000Z') + 1000 * tick++);
    writeLive('db-data', 'rows v2');
    await store({ now }).restore(ID, ['db-data']);
    writeLive('db-data', 'rows v3');
    await store({ now }).restore(ID, ['db-data']);
    expect(content('db-data')).toBe('rows v1');
    const holders = (await store().holders()).map((holder) => holder.volume);
    expect(holders).toHaveLength(2);
    expect(
      (await store().readManifest(ID))?.manifest.volumes['db-data']?.native
        ?.volume,
    ).toBe(holders[0]);
  });

  const steps: RestoreStep[] = [
    'stopped',
    'detached',
    'renamed',
    'copied',
    'attached',
    'started',
  ];

  for (const crashAt of steps) {
    test(`a crash after "${crashAt}" leaves restore-pending, refuses deploy and start, and --resume finishes it`, async () => {
      seedStack();
      await takeSet();
      writeLive('db-data', 'rows v2');
      await expect(
        store({
          afterRestoreStep: (name, step) => {
            if (name === 'db-data' && step === crashAt)
              throw new Error(`crash after ${step}`);
          },
        }).restore(ID, ['db-data']),
      ).rejects.toThrow(`crash after ${crashAt}`);
      const journal = await readJournal(stateRoot);
      expect(journal?.restorePending?.steps['db-data']).toBe(crashAt);
      expect(() => assertNoRestorePending(journal, 'deploy')).toThrow(
        /tale deploy waits/,
      );
      expect(() => assertNoRestorePending(journal, 'start')).toThrow(
        /tale start waits/,
      );
      // A missing volume is never there as an empty one.
      expect(['rows v2', 'rows v1', undefined]).toContain(content('db-data'));

      await store().finish();
      expect(content('db-data')).toBe('rows v1');
      expect((await clientOf(fake).getInstance('db'))?.instance.status).toBe(
        'Running',
      );
      expect(
        (await clientOf(fake).getInstance('db'))?.instance.devices['db-data']
          ?.source,
      ).toBe('db-data');
      expect((await readJournal(stateRoot))?.restorePending).toBeNull();
      expect(
        (await store().holders()).map((holder) => holder.referencedBy),
      ).toEqual([[ID]]);
    });

    test(`a crash after "${crashAt}" can be undone with --abort: every volume is back as it was`, async () => {
      seedStack();
      await takeSet();
      writeLive('db-data', 'rows v2');
      await store({
        afterRestoreStep: (name, step) => {
          if (name === 'db-data' && step === crashAt) throw new Error('crash');
        },
      })
        .restore(ID, ['db-data'])
        .catch(() => undefined);

      await store().abort();
      expect(content('db-data')).toBe('rows v2');
      expect(
        fakeVolume('db-data')?.snapshots?.map((snapshot) => snapshot.name),
      ).toEqual([SNAP]);
      expect(await store().holders()).toEqual([]);
      expect(
        (await store().readManifest(ID))?.manifest.volumes['db-data']?.native
          ?.volume,
      ).toBeUndefined();
      const db = await clientOf(fake).getInstance('db');
      expect(db?.instance.status).toBe('Running');
      expect(db?.instance.devices['db-data']?.source).toBe('db-data');
      expect((await readJournal(stateRoot))?.restorePending).toBeNull();
    });
  }

  test('a second restore, --resume and --abort refuse in words when nothing or something else is pending', async () => {
    seedStack();
    await takeSet();
    await expect(store().finish()).rejects.toThrow(/No restore is pending/);
    await expect(store().abort()).rejects.toThrow(/No restore is pending/);
    await store({
      afterRestoreStep: (_volume, step) => {
        if (step === 'detached') throw new Error('crash');
      },
    })
      .restore(ID, ['db-data'])
      .catch(() => undefined);
    await expect(store().restore(ID, ['config-data'])).rejects.toThrow(
      /is not finished/,
    );
  });

  test('too little pool space is refused before anything changes', async () => {
    seedStack();
    await takeSet();
    fake.poolResources = {
      space: { used: 100 * 1024 ** 3 - 5, total: 100 * 1024 ** 3 },
      inodes: { used: 0, total: 0 },
    };
    const before = fake.requests.length;
    await expect(store().restore(ID, ['db-data'])).rejects.toThrow(
      /has 5 bytes free, and the copies need 8/,
    );
    expect(
      fake.requests.slice(before).filter((request) => request.method !== 'GET'),
    ).toEqual([]);
    expect((await readJournal(stateRoot))?.restorePending ?? null).toBeNull();
  });

  test("the project's pool quota is checked for every copy", async () => {
    seedStack();
    await takeSet();
    fake.projectConfig['limits.disk.pool.tale'] = '3GiB';
    await expect(
      store().restore(ID, ['db-data', 'config-data']),
    ).rejects.toThrow(
      /limits\.disk\.pool\.tale quota, and the copies count 2362232013/,
    );
    expect(content('db-data')).toBe('rows v1');
  });

  test('a pool room the certificate cannot read is a refusal that names it', async () => {
    seedStack();
    await takeSet();
    fake.fail({
      match: 'GET /1.0/storage-pools/tale/resources',
      status: 403,
      message: 'not allowed',
      times: 10,
    });
    await expect(store().restore(ID, ['db-data'])).rejects.toThrow(
      /GET \/1\.0\/storage-pools\/tale\/resources\) could not be read/,
    );
    expect((await readJournal(stateRoot))?.restorePending ?? null).toBeNull();
  });

  test('a quota the certificate cannot read is a refusal that names it', async () => {
    seedStack();
    await takeSet();
    fake.fail({
      match: 'GET /1.0/projects/*/state',
      status: 403,
      message: 'not allowed',
      times: 10,
    });
    await expect(store().restore(ID, ['db-data'])).rejects.toThrow(
      /GET \/1\.0\/projects\/tale-stack\/state\) could not be read/,
    );
    expect(content('db-data')).toBe('rows v1');
  });

  test('an archive restore extracts into a fresh volume through the helper, owners as numbers', async () => {
    seedStack();
    const manifest = await takeSet();
    const volumes = structuredClone(manifest.volumes);
    const info = volumes['db-data'];
    if (info === undefined) throw new Error('no db-data');
    delete info.native;
    Object.assign(info, { sha256: 'a'.repeat(64), sizeBytes: 10 });
    await store().writeManifest({ ...manifest, volumes });
    const argv: string[][] = [];
    fake.exec = (call) => {
      argv.push(call.argv);
      return 0;
    };
    await store({ now: () => new Date('2026-11-13T11:00:00.000Z') }).restore(
      ID,
      ['db-data'],
    );
    expect(
      argv.some((command) =>
        command
          .join(' ')
          .includes(
            `tar xzf /backup/${ID}/db-data.tar.gz --numeric-owner -C /data`,
          ),
      ),
    ).toBe(true);
    expect(fakeVolume('db-data')?.config.size).toBe('1GiB');
    expect(fakeVolume('db-data.pre-restore-20261113110000')).toBeDefined();
  });
});

describePosix('an archived set whose native snapshots are gone (R-05)', () => {
  /** The set archived (both kinds recorded), then the volume deleted and
   * made anew: what `reset --all` and the next deploy leave behind. */
  async function archivedThenReset(): Promise<SnapshotManifest> {
    seedStack();
    const manifest = await takeSet();
    const volumes = structuredClone(manifest.volumes);
    for (const info of Object.values(volumes))
      Object.assign(info, { sha256: 'a'.repeat(64), sizeBytes: 10 });
    const archived = { ...manifest, volumes };
    await store().writeManifest(archived);
    await store().deleteNativeSnapshot('db-data', SNAP);
    await store().deleteNativeSnapshot('config-data', SNAP);
    return archived;
  }

  test('verifies: the archives stand in for the snapshots the reset took', async () => {
    const archived = await archivedThenReset();
    expect(await store().verifyNative(archived)).toEqual([]);
  });

  test('restores from the archive instead of refusing the missing snapshot', async () => {
    await archivedThenReset();
    const argv: string[][] = [];
    fake.exec = (call) => {
      argv.push(call.argv);
      return 0;
    };
    await store({ now: () => new Date('2026-11-13T11:00:00.000Z') }).restore(
      ID,
      ['db-data'],
    );
    expect(
      argv.some((command) =>
        command
          .join(' ')
          .includes(
            `tar xzf /backup/${ID}/db-data.tar.gz --numeric-owner -C /data`,
          ),
      ),
    ).toBe(true);
    expect(fakeVolume('db-data.pre-restore-20261113110000')).toBeDefined();
    expect((await readJournal(stateRoot))?.restorePending ?? null).toBeNull();
  });

  test('a set without an archive still refuses its missing snapshot', async () => {
    seedStack();
    await takeSet();
    await store().deleteNativeSnapshot('db-data', SNAP);
    await expect(store().restore(ID, ['db-data'])).rejects.toThrow(
      /Incus holds no such snapshot/,
    );
    expect(content('db-data')).toBe('rows v1');
  });
});

describePosix('holders, rotation and verification', () => {
  test('a holder stays while a manifest names a snapshot on it, and goes after', async () => {
    seedStack();
    await takeSet();
    await store({ now: () => new Date('2026-11-13T11:00:00.000Z') }).restore(
      ID,
      ['db-data'],
    );
    expect(await store().deleteUnreferencedHolders()).toEqual([]);
    await store().deleteNativeSnapshot(
      'db-data.pre-restore-20261113110000',
      SNAP,
    );
    await store().deleteSnapshotDirectory(ID);
    expect(await store().deleteUnreferencedHolders()).toEqual([
      'db-data.pre-restore-20261113110000',
    ]);
  });

  test('rotation deletes the snapshots of a set cut off before its manifest, never those of a set with a manifest file', async () => {
    seedStack();
    const kept = await takeSet();
    const cut = '20261113-090000-manual';
    const unread = '20261113-080000-manual';
    await store().snapshot(['db-data'], nativeSnapshotName(cut));
    await store().snapshot(['db-data'], nativeSnapshotName(unread));
    // A manifest this CLI cannot read (a newer schema): its set is kept.
    await store().writeVolumeFile(
      BACKUPS_VOLUME,
      `${unread}/manifest.1.json`,
      (async function* () {
        yield Buffer.from('{"schemaVersion":3}');
      })(),
    );
    expect(
      await store().deleteOrphanSnapshots([kept], '2100-01-01T00:00:00.000Z'),
    ).toEqual([`db-data/${nativeSnapshotName(cut)}`]);
    expect(
      await store().verifyNative(kept),
      'the kept set keeps its snapshots',
    ).toEqual([]);
    expect(
      await store().deleteOrphanSnapshots([kept], '2100-01-01T00:00:00.000Z'),
    ).toEqual([]);
    expect(
      fakeVolume('db-data')
        ?.snapshots?.map((snapshot) => snapshot.name)
        .sort(),
    ).toEqual([nativeSnapshotName(unread), SNAP]);
  });

  test('verifies each native snapshot where the manifest says, when it says, inside the freeze', async () => {
    seedStack();
    const manifest = await takeSet();
    expect(await store().verifyNative(manifest)).toEqual([]);
    const moved = structuredClone(manifest);
    const db = moved.volumes['db-data']?.native;
    if (db === undefined) throw new Error('no native db-data');
    db.createdAt = '2020-01-01T00:00:00.000Z';
    expect((await store().verifyNative(moved)).join()).toContain(
      'not 2020-01-01T00:00:00.000Z as recorded',
    );
    await store().deleteNativeSnapshot('config-data', SNAP);
    expect((await store().verifyNative(manifest)).join()).toContain(
      'config-data/tale-20261113-100000-manual is MISSING',
    );
  });

  test('names a holder per volume and start, never one that exists', () => {
    const at = new Date('2026-11-13T11:00:00.000Z');
    expect(holderName('db-data', at, new Set())).toBe(
      'db-data.pre-restore-20261113110000',
    );
    expect(
      holderName(
        'db-data',
        at,
        new Set(['db-data.pre-restore-20261113110000']),
      ),
    ).toBe('db-data.pre-restore-20261113110000-1');
  });
});

describePosix('the chunked volume file API', () => {
  test('writes a large file as one write and appends, and reads it back by ranges', async () => {
    fake.seedVolume(BACKUPS_VOLUME, { 'user.tale.stack': STACK });
    const size = 2 * FILE_CHUNK_BYTES + 12345;
    const data = new Uint8Array(size);
    for (let index = 0; index < size; index += 4096) data[index] = index % 251;
    async function* pieces() {
      for (let offset = 0; offset < size; offset += 1024 * 1024)
        yield data.slice(offset, offset + 1024 * 1024);
    }
    await store().writeVolumeFile(
      BACKUPS_VOLUME,
      `${ID}/db-data.tar.gz`,
      pieces(),
    );
    const writes = fake.seen(
      'POST /1.0/storage-pools/tale/volumes/custom/backups/files',
    );
    const fileWrites = writes.filter(
      (request) => request.headers['x-incus-type'] === 'file',
    );
    expect(
      fileWrites.map((request) => request.headers['x-incus-write']),
    ).toEqual(['overwrite', 'append', 'append']);
    const read: Uint8Array[] = [];
    await store().readVolumeFile(
      BACKUPS_VOLUME,
      `${ID}/db-data.tar.gz`,
      (chunk) => {
        read.push(chunk);
      },
    );
    expect(Buffer.compare(Buffer.concat(read), Buffer.from(data))).toBe(0);
    expect(read).toHaveLength(3);
    expect(
      fakeVolume(BACKUPS_VOLUME)?.files?.get(`/${ID}/db-data.tar.gz`),
    ).toMatchObject({ uid: 0, gid: 0, mode: '0600' });
  });

  test('refuses a path that leaves the volume', async () => {
    await expect(
      store().readVolumeFile(BACKUPS_VOLUME, '../etc/passwd', () => undefined),
    ).rejects.toThrow(/Not a file path/);
  });
});
