import { afterEach, describe, expect, test } from 'bun:test';

import {
  clientOf,
  converge,
  desiredOf,
  goldenTarget,
  recordingHooks,
  SENTINEL_SECRET,
  stackIncus,
  stateRootFixture,
} from '../runtime/incus/apply/apply-fixture';
import {
  readStack,
  type ObservedInstance,
} from '../runtime/incus/apply/readback';
import { STOP_GROUPS } from '../runtime/incus/compile/placement';
import { observedInstanceState } from '../runtime/incus/plan/plan';
import {
  assertIncusCustody,
  INCUS_CUSTODY_SENTENCES,
} from './runtime-incus-custody';

// The Incus runtime needs a POSIX host and is refused on Windows
// (assertIncusPlatform): its plan key, journal, credentials and copies are
// held by owner and mode, which Windows files do not carry.
const describePosix = describe.skipIf(process.platform === 'win32');

/**
 * The managed stack's custody on Incus. The refusals mirror those of
 * Docker's `assertContainerCustody` (`runtime-apply.test.ts`): identity and
 * topology, data-volume and host-mount identity, a new volume a release
 * adds, and an instance that belongs to another deployment.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** The managed golden target, converged on a fake Incus, read back. */
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
    files: [],
  });
  return { desired, readback };
}

/** The readback's instances with `name` changed by `change`. */
function changed(
  instances: readonly ObservedInstance[],
  name: string,
  change: (instance: ObservedInstance) => ObservedInstance,
): ObservedInstance[] {
  return instances.map((instance) =>
    instance.name === name ? change(instance) : instance,
  );
}

describePosix('the custody of a managed stack on Incus', () => {
  test('a converged stack is the deployment own, exactly, and carries no secret', async () => {
    const { desired, readback } = await deployed();
    const infos = assertIncusCustody({
      desired,
      instances: readback.instances,
      phase: 'ready',
    });
    expect(infos.map((info) => info.name)).toEqual(
      desired.target.instances.map((spec) => spec.name).sort(),
    );
    expect(infos.every((info) => info.index === 1 && !info.oneOff)).toBe(true);
    expect(JSON.stringify(infos)).not.toContain(SENTINEL_SECRET);
    expect(
      assertIncusCustody({
        desired,
        instances: readback.instances,
        phase: 'admission',
        volumes: new Set(readback.volumes.map((volume) => volume.name)),
      }),
    ).toHaveLength(infos.length);
  });

  test('the managed stop priorities are the three groups (R3-05)', () => {
    const groups = new Set<string>(Object.values(STOP_GROUPS).map(String));
    for (const spec of goldenTarget('managed-compose').instances)
      expect(groups.has(spec.config['boot.stop.priority'] ?? '')).toBe(true);
  });

  test.each([
    [
      'a one-off helper of the stack',
      (instance: ObservedInstance) => ({
        ...instance,
        config: { ...instance.config, 'user.tale.role': 'helper' },
      }),
    ],
    [
      'a second replica',
      (instance: ObservedInstance) => ({
        ...instance,
        config: { ...instance.config, 'user.tale.index': '2' },
      }),
    ],
    [
      'a colour on the managed /25',
      (instance: ObservedInstance) => ({
        ...instance,
        config: { ...instance.config, 'user.tale.colour': 'blue' },
      }),
    ],
    [
      'another service under the name',
      (instance: ObservedInstance) => ({
        ...instance,
        config: { ...instance.config, 'user.tale.service': 'platform' },
      }),
    ],
  ])('%s is refused as identity and topology', async (_, change) => {
    const { desired, readback } = await deployed();
    expect(() =>
      assertIncusCustody({
        desired,
        instances: changed(readback.instances, 'db', change),
        phase: 'admission',
      }),
    ).toThrow(INCUS_CUSTODY_SENTENCES.topology);
  });

  test('an instance of the stack the target does not have is refused', async () => {
    const { desired, readback } = await deployed();
    const db = readback.instances.find((instance) => instance.name === 'db');
    if (db === undefined) throw new Error('no db');
    expect(() =>
      assertIncusCustody({
        desired,
        instances: [...readback.instances, { ...db, name: 'db-copy' }],
        phase: 'admission',
      }),
    ).toThrow(INCUS_CUSTODY_SENTENCES.topology);
  });

  test('a disk at another path or read-write where read-only differs', async () => {
    const { desired, readback } = await deployed();
    const changes: Record<string, string>[] = [
      { path: '/var/lib/elsewhere' },
      { readonly: 'true' },
    ];
    for (const device of changes)
      expect(() =>
        assertIncusCustody({
          desired,
          instances: changed(readback.instances, 'db', (instance) => ({
            ...instance,
            devices: {
              ...instance.devices,
              'db-data': { ...instance.devices['db-data'], ...device },
            },
          })),
          phase: 'admission',
        }),
      ).toThrow(INCUS_CUSTODY_SENTENCES.disk);
  });

  test.each([
    ['another volume', { source: 'someone-elses-volume' }],
    ['a host path', { source: '/etc' }],
    ['another pool', { pool: 'other' }],
  ])('a disk on %s is outside the allow-list', async (_, device) => {
    const { desired, readback } = await deployed();
    expect(() =>
      assertIncusCustody({
        desired,
        instances: changed(readback.instances, 'proxy', (instance) => ({
          ...instance,
          devices: {
            ...instance.devices,
            extra: {
              type: 'disk',
              pool: 'tale',
              source: 'proxy-files',
              path: '/extra',
              ...device,
            },
          },
        })),
        phase: 'admission',
      }),
    ).toThrow(INCUS_CUSTODY_SENTENCES.allowList);
  });

  test('a disk of the allow-list the target does not give the instance differs', async () => {
    const { desired, readback } = await deployed();
    expect(() =>
      assertIncusCustody({
        desired,
        instances: changed(readback.instances, 'proxy', (instance) => ({
          ...instance,
          devices: {
            ...instance.devices,
            extra: {
              type: 'disk',
              pool: 'tale',
              source: 'db-data',
              path: '/extra',
            },
          },
        })),
        phase: 'admission',
      }),
    ).toThrow(INCUS_CUSTODY_SENTENCES.disk);
  });

  test('a volume the release adds may be missing at admission only while it does not exist', async () => {
    const { desired, readback } = await deployed();
    const withoutData = changed(readback.instances, 'db', (instance) => {
      const devices = { ...instance.devices };
      delete devices['db-backup'];
      return { ...instance, devices };
    });
    // The drift check reads the stamped digest, which a removed device
    // breaks; restamp it as an older release would have.
    const volumes = new Set(
      readback.volumes
        .map((volume) => volume.name)
        .filter((name) => name !== 'db-backup'),
    );
    const restamped = changed(withoutData, 'db', (instance) => ({
      ...instance,
      config: {
        ...instance.config,
        'user.tale.config': stateOf(desired, instance),
      },
    }));
    expect(() =>
      assertIncusCustody({
        desired,
        instances: restamped,
        phase: 'admission',
        volumes,
      }),
    ).not.toThrow();
    expect(() =>
      assertIncusCustody({
        desired,
        instances: restamped,
        phase: 'admission',
        volumes: new Set(readback.volumes.map((volume) => volume.name)),
      }),
    ).toThrow(INCUS_CUSTODY_SENTENCES.disk);
    expect(() =>
      assertIncusCustody({ desired, instances: restamped, phase: 'ready' }),
    ).toThrow(INCUS_CUSTODY_SENTENCES.disk);
  });

  test('an instance changed by hand since the CLI applied it is refused', async () => {
    const { desired, readback } = await deployed();
    expect(() =>
      assertIncusCustody({
        desired,
        instances: changed(readback.instances, 'backend-api-1', (instance) => ({
          ...instance,
          config: { ...instance.config, 'limits.memory': '1GiB' },
        })),
        phase: 'admission',
      }),
    ).toThrow(INCUS_CUSTODY_SENTENCES.drift);
    expect(() =>
      assertIncusCustody({
        desired,
        instances: changed(readback.instances, 'backend-api-1', (instance) => {
          const config = { ...instance.config };
          delete config['user.tale.config'];
          return { ...instance, config };
        }),
        phase: 'admission',
      }),
    ).toThrow(INCUS_CUSTODY_SENTENCES.drift);
  });

  test('a ready runtime misses no instance of the target', async () => {
    const { desired, readback } = await deployed();
    expect(() =>
      assertIncusCustody({
        desired,
        instances: readback.instances.filter(
          (instance) => instance.name !== 'sandbox',
        ),
        phase: 'ready',
      }),
    ).toThrow(INCUS_CUSTODY_SENTENCES.ready);
    // At admission a missing instance is the plan's to make.
    expect(() =>
      assertIncusCustody({
        desired,
        instances: readback.instances.filter(
          (instance) => instance.name !== 'sandbox',
        ),
        phase: 'admission',
      }),
    ).not.toThrow();
  });

  test('an instance under a needed name that belongs to another deployment is refused', async () => {
    const { desired, readback } = await deployed();
    expect(() =>
      assertIncusCustody({
        desired,
        instances: changed(readback.instances, 'db', (instance) => ({
          ...instance,
          custody: { verdict: 'foreign', stack: 'other' },
        })),
        phase: 'admission',
      }),
    ).toThrow('belongs to the stack other');
    expect(() =>
      assertIncusCustody({
        desired,
        instances: changed(readback.instances, 'db', (instance) => ({
          ...instance,
          custody: { verdict: 'unlabelled' },
        })),
        phase: 'admission',
      }),
    ).toThrow('without a stack label');
  });
});

/** The state digest the applier stamps on what `instance` now holds. */
function stateOf(
  desired: ReturnType<typeof desiredOf>,
  instance: ObservedInstance,
): string {
  return observedInstanceState(desired.key, { ...instance, running: true });
}
