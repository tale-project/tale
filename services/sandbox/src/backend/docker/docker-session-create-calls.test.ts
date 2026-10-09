import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

// What session creates ask the docker daemon. Module mocks run in a separate
// Bun process so they cannot replace the real exports other suites use.
async function createTwo(plant: {
  dirs?: string[];
  files?: string[];
  dockerInitiallyUnavailable?: boolean;
  /** The incarnation runnerd's readiness answers name, if any. */
  incarnation?: string;
  /** Turns transparent egress on, with the egress proxy at this address on
   * the sandbox network; `unreadable` fails its lookup. */
  egress?: string;
}): Promise<{
  calls: string[][][];
  error: string | null;
  healthChecks: number;
  results: Array<{
    resumed: boolean;
    incarnation?: string;
    egressAddress?: string;
  }>;
}> {
  const sourceRoot = resolve(import.meta.dir, '../..');
  const script = `
import { mock } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const source = ${JSON.stringify(sourceRoot)};
const planted = ${JSON.stringify(plant)};
const success = {exitCode:0, stdout:'', stderr:'', stdoutTruncated:false, stderrTruncated:false};
let calls = [];
let healthChecks = 0;
const spawnPath = join(source,'spawn-util.ts');
const realSpawn = await import(spawnPath);
// Every cache volume is there, with its label.
const labelled = {...success, stdout:'{"tale.sandbox-cache":"1"}'};
// The egress proxy on the sandbox network ('control'), named 'egress'.
const egressId = 'e'.repeat(64);
const egressNetwork = {...success, stdout: JSON.stringify({[egressId]: {Name: 'egress'}})};
const egressContainer = {...success, stdout: JSON.stringify({id: egressId, name: '/egress', running: true, startedAt: '2026-10-01T00:00:00Z', networks: {control: {Aliases: ['egress'], IPAddress: planted.egress, NetworkID: 'f'.repeat(64)}}})};
mock.module(spawnPath, () => ({...realSpawn,
  runDocker: async (args) => {
    calls.push(args);
    if (planted.egress !== undefined && args.includes(egressId)) return egressContainer;
    if (planted.egress !== undefined && args[0] === 'network' && args[1] === 'inspect') {
      return planted.egress === 'unreadable' ? {...success, exitCode:1, stderr:'Cannot connect to the Docker daemon'} : egressNetwork;
    }
    return args[0] === 'volume' && args[1] === 'inspect' ? labelled : success;
  },
}));
console.warn = () => {};
mock.module(join(source,'session/runnerd-client.ts'), () => ({
  runnerdHealth: async () => ({dockerReady: !(++healthChecks === 1 && planted.dockerInitiallyUnavailable), ...(planted.incarnation === undefined ? {} : {incarnation: planted.incarnation})}),
  runnerdEnvPatch: async () => [],
}));
const {DockerSessionBackend} = await import(join(source,'backend/docker/docker-session-backend.ts'));
const {TEST_SESSION_CONFIG} = await import(join(source,'session/session-test-config.ts'));
const root = await mkdtemp(join(tmpdir(),'tale-create-calls-'));
for (const dir of planted.dirs ?? []) await mkdir(join(root,dir));
for (const file of planted.files ?? []) await writeFile(join(root,file),'');
const cfg = {
 backend:'docker', sandboxToken:'test',runtimeImage:'runtime:test',runtimeTier:'runc',dockerInContainer:false,dockerBuildCache:false,
 transparentEgress:planted.egress !== undefined,hostSessionRoot:root,cacheVolumePrefix:{pip:'pip',npm:'npm',bun:'bun'},
 egressNetwork:'control',egressProxy:'http://egress:3128',
 session:{...TEST_SESSION_CONFIG,agentProfile:{...TEST_SESSION_CONFIG.agentProfile,uid:process.getuid() || 10001,gid:process.getgid() || 10001}},
};
const backend = new DockerSessionBackend(cfg);
const perCreate = [];
const results = [];
let error = null;
try {
  for (const sessionId of ['calls-a','calls-b']) {
    calls = [];
    results.push(await backend.createSession({sessionId,organizationId:'org-calls',profile:'agent',env:{},createdAtMs:0,ttlMs:1000,idleTimeoutMs:1000}));
    perCreate.push(calls);
  }
} catch (e) { error = e.message; }
await rm(root,{recursive:true,force:true});
console.log(JSON.stringify({calls:perCreate,error,healthChecks,results}));
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
  if (exit !== 0) throw new Error(`Create probe failed: ${stderr}`);
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}');
}

const mountLookup = (args: string[]) =>
  args[0] === 'inspect' && args.some((arg) => arg.includes('.Mounts'));
const volumeInspect = (args: string[]) =>
  args[0] === 'volume' && args[1] === 'inspect';

describe('what a session create asks the docker daemon', () => {
  test('a live runnerd with unavailable inner Docker is polled until ready', async () => {
    const { error, healthChecks } = await createTwo({
      dockerInitiallyUnavailable: true,
    });
    expect(error).toBeNull();
    expect(healthChecks).toBe(3);
  });
  test('the create reports the incarnation its readiness answer named', async () => {
    const named = await createTwo({ incarnation: '0' });
    expect(named.error).toBeNull();
    expect(named.results).toEqual([
      { resumed: false, incarnation: '0' },
      { resumed: false, incarnation: '0' },
    ]);
    // An older runtime image names none, and the create reports none.
    const unnamed = await createTwo({});
    expect(unnamed.error).toBeNull();
    expect(unnamed.results).toEqual([{ resumed: false }, { resumed: false }]);
  });
  test('a session that pins the egress proxy records its address: one lookup, then one inspect per create', async () => {
    const { calls, error, results } = await createTwo({ egress: '172.30.0.3' });
    expect(error).toBeNull();
    expect(results).toEqual([
      { resumed: false, egressAddress: '172.30.0.3' },
      { resumed: false, egressAddress: '172.30.0.3' },
    ]);
    const [first = [], second = []] = calls;
    const egressCalls = (create: string[][]) =>
      create.filter(
        (args) => args[0] === 'network' || args.includes('e'.repeat(64)),
      );
    expect(egressCalls(first).map((args) => args[0])).toEqual([
      'network',
      'inspect',
    ]);
    expect(egressCalls(second).map((args) => args[0])).toEqual(['inspect']);
    for (const create of [first, second]) {
      const run = create.find((args) => args[0] === 'run') ?? [];
      expect(run).toContain('tale.egress-ip=172.30.0.3');
    }
  });

  test('an egress proxy that cannot be read leaves the session unlabelled, never uncreated', async () => {
    const { calls, error, results } = await createTwo({ egress: 'unreadable' });
    expect(error).toBeNull();
    expect(results).toEqual([{ resumed: false }, { resumed: false }]);
    for (const create of calls) {
      const run = create.find((args) => args[0] === 'run') ?? [];
      expect(run.some((arg) => arg.startsWith('tale.egress-ip='))).toBe(false);
    }
  });

  test('the cache volumes once per organization, and no legacy mount lookup on a flat root', async () => {
    const { calls, error } = await createTwo({});
    expect(error).toBeNull();
    const [first = [], second = []] = calls;
    expect(first.filter(volumeInspect)).toHaveLength(3);
    expect(second.filter(volumeInspect)).toHaveLength(0);
    expect([...first, ...second].filter(mountLookup)).toHaveLength(0);
    expect(first.filter((args) => args[0] === 'run')).toHaveLength(1);
    expect(second.filter((args) => args[0] === 'run')).toHaveLength(1);
  });

  test('a root that still holds a legacy colour directory keeps the mount lookup', async () => {
    // A colour subdir from before the session root was flattened.
    const { calls, error } = await createTwo({ dirs: ['blue'] });
    expect(error).toBeNull();
    expect((calls[0] ?? []).filter(mountLookup)).toHaveLength(1);
  });

  test('bookkeeping, lost+found, workspaces and files are no colour directory', async () => {
    const { calls, error } = await createTwo({
      dirs: ['.pins', '.owners', '.trash', 'lost+found', 'ses-calls-old'],
      files: ['blue', '.spawner.lock'],
    });
    expect(error).toBeNull();
    expect((calls[0] ?? []).filter(mountLookup)).toHaveLength(0);
  });
});

// A create whose `docker run` the daemon refuses with `runStderr`; reports
// what the backend told its runtime-image listener.
async function refusedRun(
  runStderr: string,
  freshCaches = false,
): Promise<{
  heard: string[];
  error: string | null;
  run: string[] | null;
}> {
  const sourceRoot = resolve(import.meta.dir, '../..');
  const script = `
import { mock } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const source = ${JSON.stringify(sourceRoot)};
const success = {exitCode:0, stdout:'', stderr:'', stdoutTruncated:false, stderrTruncated:false};
let run = null;
const spawnPath = join(source,'spawn-util.ts');
const realSpawn = await import(spawnPath);
mock.module(spawnPath, () => ({...realSpawn,
  runDocker: async (args) => {
    if (args[0] === 'run') {
      run = args;
      return {...success, exitCode:125, stderr:${JSON.stringify(runStderr)}};
    }
    if (args[0] === 'inspect') return {...success, exitCode:1, stderr:'No such container'};
    if (args[0] === 'volume' && args[1] === 'inspect') {
      return ${JSON.stringify(freshCaches)}
        ? {...success, exitCode:1, stderr:'Error response from daemon: get x: no such volume'}
        : {...success, stdout:'{"tale.sandbox-cache":"1"}'};
    }
    return success;
  },
}));
console.warn = () => {};
const {DockerSessionBackend} = await import(join(source,'backend/docker/docker-session-backend.ts'));
const {TEST_SESSION_CONFIG} = await import(join(source,'session/session-test-config.ts'));
const root = await mkdtemp(join(tmpdir(),'tale-create-image-'));
const cfg = {
 backend:'docker', sandboxToken:'test',runtimeImage:'runtime:test',runtimeTier:'runc',dockerInContainer:false,dockerBuildCache:false,
 transparentEgress:false,hostSessionRoot:root,cacheVolumePrefix:{pip:'pip',npm:'npm',bun:'bun'},
 egressNetwork:'control',egressProxy:'http://egress:3128',
 session:{...TEST_SESSION_CONFIG,agentProfile:{...TEST_SESSION_CONFIG.agentProfile,uid:process.getuid() || 10001,gid:process.getgid() || 10001}},
};
const backend = new DockerSessionBackend(cfg);
const heard = [];
backend.onRuntimeImageMissing((detail) => heard.push(detail));
let error = null;
try {
  await backend.createSession({sessionId:'image-a',organizationId:'org-image',profile:'agent',env:{},createdAtMs:0,ttlMs:1000,idleTimeoutMs:1000});
} catch (e) { error = e.message; }
await rm(root,{recursive:true,force:true});
console.log(JSON.stringify({heard,error,run}));
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
  if (exit !== 0) throw new Error(`Create probe failed: ${stderr}`);
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}');
}

describe('a create on a host without the runtime image', () => {
  test('never pulls, fails at once and tells the warmup', async () => {
    const stderr =
      'docker: Error response from daemon: No such image: runtime:test.';
    const { heard, error, run } = await refusedRun(stderr);
    expect(run).toContain('--pull=never');
    expect(error).toContain('No such image');
    expect(heard).toEqual([stderr]);
  });

  test('a new cache volume’s mode, set with the runtime image, tells the warmup first', async () => {
    const stderr =
      'docker: Error response from daemon: No such image: runtime:test.';
    const { heard, error, run } = await refusedRun(stderr, true);
    // The chmod of the organization's first cache volume ran the image.
    expect(run).toEqual(expect.arrayContaining(['--entrypoint', '/bin/chmod']));
    expect(error).toContain('failed to set perms on cache volume');
    expect(heard).toHaveLength(1);
    expect(heard[0]).toContain('No such image');
  });

  test('any other refusal is no news for the warmup', async () => {
    const { heard, error } = await refusedRun(
      'docker: Error response from daemon: failed to initialize logging driver',
    );
    expect(error).toContain('logging driver');
    expect(heard).toEqual([]);
  });
});
