// What boot says about the node: each requirement and each warning, against a
// node the fake describes.

import { describe, expect, test } from 'bun:test';

import { TEST_SESSION_CONFIG } from '../../session/session-test-config.ts';
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

  test('is refused without shifted volumes', async () => {
    const fake = new FakeIncus();
    fake.extensions = fake.extensions.filter(
      (extension) => extension !== 'storage_shifted',
    );
    const { errors } = await inspect(fake);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('storage_shifted');
  });

  test('is warned about when the kernel has no idmapped mounts, and silent when it says nothing', async () => {
    const fake = new FakeIncus();
    fake.kernelFeatures = { idmapped_mounts: 'false' };
    const { errors, warnings } = await inspect(fake);
    expect(errors).toEqual([]);
    expect(matching(warnings, 'idmapped mounts')).toHaveLength(1);
    fake.kernelFeatures = {};
    expect((await inspect(fake)).warnings).toEqual([]);
    fake.kernelFeatures = { idmapped_mounts: 'true' };
    expect((await inspect(fake)).warnings).toEqual([]);
  });
});

describe('the shared memory', () => {
  test('is refused when its size is not one the entrypoint can mount', async () => {
    for (const bad of ['1.5g', '512 m', '0', 'big']) {
      const { errors } = await inspect(
        new FakeIncus(),
        incusTestConfig(
          {},
          {
            session: {
              ...TEST_SESSION_CONFIG,
              agentProfile: {
                ...TEST_SESSION_CONFIG.agentProfile,
                shmSize: bad,
              },
            },
          },
        ),
      );
      expect({
        bad,
        matching: matching(errors, 'SANDBOX_AGENT_SHM_SIZE').length,
      }).toEqual({ bad, matching: 1 });
    }
  });

  test('is accepted in the sizes Docker reads', async () => {
    for (const good of ['64m', '512m', '1g', '262144k', '67108864']) {
      const { errors } = await inspect(
        new FakeIncus(),
        incusTestConfig(
          {},
          {
            session: {
              ...TEST_SESSION_CONFIG,
              agentProfile: {
                ...TEST_SESSION_CONFIG.agentProfile,
                shmSize: good,
              },
            },
          },
        ),
      );
      expect({ good, errors }).toEqual({ good, errors: [] });
    }
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

  test('is not asked to allow disk devices: the backend needs pool-backed disks only', async () => {
    const fake = new FakeIncus();
    expect(fake.projectConfig['restricted.devices.disk']).toBeUndefined();
    const { errors, warnings } = await inspect(fake);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('is warned about when disk devices are allowed from any host path', async () => {
    const fake = new FakeIncus();
    fake.projectConfig['restricted.devices.disk'] = 'allow';
    const { errors, warnings } = await inspect(fake);
    expect(errors).toEqual([]);
    expect(matching(warnings, 'any host path')).toHaveLength(1);
    expect(warnings[0]).toContain(
      'incus project unset sandbox-pr restricted.devices.disk',
    );
  });

  test('is not warned about when the disk devices it allows are confined to paths', async () => {
    const fake = new FakeIncus();
    fake.projectConfig['restricted.devices.disk'] = 'allow';
    fake.projectConfig['restricted.devices.disk.paths'] = '/srv/never';
    expect((await inspect(fake)).warnings).toEqual([]);
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

describe('the project’s aggregate limits', () => {
  test('refuses a project that sets limits.cpu, which would refuse every create', async () => {
    const fake = new FakeIncus();
    fake.projectConfig['limits.cpu'] = '64';
    const { errors } = await inspect(fake);
    expect(matching(errors, 'limits.cpu')).toHaveLength(1);
    expect(errors[0]).toContain('incus project unset sandbox-pr limits.cpu');
  });

  test('takes limits.cpu when the profile gives every instance one', async () => {
    const fake = new FakeIncus();
    fake.projectConfig['limits.cpu'] = '64';
    fake.profileConfig['limits.cpu'] = '2';
    expect((await inspect(fake)).errors).toEqual([]);
  });

  test('refuses a disk limit while the profile’s root disk has no size', async () => {
    const fake = new FakeIncus();
    fake.projectConfig['limits.disk'] = '2TiB';
    const root = fake.profileDevices.root;
    if (root === undefined) throw new Error('no root');
    delete root.size;
    const { errors } = await inspect(fake);
    expect(matching(errors, 'limits.disk')).toHaveLength(1);
    expect(errors[0]).toContain('incus profile device set sandbox root size=');
    // The same limit on one pool.
    fake.projectConfig['limits.disk'] = '';
    fake.projectConfig['limits.disk.pool.tank'] = '1TiB';
    expect(
      matching((await inspect(fake)).errors, 'limits.disk.pool.tank'),
    ).toHaveLength(1);
  });

  test('takes a disk limit once the root disk has a size', async () => {
    const fake = new FakeIncus();
    fake.projectConfig['limits.disk'] = '2TiB';
    expect((await inspect(fake)).errors).toEqual([]);
  });

  test('warns about count limits below the capacity and its warm-up', async () => {
    const fake = new FakeIncus();
    // The test config's capacity is 10.
    fake.projectConfig['limits.instances'] = '10';
    fake.projectConfig['limits.containers'] = '5';
    const { errors, warnings } = await inspect(fake);
    expect(errors).toEqual([]);
    expect(matching(warnings, 'limits.instances')).toHaveLength(1);
    expect(matching(warnings, 'limits.containers')).toHaveLength(1);
    fake.projectConfig['limits.instances'] = '11';
    fake.projectConfig['limits.containers'] = '300';
    expect((await inspect(fake)).warnings).toEqual([]);
  });

  test('warns about a memory cap below the capacity times a session’s limit', async () => {
    const fake = new FakeIncus();
    // 10 sessions of 4 GiB.
    fake.projectConfig['limits.memory'] = '39GiB';
    const { warnings } = await inspect(fake);
    expect(matching(warnings, 'limits.memory')).toHaveLength(1);
    expect(warnings[0]).toContain('SANDBOX_MAX_SESSIONS (10) times 4g');
    fake.projectConfig['limits.memory'] = '40GiB';
    expect((await inspect(fake)).warnings).toEqual([]);
    // Docker inside raises a session's limit to 8 GiB.
    const docker = incusTestConfig({}, dockerCapableOverrides());
    expect(
      matching((await inspect(fake, docker)).warnings, 'limits.memory'),
    ).toHaveLength(1);
  });

  test('warns about a process cap below the capacity times a session’s limit', async () => {
    const fake = new FakeIncus();
    fake.projectConfig['limits.processes'] = '5119';
    expect(
      matching((await inspect(fake)).warnings, 'limits.processes'),
    ).toHaveLength(1);
    fake.projectConfig['limits.processes'] = '5120';
    expect((await inspect(fake)).warnings).toEqual([]);
    // Docker inside raises it to 16384 a session.
    const docker = incusTestConfig({}, dockerCapableOverrides());
    expect(
      matching((await inspect(fake, docker)).warnings, 'limits.processes'),
    ).toHaveLength(1);
  });

  test('says nothing about limits it cannot read', async () => {
    const fake = new FakeIncus();
    fake.projectConfig['limits.memory'] = '50%';
    fake.projectConfig['limits.instances'] = 'many';
    expect((await inspect(fake)).warnings).toEqual([]);
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

  test('says, when the network’s configuration is hidden from the certificate, that only the NIC can vouch for an ACL', async () => {
    // A restricted certificate is shown an empty configuration for a network
    // (Incus shows it to administrators only): an ACL on the network alone
    // cannot be seen.
    const fake = new FakeIncus();
    fake.networkConfig = {};
    const nic = fake.profileDevices.eth0;
    if (nic === undefined) throw new Error('no NIC');
    delete nic['security.acls'];
    const { errors } = await inspect(fake);
    const refused = matching(errors, 'no network ACL is visible');
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain('administrators only');
    expect(refused[0]).toContain(
      'incus profile device set sandbox eth0 security.acls=<acl>',
    );
    expect(refused[0]).toContain('SANDBOX_INCUS_ALLOW_UNFILTERED_NETWORK');

    // An ACL on the NIC is seen, whatever the network shows.
    const named = new FakeIncus();
    named.networkConfig = {};
    expect(matching((await inspect(named)).errors, 'ACL')).toEqual([]);
  });

  test('says which network a visible configuration without an ACL is', async () => {
    const fake = new FakeIncus();
    fake.networkConfig = { 'ipv4.address': '10.20.0.1/24' };
    const nic = fake.profileDevices.eth0;
    if (nic === undefined) throw new Error('no NIC');
    delete nic['security.acls'];
    const { errors } = await inspect(fake);
    expect(matching(errors, 'neither network sbx0')).toHaveLength(1);
    expect(matching(errors, 'is visible')).toEqual([]);
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
