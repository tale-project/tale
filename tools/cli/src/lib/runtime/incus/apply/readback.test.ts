import { afterEach, describe, expect, test } from 'bun:test';

import { writeStackRecord } from './apply';
import {
  clientOf,
  converge,
  desiredOf,
  goldenTarget,
  recordingHooks,
  SENTINEL_SECRET,
  stackIncus,
  stateRootFixture,
  testKey,
} from './apply-fixture';
import {
  assertCustody,
  custodyOf,
  deployedBefore,
  instanceInfo,
  readStack,
  readStackRecord,
  resetSinceDeploy,
  stackInstances,
  type Readback,
} from './readback';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function deployed() {
  const fake = stackIncus();
  const client = clientOf(fake);
  const state = stateRootFixture();
  cleanups.push(state.remove, () => fake.close());
  const desired = desiredOf(goldenTarget('managed-compose'));
  await converge(client, recordingHooks(fake, client), state.root, desired);
  const readback = await readStack(client, {
    stack: 'tale',
    pool: 'tale',
    key: desired.key,
    files: desired.files.map((file) => ({
      volume: file.volume,
      path: file.path,
      write: file.write,
    })),
  });
  return { fake, client, desired, readback };
}

describe('custody verdicts', () => {
  test('by the stack label', () => {
    expect(custodyOf({ 'user.tale.stack': 'tale' }, 'tale')).toEqual({
      verdict: 'stack',
    });
    expect(custodyOf({ 'user.tale.stack': 'other' }, 'tale')).toEqual({
      verdict: 'foreign',
      stack: 'other',
    });
    expect(custodyOf({}, 'tale')).toEqual({ verdict: 'unlabelled' });
    expect(() =>
      assertCustody(
        'instance',
        'db',
        { verdict: 'foreign', stack: 'x' },
        'tale',
      ),
    ).toThrow('Instance db belongs to the stack x, not tale');
    expect(() =>
      assertCustody('volume', 'db-data', { verdict: 'unlabelled' }, 'tale'),
    ).toThrow('Volume db-data exists without a stack label');
    expect(() =>
      assertCustody('volume', 'db-data', { verdict: 'stack' }, 'tale'),
    ).not.toThrow();
  });
});

describe('the readback of a deployed stack', () => {
  test('reads instances with their ETag, volumes, aliases, files and the record', async () => {
    const { readback, desired } = await deployed();
    expect(readback.instances.map((instance) => instance.name)).toEqual(
      desired.target.instances.map((spec) => spec.name).sort(),
    );
    expect(
      readback.instances.every(
        (instance) =>
          instance.revision !== null && instance.custody.verdict === 'stack',
      ),
    ).toBe(true);
    expect(
      readback.volumes.find((volume) => volume.name === 'db-data')?.usedBy,
    ).toEqual(['db']);
    for (const image of desired.target.images)
      expect(readback.aliases[image.alias]).toMatch(/^[0-9a-f]{64}$/);
    expect(
      readback.files.find((file) => file.path === 'stack/hosts/records'),
    ).toMatchObject({ generation: 1, mode: 0o644, uid: 0 });
    expect(readback.record?.deployedAt).toBeDefined();
    expect(readback.manifests).toBe(false);
    expect(deployedBefore(readback)).toBe(true);
  });

  test('InstanceInfo carries the allow-listed environment and a digest, never a secret', async () => {
    const { readback, desired } = await deployed();
    const infos = stackInstances(readback, desired.key);
    expect(infos).toHaveLength(desired.target.instances.length);
    const platform = infos.find((info) => info.name === 'platform-1');
    expect(platform).toMatchObject({
      stack: 'tale',
      service: 'platform',
      index: 1,
      oneOff: false,
      running: true,
      state: 'running',
      address: '10.30.2.64',
    });
    expect(platform?.configDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(platform?.environmentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(platform?.mounts.map((mount) => mount.source).sort()).toEqual([
      'config-data',
      'static-assets',
    ]);
    const sandbox = infos.find((info) => info.name === 'sandbox');
    expect(sandbox?.environment.SANDBOX_BACKEND).toBe('incus');
    // The sentinel secret is in the instance's configuration, and in no
    // readback output.
    expect(
      readback.instances.some((instance) =>
        Object.values(instance.config).includes(SENTINEL_SECRET),
      ),
    ).toBe(true);
    expect(JSON.stringify(infos)).not.toContain(SENTINEL_SECRET);
    // Another key gives another environment digest.
    const other = instanceInfo(
      readback.instances.find((instance) => instance.name === 'platform-1')!,
      testKey(9),
    );
    expect(other.environmentDigest).not.toBe(platform?.environmentDigest);
  });

  test('a torn newer deploy record is passed over (R3-29)', async () => {
    const { fake, client } = await deployed();
    await writeStackRecord(client, 'tale', {
      schemaVersion: 1,
      stack: 'tale',
      deployedAt: '2026-11-13T11:00:00.000Z',
    });
    const backups = fake.volumes.get('backups');
    const files = backups?.files;
    if (!files) throw new Error('no backups files');
    expect([...files.keys()]).toEqual(['/stack.2.json']);
    files.set('/stack.3.json', {
      content: '{"schemaVersion":1,"st',
      mode: '0600',
    });
    expect((await readStackRecord(client, 'tale', 'tale'))?.deployedAt).toBe(
      '2026-11-13T11:00:00.000Z',
    );
    expect(await readStackRecord(client, 'tale', 'another')).toBeNull();
  });
});

describe('deployed before', () => {
  const empty: Readback = {
    stack: 'tale',
    pool: 'tale',
    instances: [],
    volumes: [],
    aliases: {},
    files: [],
    record: null,
    manifests: false,
  };

  test('reads every sign the brief names, and a reset after the last deploy', () => {
    expect(deployedBefore(empty)).toBe(false);
    expect(
      deployedBefore({
        ...empty,
        record: {
          schemaVersion: 1,
          stack: 'tale',
          deployedAt: '2026-11-01T00:00:00Z',
        },
      }),
    ).toBe(true);
    expect(deployedBefore({ ...empty, manifests: true })).toBe(true);
    expect(
      deployedBefore({
        ...empty,
        volumes: [
          {
            name: 'config-data.pre-restore-1',
            config: {},
            usedBy: [],
            custody: { verdict: 'stack' },
          },
        ],
      }),
    ).toBe(true);
    expect(
      deployedBefore({
        ...empty,
        instances: [
          {
            name: 'db',
            revision: null,
            status: 'Stopped',
            running: false,
            config: { 'user.tale.stack': 'tale' },
            devices: {},
            profiles: [],
            createdAt: '',
            custody: { verdict: 'stack' },
          },
        ],
      }),
    ).toBe(true);
    // Another stack's instance says nothing about this one.
    expect(
      deployedBefore({
        ...empty,
        instances: [
          {
            name: 'db',
            revision: null,
            status: 'Stopped',
            running: false,
            config: { 'user.tale.stack': 'other' },
            devices: {},
            profiles: [],
            createdAt: '',
            custody: { verdict: 'foreign', stack: 'other' },
          },
        ],
      }),
    ).toBe(false);
    expect(resetSinceDeploy(null)).toBe(false);
    expect(
      resetSinceDeploy({
        schemaVersion: 1,
        stack: 'tale',
        deployedAt: '2026-11-02T00:00:00.000Z',
        resetAt: '2026-11-01T00:00:00.000Z',
      }),
    ).toBe(false);
    expect(
      resetSinceDeploy({
        schemaVersion: 1,
        stack: 'tale',
        resetAt: '2026-11-01T00:00:00.000Z',
      }),
    ).toBe(true);
  });

  test('a manifest in a snapshot directory of backups counts', async () => {
    const { fake, client, desired } = await deployed();
    fake.volumes.get('backups')?.files?.set('/20261113-100000/manifest.json', {
      content: '{}',
      mode: '0600',
    });
    const readback = await readStack(client, {
      stack: 'tale',
      pool: 'tale',
      key: desired.key,
      files: [],
    });
    expect(readback.manifests).toBe(true);
  });
});
