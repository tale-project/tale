import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

// What session creates ask the docker daemon. Module mocks run in a separate
// Bun process so they cannot replace the real exports other suites use.
async function createTwo(legacyRoot: boolean): Promise<{
  calls: string[][][];
  error: string | null;
}> {
  const sourceRoot = resolve(import.meta.dir, '../..');
  const script = `
import { mock } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const source = ${JSON.stringify(sourceRoot)};
const legacyRoot = ${JSON.stringify(legacyRoot)};
const success = {exitCode:0, stdout:'', stderr:'', stdoutTruncated:false, stderrTruncated:false};
let calls = [];
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
  runnerdHealth: async () => ({}),
  runnerdEnvPatch: async () => [],
}));
const {DockerSessionBackend} = await import(join(source,'backend/docker/docker-session-backend.ts'));
const {TEST_SESSION_CONFIG} = await import(join(source,'session/session-test-config.ts'));
const root = await mkdtemp(join(tmpdir(),'tale-create-calls-'));
// A colour subdir from before the session root was flattened.
if (legacyRoot) await mkdir(join(root,'blue'));
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
console.log(JSON.stringify({calls:perCreate,error}));
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
  test('the cache volumes once per organization, and no legacy mount lookup on a flat root', async () => {
    const { calls, error } = await createTwo(false);
    expect(error).toBeNull();
    const [first = [], second = []] = calls;
    expect(first.filter(volumeInspect)).toHaveLength(3);
    expect(second.filter(volumeInspect)).toHaveLength(0);
    expect([...first, ...second].filter(mountLookup)).toHaveLength(0);
    expect(first.filter((args) => args[0] === 'run')).toHaveLength(1);
    expect(second.filter((args) => args[0] === 'run')).toHaveLength(1);
  });

  test('a root that still holds a legacy colour directory keeps the mount lookup', async () => {
    const { calls, error } = await createTwo(true);
    expect(error).toBeNull();
    expect((calls[0] ?? []).filter(mountLookup)).toHaveLength(1);
  });
});
