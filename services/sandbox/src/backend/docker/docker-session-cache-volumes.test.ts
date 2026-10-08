import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

// An organization's package cache volumes removed behind the spawner's back
// (`docker volume prune -a` while none of its sessions ran), against a fake
// docker CLI that keeps its volumes and containers in a state file and, like
// Docker, creates a volume a `--mount` names when it is missing: no labels,
// root-owned, mode 0755. Session processes run as an unprivileged uid with
// every capability dropped, so they can write a cache volume only once its
// root is 1777. Module mocks run in a separate Bun process so they cannot
// replace the real exports other suites use.

const FAKE_DOCKER = String.raw`#!/usr/bin/env bun
import { appendFileSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const dir = dirname(process.argv[1]);
// The cache volumes are ensured at once: one call reads and writes the state
// at a time.
const lock = join(dir, 'state.lock');
for (;;) {
  try { mkdirSync(lock); break; } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    Bun.sleepSync(2);
  }
}
process.on('exit', () => rmdirSync(lock));
const path = join(dir, 'state.json');
const s = JSON.parse(readFileSync(path, 'utf8'));
const a = process.argv.slice(2);
appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify(a) + '\n');
function done(output = '') {
  writeFileSync(path, JSON.stringify(s));
  if (output !== '') console.log(output);
  process.exit(0);
}
function fail(message) { console.error(message); process.exit(1); }
const values = (name) => a.filter((_, i) => a[i - 1] === name);
const [command, sub] = a;
const name = a.at(-1);
if (command === 'volume' && sub === 'create') {
  // Creating an existing volume answers its name and leaves its labels as
  // they are.
  if (!(name in s.volumes)) {
    const labels = {};
    for (const label of values('--label')) {
      const [key, ...value] = label.split('=');
      labels[key] = value.join('=');
    }
    s.volumes[name] = { labels, mode: '0755', users: [] };
  }
  done(name);
}
if (command === 'volume' && sub === 'ls') {
  const wanted = values('--filter').map((filter) => filter.replace(/^label=/, ''));
  done(Object.entries(s.volumes)
    .filter(([, volume]) => wanted.every((label) => {
      const [key, ...value] = label.split('=');
      return (volume.labels ?? {})[key] === value.join('=');
    }))
    .map(([volume]) => volume).join('\n'));
}
if (command === 'volume' && (sub === 'inspect' || sub === 'rm')) {
  const volume = s.volumes[name];
  if (volume === undefined) fail('Error response from daemon: get ' + name + ': no such volume');
  if (sub === 'inspect') {
    const labels = Object.keys(volume.labels ?? {}).length > 0 ? volume.labels : null;
    done(a.includes('--format') ? JSON.stringify(labels) : JSON.stringify([{ Name: name, Labels: labels }]));
  }
  if (volume.users.length > 0) {
    fail('Error response from daemon: remove ' + name + ': volume is in use - [' + volume.users.join(', ') + ']');
  }
  delete s.volumes[name];
  done(name);
}
if (command === 'run') {
  const mounts = values('--mount').map((mount) =>
    Object.fromEntries(mount.split(',').map((field) => field.split('='))));
  for (const mount of mounts) {
    if (mount.type === 'volume' && !(mount.src in s.volumes)) {
      s.volumes[mount.src] = { labels: null, mode: '0755', users: [] };
    }
  }
  if (a.includes('--rm')) {
    const cache = mounts.find((mount) => mount.dst === '/cache');
    if (
      cache === undefined ||
      values('--entrypoint')[0] !== '/bin/chmod' ||
      a.slice(-2).join(' ') !== '1777 /cache'
    ) {
      fail('Unhandled one-shot run: ' + JSON.stringify(a));
    }
    s.volumes[cache.src].mode = '1777';
    done();
  }
  const container = values('--name')[0];
  s.containers[container] = mounts.filter((mount) => mount.type === 'volume').map((mount) => mount.src);
  for (const volume of s.containers[container]) s.volumes[volume].users.push(container);
  done('0123456789abcdef');
}
if (command === 'inspect') {
  if (!(name in s.containers)) fail('Error response from daemon: No such object: ' + name);
  done(a.join(' ').includes('State.Running') ? 'true' : '0123456789abcdef');
}
if (command === 'rm') {
  if (!(name in s.containers)) fail('Error response from daemon: No such container: ' + name);
  for (const volume of s.containers[name]) {
    s.volumes[volume].users = s.volumes[volume].users.filter((user) => user !== name);
  }
  delete s.containers[name];
  done(name);
}
if (command === 'ps' || (command === 'network' && sub === 'ls')) done();
if (command === 'network') fail('Error response from daemon: network ' + name + ' not found');
fail('Unhandled fake docker call: ' + JSON.stringify(a));
`;

interface Observed {
  write: boolean;
  labelled: boolean;
}

interface Scenario {
  /** Inside the window, after the prune. */
  windowCreate: Observed;
  /** The first create past the window. */
  checkedCreate: Observed;
  /** Past one more window, once no session holds the volumes. */
  laterCreate: Observed | null;
  teardown: { volumes: number } | { error: string };
  left: string[];
  warnings: string[];
  error: string | null;
}

/** One organization's sessions through the prune: a create marks its cache
 * volumes ready, its session stops, the volumes are pruned, and a create
 * inside the window lets Docker make them. Then a create past the window,
 * with the window's session stopped first or still running, and, when it
 * was still running, one more create once nothing holds the volumes; then
 * the organization's teardown. */
async function prunedCaches(windowSessionRuns: boolean): Promise<Scenario> {
  const sourceRoot = resolve(import.meta.dir, '../..');
  const script = `
import { mock } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const source = ${JSON.stringify(sourceRoot)};
const windowSessionRuns = ${JSON.stringify(windowSessionRuns)};
mock.module(join(source,'session/runnerd-client.ts'), () => ({
  runnerdHealth: async () => ({}),
  runnerdEnvPatch: async () => [],
}));
const warnings = [];
console.warn = (...parts) => { warnings.push(parts.map(String).join(' ')); };
let now = 1_700_000_000_000;
Date.now = () => now;
const fake = await mkdtemp(join(tmpdir(),'tale-cache-prune-'));
await writeFile(join(fake,'docker'), ${JSON.stringify(FAKE_DOCKER)});
await chmod(join(fake,'docker'), 0o755);
await writeFile(join(fake,'state.json'), JSON.stringify({volumes:{}, containers:{}}));
process.env.DOCKER_BIN = join(fake,'docker');
const state = async () => JSON.parse(await readFile(join(fake,'state.json'),'utf8'));
const {DockerSessionBackend} = await import(join(source,'backend/docker/docker-session-backend.ts'));
const {TEST_SESSION_CONFIG} = await import(join(source,'session/session-test-config.ts'));
const root = join(fake,'sessions');
const cfg = {
 backend:'docker', sandboxToken:'test',runtimeImage:'runtime:test',runtimeTier:'runc',dockerInContainer:false,dockerBuildCache:false,
 transparentEgress:false,hostSessionRoot:root,cacheVolumePrefix:{pip:'pip',npm:'npm',bun:'bun'},
 egressNetwork:'control',egressProxy:'http://egress:3128',
 session:{...TEST_SESSION_CONFIG,agentProfile:{...TEST_SESSION_CONFIG.agentProfile,uid:process.getuid() || 10001,gid:process.getgid() || 10001}},
};
const organizationId = 'org-pruned';
const caches = ['pip','npm','bun'].map((prefix) => prefix + '-' + organizationId);
const backend = new DockerSessionBackend(cfg);
const create = (sessionId) => backend.createSession({sessionId,organizationId,profile:'agent',env:{},createdAtMs:0,ttlMs:1000,idleTimeoutMs:1000});
// An unprivileged uid without CAP_DAC_OVERRIDE writes a root-owned
// directory only when it is world-writable.
const observe = async () => {
  const {volumes} = await state();
  return {
    write: caches.every((name) => volumes[name]?.mode === '1777'),
    labelled: caches.every((name) => volumes[name]?.labels?.['tale.sandbox-cache'] === '1'),
  };
};
const result = {windowCreate:null, checkedCreate:null, laterCreate:null, teardown:null, left:[], warnings, error:null};
try {
  await create('prune-a');
  await backend.stopSession('prune-a');
  // docker volume prune -a: every volume no container uses.
  const pruned = await state();
  for (const [name, volume] of Object.entries(pruned.volumes)) {
    if (volume.users.length === 0) delete pruned.volumes[name];
  }
  await writeFile(join(fake,'state.json'), JSON.stringify(pruned));
  now += 60_000;
  await create('prune-b');
  result.windowCreate = await observe();
  if (!windowSessionRuns) await backend.stopSession('prune-b');
  now += 5 * 60_000;
  await create('prune-c');
  result.checkedCreate = await observe();
  await backend.stopSession('prune-c');
  if (windowSessionRuns) {
    await backend.stopSession('prune-b');
    now += 5 * 60_000;
    await create('prune-d');
    result.laterCreate = await observe();
    await backend.stopSession('prune-d');
  }
  try {
    const removed = await backend.teardownOrganization(organizationId);
    result.teardown = {volumes: removed.volumes};
  } catch (e) { result.teardown = {error: e.message}; }
  result.left = Object.keys((await state()).volumes);
} catch (e) { result.error = e.message; }
await rm(fake,{recursive:true,force:true});
console.log(JSON.stringify(result));
`;
  const child = Bun.spawn([process.execPath, '-e', script], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exit !== 0) throw new Error(`Prune probe failed: ${stderr}`);
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}');
}

describe('cache volumes pruned behind the spawner', () => {
  test('one Docker re-made inside the window is replaced at the next check: sessions write, the teardown removes it', async () => {
    const result = await prunedCaches(false);
    expect(result.error).toBeNull();
    // Inside the window nothing asks the daemon: Docker made the volumes.
    expect(result.windowCreate).toEqual({ write: false, labelled: false });
    expect(result.checkedCreate).toEqual({ write: true, labelled: true });
    expect(result.teardown).toEqual({ volumes: 3 });
    expect(result.left).toEqual([]);
  }, 30_000);

  test('one a running session holds is made writable at once, and replaced once nothing holds it', async () => {
    const result = await prunedCaches(true);
    expect(result.error).toBeNull();
    expect(result.checkedCreate).toEqual({ write: true, labelled: false });
    expect(
      result.warnings.filter((line) =>
        line.includes('lacks the tale.sandbox-cache label'),
      ),
    ).toHaveLength(3);
    expect(result.laterCreate).toEqual({ write: true, labelled: true });
    expect(result.teardown).toEqual({ volumes: 3 });
    expect(result.left).toEqual([]);
  }, 30_000);
});

interface Retention {
  /** The organization's recorded use after its first create. */
  recorded: boolean;
  /** Past the retention while its session still runs. */
  whileRunning: string[];
  /** Past the retention once the session stopped. */
  afterStop: string[];
  /** The next create after the removal. */
  recreated: Observed | null;
  warnings: string[];
  error: string | null;
}

/** An organization's caches through their retention: a create records their
 * use; past the retention a session that still mounts them keeps them
 * (Docker refuses the removal); once it stopped they go, and the next
 * create makes them again, labelled and writable. */
async function retainedCaches(): Promise<Retention> {
  const sourceRoot = resolve(import.meta.dir, '../..');
  const script = `
import { mock } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const source = ${JSON.stringify(sourceRoot)};
mock.module(join(source,'session/runnerd-client.ts'), () => ({
  runnerdHealth: async () => ({}),
  runnerdEnvPatch: async () => [],
}));
const warnings = [];
console.warn = (...parts) => { warnings.push(parts.map(String).join(' ')); };
console.log = () => {};
let now = 1_700_000_000_000;
Date.now = () => now;
const fake = await mkdtemp(join(tmpdir(),'tale-cache-retention-'));
await writeFile(join(fake,'docker'), ${JSON.stringify(FAKE_DOCKER)});
await chmod(join(fake,'docker'), 0o755);
await writeFile(join(fake,'state.json'), JSON.stringify({volumes:{}, containers:{}}));
process.env.DOCKER_BIN = join(fake,'docker');
const state = async () => JSON.parse(await readFile(join(fake,'state.json'),'utf8'));
const {DockerSessionBackend} = await import(join(source,'backend/docker/docker-session-backend.ts'));
const {expirePackageCaches} = await import(join(source,'package-cache-retention.ts'));
const {TEST_SESSION_CONFIG} = await import(join(source,'session/session-test-config.ts'));
const root = join(fake,'sessions');
const cfg = {
 backend:'docker', sandboxToken:'test',runtimeImage:'runtime:test',runtimeTier:'runc',dockerInContainer:false,dockerBuildCache:false,
 transparentEgress:false,hostSessionRoot:root,cacheVolumePrefix:{pip:'pip',npm:'npm',bun:'bun'},
 egressNetwork:'control',egressProxy:'http://egress:3128',
 session:{...TEST_SESSION_CONFIG,agentProfile:{...TEST_SESSION_CONFIG.agentProfile,uid:process.getuid() || 10001,gid:process.getgid() || 10001}},
};
const organizationId = 'org-retained';
const caches = ['pip','npm','bun'].map((prefix) => prefix + '-' + organizationId);
const backend = new DockerSessionBackend(cfg);
const create = (sessionId) => backend.createSession({sessionId,organizationId,profile:'agent',env:{},createdAtMs:0,ttlMs:1000,idleTimeoutMs:1000});
const left = async () => { const {volumes} = await state(); return caches.filter((name) => name in volumes); };
const result = {recorded:false, whileRunning:[], afterStop:[], recreated:null, warnings, error:null};
try {
  await create('retain-a');
  result.recorded = (await stat(join(root,'.package-caches',organizationId + '.used')).catch(() => null)) !== null;
  const past = now + 15 * 24 * 60 * 60 * 1000;
  await expirePackageCaches(cfg, past);
  result.whileRunning = await left();
  await backend.stopSession('retain-a');
  await expirePackageCaches(cfg, past);
  result.afterStop = await left();
  now = past;
  await create('retain-b');
  const {volumes} = await state();
  result.recreated = {
    write: caches.every((name) => volumes[name]?.mode === '1777'),
    labelled: caches.every((name) => volumes[name]?.labels?.['tale.sandbox-cache'] === '1'),
  };
  await backend.stopSession('retain-b');
} catch (e) { result.error = e.message; }
await rm(fake,{recursive:true,force:true});
process.stdout.write(JSON.stringify(result) + '\\n');
`;
  const child = Bun.spawn([process.execPath, '-e', script], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exit !== 0) throw new Error(`Retention probe failed: ${stderr}`);
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}');
}

describe('package cache retention through session creates', () => {
  test('a create records the use; past the retention the caches stay while mounted, go once the session stopped, and come back with the next create', async () => {
    const result = await retainedCaches();
    expect(result.error).toBeNull();
    expect(result.recorded).toBe(true);
    // The fake lists no session container: Docker's refusal keeps them.
    expect(result.whileRunning).toHaveLength(3);
    expect(
      result.warnings.some((line) => line.includes('volume is in use')),
    ).toBe(true);
    expect(result.afterStop).toEqual([]);
    expect(result.recreated).toEqual({ write: true, labelled: true });
  }, 30_000);
});
