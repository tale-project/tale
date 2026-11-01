import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildkitCacheBudget,
  buildkitdCacheVolumeName,
  buildkitdContainerName,
  buildkitdEndpoint,
  builderConfiguration,
  builderLaunchRecord,
  builderParallelism,
  buildkitHelperLimits,
  buildkitMirrorEnvironment,
  buildkitdMirrorContainerName,
  buildkitdMirrorRef,
  buildkitdMirrorVolumeName,
  buildkitdNetworkName,
  ensureBuildkitd,
  forgetBuilderIdleAnchors,
  helperStamp,
  MIRROR_REGISTRIES,
  removeOrganizationBuildkit,
  resetBuildkitObservations,
  resetDiskPressurePause,
  retainBuildkitd,
  setBuilderIdleClock,
  setBuilderIdleFollowUpScheduler,
  sweepIdleBuildkitd,
} from './buildkitd.ts';
import { withOperationBudget } from './operation-budget.ts';
import { TEST_SESSION_CONFIG } from './session/session-test-config.ts';
import { dockerCliLoad } from './spawn-util.ts';
import type { SpawnerConfig } from './types.ts';

// Runs the actual orchestration against an isolated fake Docker CLI. Persistent
// cache contents are represented independently of replaceable containers.
const FAKE_DOCKER = String.raw`#!/usr/bin/env bun
import { mkdirSync as lockDir, rmdirSync as unlockDir, renameSync } from 'node:fs';
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
const dir = dirname(process.argv[1]);
const path = join(dir, 'state.json');
const s = JSON.parse(readFileSync(path, 'utf8'));
const before = structuredClone(s);
// Merge only this command's mutations into the fake daemon's state. Atomic
// rename keeps concurrent readers from observing half of the JSON file.
function merge(old, next, live) {
  if (JSON.stringify(old) === JSON.stringify(next)) return live;
  if (old && next && !Array.isArray(next) && typeof old === 'object' && typeof next === 'object') {
    const out = { ...live };
    for (const key of Object.keys(old)) if (!(key in next)) delete out[key];
    for (const key of Object.keys(next)) out[key] = merge(old[key], next[key], live?.[key]);
    return out;
  }
  return next;
}
function commit() {
  const lock = join(dir, 'state.lock');
  while (true) {
    try { lockDir(lock); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1); }
  }
  try {
    const live = JSON.parse(readFileSync(path, 'utf8'));
    const temp = path + '.' + process.pid;
    writeFileSync(temp, JSON.stringify(merge(before, s, live)));
    renameSync(temp, path);
  } finally { unlockDir(lock); }
}

const a = process.argv.slice(2);
appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify(a) + '\n');
const flags = name => a.filter((_, i) => a[i - 1] === name);
const flag = name => flags(name)[0];
function done(value = '', observation = '') {
  commit();
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
    const withState = flag('--format').includes('.State');
    done(Object.values(s.containers).filter(c => !helperOrg || c.labels['tale.org'] === helperOrg).map(c => [c.id, c.name, ...(withOrg ? [c.labels['tale.org'] ?? ''] : []), ...(withState ? [c.running ? 'running' : 'exited'] : [])].join('\t')).join('\n'), 'helpers');
  }
  s.sessionReads++;
  if (s.lateSession && s.sessionReads >= s.lateSession.afterRead) s.sessions = [s.lateSession.session];
  const orgFilter = flags('--filter').find(value => value.startsWith('label=tale.org='))?.slice('label=tale.org='.length);
  done(s.sessions.filter(c => !orgFilter || c.org === orgFilter).map(c => [c.id, c.status, ...(flag('--format').includes('.Label') ? [c.org] : []), ...(flag('--format').includes('tale.profile') ? [c.profile || ''] : []), ...(flag('--format').includes('tale.docker') ? [c.docker ?? ''] : [])].join('\t')).join('\n'), 'sessions');
}
const networkId = name => new Bun.CryptoHasher('sha256').update(name).digest('hex');
// Docker names each endpoint's network by id too.
const endpoints = networks => Object.fromEntries(Object.entries(networks).map(([name, value]) => [name, { NetworkID: networkId(name), ...value }]));
const egress = () => ({ id: s.egressId, name: '/egress', running: true, startedAt: s.egressStartedAt ?? '2026-10-01T00:00:00Z', networks: { 'tale-sandbox-net': { Aliases: ['sandbox-egress'], IPAddress: '172.30.0.2' }, ...Object.fromEntries((s.egressAttached ?? []).map(name => [name, { Aliases: ['tale-buildkit-egress'], IPAddress: '172.22.0.2', NetworkID: networkId(name) }])) } });
if (a[0] === 'inspect') {
  if (flag('--format').includes('.Config.Env')) done('');
  // Every target answers on its own line; missing ones fail the call after
  // the others are printed, as the Docker CLI does.
  const lines = [];
  const missing = [];
  for (const target of a.slice(a.indexOf('--format') + 2)) {
    if (target === s.egressId) { lines.push(JSON.stringify(egress())); continue; }
    const c = find(target);
    if (!c) { missing.push(target); continue; }
    lines.push(JSON.stringify({ ...c, name: '/' + c.name, startedAt: c.startedAt ?? '2026-10-01T00:00:00Z', networks: endpoints(c.networks) }));
  }
  if (missing.length) {
    commit();
    if (lines.length) console.log(lines.join('\n'));
    console.error(missing.map(target => 'Error: No such object: ' + target).join('\n'));
    process.exit(1);
  }
  done(lines.join('\n'), 'resource');
}
if (a[0] === 'network') {
  if (a[1] === 'inspect') {
    const name = a.at(-1);
    if (name === 'tale-sandbox-net') done({ [s.egressId]: { Name: 'egress' } });
    if (!s.networks[name]) fail('Error: No such network: ' + name);
    if (flag('--format').includes('"containers"')) done({ id: 'a'.repeat(64), labels: s.networks[name].Labels, containers: null });
    const network = { Id: networkId(name), ...s.networks[name] };
    if ((s.egressAttached ?? []).includes(name)) network.Containers = { [s.egressId]: { Name: 'egress' } };
    done(network);
  }
  if (a[1] === 'connect') { s.egressAttached = [...new Set([...(s.egressAttached ?? []), a.at(-2)])]; done(); }
  if (a[1] === 'rm') { const gone = Object.keys(s.networks).find(n => n.length > 0); for (const n of Object.keys(s.networks)) if (s.networks[n] && a.at(-1) === 'a'.repeat(64)) delete s.networks[n]; done(gone ?? ''); }
}
if (a[0] === 'volume' && a[1] === 'inspect') { if (!s.volumes[a.at(-1)]) fail('Error: No such volume: ' + a.at(-1)); done(s.volumes[a.at(-1)].labels); }
if (a[0] === 'volume' && a[1] === 'create') { s.volumes[a.at(-1)] ??= { labels: Object.fromEntries(flags('--label').map(v => v.split('='))), sentinel: 'empty' }; done(a.at(-1)); }
if (a[0] === 'volume' && a[1] === 'rm') { if (!s.volumes[a.at(-1)]) fail('Error: No such volume'); delete s.volumes[a.at(-1)]; done(a.at(-1)); }
if (a[0] === 'exec') {
  if (a[2] === 'iptables') done('-P FORWARD ACCEPT\n-A FORWARD -j DROP\n');
  if (a[2] === '/bin/sh') {
    if (s.fenceExecFails) fail('container is restarting');
    done(s.fenceProbe ?? '#tale-fence marker 0\n#tale-fence toml\n[dns]\n nameservers = ["172.22.0.2"]\n#tale-fence resolved\n172.22.0.2 tale-buildkit-egress');
  }
  if (a[2] === 'buildctl' && a[3] === 'prune') {
    if (s.pruneFails) fail('buildctl: failed to dial the daemon');
    if (s.pruneGate) {
      writeFileSync(join(dir, 'pruning'), a[1]);
      while (!existsSync(join(dir, 'release-prune'))) await Bun.sleep(5);
      console.log('Total:\t0B'); process.exit(0);
    }
    done('Total:\t0B');
  }
  if (a[2] === 'buildctl') {
    // Reading the history takes this long on the test's clock.
    if (s.historyReadMs) s.historyClockMs = (s.historyClockMs ?? 0) + s.historyReadMs;
    // One line per build record, its type and ref; a format without the ref
    // prints the type alone.
    const history = !s.histories?.length ? (s.buildRunning ? 'COMPLETE build-1\nSTARTED build-2\n' : 'COMPLETE build-1\n') : s.histories.length > 1 ? s.histories.shift() : s.histories[0];
    if (history === null) { commit(); fail('buildctl: failed to dial the daemon'); }
    done(flag('--format').includes('.Ref') ? history : history.split('\n').map(line => line.split(' ')[0]).join('\n'));
  }
}
if (a[0] === 'update') {
  if (!find(a.at(-1))) fail('Error: No such container');
  if (s.updateGate) {
    writeFileSync(join(dir, 'updating'), a.at(-1));
    while (!existsSync(join(dir, 'release-update'))) await Bun.sleep(5);
  }
  done();
}
if (a[0] === 'image' && a[1] === 'inspect') { const id = (s.imageIds ?? {})[a.at(-1)]; if (!id) fail('Error: No such image: ' + a.at(-1)); done(id); }
if (a[0] === 'pull') {
  if (s.pullGate) {
    writeFileSync(join(dir, 'pulling'), a.at(-1));
    while (!existsSync(join(dir, 'release-pull'))) await Bun.sleep(5);
  }
  s.pulled = [...(s.pulled ?? []), a.at(-1)];
  s.missingImages = (s.missingImages ?? []).filter((ref) => ref !== a.at(-1));
  done();
}
if (a[0] === 'run') {
  const name = flag('--name');
  if ((s.missingImages ?? []).includes(a.at(-1)) && flag('--pull') === 'never') fail("Unable to find image '" + a.at(-1) + "' locally\ndocker: Error response from daemon: No such image: " + a.at(-1));
  if (s.runFails === name) fail('docker: Error response from daemon: toomanyrequests: You have reached your pull rate limit');
  s.containers[name] = { id: new Bun.CryptoHasher('sha256').update(name + ':' + process.pid).digest('hex'), name, labels: Object.fromEntries(flags('--label').map(v => v.split('='))), networks: { [flag('--network')]: {} }, ports: null, running: true, image: (s.imageIds ?? {})[a.at(-1)] ?? 'sha256:' + a.at(-1) };
  done(s.containers[name].id);
}
if (a[0] === 'stop') {
  const c = find(a.at(-1));
  if (!c) fail('Error: No such object');
  if (s.stopFails === c.name) fail('stop failed');
  // Stopped, and started again at once (its restart policy, an operator).
  if (s.stopNoop === c.name) done();
  if (s.stopGate && !existsSync(join(dir, 'release-stop'))) {
    writeFileSync(join(dir, 'stopping'), c.name);
    while (!existsSync(join(dir, 'release-stop'))) await Bun.sleep(5);
  }
  c.running = false; done();
}
if (a[0] === 'rm') {
  const c = find(a.at(-1));
  if (c && s.rmGate === c.name && !existsSync(join(dir, 'release-rm'))) {
    writeFileSync(join(dir, 'removing'), c.name);
    while (!existsSync(join(dir, 'release-rm'))) await Bun.sleep(5);
  }
  if (c) delete s.containers[c.name];
  done();
}
if (a[0] === 'start') {
  const c = find(a.at(-1));
  if (!c) fail('Error: No such container: ' + a.at(-1));
  if (s.startFails === c.name) fail('Error response from daemon: network not found');
  c.running = true; c.startedAt = new Date().toISOString(); done(a.at(-1));
}
fail('Unhandled fake Docker call: ' + JSON.stringify(a));
`;

interface FakeSession {
  id: string;
  status: string;
  org: string;
  profile?: string;
  docker?: boolean;
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
      startedAt?: string;
    }
  >;
  networks: Record<string, object>;
  /** Organization networks the egress proxy is attached to. */
  egressAttached?: string[];
  /** The helper that is running again right after its stop. */
  stopNoop?: string;
  /** The helper whose `docker start` fails. */
  startFails?: string;
  /** The helper whose `docker run` fails. */
  runFails?: string;
  /** What the builder's fence probe prints instead of a current fence. */
  fenceProbe?: string;
  /** The fence probe's exec fails. */
  fenceExecFails?: boolean;
  egressStartedAt?: string;
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
  /** What successive reads of the builder's build history print, a line of
   * type and ref per record, the last one again; a null one fails. Unset: one
   * build done, and one under way while `buildRunning`. */
  histories?: Array<string | null>;
  /** How far each read of the build history moves the clock of the builder
   * idle checks on, while it runs. */
  historyReadMs?: number;
  /** How far the reads of the build history have moved that clock in all. */
  historyClockMs?: number;
  /** `buildctl prune` inside the builder fails. */
  pruneFails?: boolean;
  /** `buildctl prune` runs until a `release-prune` file appears. */
  pruneGate?: boolean;
  /** The container whose `docker rm` waits for a `release-rm` file. */
  rmGate?: string;
  /** `docker pull` runs until a `release-pull` file appears. */
  pullGate?: boolean;
  /** `docker update` runs until a `release-update` file appears. */
  updateGate?: boolean;
  /** Images not on the host: a `run --pull never` of one fails. */
  missingImages?: string[];
  /** Images `docker pull` fetched, in order. */
  pulled?: string[];
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
  buildkitdIdleMs: 1000,
};

let root = '';
let orgSequence = 0;
const originalDockerBin = process.env.DOCKER_BIN;

/** The stamp a builder launched now carries. The session root of these
 * configurations cannot be read, so the cache cap is the shipped one. */
function currentBuilderStamp(config: SpawnerConfig): string {
  return helperStamp(
    config.buildkitdImage,
    buildkitHelperLimits(config, 'builder'),
    builderConfiguration(
      builderParallelism(config),
      buildkitCacheBudget(null, config.buildkitdMaxCacheBytes),
    ),
  );
}

/** The proxy an organization's helpers reach the egress by. */
const HELPER_PROXY = 'http://tale-buildkit-egress:3128/';

/** The mirror mapping of an organization whose three mirrors are all up. */
function fullMirrorMapping(organizationId: string): string {
  return MIRROR_REGISTRIES.map(
    (registry) => `${registry}=${buildkitdMirrorRef(organizationId, registry)}`,
  ).join(';');
}

function seed(organizationId: string): FakeState {
  const labels = { 'tale.buildkitd': '1', 'tale.org': organizationId };
  const network = buildkitdNetworkName(organizationId);
  // Helpers launched by this release with these settings.
  const stamps = [
    currentBuilderStamp(cfg),
    ...MIRROR_REGISTRIES.map((registry) =>
      helperStamp(
        cfg.buildkitdMirrorImage,
        buildkitHelperLimits(cfg, 'mirror'),
        buildkitMirrorEnvironment(
          { egressProxy: 'http://tale-buildkit-egress:3128/' },
          registry,
        ),
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
          labels: {
            ...labels,
            'tale.helper-config': stamps[index] ?? '',
            // The builder, launched with every mirror up.
            ...(index === 0
              ? {
                  'tale.buildkitd-launch': builderLaunchRecord(
                    fullMirrorMapping(organizationId),
                    HELPER_PROXY,
                  ),
                }
              : {}),
          },
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
/** The reads of a builder's build history, in order. */
async function historyReads(): Promise<string[][]> {
  return (await calls()).filter(
    (args) =>
      args[0] === 'exec' &&
      args.slice(2, 5).join(' ') === 'buildctl debug histories',
  );
}

/** What the clock of the builder idle checks reads: it stands still unless a
 * test moves it on. */
let idleClockMs = 0;

/** A follow-up provisioning a builder hold scheduled. No timer runs it: a
 * test does, once it has moved the clock on. */
interface ScheduledFollowUp {
  run: () => Promise<void>;
  delayMs: number;
  cancelled: boolean;
}

/** The follow-ups scheduled since the test began, in order. */
let followUps: ScheduledFollowUp[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tale-buildkit-lifecycle-'));
  const executable = join(root, 'docker');
  await writeFile(executable, FAKE_DOCKER);
  await chmod(executable, 0o755);
  process.env.DOCKER_BIN = executable;
  setBuilderIdleClock(() => idleClockMs);
  setBuilderIdleFollowUpScheduler((run, delayMs) => {
    const followUp = { run, delayMs, cancelled: false };
    followUps.push(followUp);
    return () => {
      followUp.cancelled = true;
    };
  });
});
beforeEach(async () => {
  forgetBuilderIdleAnchors();
  followUps = [];
  resetBuildkitObservations();
  await Promise.all(
    [
      'stopping',
      'release-stop',
      'pruning',
      'release-prune',
      'pulling',
      'release-pull',
      'updating',
      'release-update',
    ].map((name) => rm(join(root, name), { force: true })),
  );
  await writeFile(join(root, 'calls.jsonl'), '');
});
afterAll(async () => {
  forgetBuilderIdleAnchors();
  setBuilderIdleFollowUpScheduler();
  setBuilderIdleClock();
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
    // Current mirrors start again by id rather than being recreated.
    const log = await calls();
    expect(log.filter((args) => args[0] === 'run')).toEqual([]);
    expect(log.filter((args) => args[0] === 'start')).toHaveLength(3);
  });

  test('a stopped helper launched otherwise than now, or that fails to start, is recreated', async () => {
    const org = nextOrg();
    const initial = seed(org);
    const builder = buildkitdContainerName(org);
    const drifted = buildkitdMirrorContainerName(org, 'docker.io');
    const failing = buildkitdMirrorContainerName(org, 'ghcr.io');
    for (const container of Object.values(initial.containers)) {
      container.running = false;
    }
    initial.containers[drifted]!.labels['tale.helper-config'] = 'earlier';
    initial.startFails = failing;
    await save(initial);
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
    } finally {
      warn.mockRestore();
    }
    const log = await calls();
    const started = log
      .filter((args) => args[0] === 'start')
      .map((args) => args.at(-1));
    expect(started).not.toContain(initial.containers[drifted]?.id);
    expect(started).toContain(initial.containers[builder]?.id);
    const runs = log
      .filter((args) => args[0] === 'run')
      .map((args) => args[args.indexOf('--name') + 1] ?? '');
    const byName = (a: string, b: string) => a.localeCompare(b);
    expect(runs.sort(byName)).toEqual([drifted, failing].sort(byName));
    const final = await state();
    expect(
      Object.values(final.containers).every((container) => container.running),
    ).toBe(true);
    expect(final.containers[builder]?.id).toBe(initial.containers[builder]?.id);
    expect(final.volumes).toEqual(initial.volumes);
  });

  describe('a builder launched while a registry mirror was down', () => {
    const builderRuns = async (builder: string) =>
      (await calls()).filter(
        (args) =>
          args[0] === 'run' && args[args.indexOf('--name') + 1] === builder,
      );
    const mirrorsEnv = (args: string[] | undefined) =>
      args?.find((arg) => arg.startsWith('TALE_BUILDKITD_MIRRORS='));

    /** An organization whose builder came up while its ghcr.io mirror could
     * not be launched. */
    async function launchedWithoutGhcr(org: string): Promise<FakeState> {
      const initial = seed(org);
      const builder = buildkitdContainerName(org);
      const ghcr = buildkitdMirrorContainerName(org, 'ghcr.io');
      delete initial.containers[builder];
      delete initial.containers[ghcr];
      initial.runFails = ghcr;
      await save(initial);
      const warn = spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
      } finally {
        warn.mockRestore();
      }
      const env = mirrorsEnv((await builderRuns(builder))[0]);
      expect(env).toContain('docker.io=');
      expect(env).not.toContain('ghcr.io=');
      const launched = await state();
      delete launched.runFails;
      return launched;
    }

    test('is recreated with every mirror once stopped, never started again without one', async () => {
      const org = nextOrg();
      const builder = buildkitdContainerName(org);
      const launched = await launchedWithoutGhcr(org);
      // Its organization went idle and the ghcr.io mirror can run again.
      launched.containers[builder]!.running = false;
      await save(launched);
      resetBuildkitObservations();
      await writeFile(join(root, 'calls.jsonl'), '');

      expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
      const log = await calls();
      expect(
        log.filter(
          (args) =>
            args[0] === 'start' &&
            args.at(-1) === launched.containers[builder]?.id,
        ),
      ).toEqual([]);
      const runs = await builderRuns(builder);
      expect(runs).toHaveLength(1);
      expect(mirrorsEnv(runs[0])).toBe(
        `TALE_BUILDKITD_MIRRORS=${fullMirrorMapping(org)}`,
      );

      // Launched as it would be now, its next stop ends in a start by id.
      const relaunched = await state();
      relaunched.containers[builder]!.running = false;
      await save(relaunched);
      resetBuildkitObservations();
      await writeFile(join(root, 'calls.jsonl'), '');
      await ensureBuildkitd(cfg, org);
      const restarted = await calls();
      expect(restarted.filter((args) => args[0] === 'run')).toEqual([]);
      expect(
        restarted.filter(
          (args) =>
            args[0] === 'start' &&
            args.at(-1) === relaunched.containers[builder]?.id,
        ),
      ).toHaveLength(1);
    });

    test('is recreated running once idle, and kept while a build runs or the mirror stays down', async () => {
      const org = nextOrg();
      const builder = buildkitdContainerName(org);
      const ghcr = buildkitdMirrorContainerName(org, 'ghcr.io');
      const launched = await launchedWithoutGhcr(org);
      const log = spyOn(console, 'log').mockImplementation(() => {});
      const warn = spyOn(console, 'warn').mockImplementation(() => {});
      try {
        // The mirror still cannot run: nothing to gain from a recreate.
        await save({ ...launched, runFails: ghcr });
        resetBuildkitObservations();
        await writeFile(join(root, 'calls.jsonl'), '');
        await ensureBuildkitd(cfg, org);
        expect(await builderRuns(builder)).toEqual([]);

        // It runs again, but so does a build.
        await save({
          ...(await state()),
          runFails: undefined,
          buildRunning: true,
        });
        resetBuildkitObservations();
        await writeFile(join(root, 'calls.jsonl'), '');
        await ensureBuildkitd(cfg, org);
        expect(await builderRuns(builder)).toEqual([]);

        // The build is done: kept by the first provisioning to find none
        // under way, recreated by one 3 s later that finds no build since.
        await save({ ...(await state()), buildRunning: false });
        resetBuildkitObservations();
        await writeFile(join(root, 'calls.jsonl'), '');
        await ensureBuildkitd(cfg, org);
        expect(await builderRuns(builder)).toEqual([]);
        idleClockMs += 3_000;
        resetBuildkitObservations();
        await writeFile(join(root, 'calls.jsonl'), '');
        await ensureBuildkitd(cfg, org);
        const runs = await builderRuns(builder);
        expect(runs).toHaveLength(1);
        expect(mirrorsEnv(runs[0])).toBe(
          `TALE_BUILDKITD_MIRRORS=${fullMirrorMapping(org)}`,
        );
      } finally {
        log.mockRestore();
        warn.mockRestore();
      }
      // Its cache volume stays.
      expect((await state()).volumes[buildkitdCacheVolumeName(org)]).toEqual(
        launched.volumes[buildkitdCacheVolumeName(org)],
      );
    });

    test('is recreated by the first read with no build under way once held a minute, though a build ran since every read before', async () => {
      const org = nextOrg();
      const builder = buildkitdContainerName(org);
      const launched = await launchedWithoutGhcr(org);
      // The ghcr.io mirror can run again, and a build fails on the builder
      // between every two provisionings, a minute apart.
      await save({
        ...launched,
        histories: [
          'COMPLETE build-1\n',
          'COMPLETE build-1\nSTARTED build-2\n',
          'COMPLETE build-1\nCOMPLETE build-2\nCOMPLETE build-3\n',
        ],
      });
      const log = spyOn(console, 'log').mockImplementation(() => {});
      const warn = spyOn(console, 'warn').mockImplementation(() => {});
      try {
        resetBuildkitObservations();
        await writeFile(join(root, 'calls.jsonl'), '');
        await ensureBuildkitd(cfg, org);
        expect(await builderRuns(builder)).toEqual([]);
        // Held a minute, but a build is under way: kept.
        idleClockMs += 60_000;
        resetBuildkitObservations();
        await writeFile(join(root, 'calls.jsonl'), '');
        await ensureBuildkitd(cfg, org);
        expect(await builderRuns(builder)).toEqual([]);
        // None is a minute later, though another one ran: recreated.
        idleClockMs += 60_000;
        resetBuildkitObservations();
        await writeFile(join(root, 'calls.jsonl'), '');
        await ensureBuildkitd(cfg, org);
        const runs = await builderRuns(builder);
        expect(runs).toHaveLength(1);
        expect(mirrorsEnv(runs[0])).toBe(
          `TALE_BUILDKITD_MIRRORS=${fullMirrorMapping(org)}`,
        );
      } finally {
        log.mockRestore();
        warn.mockRestore();
      }
    });

    test('is recreated by the follow-up of the provisioning that held it, with no create since', async () => {
      const org = nextOrg();
      const builder = buildkitdContainerName(org);
      // The ghcr.io mirror can run again, and no build runs.
      await save(await launchedWithoutGhcr(org));
      const log = spyOn(console, 'log').mockImplementation(() => {});
      const warn = spyOn(console, 'warn').mockImplementation(() => {});
      try {
        resetBuildkitObservations();
        await writeFile(join(root, 'calls.jsonl'), '');
        await ensureBuildkitd(cfg, org);
        expect(await builderRuns(builder)).toEqual([]);
        expect(
          followUps.map(({ delayMs, cancelled }) => ({ delayMs, cancelled })),
        ).toEqual([{ delayMs: 3_000, cancelled: false }]);
        // Its time comes, and it reads no build since.
        idleClockMs += 3_000;
        await writeFile(join(root, 'calls.jsonl'), '');
        await followUps[0]!.run();
        const runs = await builderRuns(builder);
        expect(runs).toHaveLength(1);
        expect(mirrorsEnv(runs[0])).toBe(
          `TALE_BUILDKITD_MIRRORS=${fullMirrorMapping(org)}`,
        );
        // Confirmed: no follow-up comes after it.
        expect(followUps).toHaveLength(1);
        expect(warn).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
        warn.mockRestore();
      }
    });
  });

  test('a builder is launched with cache bounds sized from the session disk, and recreated idle when they change', async () => {
    const org = nextOrg();
    await save({ ...seed(org), containers: {} });
    // A session root whose disk can be read: the test's own.
    const sized = { ...cfg, hostSessionRoot: root };
    const disk = await statfs(root);
    const budget = buildkitCacheBudget(disk.blocks * disk.bsize);
    await ensureBuildkitd(sized, org);
    const builder = (await calls()).find(
      (args) => args[0] === 'run' && args.includes('--privileged'),
    );
    expect(builder).toContain(`TALE_BUILDKITD_MAX_USED=${budget.maxUsedBytes}`);
    expect(builder).toContain(
      `TALE_BUILDKITD_RESERVED=${budget.reservedBytes}`,
    );
    expect(
      (await state()).containers[buildkitdContainerName(org)]?.labels[
        'tale.helper-config'
      ],
    ).toBe(
      helperStamp(
        sized.buildkitdImage,
        buildkitHelperLimits(sized, 'builder'),
        builderConfiguration(builderParallelism(sized), budget),
      ),
    );

    // The operator caps it lower: the idle builder is recreated with it, by
    // the first provisioning 3 s after one that found no build under way.
    await writeFile(join(root, 'calls.jsonl'), '');
    const capped = { ...sized, buildkitdMaxCacheBytes: 2 * 1024 ** 3 };
    await ensureBuildkitd(capped, org);
    expect((await calls()).filter((args) => args[0] === 'run')).toEqual([]);
    idleClockMs += 3_000;
    const log = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await ensureBuildkitd(capped, org);
    } finally {
      log.mockRestore();
    }
    const relaunch = (await calls()).find(
      (args) => args[0] === 'run' && args.includes('--privileged'),
    );
    expect(relaunch).toContain(`TALE_BUILDKITD_MAX_USED=${2 * 1024 ** 3}`);
    expect(relaunch).toContain(
      `TALE_BUILDKITD_RESERVED=${Math.floor((2 * 1024 ** 3) / 10 / 1024 ** 2) * 1024 ** 2}`,
    );
  });

  test('helpers stop after their own idle window, not the session one', async () => {
    const org = nextOrg();
    await save(seed(org));
    const now = Date.now();
    const config = {
      ...cfg,
      session: { ...cfg.session, maxIdleMs: 30 * 60_000 },
      buildkitdIdleMs: 5 * 60_000,
    };
    await sweepIdleBuildkitd(config, now);
    expect(
      (await sweepIdleBuildkitd(config, now + 5 * 60_000 - 1)).stopped,
    ).toBe(0);
    expect((await sweepIdleBuildkitd(config, now + 5 * 60_000)).stopped).toBe(
      4,
    );

    // Unset, ten minutes.
    const other = nextOrg();
    await save(seed(other));
    const defaults = { ...cfg };
    delete defaults.buildkitdIdleMs;
    await sweepIdleBuildkitd(defaults, now);
    expect(
      (await sweepIdleBuildkitd(defaults, now + 10 * 60_000 - 1)).stopped,
    ).toBe(0);
    expect(
      (await sweepIdleBuildkitd(defaults, now + 10 * 60_000)).stopped,
    ).toBe(4);
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
      expect.arrayContaining([
        '--cpus=2',
        '--cpu-shares=256',
        '--pids-limit=16384',
      ]),
    );
    expect(updates.flat().some((arg) => arg.startsWith('--memory'))).toBe(
      false,
    );
    expect((await state()).containers[builder]?.id).toBe(
      initial.containers[builder]?.id,
    );

    // The build is done: the first ensure to find none under way keeps every
    // helper, its bounds already applied, and one 3 s later that finds no
    // build since recreates the builder and its mirrors on the current image
    // and bounds, keeping every volume.
    const busy = await state();
    busy.buildRunning = false;
    await save(busy);
    await writeFile(join(root, 'calls.jsonl'), '');
    expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
    expect(
      (await calls()).filter((args) =>
        ['run', 'rm', 'update'].includes(args[0] ?? ''),
      ),
    ).toEqual([]);
    idleClockMs += 3_000;
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
      currentBuilderStamp(cfg),
    );
    expect(final.volumes).toEqual(initial.volumes);
    // Bounds already applied are not applied again.
    expect(log.filter((args) => args[0] === 'update')).toHaveLength(0);
  });

  test('mirrors with expiry disabled adopt the cleanup setting once builds finish, preserving cache volumes', async () => {
    const org = nextOrg();
    const initial = seed(org);
    const builder = buildkitdContainerName(org);
    const oldStamp = helperStamp(
      cfg.buildkitdMirrorImage,
      buildkitHelperLimits(cfg, 'mirror'),
    );
    for (const registry of MIRROR_REGISTRIES) {
      initial.containers[buildkitdMirrorContainerName(org, registry)]!.labels[
        'tale.helper-config'
      ] = oldStamp;
    }
    initial.buildRunning = true;
    await save(initial);

    expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
    expect(
      (await calls()).filter((args) => args[0] === 'run' || args[0] === 'rm'),
    ).toEqual([]);
    expect((await state()).containers).toEqual(initial.containers);

    // Kept by the first ensure to find no build under way, recreated by one
    // 3 s later that finds no build since.
    const busy = await state();
    busy.buildRunning = false;
    await save(busy);
    await writeFile(join(root, 'calls.jsonl'), '');
    expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
    expect(
      (await calls()).filter((args) => args[0] === 'run' || args[0] === 'rm'),
    ).toEqual([]);
    idleClockMs += 3_000;
    await writeFile(join(root, 'calls.jsonl'), '');
    expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));

    const launches = (await calls()).filter((args) => args[0] === 'run');
    expect(launches).toHaveLength(MIRROR_REGISTRIES.length);
    for (const launch of launches) {
      expect(launch).toContain('REGISTRY_STORAGE_DELETE_ENABLED=true');
    }
    const final = await state();
    expect(final.containers[builder]).toEqual(initial.containers[builder]);
    expect(final.volumes).toEqual(initial.volumes);
    for (const registry of MIRROR_REGISTRIES) {
      const mirror = buildkitdMirrorContainerName(org, registry);
      expect(final.containers[mirror]?.labels['tale.helper-config']).not.toBe(
        oldStamp,
      );
    }

    await writeFile(join(root, 'calls.jsonl'), '');
    await ensureBuildkitd(cfg, org);
    expect(
      (await calls()).filter((args) => args[0] === 'run' || args[0] === 'rm'),
    ).toEqual([]);
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

    // Kept by the first ensure to find no build under way, recreated by one
    // 3 s later that finds no build since.
    const busy = await state();
    busy.buildRunning = false;
    await save(busy);
    await writeFile(join(root, 'calls.jsonl'), '');
    expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
    expect(
      (await calls()).filter((args) => args[0] === 'run' || args[0] === 'rm'),
    ).toEqual([]);
    idleClockMs += 3_000;
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

  describe('a running builder on an image its reference no longer names', () => {
    /** An organization whose builder runs the image of an earlier release,
     * whose build history reads as given, one answer per read. */
    async function retagged(
      histories: Array<string | null>,
    ): Promise<{ org: string; builder: string; initial: FakeState }> {
      const org = nextOrg();
      const initial = seed(org);
      const builder = buildkitdContainerName(org);
      initial.containers[builder]!.image = 'sha256:previous-release';
      initial.imageIds = { [cfg.buildkitdImage]: 'sha256:this-release' };
      initial.histories = histories;
      await save(initial);
      return { org, builder, initial };
    }

    /** The containers removed and launched since the call log was cleared,
     * in order. */
    async function changes(): Promise<string[]> {
      return (await calls()).flatMap((args) => {
        if (args[0] === 'rm') return [`rm ${args.at(-1)}`];
        const name = args[args.indexOf('--name') + 1];
        return args[0] === 'run' ? [`run ${name}`] : [];
      });
    }

    /** Provision the organization `afterMs` after the provisioning before,
     * answering the containers it removed and launched, in order. */
    async function provision(org: string, afterMs = 0): Promise<string[]> {
      idleClockMs += afterMs;
      await writeFile(join(root, 'calls.jsonl'), '');
      expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
      return changes();
    }

    /** Run the follow-up scheduled `index`th, `afterMs` after the
     * provisioning before, answering the containers it removed and launched,
     * in order. */
    async function followUp(index: number, afterMs: number): Promise<string[]> {
      idleClockMs += afterMs;
      await writeFile(join(root, 'calls.jsonl'), '');
      const scheduled = followUps[index];
      expect(scheduled?.cancelled).toBe(false);
      await scheduled?.run();
      return changes();
    }

    /** What a provisioning that recreates the builder alone removes and
     * launches. */
    const recreated = (builder: string) => [`rm ${builder}`, `run ${builder}`];

    test('is kept, after one history read, by the first provisioning that finds no build under way', async () => {
      const { org, builder, initial } = await retagged(['COMPLETE build-1\n']);
      expect(await provision(org)).toEqual([]);
      expect(await historyReads()).toHaveLength(1);
      expect((await state()).containers[builder]).toEqual(
        initial.containers[builder],
      );
    });

    test('is recreated by a provisioning 3 s or more later whose read shows the same finished builds', async () => {
      const { org, builder, initial } = await retagged([
        'COMPLETE build-1\nCOMPLETE build-2\n',
      ]);
      expect(await provision(org)).toEqual([]);
      expect(await provision(org, 3_000)).toEqual(recreated(builder));
      expect((await historyReads()).map((args) => args.at(-1))).toEqual([
        '{{.Type}} {{with .Record}}{{.Ref}}{{end}}',
      ]);
      const final = await state();
      expect(final.containers[builder]?.image).toBe('sha256:this-release');
      expect(final.volumes).toEqual(initial.volumes);
    });

    test('is kept when a build started and finished between two provisionings', async () => {
      const { org, builder } = await retagged([
        'COMPLETE build-1\n',
        'COMPLETE build-1\nCOMPLETE build-2\n',
      ]);
      expect(await provision(org)).toEqual([]);
      expect(await provision(org, 3_000)).toEqual([]);
      // That read is the one to match now: unchanged 3 s on, the builder goes.
      expect(await provision(org, 3_000)).toEqual(recreated(builder));
    });

    test('is kept when a build is under way at the second provisioning', async () => {
      // The build under way is listed without its record: no ref gives it
      // away, but its type does, and the confirmation starts over after it.
      const { org, builder } = await retagged([
        'COMPLETE build-1\n',
        'COMPLETE build-1\nSTARTED\n',
        'COMPLETE build-1\nCOMPLETE\n',
      ]);
      expect(await provision(org)).toEqual([]);
      expect(await provision(org, 3_000)).toEqual([]);
      expect(await provision(org, 3_000)).toEqual([]);
      expect(await provision(org, 3_000)).toEqual(recreated(builder));
    });

    test('is kept when the second provisioning cannot read the build history', async () => {
      const { org, builder } = await retagged([
        'COMPLETE build-1\n',
        null,
        'COMPLETE build-1\n',
      ]);
      expect(await provision(org)).toEqual([]);
      expect(await provision(org, 3_000)).toEqual([]);
      // The failed read changed nothing: the next clean read, a moment
      // later, still matches the first one.
      expect(await provision(org, 1)).toEqual(recreated(builder));
    });

    test('is kept by a provisioning under 3 s after the first, and recreated by one 3 s after the first', async () => {
      const { org, builder } = await retagged(['COMPLETE build-1\n']);
      expect(await provision(org)).toEqual([]);
      expect(await provision(org, 2_999)).toEqual([]);
      // A millisecond after the second: the first read is still the one to
      // match.
      expect(await provision(org, 1)).toEqual(recreated(builder));
    });

    test('is kept by a read that starts under 3 s after the first read ended, though the clock passes 3 s during it', async () => {
      const { org, builder, initial } = await retagged(['COMPLETE build-1\n']);
      // Each read of the history takes 2 s.
      await save({ ...initial, historyReadMs: 2_000 });
      const historyClockMs = (): number => {
        const current: FakeState = JSON.parse(
          readFileSync(join(root, 'state.json'), 'utf8'),
        );
        return current.historyClockMs ?? 0;
      };
      setBuilderIdleClock(() => idleClockMs + historyClockMs());
      try {
        expect(await provision(org)).toEqual([]);
        // Starts 2 s after the first read ended, and ends 4 s after.
        expect(await provision(org, 2_000)).toEqual([]);
        // Starts 4 s after the first read ended.
        expect(await provision(org)).toEqual(recreated(builder));
      } finally {
        idleClockMs += historyClockMs();
        setBuilderIdleClock(() => idleClockMs);
      }
    });

    test('schedules no follow-up after a read that finds a build under way or cannot be read', async () => {
      const { org } = await retagged([
        'COMPLETE build-1\nSTARTED build-2\n',
        null,
        'COMPLETE build-1\nCOMPLETE build-2\n',
      ]);
      expect(await provision(org)).toEqual([]);
      expect(await provision(org, 3_000)).toEqual([]);
      expect(followUps).toEqual([]);
      // A read that holds it schedules one, 3 s on.
      expect(await provision(org, 3_000)).toEqual([]);
      expect(followUps.map(({ delayMs }) => delayMs)).toEqual([3_000]);
    });

    test('has one follow-up pending at most, and a follow-up that holds it again schedules the next', async () => {
      const { org, builder } = await retagged([
        'COMPLETE build-1\n',
        'COMPLETE build-1\n',
        'COMPLETE build-1\nCOMPLETE build-2\n',
      ]);
      expect(await provision(org)).toEqual([]);
      expect(await provision(org, 1_000)).toEqual([]);
      expect(followUps).toHaveLength(1);
      // A build ran before the follow-up's read: held again, it schedules
      // the next, which finds none since.
      expect(await followUp(0, 3_000)).toEqual([]);
      expect(followUps.map(({ delayMs }) => delayMs)).toEqual([3_000, 3_000]);
      expect(await followUp(1, 3_000)).toEqual(recreated(builder));
      expect(followUps).toHaveLength(2);
    });

    test('has its follow-up wait for a provisioning under way that held it meanwhile, and then read again', async () => {
      const { org, builder } = await retagged(['COMPLETE build-1\n']);
      expect(await provision(org)).toEqual([]);
      expect(followUps).toHaveLength(1);
      // A second provisioning holds it with the follow-up pending, so it
      // schedules none, and is still bringing the builder's bounds up to date
      // when the follow-up fires.
      const held = await state();
      held.containers[builder]!.labels['tale.helper-config'] = 'earlier';
      held.updateGate = true;
      await save(held);
      idleClockMs += 1_000;
      const second = ensureBuildkitd(cfg, org);
      for (let i = 0; i < 400; i += 1) {
        if (await Bun.file(join(root, 'updating')).exists()) break;
        await Bun.sleep(5);
      }
      expect(await readFile(join(root, 'updating'), 'utf8')).toBe(builder);
      expect(await historyReads()).toHaveLength(2);
      idleClockMs += 2_000;
      await writeFile(join(root, 'calls.jsonl'), '');
      const fired = followUps[0]!.run();
      await writeFile(join(root, 'release-update'), '');
      expect(await second).toBe(buildkitdEndpoint(org));
      await fired;
      // Its own read, 3 s after the first, confirms.
      expect(await historyReads()).toHaveLength(1);
      expect(await changes()).toEqual(recreated(builder));
      expect(followUps).toHaveLength(1);
    });

    test('has its follow-up wait for a provisioning under way that fails, and then provision', async () => {
      const { org, builder } = await retagged(['COMPLETE build-1\n']);
      expect(await provision(org)).toEqual([]);
      expect(followUps).toHaveLength(1);
      // A second provisioning holds it with the follow-up pending, so it
      // schedules none, and runs out of its budget bringing the builder's
      // bounds up to date: the follow-up fires meanwhile.
      const held = await state();
      held.containers[builder]!.labels['tale.helper-config'] = 'earlier';
      held.updateGate = true;
      await save(held);
      idleClockMs += 1_000;
      const second = rejection(
        ensureBuildkitd({ ...cfg, buildkitdProvisionTimeoutMs: 2_000 }, org),
      );
      for (let i = 0; i < 400; i += 1) {
        if (await Bun.file(join(root, 'updating')).exists()) break;
        await Bun.sleep(5);
      }
      expect(await readFile(join(root, 'updating'), 'utf8')).toBe(builder);
      idleClockMs += 2_000;
      await writeFile(join(root, 'calls.jsonl'), '');
      const warn = spyOn(console, 'warn').mockImplementation(() => {});
      let warnings: string[] = [];
      try {
        const fired = followUps[0]!.run();
        expect(await second).toMatch(/deadline exceeded/);
        await fired;
        warnings = warn.mock.calls.map((args) => args.map(String).join(' '));
      } finally {
        warn.mockRestore();
      }
      // Its own caller answers for the failure. The follow-up reads again
      // once the failed one let go of the lock, 3 s after the first read,
      // and confirms.
      expect(warnings.filter((line) => line.includes('follow-up'))).toEqual([]);
      expect(await historyReads()).toHaveLength(1);
      expect(await changes()).toEqual(recreated(builder));
      expect(followUps).toHaveLength(1);
    }, 15_000);

    test.each([
      'finds it launched as now',
      'starts it',
      'launches it anew',
      'recreates it for a stale fence',
    ])(
      'ends its hold when a provisioning %s, so that a later drift is held anew',
      async (path) => {
        const { org, builder } = await retagged(['COMPLETE build-1\n']);
        expect(await provision(org)).toEqual([]);
        // Whatever ran between the two provisionings brought it up to date,
        // stopped it or left its fence stale.
        const found = await state();
        const helper = found.containers[builder]!;
        if (path === 'finds it launched as now' || path === 'starts it') {
          helper.image = 'sha256:this-release';
        }
        if (path === 'starts it' || path === 'launches it anew') {
          helper.running = false;
        }
        if (path === 'recreates it for a stale fence') {
          found.fenceProbe =
            '#tale-fence marker 0\n#tale-fence toml\n[dns]\n nameservers = ["172.22.0.9"]\n#tale-fence resolved\n172.22.0.2 tale-buildkit-egress\n';
        }
        await save(found);
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        try {
          expect(await provision(org, 1_000)).toEqual(
            path === 'finds it launched as now' || path === 'starts it'
              ? []
              : recreated(builder),
          );
        } finally {
          warn.mockRestore();
        }
        expect(followUps.map(({ cancelled }) => cancelled)).toEqual([true]);
        // A minute on, it runs an image its reference no longer names again,
        // with no build since: the first read holds it anew, and the read of
        // its follow-up confirms.
        const drifted = await state();
        drifted.containers[builder]!.image = 'sha256:previous-release';
        delete drifted.fenceProbe;
        await save(drifted);
        resetBuildkitObservations();
        expect(await provision(org, 60_000)).toEqual([]);
        expect(followUps.map(({ cancelled }) => cancelled)).toEqual([
          true,
          false,
        ]);
        expect(await followUp(1, 3_000)).toEqual(recreated(builder));
      },
    );

    test('has its follow-up do nothing once a later read ended the hold', async () => {
      const { org, builder } = await retagged(['COMPLETE build-1\n']);
      expect(await provision(org)).toEqual([]);
      expect(await provision(org, 3_000)).toEqual(recreated(builder));
      await writeFile(join(root, 'calls.jsonl'), '');
      await followUps[0]!.run();
      expect(await calls()).toEqual([]);
    });

    test.each(['idle stop', 'removal'])(
      'an organization’s %s cancels its pending follow-up and forgets the hold',
      async (end) => {
        const { org, initial } = await retagged(['COMPLETE build-1\n']);
        expect(await provision(org)).toEqual([]);
        const log = spyOn(console, 'log').mockImplementation(() => {});
        try {
          if (end === 'removal') {
            expect((await removeOrganizationBuildkit(org)).containers).toBe(4);
          } else {
            const now = Date.now();
            await sweepIdleBuildkitd(cfg, now);
            expect((await sweepIdleBuildkitd(cfg, now + 1_000)).stopped).toBe(
              4,
            );
          }
        } finally {
          log.mockRestore();
        }
        // The same helpers run again, a minute on, with no build since: the
        // first read holds the builder anew.
        await save(initial);
        expect(await provision(org, 60_000)).toEqual([]);
        expect(followUps.map(({ cancelled }) => cancelled)).toEqual([
          true,
          false,
        ]);
        // The cancelled one does nothing, should it run all the same.
        await writeFile(join(root, 'calls.jsonl'), '');
        await followUps[0]!.run();
        expect(await calls()).toEqual([]);
      },
    );

    test.each(['nothing', 'a teardown'])(
      'has its follow-up, fired while the disk relief removes the organization’s helpers, provision nothing after it, with %s queued behind the relief',
      async (queued) => {
        resetDiskPressurePause();
        const { org, initial } = await retagged(['COMPLETE build-1\n']);
        expect(await provision(org)).toEqual([]);
        expect(followUps).toHaveLength(1);
        // Its helpers stop with the hold standing, and the session disk is
        // short. The relief reads the disk again under the organization's
        // lock, right before the removal, and the follow-up fires then.
        const now = Date.now();
        const stopped = await state();
        for (const container of Object.values(stopped.containers)) {
          container.running = false;
          container.finishedAt = new Date(now - 60_000).toISOString();
        }
        await save(stopped);
        const GIB = 1024 ** 3;
        let reads = 0;
        let reachedBaseline = (): void => {};
        const atBaseline = new Promise<void>((resolve) => {
          reachedBaseline = resolve;
        });
        let unblock = (): void => {};
        const blocked = new Promise<void>((resolve) => {
          unblock = resolve;
        });
        const sessionDisk = async () => {
          reads += 1;
          if (reads === 2) {
            reachedBaseline();
            await blocked;
          }
          // The removal frees enough.
          const availableBytes = (reads < 3 ? 4 : 6) * GIB;
          return { availableBytes, short: availableBytes < 5 * GIB };
        };
        const log = spyOn(console, 'log').mockImplementation(() => {});
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        let warnings: string[] = [];
        try {
          const sweep = sweepIdleBuildkitd(cfg, now, { sessionDisk });
          await atBaseline;
          await writeFile(join(root, 'calls.jsonl'), '');
          const teardown =
            queued === 'a teardown'
              ? removeOrganizationBuildkit(org).catch((error: unknown) =>
                  String(error),
                )
              : null;
          const fired = followUps[0]!.run();
          unblock();
          expect((await sweep).relieved).toBe(1);
          await fired;
          // Not refused: the follow-up holds no create lease. The relief
          // left it nothing to remove.
          if (teardown !== null) {
            expect(await teardown).toEqual({
              containers: 0,
              volumes: 0,
              networks: 0,
            });
          }
          warnings = warn.mock.calls.map((args) => args.map(String).join(' '));
        } finally {
          log.mockRestore();
          warn.mockRestore();
        }
        expect(warnings).toEqual([]);
        expect(
          (await calls()).filter(([command]) => command === 'run'),
        ).toEqual([]);
        const final = await state();
        expect(
          Object.values(final.containers).filter(
            (container) => container.labels['tale.org'] === org,
          ),
        ).toEqual([]);
        for (const volume of Object.keys(initial.volumes)) {
          expect(final.volumes[volume]).toBeUndefined();
        }
      },
    );
  });

  test('a running builder whose fence went stale is recreated, keeping its cache', async () => {
    const org = nextOrg();
    const initial = seed(org);
    initial.fenceProbe =
      '#tale-fence marker 0\n#tale-fence toml\n[dns]\n nameservers = ["172.22.0.9"]\n#tale-fence resolved\n172.22.0.2 tale-buildkit-egress\n';
    await save(initial);
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
    } finally {
      warn.mockRestore();
    }
    const builder = buildkitdContainerName(org);
    const log = await calls();
    expect(
      log.filter((args) => args[0] === 'exec' && args[2] === '/bin/sh'),
    ).toHaveLength(1);
    expect(
      log
        .filter((args) => args[0] === 'run')
        .map((args) => args.includes(builder)),
    ).toEqual([true]);
    const final = await state();
    expect(final.containers[builder]?.id).not.toBe(
      initial.containers[builder]?.id,
    );
    expect(final.volumes).toEqual(initial.volumes);
  });

  test('a fence that cannot be read is reused but never remembered as verified', async () => {
    const org = nextOrg();
    const initial = seed(org);
    initial.fenceExecFails = true;
    await save(initial);
    await ensureBuildkitd(cfg, org);
    await writeFile(join(root, 'calls.jsonl'), '');
    await ensureBuildkitd(cfg, org);
    const log = await calls();
    expect(log.filter((args) => args[0] === 'run')).toEqual([]);
    // Checked in full again: the probe ran once more.
    expect(
      log.filter((args) => args[0] === 'exec' && args[2] === '/bin/sh'),
    ).toHaveLength(1);

    const healthy = await state();
    healthy.fenceExecFails = false;
    await save(healthy);
    await ensureBuildkitd(cfg, org);
    await writeFile(join(root, 'calls.jsonl'), '');
    await ensureBuildkitd(cfg, org);
    expect((await calls()).map((args) => args[0])).toEqual(['inspect']);
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
    /** Run without the upkeep's log lines. */
    async function quietly<T>(work: () => Promise<T>): Promise<T> {
      const log = spyOn(console, 'log').mockImplementation(() => {});
      try {
        return await work();
      } finally {
        log.mockRestore();
      }
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

    /** The builder's cache volume is all that stays of a stopped
     * organization within the retention: its mirrors went at the stop. */
    async function expectBuilderCacheOnly(org: string, initial: FakeState) {
      const after = await state();
      const cache = buildkitdCacheVolumeName(org);
      expect(after.volumes).toEqual({ [cache]: initial.volumes[cache]! });
      expect(Object.keys(after.containers)).toEqual([
        buildkitdContainerName(org),
      ]);
    }

    test('keeps them within the retention, or with the retention off', async () => {
      const now = Date.now();
      const recent = nextOrg();
      const initial = await stoppedFor(recent, 2 * DAY, now);
      await quietly(() => sweepTwice(cfg, now));
      await expectBuilderCacheOnly(recent, initial);

      const kept = nextOrg();
      const old = await stoppedFor(kept, 60 * DAY, now);
      await quietly(() =>
        sweepTwice({ ...cfg, buildkitdCacheRetentionMs: 0 }, now),
      );
      await expectBuilderCacheOnly(kept, old);
    });

    test('is judged from the helper inventory, its stop time read again only once the retention could have passed', async () => {
      const org = nextOrg();
      const now = Date.now();
      await stoppedFor(org, 2 * DAY, now);
      const inspects = async () =>
        (await calls()).filter(([command]) => command === 'inspect').length;
      await quietly(() => sweepTwice(cfg, now));
      // The builder's stop time, and each mirror once, right before it goes
      // with its cache: no helper is inspected for a stop.
      expect(await inspects()).toBe(1 + MIRROR_REGISTRIES.length);
      for (const later of [60_000, DAY, 11 * DAY]) {
        await sweepIdleBuildkitd(cfg, now + later);
      }
      expect(await inspects()).toBe(1 + MIRROR_REGISTRIES.length);
      expect(Object.keys((await state()).containers)).toEqual([
        buildkitdContainerName(org),
      ]);
      // Twelve days on, the fourteen-day retention has passed: the builder is
      // inspected again, and its helpers and caches go.
      const log = spyOn(console, 'log').mockImplementation(() => {});
      try {
        await sweepIdleBuildkitd(cfg, now + 12 * DAY + 1);
      } finally {
        log.mockRestore();
      }
      expect(await inspects()).toBeGreaterThan(1);
      expect(Object.keys((await state()).containers)).toEqual([]);
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

  test('with the build cache off, an empty helper inventory is read again only hourly', async () => {
    const off = { ...cfg, dockerBuildCache: false };
    const org = nextOrg();
    const initial = seed(org);
    const helpers = initial.containers;
    await save({ ...initial, containers: {} });
    const inventories = async () =>
      (await calls()).filter(
        ([command, ...rest]) =>
          command === 'ps' && rest.includes('label=tale.buildkitd=1'),
      ).length;
    const now = Date.now();
    await sweepIdleBuildkitd(off, now);
    await sweepIdleBuildkitd(off, now + 60_000);
    await sweepIdleBuildkitd(off, now + 59 * 60_000);
    expect(await inventories()).toBe(1);
    // Helpers a spawner with the cache on left behind are found within the
    // hour, and stopped once idle.
    await save({ ...(await state()), containers: helpers });
    await sweepIdleBuildkitd(off, now + 60 * 60_000);
    expect(await inventories()).toBe(2);
    expect(
      (await sweepIdleBuildkitd(off, now + 60 * 60_000 + 1_001)).stopped,
    ).toBe(4);
    // With the cache on, every sweep reads the inventory.
    await save({ ...(await state()), containers: {} });
    const before = await inventories();
    await sweepIdleBuildkitd(cfg, now + 61 * 60_000);
    await sweepIdleBuildkitd(cfg, now + 62 * 60_000);
    expect(await inventories()).toBe(before + 2);
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

    test('judges stopped organizations from the inventory, reading each builder’s stop time once', async () => {
      const now = Date.now();
      const [older, newer] = [nextOrg(), nextOrg()];
      const initial = await stoppedOrgs(
        [
          [older, 3 * DAY],
          [newer, DAY],
        ],
        now,
      );
      const inspects = async () =>
        (await calls()).filter(([command]) => command === 'inspect');
      // The retention check reads each builder's stop time once, and each
      // mirror is read once right before it goes with its cache.
      const later = now + cfg.session.maxIdleMs + 1;
      await quiet(() => sweepIdleBuildkitd(cfg, now));
      await quiet(() => sweepIdleBuildkitd(cfg, later));
      expect(await inspects()).toHaveLength(2 * (1 + MIRROR_REGISTRIES.length));
      await writeFile(join(root, 'calls.jsonl'), '');
      // The disk goes short: no stopped helper is inspected to choose, and
      // only the removal reads its builder again, under the lock.
      const disk = sessionDisk(await state(), 4.5, 1);
      const result = await quiet(() =>
        sweepIdleBuildkitd(cfg, later + 60_000, { sessionDisk: disk }),
      );
      expect(result.relieved).toBe(1);
      expect((await inspects()).map((args) => args.at(-1))).toEqual([
        initial.containers[buildkitdContainerName(older)]?.id,
      ]);
      expect((await state()).volumes[buildkitdCacheVolumeName(newer)]).toEqual(
        initial.volumes[buildkitdCacheVolumeName(newer)],
      );
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

    test('a change of the limiting filesystem is no low gain and pauses nothing', async () => {
      const now = Date.now();
      const sessions = async () => ({
        filesystem: '/sessions',
        availableBytes: GIB,
        short: true,
      });
      await stoppedOrgs(
        [
          [nextOrg(), 2 * DAY],
          [nextOrg(), DAY],
        ],
        now,
      );
      // Two removals that gained nothing on one filesystem: two low gains in
      // a row, one short of the pause.
      expect(
        (
          await quiet(() =>
            sweepIdleBuildkitd(cfg, now, { sessionDisk: sessions }),
          )
        ).relieved,
      ).toBe(2);
      await stoppedOrgs(
        [
          [nextOrg(), 2 * DAY],
          [nextOrg(), DAY],
        ],
        now,
      );
      let reads = 0;
      const readings = [
        { filesystem: '/etc/hostname', availableBytes: 10 * GIB, short: true },
        { filesystem: '/etc/hostname', availableBytes: 10 * GIB, short: true },
        // The Docker floor is relieved, exposing the smaller workspace disk
        // as the next limiting filesystem. Its lower free byte count cannot
        // tell us whether removing caches on Docker's filesystem helped.
        { filesystem: '/sessions', availableBytes: GIB, short: true },
      ];
      const switching = async () => readings[reads++] ?? (await sessions());
      const second = await quiet(() =>
        sweepIdleBuildkitd(cfg, now + 60_000, { sessionDisk: switching }),
      );
      expect(second.relieved).toBe(1);
      // The sweep stopped at the changed filesystem: the initial reading and
      // one pair around the removal.
      expect(reads).toBe(3);
      // Counted as a third low gain, it would have paused relief for hours.
      const third = await quiet(() =>
        sweepIdleBuildkitd(cfg, now + 120_000, { sessionDisk: sessions }),
      );
      expect(third.relieved).toBe(1);
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

  test('idle-stop releases all four helpers after the existing grace, keeping the builder cache and network for resume', async () => {
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
    const log = spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await sweepIdleBuildkitd(cfg, now + 1000)).toEqual({
        stopped: 4,
        organizations: 1,
      });
    } finally {
      log.mockRestore();
    }

    const builder = buildkitdContainerName(org);
    const cache = buildkitdCacheVolumeName(org);
    const stopped = await state();
    // The builder stops and keeps its cache; the mirrors go with theirs.
    expect(Object.keys(stopped.containers)).toEqual([builder]);
    expect(stopped.containers[builder]?.running).toBe(false);
    expect(stopped.networks).toEqual(initial.networks);
    expect(stopped.volumes).toEqual({ [cache]: initial.volumes[cache]! });
    const stoppedCommands = await calls();
    expect(
      stoppedCommands
        .filter((args) => args[0] === 'stop')
        .map((args) => args.at(-1)),
    ).toEqual(
      Object.values(initial.containers).map((container) => container.id),
    );
    const mirrorIds = MIRROR_REGISTRIES.map(
      (registry) =>
        initial.containers[buildkitdMirrorContainerName(org, registry)]?.id,
    );
    // Each mirror by id, after its stop, then its volume by exact name.
    expect(
      stoppedCommands.filter((args) => args[0] === 'rm').map((args) => args),
    ).toEqual(mirrorIds.map((id) => ['rm', id ?? '']));
    expect(
      stoppedCommands
        .filter((args) => args[0] === 'volume' && args[1] === 'rm')
        .map((args) => args.at(-1)),
    ).toEqual(
      MIRROR_REGISTRIES.map((registry) =>
        buildkitdMirrorVolumeName(org, registry),
      ),
    );
    expect(
      stoppedCommands.findIndex((args) => args[0] === 'rm'),
    ).toBeGreaterThan(
      stoppedCommands.findLastIndex((args) => args[0] === 'stop'),
    );

    await writeFile(join(root, 'calls.jsonl'), '');
    expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
    const resumed = await state();
    expect(
      Object.values(resumed.containers).every((container) => container.running),
    ).toBe(true);
    expect(resumed.volumes[cache]).toEqual(initial.volumes[cache]);
    expect(resumed.networks).toEqual(initial.networks);
    // The builder, launched as it would be now, starts again by id after
    // its mirrors are recreated on fresh volumes.
    const resumeCommands = await calls();
    const runs = resumeCommands.filter((args) => args[0] === 'run');
    expect(runs).toHaveLength(MIRROR_REGISTRIES.length);
    expect(runs.some((args) => args.includes('--privileged'))).toBe(false);
    expect(
      resumeCommands
        .filter((args) => args[0] === 'start')
        .map((args) => args.at(-1)),
    ).toEqual([initial.containers[builder]?.id]);
    expect(
      resumeCommands.findIndex((args) => args[0] === 'start'),
    ).toBeGreaterThan(
      resumeCommands.findLastIndex((args) => args[0] === 'run'),
    );

    // A first launch: every helper runs bounded.
    const fresh = nextOrg();
    await save({ ...seed(fresh), containers: {} });
    await writeFile(join(root, 'calls.jsonl'), '');
    expect(await ensureBuildkitd(cfg, fresh)).toBe(buildkitdEndpoint(fresh));
    const launches = (await calls()).filter((args) => args[0] === 'run');
    expect(launches).toHaveLength(4);
    expect(
      launches.filter((args) => args.includes('--privileged')),
    ).toHaveLength(1);
    expect(launches.find((args) => args.includes('--privileged'))).toContain(
      buildkitdContainerName(fresh),
    );
    // Every helper runs bounded; the builder, shared by the organization's
    // agent sessions, with an agent session's CPUs and twice its memory.
    const agent = cfg.session.agentProfile;
    expect(agent.memory).toBe('4g');
    for (const args of launches) {
      const privileged = args.includes('--privileged');
      expect(args).toContain(`--memory=${privileged ? '8192m' : '512m'}`);
      expect(args).toContain(`--cpus=${privileged ? agent.cpus : 1}`);
      expect(args.some((arg) => arg.startsWith('--pids-limit='))).toBe(true);
      expect(args).toContain('--oom-score-adj=500');
      expect(args).toContain('max-size=10m');
    }
  });

  test('an idle stop never removes a running mirror, nor a cache volume it cannot prove its own', async () => {
    const org = nextOrg();
    const initial = seed(org);
    const restarted = buildkitdMirrorContainerName(org, 'docker.io');
    const relabelled = buildkitdMirrorVolumeName(org, 'ghcr.io');
    initial.stopNoop = restarted;
    initial.volumes[relabelled]!.labels = {
      'tale.buildkitd': '1',
      'tale.org': 'another-org',
    };
    await save(initial);
    const now = Date.now();
    await sweepIdleBuildkitd(cfg, now);
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const log = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await sweepIdleBuildkitd(cfg, now + 1000);
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
    const after = await state();
    // Running again: the mirror and its cache stay.
    expect(after.containers[restarted]?.running).toBe(true);
    expect(after.volumes[buildkitdMirrorVolumeName(org, 'docker.io')]).toEqual(
      initial.volumes[buildkitdMirrorVolumeName(org, 'docker.io')],
    );
    // Labelled for another organization: refused, never removed.
    expect(after.volumes[relabelled]).toEqual(initial.volumes[relabelled]);
    // The rest went as usual; the builder's cache stays.
    expect(after.volumes[buildkitdMirrorVolumeName(org, 'quay.io')]).toBe(
      undefined,
    );
    expect(after.volumes[buildkitdCacheVolumeName(org)]).toEqual(
      initial.volumes[buildkitdCacheVolumeName(org)],
    );
  });

  test('a missing mirror image is pulled once in the background, never inside a create', async () => {
    const org = nextOrg();
    await save({
      ...seed(org),
      containers: {},
      missingImages: [cfg.buildkitdMirrorImage],
      pullGate: true,
    });
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const log = spyOn(console, 'log').mockImplementation(() => {});
    try {
      // The builder comes up before the gated background pull can finish.
      // All three mirrors report the missing image while that pull is under way.
      expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
      for (let i = 0; i < 400; i += 1) {
        if (
          (await readFile(join(root, 'pulling'), 'utf8').catch(() => '')) ===
          cfg.buildkitdMirrorImage
        )
          break;
        await Bun.sleep(5);
      }
      const commands = await calls();
      expect(commands.filter((args) => args[0] === 'pull')).toEqual([
        ['pull', cfg.buildkitdMirrorImage],
      ]);
      expect(await readFile(join(root, 'pulling'), 'utf8')).toBe(
        cfg.buildkitdMirrorImage,
      );
      expect((await state()).pulled ?? []).toEqual([]);
      const mirrorRuns = commands.filter(
        (args) => args[0] === 'run' && args.includes(cfg.buildkitdMirrorImage),
      );
      expect(mirrorRuns).toHaveLength(MIRROR_REGISTRIES.length);
      expect(
        mirrorRuns.every((args) => args.join(' ').includes('--pull never')),
      ).toBe(true);
      expect(
        commands.find(
          (args) => args[0] === 'run' && args.includes(cfg.buildkitdImage),
        ),
      ).toContain('TALE_BUILDKITD_MIRRORS=');
    } finally {
      // Release even after an assertion fails so no background command leaks
      // into the next test's fake daemon state.
      await writeFile(join(root, 'release-pull'), '');
      for (let i = 0; i < 400; i += 1) {
        if (
          log.mock.calls.some(
            ([message]) =>
              message ===
              `[sandbox.buildkitd] pulled ${cfg.buildkitdMirrorImage}`,
          )
        )
          break;
        await Bun.sleep(5);
      }
      const completed = log.mock.calls.some(
        ([message]) =>
          message === `[sandbox.buildkitd] pulled ${cfg.buildkitdMirrorImage}`,
      );
      warn.mockRestore();
      log.mockRestore();
      expect(completed).toBe(true);
    }
    expect((await state()).pulled).toEqual([cfg.buildkitdMirrorImage]);
  });

  test('a create arriving while idle mirrors go keeps the mirrors not yet removed', async () => {
    const org = nextOrg();
    const initial = seed(org);
    const first = buildkitdMirrorContainerName(org, 'docker.io');
    initial.rmGate = first;
    const now = Date.now();
    await rm(join(root, 'removing'), { force: true });
    await rm(join(root, 'release-rm'), { force: true });
    await save(initial);
    await sweepIdleBuildkitd(cfg, now);
    const log = spyOn(console, 'log').mockImplementation(() => {});
    let release: (() => void) | undefined;
    try {
      const sweep = sweepIdleBuildkitd(cfg, now + 1000);
      for (let i = 0; i < 400; i += 1) {
        if (await Bun.file(join(root, 'removing')).exists()) break;
        await Bun.sleep(5);
      }
      // A session create of the organization takes its lease while the
      // first mirror goes; it waits behind the organization's lock with
      // only its provisioning budget, so the rest must not hold it longer.
      release = retainBuildkitd(org);
      await writeFile(join(root, 'release-rm'), '');
      await sweep;
    } finally {
      release?.();
      log.mockRestore();
    }
    const after = await state();
    expect(after.containers[first]).toBeUndefined();
    for (const registry of ['ghcr.io', 'quay.io']) {
      expect(
        after.containers[buildkitdMirrorContainerName(org, registry)],
      ).toBeDefined();
      expect(after.volumes[buildkitdMirrorVolumeName(org, registry)]).toEqual(
        initial.volumes[buildkitdMirrorVolumeName(org, registry)],
      );
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

  test.each([
    { profile: 'default', docker: undefined },
    { profile: 'agent', docker: false },
  ])(
    'a running session that never builds does not keep its helpers (%j)',
    async (capability) => {
      const org = nextOrg();
      const initial = seed(org);
      initial.sessions = [
        { id: 'd'.repeat(64), org, status: 'running', ...capability },
      ];
      await save(initial);
      const now = Date.now();
      await sweepIdleBuildkitd(cfg, now);
      expect((await sweepIdleBuildkitd(cfg, now + 1000)).stopped).toBe(4);
    },
  );

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
    // A cancelled queued ensure must not free the queue behind an older stop.
    expect(
      await rejection(withOperationBudget(20, () => ensureBuildkitd(cfg, org))),
    ).toContain('deadline');
    const runningBefore = dockerCliLoad().running;
    const ensure = ensureBuildkitd(cfg, org);
    await Bun.sleep(30);
    expect(dockerCliLoad().running).toBe(runningBefore);
    await writeFile(join(root, 'release-stop'), '1');

    expect((await sweep).stopped).toBe(1);
    expect(await ensure).toBe(buildkitdEndpoint(org));
    const final = await state();
    expect(
      Object.values(final.containers).every((container) => container.running),
    ).toBe(true);
    expect(final.volumes).toEqual(initial.volumes);
  });

  test('an expired ensure waiting behind idle-stop never launches helpers later', async () => {
    const org = nextOrg();
    const initial = seed(org);
    initial.stopGate = true;
    await save(initial);
    const now = Date.now();
    await sweepIdleBuildkitd(cfg, now);
    const sweep = sweepIdleBuildkitd(cfg, now + 1000);
    const deadline = Date.now() + 2000;
    while (!(await Bun.file(join(root, 'stopping')).exists())) {
      if (Date.now() > deadline) throw new Error('stop gate timed out');
      await Bun.sleep(5);
    }
    const error = await rejection(
      withOperationBudget(100, () =>
        ensureBuildkitd({ ...cfg, buildkitdProvisionTimeoutMs: 30 }, org),
      ),
    );
    expect(error).toContain('deadline');
    await writeFile(join(root, 'release-stop'), '1');
    await sweep;
    await Bun.sleep(30);
    expect((await calls()).filter((args) => args[0] === 'run')).toEqual([]);
    expect(
      Object.values((await state()).containers).every((c) => !c.running),
    ).toBe(true);
  });

  test('an omitted cache budget expires queued setup after five seconds', async () => {
    const org = nextOrg();
    const initial = seed(org);
    initial.stopGate = true;
    await save(initial);
    const now = Date.now();
    await sweepIdleBuildkitd(cfg, now);
    const sweep = sweepIdleBuildkitd(cfg, now + 1000);
    const deadline = Date.now() + 2000;
    while (!(await Bun.file(join(root, 'stopping')).exists())) {
      if (Date.now() > deadline) throw new Error('stop gate timed out');
      await Bun.sleep(5);
    }
    expect(cfg.buildkitdProvisionTimeoutMs).toBeUndefined();
    const pending = rejection(ensureBuildkitd(cfg, org));
    let error: string | null;
    try {
      error = await Promise.race([
        pending,
        Bun.sleep(6000).then(
          () => 'setup still waiting after its default budget',
        ),
      ]);
    } finally {
      await writeFile(join(root, 'release-stop'), '1');
      await sweep;
      await pending;
    }
    expect(error).toContain('deadline');
    expect((await calls()).filter((args) => args[0] === 'run')).toEqual([]);
    expect(
      Object.values((await state()).containers).every((c) => !c.running),
    ).toBe(true);
  }, 15_000);

  test('a cancelled joiner leaves a shared ensure available to its first caller', async () => {
    const org = nextOrg();
    const initial = seed(org);
    initial.stopGate = true;
    await save(initial);
    const now = Date.now();
    await sweepIdleBuildkitd(cfg, now);
    const sweep = sweepIdleBuildkitd(cfg, now + 1000);
    const deadline = Date.now() + 2000;
    while (!(await Bun.file(join(root, 'stopping')).exists())) {
      if (Date.now() > deadline) throw new Error('stop gate timed out');
      await Bun.sleep(5);
    }
    const first = ensureBuildkitd(cfg, org);
    const joined = rejection(
      withOperationBudget(30, () => ensureBuildkitd(cfg, org)),
    );
    try {
      // The first caller owns the shared work; the joiner owns only its wait.
      expect(
        await Promise.race([
          joined,
          Bun.sleep(250).then(() => 'still waiting'),
        ]),
      ).toContain('deadline');
    } finally {
      await writeFile(join(root, 'release-stop'), '1');
      await sweep;
      await joined;
      expect(await first).toBe(buildkitdEndpoint(org));
    }
    expect(await ensureBuildkitd(cfg, org)).toBe(buildkitdEndpoint(org));
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
