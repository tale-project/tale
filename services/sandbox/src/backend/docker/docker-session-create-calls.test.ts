import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

// What session creates ask the docker daemon. Module mocks run in a separate
// Bun process so they cannot replace the real exports other suites use.
async function createTwo(plant: {
  dirs?: string[];
  files?: string[];
  dockerInitiallyUnavailable?: boolean;
}): Promise<{
  calls: string[][][];
  error: string | null;
  healthChecks: number;
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
mock.module(spawnPath, () => ({...realSpawn,
  runDocker: async (args) => {
    calls.push(args);
    return args[0] === 'volume' && args[1] === 'inspect' ? labelled : success;
  },
}));
mock.module(join(source,'session/runnerd-client.ts'), () => ({
  runnerdHealth: async () => ({dockerReady: !(++healthChecks === 1 && planted.dockerInitiallyUnavailable)}),
  runnerdEnvPatch: async () => [],
}));
const {DockerSessionBackend} = await import(join(source,'backend/docker/docker-session-backend.ts'));
const {TEST_SESSION_CONFIG} = await import(join(source,'session/session-test-config.ts'));
const root = await mkdtemp(join(tmpdir(),'tale-create-calls-'));
for (const dir of planted.dirs ?? []) await mkdir(join(root,dir));
for (const file of planted.files ?? []) await writeFile(join(root,file),'');
const cfg = {
 backend:'docker', sandboxToken:'test',runtimeImage:'runtime:test',runtimeTier:'runc',dockerInContainer:false,dockerBuildCache:false,
 transparentEgress:false,hostSessionRoot:root,cacheVolumePrefix:{pip:'pip',npm:'npm',bun:'bun'},
 egressNetwork:'control',egressProxy:'http://egress:3128',
 session:{...TEST_SESSION_CONFIG,agentProfile:{...TEST_SESSION_CONFIG.agentProfile,uid:process.getuid() || 10001,gid:process.getgid() || 10001}},
};
const backend = new DockerSessionBackend(cfg);
const perCreate = [];
let error = null;
try {
  for (const sessionId of ['calls-a','calls-b']) {
    calls = [];
    await backend.createSession({sessionId,organizationId:'org-calls',profile:'agent',env:{},createdAtMs:0,ttlMs:1000,idleTimeoutMs:1000});
    perCreate.push(calls);
  }
} catch (e) { error = e.message; }
await rm(root,{recursive:true,force:true});
console.log(JSON.stringify({calls:perCreate,error,healthChecks}));
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
