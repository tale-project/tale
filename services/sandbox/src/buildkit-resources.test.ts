import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ensureBuildkitNetwork,
  createLegacyBuildkitRetirer,
  retireLegacyBuildkitd as retireConfiguredLegacyBuildkitd,
} from './buildkit-resources.ts';
import {
  buildkitdCacheVolumeName,
  buildkitdContainerName,
  buildkitdEndpoint,
  buildkitdMirrorContainerName,
  buildkitdMirrorRef,
  buildkitdNetworkName,
  ensureBuildkitd,
  MIRROR_REGISTRIES,
} from './buildkitd.ts';
import { TEST_SESSION_CONFIG } from './session/session-test-config.ts';
import type { SpawnerConfig } from './types.ts';

// A fake Docker CLI exercises real resource orchestration, including inspect
// failures and pre-existing resources. No network/volume on the host is touched.
const FAKE_DOCKER = String.raw`#!/usr/bin/env bun
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const dir = dirname(process.argv[1]);
const path = join(dir, 'state.json');
const s = JSON.parse(readFileSync(path, 'utf8'));
const a = process.argv.slice(2);
appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify(a) + '\n');
function done(value = '', observation = '') {
  writeFileSync(path, JSON.stringify(s));
  let output = typeof value === 'string' ? value : JSON.stringify(value);
  if (s.oversizedStdout?.observation === observation) output = s.oversizedStdout.prefix.padEnd(2 * 1024 * 1024, '\n') + s.oversizedStdout.suffix;
  console.log(output);
  process.exit(0);
}
function fail(message) { console.error(message); process.exit(1); }
function flags(name) { return a.filter((v, i) => a[i - 1] === name); }
function flag(name) { return flags(name)[0]; }
function labels() { return Object.fromEntries(flags('--label').map(v => v.split('='))); }
function containerId(name) { return s.containers[name].legacyId ?? new Bun.CryptoHasher('sha256').update('container:' + name).digest('hex'); }
if (s.daemonError) fail('Cannot connect to the Docker daemon');
if (a[0] === 'info') done(s.addressPools ?? null, 'pools');
if (a[0] === 'ps') done(s.sessions.map(session => session.id + '\t' + session.status).join('\n'), 'inventory');
if (a[0] === 'network') {
  const name = a.at(-1);
  const idFor = name => new Bun.CryptoHasher('sha256').update(name).digest('hex');
  const inventory = { 'tale-sandbox-net': { Id: idFor('tale-sandbox-net'), IPAM: { Config: [{ Subnet: '172.18.0.0/16' }] } }, ...s.networks };
  if (a[1] === 'ls') done(Object.keys(inventory).map(idFor).join('\n'), 'networks');
  if (a[1] === 'inspect' && flag('--format').includes('"ranges"')) done(Object.entries(inventory).filter(([key]) => a.includes(idFor(key))).map(([key, value]) => JSON.stringify({ id: idFor(key), ranges: value.IPAM.Config })).join('\n'), 'network-ranges');
  if (a[1] === 'rm') {
    const key = Object.keys(s.networks).find(key => key === name || s.networks[key].Id === name);
    if (!key) fail('Error: No such network: ' + name);
    if (Object.keys(s.networks[key].Containers ?? {}).length) fail('network has active endpoints');
    delete s.networks[key]; done();
  }
  if (a[1] === 'inspect') {
    if (name === 'tale-sandbox-net') done({ [s.egressId]: { Name: 'compose-egress-1' } }, 'egress-network');
    if (!s.networks[name]) fail('Error: No such network: ' + name);
    done(s.networks[name], 'resource');
  }
  if (a[1] === 'create') {
    s.networks[name] = { Id: idFor(name), Containers: {}, Labels: labels(), Driver: flag('--driver'), Internal: a.includes('--internal'), EnableIPv6: !a.includes('--ipv6=false'), IPAM: { Config: [{ Subnet: flag('--subnet') ?? '172.31.0.0/16' }] } };
    done(name);
  }
  if (a[1] === 'connect') {
    const net = a.at(-2);
    if (s.attachments.includes(net)) fail('endpoint already exists in network');
    s.attachments.push(net);
    done();
  }
}
if (a[0] === 'volume') {
  const name = a.at(-1);
  if (a[1] === 'inspect') {
    if (!s.volumes[name]) fail('Error: No such volume: ' + name);
    done(s.volumes[name], 'resource');
  }
  if (a[1] === 'create') { s.volumes[name] ??= labels(); done(name); }
}
if (a[0] === 'inspect') {
  if (flag('--format').includes('.Config.Env')) {
    if (s.legacyReplacement) {
      const { name, id } = s.legacyReplacement;
      s.containers[name] = { ...s.containers[name], labels: {}, legacyId: id };
      delete s.legacyReplacement;
    }
    done(s.sessions.filter(session => a.includes(session.id)).map(session => 'TALE_BUILDKITD_ENDPOINT=' + session.endpoint).join('\n'), 'endpoints');
  }
  if (flag('--format').includes('"id"')) {
    done({ id: s.egressId, name: '/compose-egress-1', networks: { 'tale-sandbox-net': { Aliases: [s.egressAlias], IPAddress: '172.30.0.3' } } }, 'egress-containers');
  }
  const name = a.at(-1);
  if (!s.containers[name]) fail('Error: No such object: ' + name);
  if (flag('--format').includes('"legacyId"')) done({ ...s.containers[name], legacyId: containerId(name) }, 'resource');
  done(s.containers[name], 'resource');
}
if (a[0] === 'exec') {
  if (a[2] === 'iptables') {
    if (s.firewallFails) fail('iptables permission denied');
    if (a[3] === '-S') done('-P FORWARD ACCEPT\n' + (s.firewallBlocked ? '-A FORWARD -j DROP\n' : ''), 'firewall');
    if (a[3] === '-I') { s.firewallBlocked = true; done(); }
  }
  if (a[2] === 'test') done();
  if (a[2] === 'cat') done('[dns]\n nameservers = ["172.22.0.2"]');
  if (a[2] === 'getent') done('172.22.0.2 tale-buildkit-egress');
}
if (a[0] === 'run') {
  if (a.includes('tale.buildkit-probe=1')) {
    if (s.hostRouteFailure) fail('host route observation unavailable');
    done(JSON.stringify(s.hostRoutes ?? [{dst:'default',gateway:'172.17.0.1'},{dst:'172.17.0.0/16'}]) + '\n---tale-resolvers---\n' + (s.hostDns ?? 'nameserver 8.8.8.8\n'), 'host-routes');
  }
  const name = flag('--name');
  s.containers[name] = { labels: labels(), networks: { [flag('--network')]: {} }, ports: null, running: true };
  if (s.race && s.race.name === name) {
    s.containers[name].running = s.race.running;
    if (s.race.foreign) s.containers[name].labels['tale.org'] = 'another-org';
    writeFileSync(path, JSON.stringify(s));
    fail('container name already in use');
  }
  done(name);
}
if (a[0] === 'stop') {
  const name = Object.keys(s.containers).find(name => name === a.at(-1) || containerId(name) === a.at(-1));
  if (!name) fail('Error: No such container: ' + a.at(-1));
  s.containers[name].running = false; done();
}
if (a[0] === 'rm') { delete s.containers[a.at(-1)]; done(); }
fail('Unhandled fake docker call: ' + JSON.stringify(a));
`;

interface FakeState {
  hostRoutes?: object[];
  hostDns?: string;
  hostRouteFailure?: boolean;
  legacyReplacement?: { name: string; id: string };
  addressPools?: Array<{ Base: string; Size: number }>;
  oversizedStdout: {
    observation: string;
    prefix: string;
    suffix: string;
  } | null;
  race: { name: string; running: boolean; foreign: boolean } | null;
  sessions: Array<{ id: string; status: string; endpoint: string }>;
  networks: Record<
    string,
    {
      Id?: string;
      Containers?: Record<string, object>;
      Labels: Record<string, string>;
      Driver: string;
      Internal: boolean;
      EnableIPv6: boolean;
      IPAM: { Config: Array<{ Subnet: string }> };
    }
  >;
  volumes: Record<string, Record<string, string>>;
  containers: Record<
    string,
    {
      labels: Record<string, string>;
      networks: Record<string, object>;
      ports: Record<string, object> | null;
      running: boolean;
      legacyId?: string;
    }
  >;
  egressId: string;
  egressAlias: string;
  firewallBlocked: boolean;
  firewallFails: boolean;
  daemonError: boolean;
  attachments: string[];
}

const cfg: SpawnerConfig = {
  backend: 'docker',
  port: 8003,
  sandboxToken: 'test',
  runtimeImage: 'runtime:test',
  runtimeTier: 'sysbox',
  dockerInContainer: true,
  dockerBuildCache: true,
  buildkitdImage: 'buildkit:test',
  buildkitdMirrorImage: 'registry:2',
  transparentEgress: true,
  k8s: {
    namespace: 'sandbox',
    runtimeClassName: null,
    workspaceSizeLimit: '4Gi',
  },
  maxTimeoutMs: 300_000,
  hostSessionRoot: '/unused',
  cacheVolumePrefix: { pip: 'pip', npm: 'npm', bun: 'bun' },
  egressNetwork: 'tale-sandbox-net',
  egressProxy: 'http://sandbox-egress:3128',
  stdoutMaxBytes: 1000,
  stderrMaxBytes: 1000,
  maxRequestBodyBytes: 1000,
  session: TEST_SESSION_CONFIG,
};

let root = '';
let retireLegacyBuildkitd = createLegacyBuildkitRetirer();
const originalDockerBin = process.env.DOCKER_BIN;
function owned(organizationId: string) {
  return { 'tale.buildkitd': '1', 'tale.org': organizationId };
}
function initialState(): FakeState {
  return {
    oversizedStdout: null,
    race: null,
    sessions: [],
    networks: {},
    volumes: {},
    containers: {},
    attachments: [],
    egressId: 'a'.repeat(64),
    egressAlias: 'sandbox-egress',
    firewallBlocked: false,
    firewallFails: false,
    daemonError: false,
  };
}
async function save(snapshot: FakeState): Promise<void> {
  await writeFile(join(root, 'state.json'), JSON.stringify(snapshot));
}
async function state(): Promise<FakeState> {
  return JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
}
async function calls(): Promise<string[][]> {
  const lines = (await readFile(join(root, 'calls.jsonl'), 'utf8')).trim();
  return lines ? lines.split('\n').map((line) => JSON.parse(line)) : [];
}
async function rejection(promise: Promise<unknown>): Promise<Error | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tale-buildkit-test-'));
  const executable = join(root, 'docker');
  await writeFile(executable, FAKE_DOCKER);
  await chmod(executable, 0o755);
  process.env.DOCKER_BIN = executable;
});
beforeEach(async () => {
  retireLegacyBuildkitd = createLegacyBuildkitRetirer();
  await save(initialState());
  await writeFile(join(root, 'calls.jsonl'), '');
});
afterAll(async () => {
  if (originalDockerBin === undefined) delete process.env.DOCKER_BIN;
  else process.env.DOCKER_BIN = originalDockerBin;
  await rm(root, { recursive: true, force: true });
});

describe('organization BuildKit provisioning', () => {
  test('reads daemon-host routes and DNS before selecting a subnet', async () => {
    const seeded = initialState();
    seeded.addressPools = [{ Base: '10.0.0.0/16', Size: 23 }];
    seeded.hostRoutes = [
      { dst: '10.0.0.0/24' },
      { dst: 'default', gateway: '172.17.0.1' },
    ];
    seeded.hostDns = 'nameserver 10.0.2.12\n';
    await save(seeded);
    const name = buildkitdNetworkName('org-a');
    await ensureBuildkitNetwork(cfg, 'org-a', name);
    expect((await state()).networks[name]?.IPAM.Config[0]?.Subnet).toBe(
      '10.0.4.0/23',
    );
    const probe = (await calls()).find((args) =>
      args.includes('tale.buildkit-probe=1'),
    );
    expect(probe).toContain('host');
    expect(probe).toContain('--read-only');
    expect(probe).toContain('ALL');
    expect(probe).toContain('65534:65534');
  });

  test('does not create a network if daemon host routes cannot be observed', async () => {
    const seeded = initialState();
    seeded.hostRouteFailure = true;
    await save(seeded);
    expect(
      (
        await rejection(
          ensureBuildkitNetwork(cfg, 'org-a', buildkitdNetworkName('org-a')),
        )
      )?.message,
    ).toContain('cannot read daemon host routes');
    expect(
      (await calls()).some(
        (args) => args[0] === 'network' && args[1] === 'create',
      ),
    ).toBe(false);
    expect((await state()).networks).toEqual({});
  });

  test.each(['networks', 'network-ranges', 'host-routes', 'pools'])(
    'refuses truncated %s before claiming an explicit subnet',
    async (observation) => {
      const seeded = initialState();
      const id = new Bun.CryptoHasher('sha256')
        .update('tale-sandbox-net')
        .digest('hex');
      const prefixes: Record<string, string> = {
        networks: `${id}\n`,
        'network-ranges': JSON.stringify({
          id,
          ranges: [{ Subnet: '172.18.0.0/16' }],
        }),
        'host-routes':
          '[{"dst":"172.17.0.0/16"}]\n---tale-resolvers---\nnameserver 8.8.8.8\n',
        pools: '[]',
      };
      seeded.oversizedStdout = {
        observation,
        prefix: prefixes[observation]!,
        suffix: '',
      };
      await save(seeded);
      expect(
        (
          await rejection(
            ensureBuildkitNetwork(cfg, 'org-a', buildkitdNetworkName('org-a')),
          )
        )?.message,
      ).toMatch(/truncated/);
      expect(
        (await calls()).some(
          (args) => args[0] === 'network' && args[1] === 'create',
        ),
      ).toBe(false);
      expect((await state()).networks).toEqual({});
    },
  );

  test('allocates an explicit subnet instead of accepting the reserved default pool', async () => {
    const result = await ensureBuildkitNetwork(
      cfg,
      'org-new',
      buildkitdNetworkName('org-new'),
    );
    expect(result.network).toBe(buildkitdNetworkName('org-new'));
    const created = (await calls()).find(
      (args) => args[0] === 'network' && args[1] === 'create',
    );
    expect(created).toContain('--subnet');
    expect(
      (await state()).networks[result.network]?.IPAM.Config[0]?.Subnet,
    ).not.toBe('172.31.0.0/16');
  });

  test('recovers an unused owned network stranded in the nested Docker pool', async () => {
    const seeded = initialState();
    const name = buildkitdNetworkName('org-a');
    seeded.networks[name] = {
      Id: 'f'.repeat(64),
      Containers: {},
      Labels: owned('org-a'),
      Driver: 'bridge',
      Internal: true,
      EnableIPv6: false,
      IPAM: { Config: [{ Subnet: '172.31.0.0/16' }] },
    };
    seeded.volumes['retained-cache'] = owned('org-a');
    await save(seeded);
    await ensureBuildkitNetwork(cfg, 'org-a', name);
    await ensureBuildkitNetwork(cfg, 'org-a', name);
    const commands = await calls();
    expect(
      commands.filter((args) => args[0] === 'network' && args[1] === 'rm'),
    ).toEqual([['network', 'rm', 'f'.repeat(64)]]);
    expect(
      commands.filter((args) => args[0] === 'network' && args[1] === 'create'),
    ).toHaveLength(1);
    expect((await state()).volumes).toEqual(seeded.volumes);
  });

  test('never removes a conflicting network while an endpoint remains attached', async () => {
    const seeded = initialState();
    const name = buildkitdNetworkName('org-a');
    seeded.networks[name] = {
      Id: 'f'.repeat(64),
      Containers: { ['c'.repeat(64)]: { Name: 'live-session' } },
      Labels: owned('org-a'),
      Driver: 'bridge',
      Internal: true,
      EnableIPv6: false,
      IPAM: { Config: [{ Subnet: '172.31.0.0/16' }] },
    };
    await save(seeded);
    expect(
      (await rejection(ensureBuildkitNetwork(cfg, 'org-a', name)))?.message,
    ).toMatch(/overlaps the inner Docker/);
    expect(await calls()).toHaveLength(1);
    expect(await state()).toEqual(seeded);
  });

  test('two orgs receive private builders, mirrors and volumes; legacy cache data is preserved', async () => {
    const seeded = initialState();
    seeded.containers['tale-buildkitd'] = {
      labels: { 'tale.buildkitd': '1' },
      networks: { 'tale-sandbox-net': {} },
      ports: null,
      running: true,
    };
    seeded.volumes['tale-buildkitd-cache'] = { 'tale.buildkitd': '1' };
    seeded.volumes['tale-buildkitd-mirror-cache-docker-io'] = {
      'tale.buildkitd': '1',
    };
    await save(seeded);

    for (const org of ['org-a', 'org-b']) {
      expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
    }

    const final = await state();
    expect(final.containers['tale-buildkitd']).toEqual({
      ...seeded.containers['tale-buildkitd'],
      running: false,
    });
    expect(final.volumes['tale-buildkitd-cache']).toEqual(
      seeded.volumes['tale-buildkitd-cache'],
    );
    expect(final.volumes['tale-buildkitd-mirror-cache-docker-io']).toEqual(
      seeded.volumes['tale-buildkitd-mirror-cache-docker-io'],
    );
    expect(final.firewallBlocked).toBe(true);
    expect(Object.keys(final.volumes)).toHaveLength(10);
    for (const org of ['org-a', 'org-b']) {
      const network = buildkitdNetworkName(org);
      expect(final.networks[network]).toMatchObject({
        Labels: owned(org),
        Driver: 'bridge',
        Internal: true,
        EnableIPv6: false,
        IPAM: { Config: [{ Subnet: expect.any(String) }] },
      });
      for (const name of [
        buildkitdContainerName(org),
        ...MIRROR_REGISTRIES.map((registry) =>
          buildkitdMirrorContainerName(org, registry),
        ),
      ]) {
        expect(final.containers[name]).toMatchObject({
          labels: owned(org),
          networks: { [network]: {} },
          ports: null,
        });
        expect(Object.keys(final.containers[name]!.networks)).toEqual([
          network,
        ]);
      }
    }
    const commands = await calls();
    const launched = commands.filter(
      (a) => a[0] === 'run' && !a.includes('tale.buildkit-probe=1'),
    );
    expect(launched).toHaveLength(8);
    for (const org of ['org-a', 'org-b']) {
      const builder = launched.find((a) =>
        a.includes(buildkitdContainerName(org)),
      )!;
      expect(builder).toContain(
        'HTTPS_PROXY=http://tale-buildkit-egress:3128/',
      );
      expect(builder).toContain(
        `TALE_BUILDKITD_MIRRORS=${MIRROR_REGISTRIES.map((registry) => `${registry}=${buildkitdMirrorRef(org, registry)}`).join(';')}`,
      );
    }
    expect(commands.some((a) => a[0] === 'rm' || a[1] === 'rm')).toBe(false);
    expect(commands.findIndex((a) => a.includes('-I'))).toBeLessThan(
      commands.findIndex((a) => a[1] === 'connect'),
    );
  });

  test('coalesces same-org provisioning and reuses healthy caches after restart', async () => {
    expect(
      await Promise.all([
        ensureBuildkitd(cfg, 'org-a'),
        ensureBuildkitd(cfg, 'org-a'),
      ]),
    ).toEqual([buildkitdEndpoint('org-a'), buildkitdEndpoint('org-a')]);
    const restarted = await state();
    restarted.egressId = 'b'.repeat(64);
    restarted.attachments = [];
    restarted.firewallBlocked = false;
    await save(restarted);

    await ensureBuildkitd(cfg, 'org-a');

    const commands = await calls();
    expect(
      commands.filter(
        (a) => a[0] === 'run' && !a.includes('tale.buildkit-probe=1'),
      ),
    ).toHaveLength(4);
    expect(commands.findLast((a) => a[1] === 'connect')?.at(-1)).toBe(
      'b'.repeat(64),
    );
    expect((await state()).firewallBlocked).toBe(true);
  });

  test.each(['foreign', 'public', 'ipv6', 'dind-overlap'])(
    'refuses an unsafe existing network (%s) without modifying it',
    async (kind) => {
      const seeded = initialState();
      seeded.networks[buildkitdNetworkName('org-a')] = {
        Labels: owned(kind === 'foreign' ? 'org-b' : 'org-a'),
        Driver: 'bridge',
        Internal: kind !== 'public',
        EnableIPv6: kind === 'ipv6',
        IPAM: {
          Config: [
            {
              Subnet:
                kind === 'dind-overlap' ? '172.16.0.0/12' : '172.22.0.0/16',
            },
          ],
        },
      };
      await save(seeded);

      expect(await rejection(ensureBuildkitd(cfg, 'org-a'))).not.toBeNull();

      expect(await state()).toEqual(seeded);
      expect((await calls()).filter((a) => a[0] === 'network')).toHaveLength(1);
    },
  );

  test.each(['192.168.64.0/24', '10.80.0.0/16'])(
    'accepts RFC1918 build-network allocations supported by the proxy ACL (%s)',
    async (subnet) => {
      const seeded = initialState();
      const name = buildkitdNetworkName('org-a');
      seeded.networks[name] = {
        Labels: owned('org-a'),
        Driver: 'bridge',
        Internal: true,
        EnableIPv6: false,
        IPAM: { Config: [{ Subnet: subnet }] },
      };
      await save(seeded);

      expect(await ensureBuildkitd(cfg, 'org-a')).toBe(
        buildkitdEndpoint('org-a'),
      );

      const final = await state();
      expect(final.networks[name]).toEqual(seeded.networks[name]);
      expect(
        Object.keys(
          final.containers[buildkitdContainerName('org-a')]!.networks,
        ),
      ).toEqual([name]);
    },
  );

  test.each([
    '203.0.113.0/24',
    '172.32.0.0/16',
    '10.0.0.0/7',
    '172.16.0.0/11',
    '192.168.0.0/15',
  ])(
    'refuses a subnet extending outside RFC1918 before connecting egress (%s)',
    async (subnet) => {
      const seeded = initialState();
      seeded.networks[buildkitdNetworkName('org-a')] = {
        Labels: owned('org-a'),
        Driver: 'bridge',
        Internal: true,
        EnableIPv6: false,
        IPAM: { Config: [{ Subnet: subnet }] },
      };
      await save(seeded);

      expect((await rejection(ensureBuildkitd(cfg, 'org-a')))?.message).toMatch(
        /RFC1918|nonzero host bits/,
      );

      expect(await state()).toEqual(seeded);
      expect(
        (await calls()).some(
          (args) =>
            args[1] === 'connect' ||
            (args[0] === 'run' && !args.includes('tale.buildkit-probe=1')),
        ),
      ).toBe(false);
    },
  );

  test.each(['foreign', 'shared-network', 'published-port'])(
    'refuses an unsafe same-name builder (%s) without reaping it',
    async (kind) => {
      const seeded = initialState();
      const name = buildkitdContainerName('org-a');
      seeded.containers[name] = {
        labels: owned(kind === 'foreign' ? 'org-b' : 'org-a'),
        networks: {
          [kind === 'shared-network'
            ? cfg.egressNetwork
            : buildkitdNetworkName('org-a')]: {},
        },
        ports: kind === 'published-port' ? { '1234/tcp': {} } : null,
        running: false,
      };
      await save(seeded);

      expect(await rejection(ensureBuildkitd(cfg, 'org-a'))).not.toBeNull();

      expect((await state()).containers[name]).toEqual(seeded.containers[name]);
      expect(
        (await calls()).some(
          (a) =>
            a[0] === 'rm' ||
            (a[0] === 'run' && !a.includes('tale.buildkit-probe=1')),
        ),
      ).toBe(false);
    },
  );

  test('refuses a foreign cache volume without relabelling or deleting it', async () => {
    const seeded = initialState();
    const name = buildkitdCacheVolumeName('org-a');
    seeded.volumes[name] = owned('org-b');
    await save(seeded);

    expect((await rejection(ensureBuildkitd(cfg, 'org-a')))?.message).toMatch(
      /foreign or unowned/,
    );

    expect((await state()).volumes[name]).toEqual(owned('org-b'));
    expect(
      (await calls()).some(
        (a) =>
          (a[0] === 'run' && !a.includes('tale.buildkit-probe=1')) ||
          (a[1] === 'create' && a[0] === 'volume'),
      ),
    ).toBe(false);
  });

  test('does not attach the proxy or launch builders when forwarding cannot be blocked', async () => {
    const seeded = initialState();
    seeded.firewallFails = true;
    await save(seeded);

    expect((await rejection(ensureBuildkitd(cfg, 'org-a')))?.message).toMatch(
      /forwarding firewall/,
    );

    expect(
      (await calls()).some(
        (a) =>
          a[1] === 'connect' ||
          (a[0] === 'run' && !a.includes('tale.buildkit-probe=1')),
      ),
    ).toBe(false);
  });

  test.each(['egress-network', 'egress-containers', 'firewall'])(
    'refuses truncated %s observations before attaching the proxy',
    async (observation) => {
      const seeded = initialState();
      const network = buildkitdNetworkName('org-a');
      seeded.networks[network] = {
        Labels: owned('org-a'),
        Driver: 'bridge',
        Internal: true,
        EnableIPv6: false,
        IPAM: { Config: [{ Subnet: '172.22.0.0/16' }] },
      };
      const prefixes: Record<string, string> = {
        'egress-network': JSON.stringify({
          [seeded.egressId]: { Name: 'compose-egress-1' },
        }),
        'egress-containers': JSON.stringify({
          id: seeded.egressId,
          name: '/compose-egress-1',
          networks: {
            [cfg.egressNetwork]: {
              Aliases: [seeded.egressAlias],
              IPAddress: '172.30.0.3',
            },
          },
        }),
        firewall: '-P FORWARD ACCEPT\n-A FORWARD -j DROP\n',
      };
      seeded.oversizedStdout = {
        observation,
        prefix: prefixes[observation]!,
        suffix: '',
      };
      await save(seeded);

      expect(
        (await rejection(ensureBuildkitNetwork(cfg, 'org-a', network)))
          ?.message,
      ).toMatch(/truncated/);

      expect(await state()).toEqual(seeded);
      expect((await calls()).some((args) => args[1] === 'connect')).toBe(false);
    },
  );

  test('an unresolved proxy refuses private provisioning instead of falling back to the shared network', async () => {
    const seeded = initialState();
    seeded.egressAlias = 'another-proxy';
    await save(seeded);

    expect((await rejection(ensureBuildkitd(cfg, 'org-a')))?.message).toMatch(
      /exactly one container/,
    );

    expect(
      (await calls()).some(
        (a) =>
          a[1] === 'connect' ||
          (a[0] === 'run' && !a.includes('tale.buildkit-probe=1')),
      ),
    ).toBe(false);
  });

  test('a Docker outage is not mistaken for absent resources', async () => {
    const seeded = initialState();
    seeded.daemonError = true;
    await save(seeded);

    expect((await rejection(ensureBuildkitd(cfg, 'org-a')))?.message).toMatch(
      /Cannot connect to the Docker daemon/,
    );

    expect(await calls()).toHaveLength(1);
  });

  test.each(['healthy', 'stopped', 'foreign'])(
    'a create-name race adopts only a running owned builder (%s)',
    async (kind) => {
      const seeded = initialState();
      seeded.race = {
        name: buildkitdContainerName('org-a'),
        running: kind !== 'stopped',
        foreign: kind === 'foreign',
      };
      await save(seeded);

      const error = await rejection(ensureBuildkitd(cfg, 'org-a'));

      if (kind === 'healthy') expect(error).toBeNull();
      else
        expect(error?.message).toMatch(/failed to launch|foreign or unowned/);
      expect((await calls()).some((a) => a[0] === 'rm')).toBe(false);
    },
  );
});

describe('legacy global build-cache retirement', () => {
  test('a different configured Docker target gets its own retirement observation', async () => {
    const previous = process.env.DOCKER_BIN;
    try {
      for (const name of ['docker-empty', 'docker-legacy']) {
        const executable = join(root, name);
        await writeFile(executable, FAKE_DOCKER);
        await chmod(executable, 0o755);
        process.env.DOCKER_BIN = executable;
        await save(name === 'docker-empty' ? initialState() : legacyState());
        const expected = {
          stopped: name === 'docker-empty' ? 0 : 2,
          deferred: false,
        };
        expect(await retireConfiguredLegacyBuildkitd()).toEqual(expected);
        const observedCalls = await calls();
        expect(await retireConfiguredLegacyBuildkitd()).toEqual({
          stopped: 0,
          deferred: false,
        });
        expect(await calls()).toEqual(observedCalls);
      }
    } finally {
      if (previous === undefined) delete process.env.DOCKER_BIN;
      else process.env.DOCKER_BIN = previous;
    }
  });

  test('remembers an already retired deployment without inventorying sessions', async () => {
    await retireLegacyBuildkitd();
    const first = await calls();
    await retireLegacyBuildkitd();
    expect(first).toHaveLength(5);
    expect(first.every((args) => args[0] === 'inspect')).toBe(true);
    expect(await calls()).toEqual(first);
  });

  function legacyState(): FakeState {
    const seeded = initialState();
    for (const name of ['tale-buildkitd', 'tale-buildkitd-mirror-docker-io']) {
      seeded.containers[name] = {
        labels: { 'tale.buildkitd': '1' },
        networks: { 'tale-sandbox-net': {} },
        ports: null,
        running: true,
      };
    }
    seeded.volumes['tale-buildkitd-cache'] = { 'tale.buildkitd': '1' };
    return seeded;
  }

  test.each(['inventory', 'endpoints'])(
    'refuses truncated %s even when the visible prefix contains no legacy dependency',
    async (observation) => {
      const seeded = legacyState();
      const modernId = 'd'.repeat(64);
      const legacyId = 'c'.repeat(64);
      seeded.sessions.push(
        {
          id: modernId,
          status: 'running',
          endpoint: buildkitdEndpoint('org-a'),
        },
        {
          id: legacyId,
          status: 'running',
          endpoint: 'tcp://tale-buildkitd:1234',
        },
      );
      // The retained prefix is valid and safe-looking. Only the discarded
      // suffix reveals an active session's dependency on the legacy helper.
      seeded.oversizedStdout = {
        observation,
        prefix:
          observation === 'inventory'
            ? `${modernId}\trunning\n`
            : `TALE_BUILDKITD_ENDPOINT=${buildkitdEndpoint('org-a')}\n`,
        suffix:
          observation === 'inventory'
            ? `${legacyId}\trunning\n`
            : 'TALE_BUILDKITD_ENDPOINT=tcp://tale-buildkitd:1234\n',
      };
      await save(seeded);

      expect((await rejection(retireLegacyBuildkitd()))?.message).toMatch(
        /truncated/,
      );

      expect(await state()).toEqual(seeded);
      const commands = await calls();
      expect(commands).toHaveLength(observation === 'inventory' ? 6 : 7);
      expect(commands.some((args) => args[0] === 'stop')).toBe(false);
    },
  );

  test('refuses truncated helper ownership metadata even when its prefix is valid JSON', async () => {
    const seeded = legacyState();
    seeded.oversizedStdout = {
      observation: 'resource',
      prefix: JSON.stringify(seeded.containers['tale-buildkitd']),
      suffix: '',
    };
    await save(seeded);

    expect((await rejection(retireLegacyBuildkitd()))?.message).toMatch(
      /truncated/,
    );

    expect(await state()).toEqual(seeded);
    expect((await calls()).some((args) => args[0] === 'stop')).toBe(false);
  });

  test.each(['running', 'paused', 'restarting', 'created'])(
    'defers while an old session could still depend on global buildkit (%s)',
    async (status) => {
      const seeded = legacyState();
      seeded.sessions.push({
        id: 'c'.repeat(64),
        status,
        endpoint: 'tcp://tale-buildkitd:1234',
      });
      await save(seeded);

      expect(await retireLegacyBuildkitd()).toEqual({
        stopped: 0,
        deferred: true,
      });

      expect(await state()).toEqual(seeded);
      expect((await calls()).some((a) => a[0] === 'stop')).toBe(false);
    },
  );

  test('stops only exact legacy helpers after old sessions exit and preserves all cached data', async () => {
    const seeded = legacyState();
    seeded.sessions.push(
      {
        id: 'c'.repeat(64),
        status: 'exited',
        endpoint: 'tcp://tale-buildkitd:1234',
      },
      {
        id: 'd'.repeat(64),
        status: 'running',
        endpoint: buildkitdEndpoint('org-a'),
      },
    );
    seeded.containers['tale-buildkitd-custom'] = {
      labels: { 'tale.buildkitd': '1' },
      networks: {},
      ports: null,
      running: true,
    };
    await save(seeded);

    expect(await retireLegacyBuildkitd()).toEqual({
      stopped: 2,
      deferred: false,
    });

    const final = await state();
    expect(final.volumes).toEqual(seeded.volumes);
    expect(final.containers['tale-buildkitd']?.running).toBe(false);
    expect(final.containers['tale-buildkitd-mirror-docker-io']?.running).toBe(
      false,
    );
    expect(final.containers['tale-buildkitd-custom']).toEqual(
      seeded.containers['tale-buildkitd-custom'],
    );
    expect(
      (await calls()).filter((a) => a[0] !== 'inspect' && a[0] !== 'ps'),
    ).toEqual([
      [
        'stop',
        '--time',
        '30',
        new Bun.CryptoHasher('sha256')
          .update('container:tale-buildkitd')
          .digest('hex'),
      ],
      [
        'stop',
        '--time',
        '30',
        new Bun.CryptoHasher('sha256')
          .update('container:tale-buildkitd-mirror-docker-io')
          .digest('hex'),
      ],
    ]);
  });

  test('never stops a foreign same-name replacement during the session scan', async () => {
    const seeded = legacyState();
    seeded.legacyReplacement = { name: 'tale-buildkitd', id: 'f'.repeat(64) };
    seeded.sessions.push({
      id: 'd'.repeat(64),
      status: 'running',
      endpoint: buildkitdEndpoint('org-a'),
    });
    await save(seeded);

    expect((await rejection(retireLegacyBuildkitd()))?.message).toMatch(
      /failed to stop drained legacy helper/,
    );
    expect((await state()).containers['tale-buildkitd']).toMatchObject({
      legacyId: 'f'.repeat(64),
      labels: {},
      running: true,
    });
    expect((await calls()).filter((args) => args[0] === 'stop')).toEqual([
      [
        'stop',
        '--time',
        '30',
        new Bun.CryptoHasher('sha256')
          .update('container:tale-buildkitd')
          .digest('hex'),
      ],
    ]);
    // A failed retirement must be retried, without adopting the replacement.
    expect((await retireLegacyBuildkitd()).deferred).toBe(true);
    expect((await state()).containers['tale-buildkitd']?.running).toBe(true);
  });

  test.each(['', 'a'.repeat(12), 'invalid'])(
    'rejects an unverifiable legacy container ID (%s)',
    async (legacyId) => {
      const seeded = legacyState();
      seeded.containers['tale-buildkitd']!.legacyId = legacyId;
      await save(seeded);
      expect((await rejection(retireLegacyBuildkitd()))?.message).toMatch(
        /invalid legacy container identity/,
      );
      expect(
        (await calls()).some((args) => args[0] === 'stop' || args[0] === 'ps'),
      ).toBe(false);
    },
  );

  const foreignLabels: Array<Record<string, string>> = [
    {},
    { 'tale.buildkitd': '0' },
    { 'tale.buildkitd': '1', 'tale.org': 'org-a' },
  ];
  test.each(foreignLabels)(
    'never stops a same-name helper with foreign/missing ownership (%j)',
    async (labels) => {
      const seeded = initialState();
      seeded.containers['tale-buildkitd'] = {
        labels,
        networks: {},
        ports: null,
        running: true,
      };
      await save(seeded);

      expect(await retireLegacyBuildkitd()).toEqual({
        stopped: 0,
        deferred: true,
      });

      expect(await state()).toEqual(seeded);
      expect((await calls()).some((a) => a[0] === 'stop')).toBe(false);
    },
  );
});
