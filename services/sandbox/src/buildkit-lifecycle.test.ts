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
  buildkitdCacheVolumeName,
  buildkitdContainerName,
  buildkitdEndpoint,
  buildkitdMirrorContainerName,
  buildkitdMirrorVolumeName,
  buildkitdNetworkName,
  ensureBuildkitd,
  MIRROR_REGISTRIES,
  retainBuildkitd,
  sweepIdleBuildkitd,
} from './buildkitd.ts';
import { TEST_SESSION_CONFIG } from './session/session-test-config.ts';
import type { SpawnerConfig } from './types.ts';

// Runs the actual orchestration against an isolated fake Docker CLI. Persistent
// cache contents are represented independently of replaceable containers.
const FAKE_DOCKER = String.raw`#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
const dir = dirname(process.argv[1]);
const path = join(dir, 'state.json');
const s = JSON.parse(readFileSync(path, 'utf8'));
const a = process.argv.slice(2);
appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify(a) + '\n');
const flags = name => a.filter((_, i) => a[i - 1] === name);
const flag = name => flags(name)[0];
function done(value = '', observation = '') {
  writeFileSync(path, JSON.stringify(s));
  let output = typeof value === 'string' ? value : JSON.stringify(value);
  if (s.oversized === observation && observation) output = output.padEnd(2 * 1024 * 1024, '\n');
  console.log(output); process.exit(0);
}
function fail(message) { console.error(message); process.exit(1); }
const find = key => Object.values(s.containers).find(c => c.id === key || c.name === key);
if (s.daemonError) fail('Cannot connect to the Docker daemon');
if (a[0] === 'ps') {
  if (a.includes('label=tale.buildkitd=1')) done(Object.values(s.containers).map(c => [c.id, c.name, c.labels['tale.org'] ?? ''].join('\t')).join('\n'), 'helpers');
  s.sessionReads++;
  if (s.lateSession && s.sessionReads >= s.lateSession.afterRead) s.sessions = [s.lateSession.session];
  const orgFilter = flags('--filter').find(value => value.startsWith('label=tale.org='))?.slice('label=tale.org='.length);
  done(s.sessions.filter(c => !orgFilter || c.org === orgFilter).map(c => [c.id, c.status, ...(flag('--format').includes('.Label') ? [c.org] : [])].join('\t')).join('\n'), 'sessions');
}
if (a[0] === 'inspect') {
  if (flag('--format').includes('"id"')) done({ id: s.egressId, name: '/egress', networks: { 'tale-sandbox-net': { Aliases: ['sandbox-egress'], IPAddress: '172.22.0.2' } } });
  if (flag('--format').includes('.Config.Env')) done('');
  const c = find(a.at(-1));
  if (!c) fail('Error: No such object: ' + a.at(-1));
  done(c, 'resource');
}
if (a[0] === 'network') {
  if (a[1] === 'inspect') {
    const name = a.at(-1);
    if (name === 'tale-sandbox-net') done({ [s.egressId]: { Name: 'egress' } });
    if (!s.networks[name]) fail('Error: No such network: ' + name);
    done(s.networks[name]);
  }
  if (a[1] === 'connect') done();
}
if (a[0] === 'volume' && a[1] === 'inspect') done(s.volumes[a.at(-1)].labels);
if (a[0] === 'exec') {
  if (a[2] === 'iptables') done('-P FORWARD ACCEPT\n-A FORWARD -j DROP\n');
  if (a[2] === 'test') done();
  if (a[2] === 'cat') done('[dns]\n nameservers = ["172.22.0.2"]');
  if (a[2] === 'getent') done('172.22.0.2 tale-buildkit-egress');
}
if (a[0] === 'run') {
  const name = flag('--name');
  s.containers[name] = { id: (++s.nextId).toString(16).padStart(64, '0'), name, labels: Object.fromEntries(flags('--label').map(v => v.split('='))), networks: { [flag('--network')]: {} }, ports: null, running: true };
  done(s.containers[name].id);
}
if (a[0] === 'stop') {
  const c = find(a.at(-1));
  if (!c) fail('Error: No such object');
  if (s.stopFails === c.name) fail('stop failed');
  if (s.stopGate && !existsSync(join(dir, 'release-stop'))) {
    writeFileSync(join(dir, 'stopping'), c.name);
    while (!existsSync(join(dir, 'release-stop'))) await Bun.sleep(5);
  }
  c.running = false; done();
}
if (a[0] === 'rm') { delete s.containers[a.at(-1)]; done(); }
fail('Unhandled fake Docker call: ' + JSON.stringify(a));
`;

interface FakeSession {
  id: string;
  status: string;
  org: string;
}

interface FakeState {
  containers: Record<
    string,
    {
      id: string;
      name: string;
      labels: Record<string, string>;
      networks: Record<string, object>;
      ports: Record<string, object> | null;
      running: boolean;
    }
  >;
  networks: Record<string, object>;
  volumes: Record<string, { labels: Record<string, string>; sentinel: string }>;
  sessions: FakeSession[];
  sessionReads: number;
  lateSession: { afterRead: number; session: FakeSession } | null;
  nextId: number;
  egressId: string;
  oversized: string | null;
  daemonError: boolean;
  stopFails: string | null;
  stopGate: boolean;
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
  session: { ...TEST_SESSION_CONFIG, maxIdleMs: 1000 },
};

let root = '';
let orgSequence = 0;
const originalDockerBin = process.env.DOCKER_BIN;

function seed(organizationId: string): FakeState {
  const labels = { 'tale.buildkitd': '1', 'tale.org': organizationId };
  const network = buildkitdNetworkName(organizationId);
  return {
    containers: Object.fromEntries(
      [
        buildkitdContainerName(organizationId),
        ...MIRROR_REGISTRIES.map((registry) =>
          buildkitdMirrorContainerName(organizationId, registry),
        ),
      ].map((name, index) => [
        name,
        {
          id: String(index + 1).padStart(64, '0'),
          name,
          labels,
          networks: { [network]: {} },
          ports: null,
          running: true,
        },
      ]),
    ),
    networks: {
      [network]: {
        Labels: labels,
        Driver: 'bridge',
        Internal: true,
        EnableIPv6: false,
        IPAM: { Config: [{ Subnet: '172.22.0.0/16' }] },
      },
    },
    volumes: Object.fromEntries(
      [
        buildkitdCacheVolumeName(organizationId),
        ...MIRROR_REGISTRIES.map((registry) =>
          buildkitdMirrorVolumeName(organizationId, registry),
        ),
      ].map((name) => [name, { labels, sentinel: `cached-content-${name}` }]),
    ),
    sessions: [],
    sessionReads: 0,
    lateSession: null,
    nextId: 100,
    egressId: 'e'.repeat(64),
    oversized: null,
    daemonError: false,
    stopFails: null,
    stopGate: false,
  };
}

async function save(value: FakeState): Promise<void> {
  await writeFile(join(root, 'state.json'), JSON.stringify(value));
}
async function state(): Promise<FakeState> {
  return JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
}
async function calls(): Promise<string[][]> {
  const lines = (await readFile(join(root, 'calls.jsonl'), 'utf8')).trim();
  return lines ? lines.split('\n').map((line) => JSON.parse(line)) : [];
}
async function rejection(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
function nextOrg(): string {
  return `lifecycle-org-${++orgSequence}`;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tale-buildkit-lifecycle-'));
  const executable = join(root, 'docker');
  await writeFile(executable, FAKE_DOCKER);
  await chmod(executable, 0o755);
  process.env.DOCKER_BIN = executable;
});
beforeEach(async () => {
  await writeFile(join(root, 'calls.jsonl'), '');
});
afterAll(async () => {
  if (originalDockerBin === undefined) delete process.env.DOCKER_BIN;
  else process.env.DOCKER_BIN = originalDockerBin;
  await rm(root, { recursive: true, force: true });
});

describe('organization build-cache lifecycle', () => {
  test('a healthy running builder revives stopped mirrors and preserves their cached content', async () => {
    const org = nextOrg();
    const initial = seed(org);
    for (const registry of MIRROR_REGISTRIES) {
      initial.containers[buildkitdMirrorContainerName(org, registry)]!.running =
        false;
    }
    await save(initial);

    expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));

    const final = await state();
    expect(
      Object.values(final.containers).every((container) => container.running),
    ).toBe(true);
    expect(final.volumes).toEqual(initial.volumes);
    expect(final.containers[buildkitdContainerName(org)]).toEqual(
      initial.containers[buildkitdContainerName(org)],
    );
    expect((await calls()).filter((args) => args[0] === 'run')).toHaveLength(3);
  });

  test('idle-stop releases all four helpers after the existing grace, preserving caches and network for resume', async () => {
    const org = nextOrg();
    const initial = seed(org);
    const now = Date.now();
    await save(initial);

    expect(await sweepIdleBuildkitd(cfg, now)).toEqual({
      stopped: 0,
      organizations: 0,
    });
    expect(await sweepIdleBuildkitd(cfg, now + 999)).toEqual({
      stopped: 0,
      organizations: 0,
    });
    expect(await sweepIdleBuildkitd(cfg, now + 1000)).toEqual({
      stopped: 4,
      organizations: 1,
    });

    const stopped = await state();
    expect(
      Object.values(stopped.containers).every(
        (container) => !container.running,
      ),
    ).toBe(true);
    expect(stopped.networks).toEqual(initial.networks);
    expect(stopped.volumes).toEqual(initial.volumes);
    const stoppedCommands = await calls();
    expect(
      stoppedCommands
        .filter((args) => args[0] === 'stop')
        .map((args) => args.at(-1)),
    ).toEqual(
      Object.values(initial.containers).map((container) => container.id),
    );
    expect(
      stoppedCommands.some((args) => args[0] === 'rm' || args[1] === 'rm'),
    ).toBe(false);

    expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
    const resumed = await state();
    expect(
      Object.values(resumed.containers).every((container) => container.running),
    ).toBe(true);
    expect(resumed.volumes).toEqual(initial.volumes);
    expect(resumed.networks).toEqual(initial.networks);
    const launches = (await calls()).filter((args) => args[0] === 'run');
    expect(launches).toHaveLength(4);
    expect(
      launches.filter((args) => args.includes('--privileged')),
    ).toHaveLength(1);
    expect(launches.find((args) => args.includes('--privileged'))).toContain(
      buildkitdContainerName(org),
    );
  });

  test.each([
    'running',
    'paused',
    'created',
    'restarting',
    'removing',
    'unknown',
  ])(
    'a %s session keeps its organization helpers alive until a full grace after it exits',
    async (status) => {
      const org = nextOrg();
      const initial = seed(org);
      initial.sessions = [{ id: 'c'.repeat(64), org, status }];
      await save(initial);
      const now = Date.now();

      expect((await sweepIdleBuildkitd(cfg, now)).stopped).toBe(0);
      expect((await sweepIdleBuildkitd(cfg, now + 2000)).stopped).toBe(0);

      const drained = await state();
      drained.sessions[0]!.status = 'exited';
      await save(drained);
      expect((await sweepIdleBuildkitd(cfg, now + 3000)).stopped).toBe(0);
      expect((await sweepIdleBuildkitd(cfg, now + 4000)).stopped).toBe(4);
    },
  );

  test('another organization’s live session does not retain idle helpers', async () => {
    const org = nextOrg();
    const initial = seed(org);
    initial.sessions = [
      { id: 'c'.repeat(64), org: 'other-organization', status: 'running' },
    ];
    await save(initial);
    const now = Date.now();

    await sweepIdleBuildkitd(cfg, now);
    expect((await sweepIdleBuildkitd(cfg, now + 1000)).stopped).toBe(4);
  });

  test('concurrent creation leases retain helpers before Docker exposes a session and release idempotently', async () => {
    const org = nextOrg();
    await save(seed(org));
    const now = Date.now();
    await sweepIdleBuildkitd(cfg, now);

    const first = retainBuildkitd(org);
    const second = retainBuildkitd(org);
    try {
      expect((await sweepIdleBuildkitd(cfg, now + 1000)).stopped).toBe(0);
      first();
      first();
      expect((await sweepIdleBuildkitd(cfg, now + 2000)).stopped).toBe(0);
    } finally {
      first();
      second();
    }
    expect((await sweepIdleBuildkitd(cfg, now + 3000)).stopped).toBe(0);
    expect((await sweepIdleBuildkitd(cfg, now + 4000)).stopped).toBe(4);
  });

  test('a session appearing after initial inventory cancels stopping before the first mutation', async () => {
    const org = nextOrg();
    const initial = seed(org);
    initial.lateSession = {
      afterRead: 3,
      session: { id: 'c'.repeat(64), org, status: 'created' },
    };
    await save(initial);
    const now = Date.now();

    await sweepIdleBuildkitd(cfg, now);
    expect((await sweepIdleBuildkitd(cfg, now + 1000)).stopped).toBe(0);
    expect((await calls()).some((args) => args[0] === 'stop')).toBe(false);
  });

  test.each(['helpers', 'sessions', 'resource'])(
    'truncated %s metadata cannot authorize an idle stop',
    async (oversized) => {
      const org = nextOrg();
      await save(seed(org));
      const now = Date.now();
      await sweepIdleBuildkitd(cfg, now);
      const failed = await state();
      failed.oversized = oversized;
      await save(failed);

      expect(await rejection(sweepIdleBuildkitd(cfg, now + 1000))).toMatch(
        /truncated/,
      );
      expect((await calls()).some((args) => args[0] === 'stop')).toBe(false);
    },
  );

  test('a Docker outage defers stopping instead of treating session inventory as empty', async () => {
    const org = nextOrg();
    await save(seed(org));
    const now = Date.now();
    await sweepIdleBuildkitd(cfg, now);
    const failed = await state();
    failed.daemonError = true;
    await save(failed);

    expect(await rejection(sweepIdleBuildkitd(cfg, now + 1000))).toMatch(
      /cannot inventory/,
    );
    expect((await calls()).some((args) => args[0] === 'stop')).toBe(false);
  });

  test.each(['labels', 'network', 'ports'])(
    'every helper’s %s are validated before stopping the builder',
    async (broken) => {
      const org = nextOrg();
      const initial = seed(org);
      const mirror =
        initial.containers[buildkitdMirrorContainerName(org, 'ghcr.io')]!;
      if (broken === 'labels')
        mirror.labels = { ...mirror.labels, 'tale.buildkitd': '0' };
      if (broken === 'network') mirror.networks = { 'foreign-network': {} };
      if (broken === 'ports') mirror.ports = { '5000/tcp': {} };
      await save(initial);
      const now = Date.now();

      await sweepIdleBuildkitd(cfg, now);
      expect(await rejection(sweepIdleBuildkitd(cfg, now + 1000))).toMatch(
        /refusing/,
      );
      expect((await calls()).some((args) => args[0] === 'stop')).toBe(false);
    },
  );

  test('a failed builder stop leaves all mirrors available and is retried on the next sweep', async () => {
    const org = nextOrg();
    const initial = seed(org);
    initial.stopFails = buildkitdContainerName(org);
    await save(initial);
    const now = Date.now();

    await sweepIdleBuildkitd(cfg, now);
    expect(await rejection(sweepIdleBuildkitd(cfg, now + 1000))).toMatch(
      /failed to stop idle helper/,
    );
    expect(
      Object.values((await state()).containers).every(
        (container) => container.running,
      ),
    ).toBe(true);
    expect((await calls()).filter((args) => args[0] === 'stop')).toHaveLength(
      1,
    );

    const recovered = await state();
    recovered.stopFails = null;
    await save(recovered);
    expect((await sweepIdleBuildkitd(cfg, now + 2000)).stopped).toBe(4);
  });

  test('an ensure arriving during an idle stop waits, then restores every helper', async () => {
    const org = nextOrg();
    const initial = seed(org);
    initial.stopGate = true;
    await save(initial);
    const now = Date.now();
    await sweepIdleBuildkitd(cfg, now);
    const sweep = sweepIdleBuildkitd(cfg, now + 1000);
    const deadline = Date.now() + 2000;
    while (!(await Bun.file(join(root, 'stopping')).exists())) {
      if (Date.now() > deadline)
        throw new Error('fake stop did not reach its gate');
      await Bun.sleep(5);
    }
    const ensure = ensureBuildkitd(cfg, org);
    await writeFile(join(root, 'release-stop'), '1');

    expect((await sweep).stopped).toBe(1);
    expect(await ensure).toBe(buildkitdEndpoint(org));
    const final = await state();
    expect(
      Object.values(final.containers).every((container) => container.running),
    ).toBe(true);
    expect(final.volumes).toEqual(initial.volumes);
  });

  test('Kubernetes never invokes Docker and disabling build cache still reaps old idle helpers', async () => {
    const org = nextOrg();
    await save(seed(org));
    const now = Date.now();
    expect(
      (await sweepIdleBuildkitd({ ...cfg, backend: 'kubernetes' }, now))
        .stopped,
    ).toBe(0);
    expect(await calls()).toHaveLength(0);
    await sweepIdleBuildkitd({ ...cfg, dockerBuildCache: false }, now);
    expect(
      (
        await sweepIdleBuildkitd(
          { ...cfg, dockerBuildCache: false },
          now + 1000,
        )
      ).stopped,
    ).toBe(4);
  });
});
