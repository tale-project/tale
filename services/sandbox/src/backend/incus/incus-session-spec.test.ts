// The Incus instance of a session, read as data: what the create body holds
// for each shape of session, and what it must never hold.

import { describe, expect, test } from 'bun:test';

import { TEST_SESSION_CONFIG } from '../../session/session-test-config.ts';
import {
  incusInstanceName,
  incusPoolInstanceName,
  incusWorkspaceVolumeName,
  isPoolInstance,
  isScratchVolume,
  isSessionInstance,
  LABEL,
  stampOf,
} from './incus-naming.ts';
import {
  buildClaim,
  buildPoolInstance,
  buildWarmupInstance,
  buildSessionInstance,
  buildWorkspaceVolume,
  pinnedEgressAddress,
  poolFingerprint,
  poolServes,
  poolShape,
  sessionShape,
  type SessionInstanceInput,
} from './incus-session-spec.ts';
import { STANDBY_COMMAND } from './incus-standby.ts';
import {
  dockerCapableOverrides,
  incusTestConfig,
  INCUS_TEST_ADDRESS,
} from './incus-test-config.ts';
import { toIncusSize } from './incus-units.ts';

function dockerCapable(incus = {}, overrides = {}) {
  return incusTestConfig(incus, { ...dockerCapableOverrides(), ...overrides });
}

const input: SessionInstanceInput = {
  sessionId: 'sess_one',
  organizationId: 'org_one',
  profile: 'agent',
  createdAtMs: 1_700_000_000_000,
  createAttemptId: 'attempt-1',
  runnerdToken: 'ab12cd34',
  egressAddress: INCUS_TEST_ADDRESS,
  startupDeadlineMs: 1_700_000_005_000,
};

describe('names and labels', () => {
  test('an instance name is a hash: valid for Incus whatever the id holds', () => {
    const name = incusInstanceName(
      'sess_with_underscores-and-64-characters-1234567890123456789012345',
    );
    expect(name).toMatch(/^tale-sbx-ses-[0-9a-f]{24}$/);
    expect(incusInstanceName('a')).toBe(incusInstanceName('a'));
    expect(incusInstanceName('a')).not.toBe(incusInstanceName('b'));
    expect(name.length).toBeLessThanOrEqual(63);
  });

  test('a workspace volume and a standby have names of their own', () => {
    expect(incusWorkspaceVolumeName('a')).toMatch(/^tale-ses-ws-[0-9a-f]{24}$/);
    expect(incusPoolInstanceName('0a1b')).toBe('tale-sbx-pool-0a1b');
  });

  test('a session instance and a standby are told apart by their labels', () => {
    const session = {
      [LABEL.sandboxSession]: '1',
      [LABEL.session]: 'x',
    };
    expect(isSessionInstance(session, '')).toBe(true);
    // Another spawner on the same project owns what carries its instance.
    expect(
      isSessionInstance({ ...session, [LABEL.spawnerInstance]: 'device' }, ''),
    ).toBe(false);
    expect(
      isSessionInstance(
        { ...session, [LABEL.spawnerInstance]: 'device' },
        'device',
      ),
    ).toBe(true);
    expect(isSessionInstance({ [LABEL.sandboxSession]: '1' }, '')).toBe(false);
    expect(isSessionInstance({}, '')).toBe(false);

    const standby = { [LABEL.pool]: 'abc' };
    expect(isPoolInstance(standby, '')).toBe(true);
    // A claimed standby is a session, and its emptied pool label reads as none.
    expect(isPoolInstance({ ...session, [LABEL.pool]: 'abc' }, '')).toBe(false);
    expect(isPoolInstance({ ...session, [LABEL.pool]: '' }, '')).toBe(false);
    expect(isSessionInstance({ ...session, [LABEL.pool]: '' }, '')).toBe(true);
  });

  test('a volume is scratch only when it says so: a workspace is never taken for one', () => {
    const volume = { [LABEL.workspace]: '1', [LABEL.profile]: 'default' };
    expect(isScratchVolume(volume)).toBe(true);
    expect(isScratchVolume({ ...volume, [LABEL.profile]: 'agent' })).toBe(
      false,
    );
    expect(isScratchVolume({ ...volume, [LABEL.profile]: 'agent-light' })).toBe(
      false,
    );
    // Saying nothing is not saying scratch.
    expect(isScratchVolume({ [LABEL.workspace]: '1' })).toBe(false);
    expect(isScratchVolume({ [LABEL.profile]: 'default' })).toBe(false);
    expect(isScratchVolume({ ...volume, [LABEL.profile]: '' })).toBe(false);
    expect(isScratchVolume({})).toBe(false);
  });

  test('a creation stamp is read only when it is one', () => {
    expect(stampOf({ [LABEL.created]: '1700000000000' })).toBe(
      1_700_000_000_000,
    );
    expect(stampOf({ [LABEL.created]: '' })).toBeUndefined();
    expect(stampOf({ [LABEL.created]: 'soon' })).toBeUndefined();
    expect(stampOf({})).toBeUndefined();
  });
});

describe('sizes', () => {
  test.each([
    ['4g', '4GiB'],
    ['1500m', '1500MiB'],
    ['512M', '512MiB'],
    ['64k', '64KiB'],
    ['1024', '1024B'],
    ['10GiB', '10GiB'],
    ['2TB', '2TB'],
  ])('%s is %s to Incus', (quantity, expected) => {
    expect(toIncusSize(quantity)).toBe(expected);
  });

  test.each(['', '0', '0g', '-1g', '1.5g', 'ten', '4 GiB', '4Gi', 'g'])(
    '%j is no size',
    (quantity) => {
      expect(toIncusSize(quantity)).toBeUndefined();
    },
  );
});

describe('a session started cold', () => {
  test('an agent without Docker: the whole create body', () => {
    const body = buildSessionInstance(incusTestConfig(), input);
    expect(body.name).toBe(incusInstanceName('sess_one'));
    // Not ephemeral: it stays stopped, console and all, if its start fails.
    expect(body.ephemeral).toBe(false);
    expect(body.start).toBe(true);
    expect(body.profiles).toEqual(['sandbox']);
    expect(body.source).toEqual({
      type: 'image',
      alias: 'tale-sandbox-runtime',
    });
    expect(body.config).toEqual({
      // hardening that does not need the project's consent
      'security.idmap.isolated': 'true',
      'security.guestapi': 'false',
      'boot.autostart': 'false',
      // the entrypoint, as root so it can install the egress redirect and
      // drop, under no_new_privs as Docker's `no-new-privileges` sets it
      'oci.entrypoint':
        '/usr/bin/setpriv --no-new-privs -- /docker-entrypoint.sh daemon',
      'oci.uid': '0',
      'oci.gid': '0',
      'oci.dns.nameservers': INCUS_TEST_ADDRESS,
      // limits of the agent profile
      'limits.cpu.allowance': '200ms/100ms',
      'limits.memory': '4GiB',
      'limits.processes': '512',
      'limits.kernel.nofile': '4096:8192',
      'limits.kernel.fsize': '536870912',
      'limits.kernel.core': '0:0',
      'linux.sysctl.net.ipv6.conf.all.disable_ipv6': '1',
      'linux.sysctl.net.ipv6.conf.default.disable_ipv6': '1',
      // environment
      'environment.HTTPS_PROXY': `http://${INCUS_TEST_ADDRESS}:3128`,
      'environment.HTTP_PROXY': `http://${INCUS_TEST_ADDRESS}:3128`,
      'environment.NO_PROXY':
        '127.0.0.1,localhost,sandbox-llm-gateway,backend-api,backend-relay',
      'environment.HOME': '/agent/.runtime/home',
      'environment.TALE_EXEC_STALL_MS': '2700000',
      'environment.TALE_EXEC_ADMISSION_MEMORY_PERCENT': '90',
      'environment.TALE_TRANSPARENT_EGRESS': '1',
      // a /dev/shm of the profile's size, mounted by the entrypoint as root
      'environment.TALE_SHM_SIZE': '512m',
      'environment.TALE_DROP_UID': '10001',
      'environment.TALE_DROP_GID': '10001',
      'environment.TALE_RUNNERD_TOKEN': 'ab12cd34',
      'environment.TALE_RUNNERD_INCARNATION': '1700000000000',
      // labels
      'user.tale.sandbox-session': '1',
      'user.tale.session': 'sess_one',
      'user.tale.org': 'org_one',
      'user.tale.profile': 'agent',
      'user.tale.docker': 'false',
      'user.tale.created': '1700000000000',
      'user.tale.create-attempt': 'attempt-1',
      'user.tale.startup-deadline': '1700000005000',
      'user.tale.egress-ip': INCUS_TEST_ADDRESS,
    });
    // The workspace is the one device: a restricted project admits pool-backed
    // disks only, so there is no tmpfs device for /dev/shm.
    expect(body.devices).toEqual({
      workspace: {
        type: 'disk',
        pool: 'tank',
        source: incusWorkspaceVolumeName('sess_one'),
        path: '/agent',
      },
    });
  });

  test('never asks for what a restricted project refuses', () => {
    for (const cfg of [incusTestConfig(), dockerCapable()]) {
      for (const profile of ['agent', 'agent-light', 'default'] as const) {
        const body = buildSessionInstance(cfg, { ...input, profile });
        const keys = Object.keys(body.config);
        expect(keys.filter((key) => key.startsWith('raw.'))).toEqual([]);
        expect(keys).not.toContain('limits.memory.swap');
        expect(keys).not.toContain('limits.memory.oom_priority');
        expect(keys).not.toContain('security.privileged');
        // The profile owns the NIC, with its ACL and port isolation.
        expect(Object.values(body.devices).map((d) => d.type)).not.toContain(
          'nic',
        );
        expect(Object.keys(body.devices)).not.toContain('eth0');
        // Every disk is backed by a pool: the default a restricted project
        // admits, with no host path and no tmpfs.
        for (const device of Object.values(body.devices)) {
          expect(device.type).toBe('disk');
          expect(device.pool).toBe('tank');
        }
      }
    }
  });

  test('the seed environment never reaches the instance', () => {
    const body = buildSessionInstance(incusTestConfig(), input);
    expect(JSON.stringify(body)).not.toContain('TALE_SESSION_ENV');
  });

  test('Docker inside: nesting and the interception it needs, a bigger process budget', () => {
    const cfg = dockerCapable();
    const body = buildSessionInstance(cfg, input);
    expect(body.config).toMatchObject({
      'security.nesting': 'true',
      'security.syscalls.intercept.mknod': 'true',
      'security.syscalls.intercept.setxattr': 'true',
      'oci.uid': '0',
      'limits.memory': '8GiB',
      'limits.processes': '16384',
      'limits.kernel.nofile': '65536:1048576',
      'environment.TALE_DIND': '1',
      'environment.TALE_RUNTIME_TIER': 'sysbox',
      'user.tale.docker': 'true',
    });
    // No per-file cap under Docker inside, and no drop variables: the
    // entrypoint drops after the inner engine is up.
    expect(body.config['limits.kernel.fsize']).toBeUndefined();
    expect(body.config['environment.TALE_DROP_UID']).toBeUndefined();
  });

  test('no_new_privs is on for every session but one with Docker inside, which must be able to grow privileges', () => {
    const plain = incusTestConfig();
    for (const profile of ['agent', 'agent-light', 'default'] as const) {
      expect(
        buildSessionInstance(plain, { ...input, profile }).config[
          'oci.entrypoint'
        ],
      ).toBe('/usr/bin/setpriv --no-new-privs -- /docker-entrypoint.sh daemon');
    }
    // Docker's own backend leaves the flag off for DinD, and so does this one.
    expect(
      buildSessionInstance(dockerCapable(), input).config['oci.entrypoint'],
    ).toBe('/docker-entrypoint.sh daemon');
    // A Docker-free agent in a Docker-capable deployment is hardened again.
    expect(
      buildSessionInstance(dockerCapable(), { ...input, docker: false }).config[
        'oci.entrypoint'
      ],
    ).toBe('/usr/bin/setpriv --no-new-privs -- /docker-entrypoint.sh daemon');
  });

  test('the operator’s Docker config replaces the default set', () => {
    const cfg = dockerCapable(
      { dockerConfig: { 'security.nesting': 'true' } },
      { dindInnerPool: '10.240.0.0/16' },
    );
    const body = buildSessionInstance(cfg, input);
    expect(body.config['security.syscalls.intercept.mknod']).toBeUndefined();
    expect(body.config['environment.TALE_DIND_INNER_POOL_OVERRIDE']).toBe(
      '10.240.0.0/16',
    );
  });

  test('a Docker-free agent in a Docker-capable deployment gets neither nesting nor Docker', () => {
    const cfg = dockerCapable();
    const body = buildSessionInstance(cfg, { ...input, docker: false });
    expect(body.config['security.nesting']).toBeUndefined();
    expect(body.config['environment.TALE_DIND']).toBeUndefined();
    expect(body.config['limits.memory']).toBe('4GiB');
  });

  test('the render profile: nobody, small, and without a drop to make', () => {
    const body = buildSessionInstance(incusTestConfig(), {
      ...input,
      profile: 'default',
    });
    expect(body.config).toMatchObject({
      'limits.cpu.allowance': '100ms/100ms',
      'limits.memory': '1500MiB',
      'limits.processes': '512',
      'limits.kernel.nofile': '1024:4096',
      'limits.kernel.fsize': '104857600',
      'environment.TALE_DROP_UID': '65534',
      'user.tale.profile': 'default',
    });
    // The image's own /dev/shm is already 64 MiB: nothing to mount.
    expect(body.config['environment.TALE_SHM_SIZE']).toBeUndefined();
  });

  test("without transparent egress and with the image's /dev/shm the session boots as its own user", () => {
    const cfg = incusTestConfig(
      {},
      {
        transparentEgress: false,
        session: {
          ...TEST_SESSION_CONFIG,
          agentProfile: { ...TEST_SESSION_CONFIG.agentProfile, shmSize: '64m' },
        },
      },
    );
    const body = buildSessionInstance(cfg, input);
    expect(body.config['oci.uid']).toBe('10001');
    expect(body.config['oci.gid']).toBe('10001');
    expect(body.config['environment.TALE_TRANSPARENT_EGRESS']).toBeUndefined();
    expect(body.config['environment.TALE_SHM_SIZE']).toBeUndefined();
    expect(body.config['environment.TALE_DROP_UID']).toBeUndefined();
    expect(body.config['user.tale.egress-ip']).toBe(INCUS_TEST_ADDRESS);
  });

  test('a bigger /dev/shm is a mount, so the session boots as root and is told whom to become', () => {
    const cfg = incusTestConfig({}, { transparentEgress: false });
    const body = buildSessionInstance(cfg, input);
    expect(body.config).toMatchObject({
      'oci.uid': '0',
      'oci.gid': '0',
      'environment.TALE_SHM_SIZE': '512m',
      'environment.TALE_DROP_UID': '10001',
      'environment.TALE_DROP_GID': '10001',
    });
    expect(body.config['environment.TALE_TRANSPARENT_EGRESS']).toBeUndefined();
  });

  test('a /dev/shm size that is not one resizes nothing (boot refuses it)', () => {
    const cfg = incusTestConfig(
      {},
      {
        session: {
          ...TEST_SESSION_CONFIG,
          agentProfile: {
            ...TEST_SESSION_CONFIG.agentProfile,
            shmSize: '1.5g',
          },
        },
      },
    );
    // Not a size the entrypoint reads: nothing is asked of it. The boot
    // checks refuse the setting by name.
    expect(sessionShape(cfg, 'agent').resizeShm).toBe(false);
  });

  test('only a session that pins the proxy address records it', () => {
    const cfg = incusTestConfig({}, { transparentEgress: false });
    expect(
      pinnedEgressAddress(cfg, sessionShape(cfg, 'agent')),
    ).toBeUndefined();
    expect(
      pinnedEgressAddress(
        incusTestConfig(),
        sessionShape(incusTestConfig(), 'agent'),
      ),
    ).toBe(INCUS_TEST_ADDRESS);
    const dind = dockerCapable({}, { transparentEgress: false });
    expect(pinnedEgressAddress(dind, sessionShape(dind, 'agent'))).toBe(
      INCUS_TEST_ADDRESS,
    );
  });

  test('another spawner instance is recorded', () => {
    const body = buildSessionInstance(
      incusTestConfig({}, { instance: 'device' }),
      input,
    );
    expect(body.config['user.tale.sandbox-instance']).toBe('device');
  });

  test('refuses ids that are not plain, and an address that is not one', () => {
    const cfg = incusTestConfig();
    expect(() =>
      buildSessionInstance(cfg, { ...input, sessionId: 'a/b' }),
    ).toThrow('sessionId');
    expect(() =>
      buildSessionInstance(cfg, { ...input, organizationId: 'a b' }),
    ).toThrow('organizationId');
    expect(() =>
      buildSessionInstance(cfg, { ...input, createAttemptId: '' }),
    ).toThrow('createAttemptId');
    expect(() =>
      buildSessionInstance(cfg, { ...input, runnerdToken: 'NOT-HEX' }),
    ).toThrow('runnerdToken');
    expect(() =>
      buildSessionInstance(cfg, { ...input, egressAddress: 'proxy.local' }),
    ).toThrow('egressAddress');
  });
});

describe('the workspace volume', () => {
  test('is quota’d, shifted and owned by the session’s user', () => {
    const volume = buildWorkspaceVolume(incusTestConfig(), input, 'zfs');
    expect(volume).toEqual({
      name: incusWorkspaceVolumeName('sess_one'),
      type: 'custom',
      content_type: 'filesystem',
      config: {
        size: '10GiB',
        'security.shifted': 'true',
        'initial.uid': '10001',
        'initial.gid': '10001',
        'initial.mode': '755',
        'zfs.use_refquota': 'true',
        'user.tale.sandbox-workspace': '1',
        'user.tale.session': 'sess_one',
        'user.tale.org': 'org_one',
        'user.tale.profile': 'agent',
      },
    });
  });

  test('asks for ZFS options only of a ZFS pool; a render’s volume belongs to nobody', () => {
    const other = buildWorkspaceVolume(
      incusTestConfig(),
      { ...input, profile: 'default' },
      'btrfs',
    );
    expect(other.config['zfs.use_refquota']).toBeUndefined();
    expect(other.config['initial.uid']).toBe('65534');
  });
});

describe('the warm pool', () => {
  test('keeps agent sessions of the deployment’s Docker capability ready', () => {
    const plain = incusTestConfig();
    const pool = poolShape(plain);
    expect(pool.dind).toBe(false);
    expect(poolServes(pool, sessionShape(plain, 'agent'))).toBe(true);
    expect(poolServes(pool, sessionShape(plain, 'agent-light'))).toBe(true);
    expect(poolServes(pool, sessionShape(plain, 'default'))).toBe(false);

    const docker = dockerCapable();
    const dockerPool = poolShape(docker);
    expect(poolServes(dockerPool, sessionShape(docker, 'agent'))).toBe(true);
    expect(poolServes(dockerPool, sessionShape(docker, 'agent', false))).toBe(
      false,
    );
    expect(poolServes(dockerPool, sessionShape(docker, 'agent-light'))).toBe(
      false,
    );
  });

  test('a standby boots the waiting script, as root, stopped, with nothing of a session', () => {
    const cfg = incusTestConfig();
    const body = buildPoolInstance(cfg, poolShape(cfg), {
      name: incusPoolInstanceName('ab12'),
      imageFingerprint: 'f'.repeat(64),
      nowMs: 1_700_000_000_000,
    });
    expect(body.start).toBe(false);
    expect(body.ephemeral).toBe(false);
    expect(body.config).toMatchObject({
      // the waiting script, under no_new_privs like the session it becomes
      'oci.entrypoint': `/usr/bin/setpriv --no-new-privs -- ${STANDBY_COMMAND}`,
      'oci.uid': '0',
      'oci.gid': '0',
      'limits.memory': '4GiB',
      'user.tale.pool': poolFingerprint(cfg, poolShape(cfg)),
      'user.tale.pool-image': 'f'.repeat(64),
      'user.tale.pool-since': '1700000000000',
    });
    const keys = Object.keys(body.config);
    expect(keys).not.toContain('environment.TALE_RUNNERD_TOKEN');
    expect(keys).not.toContain('environment.TALE_RUNNERD_INCARNATION');
    expect(keys).not.toContain('user.tale.sandbox-session');
    expect(keys).not.toContain('user.tale.session');
    expect(body.devices.workspace).toBeUndefined();
    expect(isPoolInstance(body.config, '')).toBe(true);
  });

  test('the warm-up instance is never started, and carries the limits a project adds up', () => {
    const body = buildWarmupInstance(incusTestConfig(), 'tale-sbx-warm-ab12');
    expect(body).toEqual({
      name: 'tale-sbx-warm-ab12',
      ephemeral: false,
      profiles: ['sandbox'],
      config: { 'limits.memory': '4GiB', 'limits.processes': '512' },
      devices: {},
      source: { type: 'image', alias: 'tale-sandbox-runtime' },
      start: false,
    });
    const docker = buildWarmupInstance(dockerCapable(), 'tale-sbx-warm-ab12');
    expect(docker.config).toEqual({
      'limits.memory': '8GiB',
      'limits.processes': '16384',
    });
  });

  test('the fingerprint follows what a standby is made of, and nothing else', () => {
    const base = incusTestConfig();
    const same = poolFingerprint(base, poolShape(base));
    expect(poolFingerprint(incusTestConfig(), poolShape(base))).toBe(same);
    const moved = incusTestConfig({}, { egressProxy: 'http://10.9.0.3:3128' });
    expect(poolFingerprint(moved, poolShape(moved))).not.toBe(same);
    const bigger = incusTestConfig({ image: 'tale-sandbox-runtime-2' });
    expect(poolFingerprint(bigger, poolShape(bigger))).not.toBe(same);
    const docker = dockerCapable();
    expect(poolFingerprint(docker, poolShape(docker))).not.toBe(same);
    expect(same).toMatch(/^[0-9a-f]{16}$/);
  });

  test('a claim labels the instance, mounts the workspace and hands over the token', () => {
    const cfg = incusTestConfig();
    const claim = buildClaim(cfg, sessionShape(cfg, 'agent'), input);
    expect(claim.patch.config).toMatchObject({
      'user.tale.sandbox-session': '1',
      'user.tale.session': 'sess_one',
      'user.tale.created': '1700000000000',
      'user.tale.create-attempt': 'attempt-1',
      'user.tale.pool': '',
      'user.tale.pool-image': '',
      'user.tale.pool-since': '',
    });
    expect(claim.patch.devices).toEqual({
      workspace: {
        type: 'disk',
        pool: 'tank',
        source: incusWorkspaceVolumeName('sess_one'),
        path: '/agent',
      },
    });
    expect(claim.file).toBe(
      "export TALE_RUNNERD_TOKEN='ab12cd34'\nexport TALE_RUNNERD_INCARNATION='1700000000000'\n# tale-claim-end\n",
    );
  });

  test('a claim of a shape the entrypoint would not drop drops it itself', () => {
    // No transparent egress and the image's own /dev/shm: the entrypoint has
    // nothing to do as root, so the standby script hands it a session user.
    const cfg = incusTestConfig(
      {},
      {
        transparentEgress: false,
        session: {
          ...TEST_SESSION_CONFIG,
          agentProfile: { ...TEST_SESSION_CONFIG.agentProfile, shmSize: '64m' },
        },
      },
    );
    const claim = buildClaim(cfg, sessionShape(cfg, 'agent'), input);
    expect(claim.file).toContain("export TALE_STANDBY_UID='10001'");
    expect(claim.file).toContain("export TALE_STANDBY_GID='10001'");
  });

  test('a claim of a shape that boots as root leaves the drop to the entrypoint', () => {
    // A bigger /dev/shm is a mount the entrypoint makes as root, then it drops.
    const cfg = incusTestConfig({}, { transparentEgress: false });
    const claim = buildClaim(cfg, sessionShape(cfg, 'agent'), input);
    expect(claim.file).not.toContain('TALE_STANDBY_UID');
  });
});
