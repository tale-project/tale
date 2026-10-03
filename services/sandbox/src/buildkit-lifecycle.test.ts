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
  buildkitHelperLimits,
  buildkitdMirrorContainerName,
  buildkitdMirrorVolumeName,
  buildkitdNetworkName,
  ensureBuildkitd,
  helperStamp,
  MIRROR_REGISTRIES,
  removeOrganizationBuildkit,
  resetDiskPressurePause,
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
  if (a.includes('label=tale.buildkitd=1')) {
    const helperOrg = flags('--filter').find(value => value.startsWith('label=tale.org='))?.slice('label=tale.org='.length);
    const withOrg = flag('--format').includes('tale.org');
    done(Object.values(s.containers).filter(c => !helperOrg || c.labels['tale.org'] === helperOrg).map(c => [c.id, c.name, ...(withOrg ? [c.labels['tale.org'] ?? ''] : [])].join('\t')).join('\n'), 'helpers');
  }
  s.sessionReads++;
  if (s.lateSession && s.sessionReads >= s.lateSession.afterRead) s.sessions = [s.lateSession.session];
  const orgFilter = flags('--filter').find(value => value.startsWith('label=tale.org='))?.slice('label=tale.org='.length);
  done(s.sessions.filter(c => !orgFilter || c.org === orgFilter).map(c => [c.id, c.status, ...(flag('--format').includes('.Label') ? [c.org] : []), ...(flag('--format').includes('tale.profile') ? [c.profile || ''] : [])].join('\t')).join('\n'), 'sessions');
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
    if (flag('--format').includes('"containers"')) done({ id: 'a'.repeat(64), labels: s.networks[name].Labels, containers: null });
    done(s.networks[name]);
  }
  if (a[1] === 'connect') done();
  if (a[1] === 'rm') { const gone = Object.keys(s.networks).find(n => n.length > 0); for (const n of Object.keys(s.networks)) if (s.networks[n] && a.at(-1) === 'a'.repeat(64)) delete s.networks[n]; done(gone ?? ''); }
}
if (a[0] === 'volume' && a[1] === 'inspect') { if (!s.volumes[a.at(-1)]) fail('Error: No such volume: ' + a.at(-1)); done(s.volumes[a.at(-1)].labels); }
if (a[0] === 'volume' && a[1] === 'rm') { if (!s.volumes[a.at(-1)]) fail('Error: No such volume'); delete s.volumes[a.at(-1)]; done(a.at(-1)); }
if (a[0] === 'exec') {
  if (a[2] === 'iptables') done('-P FORWARD ACCEPT\n-A FORWARD -j DROP\n');
  if (a[2] === 'test') done();
  if (a[2] === 'cat') done('[dns]\n nameservers = ["172.22.0.2"]');
  if (a[2] === 'getent') done('172.22.0.2 tale-buildkit-egress');
  if (a[2] === 'buildctl' && a[3] === 'prune') {
    if (s.pruneFails) fail('buildctl: failed to dial the daemon');
    if (s.pruneGate) {
      writeFileSync(join(dir, 'pruning'), a[1]);
      while (!existsSync(join(dir, 'release-prune'))) await Bun.sleep(5);
    }
    done('Total:\t0B');
  }
  if (a[2] === 'buildctl') done(s.buildRunning ? 'COMPLETE\nSTARTED\n' : 'COMPLETE\n');
}
if (a[0] === 'update') { if (!find(a.at(-1))) fail('Error: No such container'); done(); }
if (a[0] === 'image' && a[1] === 'inspect') { const id = (s.imageIds ?? {})[a.at(-1)]; if (!id) fail('Error: No such image: ' + a.at(-1)); done(id); }
if (a[0] === 'run') {
  const name = flag('--name');
  s.containers[name] = { id: (++s.nextId).toString(16).padStart(64, '0'), name, labels: Object.fromEntries(flags('--label').map(v => v.split('='))), networks: { [flag('--network')]: {} }, ports: null, running: true, image: (s.imageIds ?? {})[a.at(-1)] ?? 'sha256:' + a.at(-1) };
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
if (a[0] === 'rm') { const c = find(a.at(-1)); if (c) delete s.containers[c.name]; done(); }
fail('Unhandled fake Docker call: ' + JSON.stringify(a));
`;

interface FakeSession {
  id: string;
  status: string;
  org: string;
  profile?: string;
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
      image?: string;
      finishedAt?: string;
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
  buildRunning?: boolean;
  /** `buildctl prune` inside the builder fails. */
  pruneFails?: boolean;
  /** `buildctl prune` runs until a `release-prune` file appears. */
  pruneGate?: boolean;
  /** What `docker image inspect` answers per reference (none: no such image). */
  imageIds?: Record<string, string>;
}

const cfg: SpawnerConfig = {
  instance: '',
  hub: null,
  deviceConfigPath: null,
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
  // Helpers launched by this release with these settings.
  const stamps = [
    helperStamp(cfg.buildkitdImage, buildkitHelperLimits(cfg, 'builder')),
    ...MIRROR_REGISTRIES.map(() =>
      helperStamp(
        cfg.buildkitdMirrorImage,
        buildkitHelperLimits(cfg, 'mirror'),
      ),
    ),
  ];
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
          labels: { ...labels, 'tale.helper-config': stamps[index] ?? '' },
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
/** Run a sweep that must resolve, returning its result and what it warned. */
async function sweepWarning(
  promise: Promise<{ stopped: number }>,
): Promise<{ stopped: number; warnings: string }> {
  const warn = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    return { stopped: (await promise).stopped, warnings: lines.join('\n') };
  } finally {
    console.warn = warn;
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

  test('a builder from an earlier release is recreated once no build runs; its cache and mirrors stay', async () => {
    const org = nextOrg();
    const initial = seed(org);
    const builder = buildkitdContainerName(org);
    for (const container of Object.values(initial.containers)) {
      // Launched before helpers carried a stamp.
      delete container.labels['tale.helper-config'];
    }
    initial.buildRunning = true;
    await save(initial);

    // A build is under way: the builder and its mirrors keep serving, with
    // the CPU and process bounds applied in place — never a memory cut, which
    // on cgroup v2 OOM-kills the running build.
    expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
    let log = await calls();
    expect(log.filter((args) => args[0] === 'run')).toHaveLength(0);
    const updates = log.filter((args) => args[0] === 'update');
    const byName = (a: string, b: string) => a.localeCompare(b);
    expect(updates.map((args) => args.at(-1) ?? '').sort(byName)).toEqual(
      Object.keys(initial.containers).sort(byName),
    );
    expect(updates.find((args) => args.at(-1) === builder)).toEqual(
      expect.arrayContaining(['--cpus=2', '--pids-limit=16384']),
    );
    expect(updates.flat().some((arg) => arg.startsWith('--memory'))).toBe(
      false,
    );
    expect((await state()).containers[builder]?.id).toBe(
      initial.containers[builder]?.id,
    );

    // The build is done: the next ensure recreates the builder and its
    // mirrors on the current image and bounds, keeping every volume.
    const busy = await state();
    busy.buildRunning = false;
    await save(busy);
    await writeFile(join(root, 'calls.jsonl'), '');
    expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
    log = await calls();
    const launches = log.filter((args) => args[0] === 'run');
    expect(launches).toHaveLength(4);
    expect(
      launches.filter((args) => args.includes(cfg.buildkitdImage)),
    ).toHaveLength(1);
    expect(
      launches.find((args) => args.includes(cfg.buildkitdImage)),
    ).toContain('--memory=8192m');
    const final = await state();
    expect(final.containers[builder]?.id).not.toBe(
      initial.containers[builder]?.id,
    );
    expect(final.containers[builder]?.labels['tale.helper-config']).toBe(
      helperStamp(cfg.buildkitdImage, buildkitHelperLimits(cfg, 'builder')),
    );
    expect(final.volumes).toEqual(initial.volumes);
    // Bounds already applied are not applied again.
    expect(log.filter((args) => args[0] === 'update')).toHaveLength(0);
  });

  test('a release that re-tags the builder image in place recreates the builder once idle', async () => {
    const org = nextOrg();
    const initial = seed(org);
    const builder = buildkitdContainerName(org);
    for (const container of Object.values(initial.containers)) {
      container.image = 'sha256:previous-release';
    }
    // `tale deploy` re-tags the same reference to the new release's image;
    // the mirror image's reference resolves to nothing new here.
    initial.imageIds = { [cfg.buildkitdImage]: 'sha256:this-release' };
    initial.buildRunning = true;
    await save(initial);

    expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
    let log = await calls();
    // Same stamp: nothing to update in place, and a build is under way.
    expect(
      log.filter((args) => args[0] === 'run' || args[0] === 'update'),
    ).toEqual([]);

    const busy = await state();
    busy.buildRunning = false;
    await save(busy);
    await writeFile(join(root, 'calls.jsonl'), '');
    expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
    log = await calls();
    const launches = log.filter((args) => args[0] === 'run');
    expect(launches).toHaveLength(1);
    expect(launches[0]).toContain(builder);
    const final = await state();
    expect(final.containers[builder]?.image).toBe('sha256:this-release');
    expect(final.volumes).toEqual(initial.volumes);
  });

  describe('an organization that has not built for a long time', () => {
    const DAY = 24 * 60 * 60 * 1000;
    /** Seed `org` with every helper stopped `stoppedForMs` ago. */
    async function stoppedFor(org: string, stoppedForMs: number, now: number) {
      const initial = seed(org);
      for (const container of Object.values(initial.containers)) {
        container.running = false;
        container.finishedAt = new Date(now - stoppedForMs).toISOString();
      }
      await save(initial);
      return initial;
    }
    /** Two sweeps a full idle grace apart: the second may act. */
    async function sweepTwice(config: SpawnerConfig, now: number) {
      await sweepIdleBuildkitd(config, now);
      await sweepIdleBuildkitd(config, now + config.session.maxIdleMs + 1);
    }

    test('gives its helpers and caches back past the retention', async () => {
      const org = nextOrg();
      const now = Date.now();
      await stoppedFor(org, 15 * DAY, now);
      await sweepTwice(cfg, now);
      const after = await state();
      expect(Object.keys(after.containers)).toEqual([]);
      expect(Object.keys(after.volumes)).toEqual([]);
      expect(Object.keys(after.networks)).toEqual([]);
    });

    test('keeps them within the retention, or with the retention off', async () => {
      const now = Date.now();
      const recent = nextOrg();
      const initial = await stoppedFor(recent, 2 * DAY, now);
      await sweepTwice(cfg, now);
      expect((await state()).volumes).toEqual(initial.volumes);

      const kept = nextOrg();
      const old = await stoppedFor(kept, 60 * DAY, now);
      await sweepTwice({ ...cfg, buildkitdCacheRetentionMs: 0 }, now);
      expect((await state()).volumes).toEqual(old.volumes);
      expect(Object.keys((await state()).containers).length).toBe(4);
    });

    test('keeps them while a session of the organization may build', async () => {
      const org = nextOrg();
      const now = Date.now();
      const initial = await stoppedFor(org, 30 * DAY, now);
      initial.sessions = [{ id: 'd'.repeat(64), org, status: 'running' }];
      await save(initial);
      await sweepTwice(cfg, now);
      expect((await state()).volumes).toEqual(initial.volumes);
    });
  });

  describe('a session disk below its floor', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const GIB = 1024 ** 3;
    beforeEach(() => {
      resetDiskPressurePause();
    });
    /** Organizations whose helpers all stopped the given time ago, in one
     * daemon. */
    async function stoppedOrgs(
      orgs: ReadonlyArray<readonly [string, number]>,
      now: number,
    ): Promise<FakeState> {
      let merged: FakeState | null = null;
      for (const [index, [org, stoppedForMs]] of orgs.entries()) {
        const one = seed(org);
        for (const container of Object.values(one.containers)) {
          container.running = false;
          container.finishedAt = new Date(now - stoppedForMs).toISOString();
          // Unique per organization: the daemon finds containers by id.
          container.id = `${(index + 1).toString(16)}${container.id.slice(1)}`;
        }
        if (merged === null) merged = one;
        else {
          Object.assign(merged.containers, one.containers);
          Object.assign(merged.networks, one.networks);
          Object.assign(merged.volumes, one.volumes);
        }
      }
      if (merged === null) throw new Error('no organization seeded');
      await save(merged);
      return merged;
    }
    const cacheVolumes = (org: string) => [
      buildkitdCacheVolumeName(org),
      ...MIRROR_REGISTRIES.map((registry) =>
        buildkitdMirrorVolumeName(org, registry),
      ),
    ];
    /** A session disk with `startGiB` free and a 5 GiB floor, freeing
     * `perVolumeGiB` with each cache volume removed. */
    function sessionDisk(
      initial: FakeState,
      startGiB: number,
      perVolumeGiB: number,
    ) {
      const volumes = Object.keys(initial.volumes).length;
      return async () => {
        const removed = volumes - Object.keys((await state()).volumes).length;
        const availableBytes = (startGiB + removed * perVolumeGiB) * GIB;
        return { availableBytes, short: availableBytes < 5 * GIB };
      };
    }
    const quiet = async <T>(work: () => Promise<T>): Promise<T> => {
      const log = console.log;
      const warn = console.warn;
      console.log = () => {};
      console.warn = () => {};
      try {
        return await work();
      } finally {
        console.log = log;
        console.warn = warn;
      }
    };

    test('gives back the longest-stopped organization’s caches first, until the disk is above its floor', async () => {
      const now = Date.now();
      const [day1, day3, day2] = [nextOrg(), nextOrg(), nextOrg()];
      const initial = await stoppedOrgs(
        [
          [day1, DAY],
          [day3, 3 * DAY],
          [day2, 2 * DAY],
        ],
        now,
      );
      const result = await quiet(() =>
        sweepIdleBuildkitd(cfg, now, {
          sessionDisk: sessionDisk(initial, 4, 1),
        }),
      );
      expect(result.relieved).toBe(1);
      const after = await state();
      for (const volume of cacheVolumes(day3)) {
        expect(after.volumes[volume]).toBeUndefined();
      }
      for (const volume of [...cacheVolumes(day1), ...cacheVolumes(day2)]) {
        expect(after.volumes[volume]).toEqual(initial.volumes[volume]);
      }
    });

    test('keeps going while the disk stays short, at most three organizations a sweep', async () => {
      const now = Date.now();
      const orgs = [nextOrg(), nextOrg(), nextOrg(), nextOrg(), nextOrg()];
      const initial = await stoppedOrgs(
        orgs.map((org, index) => [org, (index + 1) * DAY] as const),
        now,
      );
      const result = await quiet(() =>
        sweepIdleBuildkitd(cfg, now, {
          sessionDisk: sessionDisk(initial, 0, 0.25),
        }),
      );
      expect(result.relieved).toBe(3);
      const after = await state();
      // The three stopped longest went; the two most recent stay.
      for (const org of orgs.slice(2)) {
        expect(after.volumes[buildkitdCacheVolumeName(org)]).toBeUndefined();
      }
      for (const org of orgs.slice(0, 2)) {
        expect(after.volumes[buildkitdCacheVolumeName(org)]).toBeDefined();
      }
    });

    test('never an organization that may build: one with a live session, or a helper still running', async () => {
      const now = Date.now();
      const [inUse, mirrorUp, idle] = [nextOrg(), nextOrg(), nextOrg()];
      const initial = await stoppedOrgs(
        [
          [inUse, 30 * DAY],
          [mirrorUp, 20 * DAY],
          [idle, DAY],
        ],
        now,
      );
      initial.sessions = [
        { id: 'f'.repeat(64), org: inUse, status: 'running' },
      ];
      const mirror =
        initial.containers[
          buildkitdMirrorContainerName(mirrorUp, MIRROR_REGISTRIES[0] ?? '')
        ];
      if (mirror === undefined) throw new Error('no mirror seeded');
      mirror.running = true;
      await save(initial);
      const result = await quiet(() =>
        sweepIdleBuildkitd(cfg, now, {
          sessionDisk: sessionDisk(initial, 0, 0.25),
        }),
      );
      expect(result.relieved).toBe(1);
      const after = await state();
      expect(after.volumes[buildkitdCacheVolumeName(idle)]).toBeUndefined();
      expect(after.volumes[buildkitdCacheVolumeName(inUse)]).toBeDefined();
      expect(after.volumes[buildkitdCacheVolumeName(mirrorUp)]).toBeDefined();
    });

    test('only repeated sub-threshold gains pause disk relief, without claiming another disk', async () => {
      const now = Date.now();
      const orgs = Array.from({ length: 7 }, () => nextOrg());
      const initial = await stoppedOrgs(
        orgs.map((org, index) => [org, (index + 1) * DAY] as const),
        now,
      );
      // The caches live on another disk: removing them frees nothing here.
      const elsewhere = sessionDisk(initial, 1, 0.0001);
      const warnings: string[] = [];
      const warn = console.warn;
      const log = console.log;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
      };
      console.log = () => {};
      try {
        const first = await sweepIdleBuildkitd(cfg, now, {
          sessionDisk: elsewhere,
        });
        expect(first.relieved).toBe(3);
        const second = await sweepIdleBuildkitd(cfg, now + 60_000, {
          sessionDisk: elsewhere,
        });
        expect(second.relieved).toBeUndefined();
        // Past the pause, a sweep tries again.
        const later = await sweepIdleBuildkitd(cfg, now + 6 * 60 * 60_000 + 1, {
          sessionDisk: elsewhere,
        });
        expect(later.relieved).toBe(3);
      } finally {
        console.warn = warn;
        console.log = log;
      }
      expect(
        warnings.filter((line) => line.includes('sub-threshold')),
      ).toHaveLength(2);
      expect(
        warnings.some((line) => line.includes('live on another disk')),
      ).toBe(false);
      expect(
        (await state()).volumes[buildkitdCacheVolumeName(orgs[0] ?? '')],
      ).toBeDefined();
    });

    test('samples the disk again after judging helpers, immediately before each removal', async () => {
      const now = Date.now();
      const orgs = Array.from({ length: 4 }, () => nextOrg());
      const initial = await stoppedOrgs(
        orgs.map((org, index) => [org, (index + 1) * DAY] as const),
        now,
      );
      const volumes = Object.keys(initial.volumes).length;
      let readings = 0;
      const result = await quiet(() =>
        sweepIdleBuildkitd(cfg, now, {
          sessionDisk: async () => {
            readings++;
            const current = await state();
            const removed = volumes - Object.keys(current.volumes).length;
            if (readings > 1 && removed === 0) {
              expect(current.sessionReads).toBeGreaterThan(
                initial.sessionReads,
              );
            }
            return {
              availableBytes: (readings === 1 ? 4 : 1 + removed * 0.01) * GIB,
              short: true,
            };
          },
        }),
      );
      expect(result.relieved).toBe(3);
      expect(readings).toBe(7);
    });

    test('the pre-removal sample excludes a competing same-org teardown', async () => {
      const now = Date.now();
      const org = nextOrg();
      await stoppedOrgs([[org, DAY]], now);
      const entered = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      let readings = 0;
      const sweep = quiet(() =>
        sweepIdleBuildkitd(cfg, now, {
          sessionDisk: async () => {
            readings++;
            if (readings === 2) {
              entered.resolve();
              await gate.promise;
            }
            return { availableBytes: GIB, short: true };
          },
        }),
      );
      await entered.promise;
      const beforeCalls = (await calls()).length;
      const competing = removeOrganizationBuildkit(org);
      try {
        await Bun.sleep(50);
        expect((await calls()).length).toBe(beforeCalls);
        expect(
          (await state()).volumes[buildkitdCacheVolumeName(org)],
        ).toBeDefined();
      } finally {
        gate.resolve();
      }
      expect((await sweep).relieved).toBe(1);
      expect(await competing).toEqual({
        containers: 0,
        volumes: 0,
        networks: 0,
      });
    });

    test.each(['healthy', 'unknown'])(
      'a %s reading resets the low-gain streak between pressure episodes',
      async (recovery) => {
        const now = Date.now();
        await stoppedOrgs(
          [
            [nextOrg(), DAY],
            [nextOrg(), DAY],
          ],
          now,
        );
        const short = async () => ({ availableBytes: GIB, short: true });
        expect(
          (
            await quiet(() =>
              sweepIdleBuildkitd(cfg, now, { sessionDisk: short }),
            )
          ).relieved,
        ).toBe(2);
        await stoppedOrgs(
          Array.from({ length: 3 }, () => [nextOrg(), DAY] as const),
          now,
        );
        await quiet(() =>
          sweepIdleBuildkitd(cfg, now + 60_000, {
            sessionDisk: async () =>
              recovery === 'unknown'
                ? null
                : { availableBytes: 10 * GIB, short: false },
          }),
        );
        expect(
          (
            await quiet(() =>
              sweepIdleBuildkitd(cfg, now + 120_000, { sessionDisk: short }),
            )
          ).relieved,
        ).toBe(3);
      },
    );

    test('a gain of at least 1 MiB resets consecutive sub-threshold gains', async () => {
      const now = Date.now();
      const orgs = Array.from({ length: 5 }, () => nextOrg());
      const initial = await stoppedOrgs(
        orgs.map((org) => [org, DAY] as const),
        now,
      );
      const volumes = Object.keys(initial.volumes).length;
      const disk = async () => {
        const removed = volumes - Object.keys((await state()).volumes).length;
        return {
          availableBytes: GIB + (removed >= 6 ? 2 * 1024 ** 2 : 0),
          short: true,
        };
      };
      expect(
        (await quiet(() => sweepIdleBuildkitd(cfg, now, { sessionDisk: disk })))
          .relieved,
      ).toBe(3);
      expect(
        (
          await quiet(() =>
            sweepIdleBuildkitd(cfg, now + 60_000, { sessionDisk: disk }),
          )
        ).relieved,
      ).toBe(2);
    });

    test('nothing goes while the disk is above its floor, or cannot be read', async () => {
      const now = Date.now();
      const org = nextOrg();
      const initial = await stoppedOrgs([[org, 10 * DAY]], now);
      for (const reading of [
        async () => ({ availableBytes: 50 * GIB, short: false }),
        async () => null,
      ]) {
        const result = await sweepIdleBuildkitd(cfg, now, {
          sessionDisk: reading,
        });
        expect(result.relieved).toBeUndefined();
      }
      expect((await state()).volumes).toEqual(initial.volumes);
    });
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
    // Every helper runs bounded; the builder, shared by the organization's
    // agent sessions, with an agent session's CPUs and twice its memory.
    const agent = cfg.session.agentProfile;
    expect(agent.memory).toBe('4g');
    for (const args of launches) {
      const builder = args.includes('--privileged');
      expect(args).toContain(`--memory=${builder ? '8192m' : '512m'}`);
      expect(args).toContain(`--cpus=${builder ? agent.cpus : 1}`);
      expect(args.some((arg) => arg.startsWith('--pids-limit='))).toBe(true);
      expect(args).toContain('--oom-score-adj=500');
      expect(args).toContain('max-size=10m');
    }
  });

  test("an idle organization's builder prunes its cache to the idle budget right before it stops", async () => {
    const org = nextOrg();
    const initial = seed(org);
    const builderId = initial.containers[buildkitdContainerName(org)]?.id;
    const now = Date.now();
    await save(initial);

    await sweepIdleBuildkitd(cfg, now);
    expect(await sweepIdleBuildkitd(cfg, now + 1000)).toEqual({
      stopped: 4,
      organizations: 1,
    });
    const log = await calls();
    const prunes = log.filter((args) => args[3] === 'prune');
    // The builder alone: the mirrors' storage is no BuildKit cache.
    expect(prunes).toEqual([
      [
        'exec',
        builderId ?? '',
        'buildctl',
        'prune',
        '--all',
        '--keep-storage',
        String(Math.floor((5 * 1024 ** 3) / 1e6)),
      ],
    ]);
    const firstStop = log.findIndex((args) => args[0] === 'stop');
    expect(log.findIndex((args) => args[3] === 'prune')).toBeLessThan(
      firstStop,
    );
    expect(log[firstStop]).toEqual(['stop', '--time', '30', builderId ?? '']);
  });

  test('a configured idle budget is used, and a prune that fails still lets the helpers stop', async () => {
    const org = nextOrg();
    const initial = seed(org);
    initial.pruneFails = true;
    const now = Date.now();
    await save(initial);
    const budgeted = { ...cfg, buildkitdIdleCacheBytes: 2 * 1024 ** 3 };

    await sweepIdleBuildkitd(budgeted, now);
    const { stopped, warnings } = await sweepWarning(
      sweepIdleBuildkitd(budgeted, now + 1000),
    );
    expect(stopped).toBe(4);
    expect(warnings).toContain('could not prune the idle build cache');
    expect((await calls()).find((args) => args[3] === 'prune')?.at(-1)).toBe(
      String(Math.floor((2 * 1024 ** 3) / 1e6)),
    );
    expect(
      Object.values((await state()).containers).every(
        (container) => !container.running,
      ),
    ).toBe(true);
  });

  test('a create that needs the builder cuts its idle prune short and keeps every helper running', async () => {
    const org = nextOrg();
    const initial = seed(org);
    initial.pruneGate = true;
    const now = Date.now();
    await rm(join(root, 'pruning'), { force: true });
    await rm(join(root, 'release-prune'), { force: true });
    await save(initial);

    await sweepIdleBuildkitd(cfg, now);
    const sweep = sweepIdleBuildkitd(cfg, now + 1000);
    for (let i = 0; i < 400; i += 1) {
      if (await Bun.file(join(root, 'pruning')).exists()) break;
      await Bun.sleep(5);
    }
    // A session create of the organization takes its lease meanwhile.
    const release = retainBuildkitd(org);
    try {
      expect(await sweep).toEqual({ stopped: 0, organizations: 0 });
    } finally {
      release();
      await writeFile(join(root, 'release-prune'), '');
    }
    expect((await calls()).some((args) => args[0] === 'stop')).toBe(false);
    expect(
      Object.values((await state()).containers).every(
        (container) => container.running,
      ),
    ).toBe(true);
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

      if (oversized === 'resource') {
        // One organization's unreadable helper is that organization's
        // failure: logged, retried next sweep, and nothing stopped.
        const swept = await sweepWarning(sweepIdleBuildkitd(cfg, now + 1000));
        expect(swept.stopped).toBe(0);
        expect(swept.warnings).toMatch(/truncated/);
      } else {
        expect(await rejection(sweepIdleBuildkitd(cfg, now + 1000))).toMatch(
          /truncated/,
        );
      }
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
      const swept = await sweepWarning(sweepIdleBuildkitd(cfg, now + 1000));
      expect(swept.stopped).toBe(0);
      expect(swept.warnings).toMatch(/refusing/);
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
    const swept = await sweepWarning(sweepIdleBuildkitd(cfg, now + 1000));
    expect(swept.stopped).toBe(0);
    expect(swept.warnings).toMatch(/failed to stop idle helper/);
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

  test("one organization's failing stop does not keep another organization's helpers running", async () => {
    const failing = nextOrg();
    const healthy = nextOrg();
    const first = seed(failing);
    const second = seed(healthy);
    // Distinct container ids for the second organization's helpers.
    for (const [index, container] of Object.values(
      second.containers,
    ).entries()) {
      container.id = String(index + 11).padStart(64, '0');
    }
    await save({
      ...first,
      containers: { ...first.containers, ...second.containers },
      networks: { ...first.networks, ...second.networks },
      volumes: { ...first.volumes, ...second.volumes },
      stopFails: buildkitdContainerName(failing),
    });
    const now = Date.now();
    await sweepIdleBuildkitd(cfg, now);
    const swept = await sweepWarning(sweepIdleBuildkitd(cfg, now + 1000));
    expect(swept.stopped).toBe(4);
    expect(swept.warnings).toMatch(/failed to stop idle helper/);
    const containers = Object.values((await state()).containers);
    expect(
      containers
        .filter((container) => container.labels['tale.org'] === healthy)
        .every((container) => !container.running),
    ).toBe(true);
    expect(
      containers
        .filter((container) => container.labels['tale.org'] === failing)
        .every((container) => container.running),
    ).toBe(true);
  });

  test("a running session of the organization's that never builds does not keep its helpers", async () => {
    const org = nextOrg();
    const initial = seed(org);
    initial.sessions = [
      { id: 'd'.repeat(64), org, status: 'running', profile: 'default' },
    ];
    await save(initial);
    const now = Date.now();
    await sweepIdleBuildkitd(cfg, now);
    expect((await sweepIdleBuildkitd(cfg, now + 1000)).stopped).toBe(4);
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
