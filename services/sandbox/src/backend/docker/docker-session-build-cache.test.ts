import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

// Module mocks run in a separate Bun process so they cannot replace the real
// provisioning or firewall exports used by the other sandbox suites.
async function create(scenario: string): Promise<{
  events: string[];
  error: string | null;
  retained: string;
  owner: string | null;
  peerAlive: boolean;
  removalTargets: string[];
  removedVolumesAfterRun: string[];
  attemptId: string | null;
  workspaceExists: boolean;
}> {
  const sourceRoot = resolve(import.meta.dir, '../..');
  const script = `
import { mock } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const source = ${JSON.stringify(sourceRoot)};
const scenario = ${JSON.stringify(scenario)};
const {dockerDeadlineSignal} = await import(join(source,'docker-deadline.ts'));
const events = [];
let leases = 0;
let attemptId = null;
let currentAttempt = 'own';
let currentId = 'a'.repeat(64);
let containerPresent = true;
let peerAlive = false;
let ran = false;
const removalTargets = [];
const removedVolumesAfterRun = [];
const installPeer = async (empty = false) => {
  currentAttempt = 'peer-attempt';
  currentId = 'b'.repeat(64);
  containerPresent = true;
  peerAlive = true;
  if (!empty) await writeFile(join(workspace,'sentinel'),'peer workspace');
};
const success = {exitCode:0, stdout:'', stderr:'', stdoutTruncated:false, stderrTruncated:false};
const spawnPath = join(source,'spawn-util.ts');
const realSpawn = await import(spawnPath);
mock.module(spawnPath, () => ({...realSpawn,
  runDocker: async (args) => {
    if (scenario.startsWith('volume-failure')) {
      if (args[0] === 'volume' && args[1] === 'create') {
        if (scenario === 'volume-failure-peer-empty-fresh') await installPeer(true);
        return {...success,exitCode:1,stderr:'volume unavailable'};
      }
      if (args[0] === 'inspect') return {...success,exitCode:1,stderr:'Error: No such object'};
    }
    if (args[0] === 'volume' && args[1] === 'rm' && ran) removedVolumesAfterRun.push(args.at(-1));
    if (args[0] === 'run') {
      events.push('run');
      ran = true;
      attemptId = args.find(value=>value.startsWith('tale.create-attempt='))?.split('=')[1] ?? null;
      if (scenario === 'orphan-replaced-fresh') return {...success,exitCode:1,stderr:'name already in use'};
      currentAttempt = attemptId ?? 'own';
      if (scenario === 'own-data-fresh') await writeFile(join(workspace,'sentinel'),'new workspace data');
      if (scenario === 'peer-after-run-fresh') {
        await Bun.sleep(70);
        await installPeer();
        return {...success,exitCode:124,stderr:'Docker operation deadline exceeded'};
      }
      if (scenario === 'startup-failure') return {...success,exitCode:1,stderr:'image unavailable'};
    }
    if (args[0] === 'inspect') {
      // A response may describe absence just before a peer mounts the empty path.
      if (scenario === 'peer-after-absence-fresh' && peerAlive) return {...success,exitCode:1,stderr:'Error: No such object'};
      if (!containerPresent) return {...success,exitCode:1,stderr:'Error: No such object'};
      const format = args[2];
      if (format.includes('State.Status')) {
        const value = format.includes('.Id') ? currentId+'\\texited' : 'exited';
        if (scenario === 'orphan-replaced-fresh' && !peerAlive) await installPeer();
        return {...success,stdout:value};
      }
      if (format.includes('tale.create-attempt')) {
        const value = currentId+'\\t0\\t'+currentAttempt;
        if (scenario === 'peer-before-rm-fresh' && !peerAlive) await installPeer();
        return {...success,stdout:value};
      }
      const value = format.includes('tale.created') ? currentId+'\\t0' : currentId;
      if (ran && scenario === 'peer-before-rm-fresh' && !peerAlive) await installPeer();
      return {...success,stdout:value};
    }
    return success;
  },
  dockerRm: async (target) => {
    events.push('cleanup'); removalTargets.push(target);
    if(target===currentId || target==='tale-sbx-ses-test-session') {containerPresent=false;peerAlive=false;}
    if (scenario === 'peer-after-absence-fresh') await installPeer(true);
    return success;
  },
}));
const buildPath = join(source,'buildkitd.ts');
const realBuild = await import(buildPath);
mock.module(buildPath, () => ({...realBuild,
  retainBuildkitd: () => {events.push('retain'); leases++; return () => {leases--;events.push('release');};},
  ensureBuildkitd: async (_,org) => {events.push('ensure:'+leases);
    if(scenario==='cache-deadline') {
      const signal = dockerDeadlineSignal();
      await new Promise((resolve,reject) => {
        const timer=setTimeout(resolve,1000);
        signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});
      });
      events.push('late-cache');
    }
    if(scenario==='create-deadline') await Bun.sleep(70);
 if(scenario==='cache-failure') throw new Error('cache unavailable'); return realBuild.buildkitdEndpoint(org);},
  sweepIdleBuildkitd: async () => {events.push('sweep'); return {stopped:0,organizations:0};},
}));
mock.module(join(source,'session/buildkit-network-guard.ts'), () => ({
  readBuildkitNetworkPlan: async () => ({id:'e'.repeat(64),subnets:['172.19.0.0/23']}),
  attachBuildkitNetwork: async () => {events.push('attach:'+leases); if(scenario==='peer-after-guard-fresh') await installPeer(); if(['guard-failure','peer-after-guard-fresh','peer-before-rm-fresh','peer-after-absence-fresh','own-data-fresh','own-empty-fresh'].includes(scenario)) throw new Error('guard unavailable');},
}));
mock.module(join(source,'session/runnerd-client.ts'), () => ({
  runnerdHealth: async (_,signal) => {signal?.throwIfAborted();events.push('ready'); return {};},
  runnerdEnvPatch: async () => {events.push('env'); return [];},
}));
const {DockerSessionBackend} = await import(join(source,'backend/docker/docker-session-backend.ts'));
const {TEST_SESSION_CONFIG} = await import(join(source,'session/session-test-config.ts'));
const {sessionWorkspaceDirName} = await import(join(source,'session/session-naming.ts'));
const root = await mkdtemp(join(tmpdir(),'tale-create-order-'));
const workspace = join(root,sessionWorkspaceDirName('test-session'));
if(!scenario.endsWith('-fresh')) {
await mkdir(workspace);
await writeFile(join(workspace,'sentinel'),'saved workspace');
}
const cfg = {
 backend:'docker', sandboxToken:'test',runtimeImage:'runtime:test',runtimeTier:'kata',dockerInContainer:true,dockerBuildCache:true,
 buildkitdProvisionTimeoutMs:scenario==='cache-deadline'?20:1000,
 transparentEgress:false,hostSessionRoot:root,cacheVolumePrefix:{pip:'pip',npm:'npm',bun:'bun'},
 egressNetwork:'control',egressProxy:'http://egress:3128',
 session:{...TEST_SESSION_CONFIG,createHealthTimeoutMs:['create-deadline','peer-after-run-fresh'].includes(scenario)?40:1000,agentProfile:{...TEST_SESSION_CONFIG.agentProfile,uid:process.getuid() || 10001,gid:process.getgid() || 10001}},
};
let error = null;
try {
  await new DockerSessionBackend(cfg).createSession({sessionId:'test-session',organizationId:'org-a',profile:'agent',env:{TEST_VALUE:'set'},createdAtMs:0,ttlMs:1000,idleTimeoutMs:1000});
} catch (e) { error=e.message; }
const retained = await readFile(join(workspace,'sentinel'),'utf8').catch(()=> 'absent');
const owner = await readFile(join(root,'.owners','test-session.org'),'utf8').catch(() => null);
const workspaceExists = await stat(workspace).then(()=>true,()=>false);
await rm(root,{recursive:true,force:true});
console.log(JSON.stringify({events,error,retained,owner,peerAlive,removalTargets,removedVolumesAfterRun,attemptId,workspaceExists}));
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

test('optional cache timeout falls back without a late provisioning continuation', async () => {
  const result = await create('cache-deadline');
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

test('cache setup consumes the create budget; expired creates clean up and retain workspace', async () => {
  const result = await create('create-deadline');
  expect(result.error).toContain('deadline');
  expect(result.events).not.toContain('env');
  expect(result.events).toContain('cleanup');
  expect(result.retained).toBe('saved workspace');
});

test.each(['volume-failure', 'volume-failure-fresh'])(
  'pre-run setup failure preserves saved files and empty new workspaces: %s',
  async (scenario) => {
    const result = await create(scenario);
    expect(result.error).toContain('volume unavailable');
    expect(result.events).not.toContain('run');
    expect(result.workspaceExists).toBe(true);
    expect(result.retained).toBe(
      scenario === 'volume-failure' ? 'saved workspace' : 'absent',
    );
  },
);

describe('failed creates preserve a concurrent winner', () => {
  test.each(['volume-failure-peer-empty-fresh', 'peer-after-absence-fresh'])(
    'stale container absence never deletes an empty workspace mounted by a peer: %s',
    async (scenario) => {
      const result = await create(scenario);
      expect(result.error).not.toBeNull();
      expect(result.peerAlive).toBe(true);
      expect(result.workspaceExists).toBe(true);
      expect(result.retained).toBe('absent');
      expect(result.owner).toBe('org-a\n');
    },
  );

  test.each(['own-data-fresh', 'own-empty-fresh'])(
    'own attempt cleanup preserves its fresh workspace for retry: %s',
    async (scenario) => {
      const result = await create(scenario);
      expect(result.error).toBe('guard unavailable');
      expect(result.removalTargets).toEqual(['a'.repeat(64)]);
      expect(result.removedVolumesAfterRun).toEqual([]);
      expect(result.workspaceExists).toBe(true);
      expect(result.retained).toBe(
        scenario === 'own-data-fresh' ? 'new workspace data' : 'absent',
      );
      expect(result.owner).toBe('org-a\n');
    },
  );

  test.each(['peer-after-run-fresh', 'peer-after-guard-fresh'])(
    '%s never removes the peer container, its volume or freshly written workspace',
    async (scenario) => {
      const result = await create(scenario);
      expect(result.error).not.toBeNull();
      expect(result.peerAlive).toBe(true);
      expect(result.retained).toBe('peer workspace');
      expect(result.removalTargets).toEqual([]);
      expect(result.removedVolumesAfterRun).toEqual([]);
      expect(result.attemptId).toMatch(/^[a-f0-9-]{36}$/);
    },
  );

  test('a peer replacing this attempt after inspection survives removal by immutable id', async () => {
    const result = await create('peer-before-rm-fresh');
    expect(result.error).toBe('guard unavailable');
    expect(result.peerAlive).toBe(true);
    expect(result.retained).toBe('peer workspace');
    expect(result.removalTargets).toEqual(['a'.repeat(64)]);
    expect(result.removedVolumesAfterRun).toEqual([]);
  });

  test('terminal conflict reconciliation removes only the observed orphan id', async () => {
    const result = await create('orphan-replaced-fresh');
    expect(result.error).toContain('name already in use');
    expect(result.peerAlive).toBe(true);
    expect(result.retained).toBe('peer workspace');
    expect(result.removalTargets).toEqual(['a'.repeat(64)]);
  });
});
