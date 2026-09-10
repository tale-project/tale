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
  retireLegacyBuildkitd,
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
if (s.daemonError) fail('Cannot connect to the Docker daemon');
if (a[0] === 'ps') done(s.sessions.map(session => session.id + '\t' + session.status).join('\n'), 'inventory');
if (a[0] === 'network') {
  const name = a.at(-1);
  if (a[1] === 'inspect') {
    if (name === 'tale-sandbox-net') done({ [s.egressId]: { Name: 'compose-egress-1' } }, 'egress-network');
    if (!s.networks[name]) fail('Error: No such network: ' + name);
    done(s.networks[name], 'resource');
  }
  if (a[1] === 'create') {
    s.networks[name] = { Labels: labels(), Driver: flag('--driver'), Internal: a.includes('--internal'), EnableIPv6: !a.includes('--ipv6=false'), IPAM: { Config: [{ Subnet: '172.22.0.0/16' }] } };
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
  if (flag('--format').includes('.Config.Env')) done(s.sessions.filter(session => a.includes(session.id)).map(session => 'TALE_BUILDKITD_ENDPOINT=' + session.endpoint).join('\n'), 'endpoints');
  if (flag('--format').includes('"id"')) {
    done({ id: s.egressId, name: '/compose-egress-1', networks: { 'tale-sandbox-net': { Aliases: [s.egressAlias], IPAddress: '172.30.0.3' } } }, 'egress-containers');
  }
  const name = a.at(-1);
  if (!s.containers[name]) fail('Error: No such object: ' + name);
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
if (a[0] === 'stop') { s.containers[a.at(-1)].running = false; done(); }
if (a[0] === 'rm') { delete s.containers[a.at(-1)]; done(); }
fail('Unhandled fake docker call: ' + JSON.stringify(a));
`;

interface FakeState {
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
  await save(initialState());
  await writeFile(join(root, 'calls.jsonl'), '');
});
afterAll(async () => {
  if (originalDockerBin === undefined) delete process.env.DOCKER_BIN;
  else process.env.DOCKER_BIN = originalDockerBin;
  await rm(root, { recursive: true, force: true });
});

describe('organization BuildKit provisioning', () => {
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
      expect(final.networks[network]).toEqual({
        Labels: owned(org),
        Driver: 'bridge',
        Internal: true,
        EnableIPv6: false,
        IPAM: { Config: [{ Subnet: '172.22.0.0/16' }] },
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
    const launched = commands.filter((a) => a[0] === 'run');
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
    expect(commands.filter((a) => a[0] === 'run')).toHaveLength(4);
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
        /RFC1918/,
      );

      expect(await state()).toEqual(seeded);
      expect(
        (await calls()).some(
          (args) => args[1] === 'connect' || args[0] === 'run',
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
      expect((await calls()).some((a) => a[0] === 'rm' || a[0] === 'run')).toBe(
        false,
      );
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
        (a) => a[0] === 'run' || (a[1] === 'create' && a[0] === 'volume'),
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
      (await calls()).some((a) => a[1] === 'connect' || a[0] === 'run'),
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
      (await calls()).some((a) => a[1] === 'connect' || a[0] === 'run'),
    ).toBe(false);
  });

  test('a Docker outage is not mistaken for absent resources', async () => {
    const seeded = initialState();
    seeded.daemonError = true;
    await save(seeded);

    expect((await rejection(ensureBuildkitd(cfg, 'org-a')))?.message).toMatch(
      /legacy sessions have drained/,
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
      expect(commands).toHaveLength(observation === 'inventory' ? 1 : 2);
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
      ['stop', '--time', '30', 'tale-buildkitd'],
      ['stop', '--time', '30', 'tale-buildkitd-mirror-docker-io'],
    ]);
  });

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
