import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

// Module mocks run in a separate Bun process so they cannot replace the real
// provisioning or firewall exports used by the other sandbox suites.
async function create(scenario: string): Promise<{
  events: string[];
  error: string | null;
  retained: string;
  owner: string | null;
}> {
  const sourceRoot = resolve(import.meta.dir, '../..');
  const script = `
import { mock } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const source = ${JSON.stringify(sourceRoot)};
const scenario = ${JSON.stringify(scenario)};
const events = [];
let leases = 0;
let completeCache;
const cacheGate = new Promise(resolve => { completeCache = resolve; });
const success = {exitCode:0, stdout:'', stderr:'', stdoutTruncated:false, stderrTruncated:false};
const spawnPath = join(source,'spawn-util.ts');
const realSpawn = await import(spawnPath);
mock.module(spawnPath, () => ({...realSpawn,
  runDocker: async (args) => {
    if (scenario === 'expired-setup' && args[0] === 'volume') {
      events.push('volume-' + args[1]);
      if (args[1] === 'create') await Bun.sleep(100);
    }
    if (args[0] === 'run') {
      events.push('run');
      if (scenario === 'slow-cache') completeCache();
      if (scenario === 'startup-failure') return {...success,exitCode:1,stderr:'image unavailable'};
    }
    return {...success,stdout:args[0] === 'inspect' ? 'container-id' : ''};
  },
  dockerRm: async () => {events.push('cleanup'); return success;},
}));
const buildPath = join(source,'buildkitd.ts');
const realBuild = await import(buildPath);
mock.module(buildPath, () => ({...realBuild,
  retainBuildkitd: () => {events.push('retain'); leases++; return () => {leases--;events.push('release');};},
  ensureBuildkitd: async (_,org) => {events.push('ensure:'+leases); if(scenario==='cache-failure') throw new Error('cache unavailable'); if(scenario==='slow-cache') { await cacheGate; events.push('late-cache'); } return realBuild.buildkitdEndpoint(org);},
  sweepIdleBuildkitd: async () => {events.push('sweep'); return {stopped:0,organizations:0};},
}));
mock.module(join(source,'session/buildkit-network-guard.ts'), () => ({
  readBuildkitNetworkPlan: async () => ({id:'e'.repeat(64),subnets:['172.19.0.0/23']}),
  attachBuildkitNetwork: async () => {events.push('attach:'+leases); if(scenario==='guard-failure') throw new Error('guard unavailable');},
}));
mock.module(join(source,'session/runnerd-client.ts'), () => ({
  runnerdHealth: async () => {events.push('ready'); return {};},
  runnerdEnvPatch: async () => {events.push('env'); return [];},
}));
const {DockerSessionBackend} = await import(join(source,'backend/docker/docker-session-backend.ts'));
const {TEST_SESSION_CONFIG} = await import(join(source,'session/session-test-config.ts'));
const {sessionWorkspaceDirName} = await import(join(source,'session/session-naming.ts'));
const root = await mkdtemp(join(tmpdir(),'tale-create-order-'));
const workspace = join(root,sessionWorkspaceDirName('test-session'));
await mkdir(workspace);
await writeFile(join(workspace,'sentinel'),'saved workspace');
const cfg = {
 backend:'docker', sandboxToken:'test',runtimeImage:'runtime:test',runtimeTier:'kata',dockerInContainer:true,dockerBuildCache:true,
 transparentEgress:false,hostSessionRoot:root,cacheVolumePrefix:{pip:'pip',npm:'npm',bun:'bun'},
 egressNetwork:'control',egressProxy:'http://egress:3128',
 session:{...TEST_SESSION_CONFIG,createHealthTimeoutMs:scenario==='slow-cache'||scenario==='expired-setup'?40:TEST_SESSION_CONFIG.createHealthTimeoutMs,agentProfile:{...TEST_SESSION_CONFIG.agentProfile,uid:process.getuid() || 10001,gid:process.getgid() || 10001}},
};
let error = null;
try {
  await new DockerSessionBackend(cfg).createSession({sessionId:'test-session',organizationId:'org-a',profile:'agent',env:{TEST_VALUE:'set'},createdAtMs:0,ttlMs:1000,idleTimeoutMs:1000});
} catch (e) { error=e.message; }
const retained = await readFile(join(workspace,'sentinel'),'utf8');
const owner = await readFile(join(root,'.owners','test-session.org'),'utf8').catch(() => null);
await rm(root,{recursive:true,force:true});
console.log(JSON.stringify({events,error,retained,owner}));
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
  return JSON.parse(stdout);
}

describe('Docker session build-cache readiness and create lease', () => {
  test('protects ensure through ready/attach and attaches before exposing environment', async () => {
    const result = await create('success');
    expect(result.error).toBeNull();
    expect(result.events).toEqual([
      'retain',
      'ensure:1',
      'run',
      'ready',
      'attach:1',
      'env',
      'release',
    ]);
    expect(result.retained).toBe('saved workspace');
    // The workspace names its organization for when no container does.
    expect(result.owner).toBe('org-a\n');
  });

  test('failed guard tears down compute, preserves workspace and releases the lease', async () => {
    const result = await create('guard-failure');
    expect(result.error).toBe('guard unavailable');
    expect(result.events).toEqual([
      'retain',
      'ensure:1',
      'run',
      'ready',
      'attach:1',
      'cleanup',
      'release',
    ]);
    expect(result.retained).toBe('saved workspace');
  });

  test('unavailable shared cache uses the local builder without an org network', async () => {
    const result = await create('cache-failure');
    expect(result.error).toBeNull();
    expect(result.events).toEqual([
      'retain',
      'ensure:1',
      'run',
      'ready',
      'env',
      'release',
    ]);
  });

  test('slow optional setup cannot delay readiness or attach its late result', async () => {
    const result = await create('slow-cache');
    expect(result.error).toBeNull();
    expect(result.events).toContain('late-cache');
    expect(result.events).toContain('ready');
    expect(result.events.some((event) => event.startsWith('attach:'))).toBe(
      false,
    );
    expect(result.events.indexOf('run')).toBeLessThan(
      result.events.indexOf('late-cache'),
    );
    expect(result.retained).toBe('saved workspace');
  });

  test('setup consumes readiness time and an expired budget preserves the workspace', async () => {
    const result = await create('expired-setup');
    expect(result.error).toContain(
      'session create readiness deadline exceeded',
    );
    expect(result.events).not.toContain('run');
    expect(result.events.at(-2)).toBe('volume-rm');
    expect(result.events.at(-1)).toBe('release');
    expect(result.retained).toBe('saved workspace');
  });

  test('failed Docker startup also releases the create lease', async () => {
    const result = await create('startup-failure');
    expect(result.error).toContain('image unavailable');
    expect(result.events).toEqual([
      'retain',
      'ensure:1',
      'run',
      'cleanup',
      'release',
    ]);
    expect(result.retained).toBe('saved workspace');
    // A resume that failed keeps the workspace, and with it whose it is.
    expect(result.owner).toBe('org-a\n');
  });
});
