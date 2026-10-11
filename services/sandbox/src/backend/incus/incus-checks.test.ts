// What boot says about the node: each requirement and each warning, against a
// node the fake describes.

import { describe, expect, test } from 'bun:test';

import type { SpawnerConfig } from '../../types.ts';
import { FakeIncus } from './fake-incus.ts';
import { inspectIncus, type IncusFindings } from './incus-checks.ts';
import {
  dockerCapableOverrides,
  incusTestConfig,
} from './incus-test-config.ts';

async function inspect(
  fake: FakeIncus,
  cfg: SpawnerConfig = incusTestConfig(),
): Promise<IncusFindings> {
  const client = fake.client();
  return inspectIncus(cfg, {
    server: await client.getServer(),
    project: await client.getProject(),
    profile: await client.getProfile('sandbox'),
    network: await client.getNetwork('sbx0'),
    pool: await client.getStoragePool('tank'),
  });
}

function matching(texts: string[], needle: string): string[] {
  return texts.filter((text) => text.includes(needle));
}

describe('a node set up as the docs describe', () => {
  test('has nothing to say', async () => {
    expect(await inspect(new FakeIncus())).toEqual({
      errors: [],
      warnings: [],
    });
  });

  test('with Docker inside, still nothing', async () => {
    expect(
      await inspect(
        new FakeIncus(),
        incusTestConfig({}, dockerCapableOverrides()),
      ),
    ).toEqual({ errors: [], warnings: [] });
  });
});

describe('the server', () => {
  test('is refused when an extension the backend needs is missing', async () => {
    const fake = new FakeIncus();
    fake.extensions = fake.extensions.filter(
      (extension) =>
        extension !== 'instance_oci_entrypoint' &&
        extension !== 'storage_volumes_created_at',
    );
    const { errors } = await inspect(fake);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('instance_oci_entrypoint');
    expect(errors[0]).toContain('storage_volumes_created_at');
  });

  test('is not asked for the tmpfs extension when the shm device is off', async () => {
    const fake = new FakeIncus();
    fake.extensions = fake.extensions.filter(
      (extension) => extension !== 'container_disk_tmpfs',
    );
    expect((await inspect(fake)).errors).toHaveLength(1);
    expect(
      (await inspect(fake, incusTestConfig({ shmDevice: false }))).errors,
    ).toEqual([]);
  });
});

describe('the project', () => {
  test('is refused without its own storage volumes', async () => {
    const fake = new FakeIncus();
    fake.projectConfig['features.storage.volumes'] = 'false';
    const { errors } = await inspect(fake);
    expect(matching(errors, 'features.storage.volumes')).toHaveLength(1);
    expect(errors[0]).toContain('incus project set sandbox-pr');
  });

  test('is warned about when it does not hold its own images', async () => {
    const fake = new FakeIncus();
    fake.projectConfig['features.images'] = 'false';
    expect(
      matching((await inspect(fake)).warnings, 'features.images'),
    ).toHaveLength(1);
  });

  test('is warned about when it is not restricted', async () => {
    const fake = new FakeIncus();
    fake.projectConfig.restricted = 'false';
    const { errors, warnings } = await inspect(fake);
    expect(errors).toEqual([]);
    expect(matching(warnings, 'not restricted')).toHaveLength(1);
  });

  test('is refused when a restricted project does not allow the shm device', async () => {
    const fake = new FakeIncus();
    delete fake.projectConfig['restricted.devices.disk'];
    const { errors } = await inspect(fake);
    expect(matching(errors, 'tmpfs /dev/shm')).toHaveLength(1);
    expect(errors[0]).toContain('SANDBOX_INCUS_SHM_DEVICE=false');
  });

  test('is refused when the disk paths it allows leave out tmpfs:', async () => {
    const fake = new FakeIncus();
    fake.projectConfig['restricted.devices.disk.paths'] = '/srv/data';
    const { errors } = await inspect(fake);
    expect(matching(errors, '/srv/data')).toHaveLength(1);
  });

  test('is warned about when disk devices are allowed from anywhere', async () => {
    const fake = new FakeIncus();
    delete fake.projectConfig['restricted.devices.disk.paths'];
    const { errors, warnings } = await inspect(fake);
    expect(errors).toEqual([]);
    expect(matching(warnings, 'any host path')).toHaveLength(1);
  });

  test('is not asked about the shm device when it is off', async () => {
    const fake = new FakeIncus();
    delete fake.projectConfig['restricted.devices.disk'];
    expect(
      (await inspect(fake, incusTestConfig({ shmDevice: false }))).errors,
    ).toEqual([]);
  });

  test('is warned about when it allows low-level keys', async () => {
    const fake = new FakeIncus();
    fake.projectConfig['restricted.containers.lowlevel'] = 'allow';
    expect(matching((await inspect(fake)).warnings, 'raw.lxc')).toHaveLength(1);
  });

  test('is refused for Docker inside without nesting or interception', async () => {
    const fake = new FakeIncus();
    delete fake.projectConfig['restricted.containers.nesting'];
    delete fake.projectConfig['restricted.containers.interception'];
    const cfg = incusTestConfig({}, dockerCapableOverrides());
    const { errors } = await inspect(fake, cfg);
    expect(matching(errors, 'nesting')).toHaveLength(1);
    expect(matching(errors, 'interception')).toHaveLength(1);
    // Without Docker inside, neither is needed.
    expect((await inspect(fake)).errors).toEqual([]);
  });

  test('does not need interception when the Docker config asks for none', async () => {
    const fake = new FakeIncus();
    delete fake.projectConfig['restricted.containers.interception'];
    const cfg = incusTestConfig(
      { dockerConfig: { 'security.nesting': 'true' } },
      dockerCapableOverrides(),
    );
    expect((await inspect(fake, cfg)).errors).toEqual([]);
  });

  test('skips the restricted-project rules for a project that is not restricted', async () => {
    const fake = new FakeIncus();
    fake.projectConfig = { 'features.storage.volumes': 'true' };
    const { errors, warnings } = await inspect(
      fake,
      incusTestConfig({}, dockerCapableOverrides()),
    );
    expect(errors).toEqual([]);
    expect(matching(warnings, 'not restricted')).toHaveLength(1);
  });
});

describe('the network and the profile', () => {
  test('refuses a network Incus does not manage', async () => {
    const fake = new FakeIncus();
    fake.networkManaged = false;
    expect(matching((await inspect(fake)).errors, 'not managed')).toHaveLength(
      1,
    );
  });

  test('refuses a profile without a NIC', async () => {
    const fake = new FakeIncus();
    delete fake.profileDevices.eth0;
    const { errors } = await inspect(fake);
    expect(matching(errors, 'no network device')).toHaveLength(1);
    expect(errors[0]).toContain('incus profile device add sandbox eth0');
  });

  test('refuses a NIC on another network, and names it', async () => {
    const fake = new FakeIncus();
    const nic = fake.profileDevices.eth0;
    if (nic === undefined) throw new Error('no NIC');
    nic.network = 'br-other';
    const { errors } = await inspect(fake);
    expect(matching(errors, 'br-other')).toHaveLength(1);
  });

  test('takes the NIC’s parent for its network too', async () => {
    const fake = new FakeIncus();
    fake.profileDevices.eth0 = {
      type: 'nic',
      nictype: 'bridged',
      parent: 'sbx0',
      'security.acls': 'x',
    };
    expect((await inspect(fake)).errors).toEqual([]);
  });

  test('refuses sessions with no ACL at all', async () => {
    const fake = new FakeIncus();
    fake.networkConfig = {};
    const nic = fake.profileDevices.eth0;
    if (nic === undefined) throw new Error('no NIC');
    delete nic['security.acls'];
    const { errors } = await inspect(fake);
    expect(matching(errors, 'no network ACL')).toHaveLength(1);
    expect(errors[0]).toContain('SANDBOX_INCUS_ALLOW_UNFILTERED_NETWORK');
  });

  test('takes an ACL on the network as enough, or on the NIC', async () => {
    const onNetwork = new FakeIncus();
    const nic = onNetwork.profileDevices.eth0;
    if (nic === undefined) throw new Error('no NIC');
    delete nic['security.acls'];
    expect((await inspect(onNetwork)).errors).toEqual([]);

    const onNic = new FakeIncus();
    onNic.networkConfig = {};
    expect((await inspect(onNic)).errors).toEqual([]);
  });

  test('allows no ACL for a lab that says so, with a warning', async () => {
    const fake = new FakeIncus();
    fake.networkConfig = {};
    const nic = fake.profileDevices.eth0;
    if (nic === undefined) throw new Error('no NIC');
    delete nic['security.acls'];
    const { errors, warnings } = await inspect(
      fake,
      incusTestConfig({ allowUnfilteredNetwork: true }),
    );
    expect(errors).toEqual([]);
    expect(matching(warnings, 'no network ACL')).toHaveLength(1);
  });

  test('warns about a NIC that does not isolate its port', async () => {
    const fake = new FakeIncus();
    const nic = fake.profileDevices.eth0;
    if (nic === undefined) throw new Error('no NIC');
    delete nic['security.port_isolation'];
    expect(
      matching((await inspect(fake)).warnings, 'port_isolation'),
    ).toHaveLength(1);
  });

  test('warns about a root disk on another pool, and one without a size', async () => {
    const fake = new FakeIncus();
    fake.profileDevices.root = { type: 'disk', path: '/', pool: 'elsewhere' };
    const { warnings } = await inspect(fake);
    expect(matching(warnings, 'elsewhere')).toHaveLength(1);
    expect(matching(warnings, 'no size')).toHaveLength(1);
  });
});

describe('the storage pool', () => {
  test('warns when the driver cannot hold a quota', async () => {
    const fake = new FakeIncus({ poolDriver: 'dir' });
    expect(matching((await inspect(fake)).warnings, 'dir driver')).toHaveLength(
      1,
    );
  });
});
