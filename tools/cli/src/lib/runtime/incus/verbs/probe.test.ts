import { beforeEach, describe, expect, test } from 'bun:test';

import { FakeIncus } from '@tale/incus/fake';

import { clientOf, stackIncus } from '../apply/apply-fixture';
import { platformOf, probeIncus, REQUIRED_EXTENSIONS } from './probe';

let fake: FakeIncus;

/** A server and project shaped as the node contract makes them. */
function readyIncus(): FakeIncus {
  const incus = stackIncus();
  incus.extensions = [...REQUIRED_EXTENSIONS, 'instance_create_start'];
  incus.projectConfig = {
    'features.images': 'true',
    'features.profiles': 'true',
    'features.storage.volumes': 'true',
    restricted: 'true',
    'restricted.images.servers': 'ghcr.io,mirror.gcr.io:443',
  };
  return incus;
}

const probe = (registries: string[] = ['ghcr.io', 'mirror.gcr.io:443']) =>
  probeIncus(clientOf(fake), { pool: 'tale', registries });

beforeEach(() => {
  fake = readyIncus();
});

describe('the Incus probe', () => {
  test('a server and project made from the contract are ready', async () => {
    const result = await probe();
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.facts).toEqual({
      version: '7.5.1',
      architecture: 'x86_64',
      platform: 'linux/amd64',
      poolDriver: 'zfs',
    });
  });

  test('every missing extension of D-06 is named; port forwarding is not one', async () => {
    fake.extensions = fake.extensions.filter(
      (name) =>
        name !== 'instance_auto_restart' && name !== 'file_storage_volume',
    );
    expect(fake.extensions).not.toContain('instance_port_forward');
    const { errors } = await probe();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('file_storage_volume, instance_auto_restart');
  });

  test('a cluster member is refused', async () => {
    fake.clustered = true;
    expect((await probe()).errors.join('\n')).toContain('cluster member');
  });

  test('an architecture Tale ships no image for is refused', async () => {
    fake.architectures = ['mips64'];
    const result = await probe();
    expect(result.errors.join('\n')).toContain('mips64');
    expect(result.facts).toBeNull();
    expect(platformOf('aarch64')).toBe('linux/arm64');
  });

  test('no idmapped mounts, or a ZFS older than 2.2, is refused', async () => {
    fake.kernelFeatures = { idmapped_mounts: 'false' };
    expect((await probe()).errors.join('\n')).toContain('idmapped mounts');
    fake.kernelFeatures = {};
    fake.storageDrivers = [{ name: 'zfs', version: '2.1.5-1', remote: false }];
    expect((await probe()).errors.join('\n')).toContain('OpenZFS 2.2');
    fake.storageDrivers = [];
    const unknown = await probe();
    expect(unknown.errors).toEqual([]);
    expect(unknown.warnings.join('\n')).toContain('OpenZFS 2.2');
  });

  test('a pool driver without quotas warns', async () => {
    fake = new FakeIncus({
      project: 'tale-stack',
      profile: 'tale-stack',
      network: 'talebr0',
      pool: 'tale',
      poolDriver: 'dir',
    });
    fake.extensions = [...REQUIRED_EXTENSIONS];
    fake.projectConfig = readyIncus().projectConfig;
    const result = await probe();
    expect(result.errors).toEqual([]);
    expect(result.warnings.join('\n')).toContain('dir driver');
  });

  test('project limits on memory or processes need the profile to set them (R3-12)', async () => {
    fake.projectConfig['limits.memory'] = '16GiB';
    fake.projectConfig['limits.processes'] = '20000';
    const refused = (await probe()).errors.join('\n');
    expect(refused).toContain('limits.memory (16GiB)');
    expect(refused).toContain('limits.processes (20000)');
    fake.profileConfig = {
      'limits.memory': '1GiB',
      'limits.processes': '1024',
    };
    expect((await probe()).errors).toEqual([]);
  });

  test('a registry host is matched exactly as the remote URL carries it (R3-12)', async () => {
    fake.projectConfig['restricted.images.servers'] =
      'ghcr.io,https://mirror.gcr.io';
    const errors = (await probe()).errors.join('\n');
    expect(errors).toContain('pull from mirror.gcr.io:443');
    expect(errors).toContain(
      'restricted.images.servers=ghcr.io,https://mirror.gcr.io,mirror.gcr.io:443',
    );
    // A host without the port, or one part of a longer host, is no match.
    fake.projectConfig['restricted.images.servers'] =
      'ghcr.io,mirror.gcr.io,x.mirror.gcr.io:4430';
    expect((await probe()).errors.join('\n')).toContain(
      'pull from mirror.gcr.io:443',
    );
  });

  test('a project without its own images, profiles and volumes is refused', async () => {
    delete fake.projectConfig['features.profiles'];
    expect((await probe()).errors.join('\n')).toContain(
      'features.profiles off',
    );
  });

  test('an unrestricted project warns and is not asked for image servers', async () => {
    fake.projectConfig = {
      'features.images': 'true',
      'features.profiles': 'true',
      'features.storage.volumes': 'true',
    };
    const result = await probe(['docker.io']);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join('\n')).toContain('not restricted');
  });

  test('a certificate the server does not trust stops the probe early', async () => {
    fake.auth = 'untrusted';
    const result = await probe();
    expect(result.facts).toBeNull();
    expect(result.errors.join('\n')).toContain('does not trust');
  });

  test('a project without the tale-stack profile or the pool is refused', async () => {
    const other = new FakeIncus({
      project: 'tale-stack',
      profile: 'default',
      pool: 'other',
    });
    other.extensions = [...REQUIRED_EXTENSIONS];
    other.projectConfig = readyIncus().projectConfig;
    fake = other;
    const errors = (await probe()).errors.join('\n');
    expect(errors).toContain('no profile tale-stack');
    expect(errors).toContain('storage pool tale does not exist');
  });
});
