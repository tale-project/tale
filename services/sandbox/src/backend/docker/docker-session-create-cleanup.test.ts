import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

// Isolate module mocks from the other Docker backend suites. The fake daemon
// fails the create; real filesystem workspaces and owner markers show whether
// its cleanup retains a recoverable resource or silently abandons it.
async function failedCreate(options: {
  resumed?: boolean;
  removalFails?: boolean;
  discardFails?: boolean;
  destroyAfterFailure?: boolean;
}): Promise<{
  error: string | null;
  destroyError: string | null;
  warnings: string[];
  workspace: boolean;
  owner: boolean;
  trashEntries: number;
  discarded: number;
  containerGone: boolean;
  removalTargets: string[];
}> {
  const script = `
import { mock } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const source = ${JSON.stringify(resolve(import.meta.dir, '../..'))};
const options = ${JSON.stringify(options)};
const success = {exitCode:0,stdout:'',stderr:'',stdoutTruncated:false,stderrTruncated:false};
const spawnPath = join(source,'spawn-util.ts');
const realSpawn = await import(spawnPath);
let containerGone = false;
let createAttempt = '';
const containerId = 'a'.repeat(64);
const removalTargets = [];
const warnings = [];
console.warn = (...args) => warnings.push(args.map(String).join(' '));
mock.module(spawnPath, () => ({...realSpawn,
  runDocker: async (args) => {
    if (args[0] === 'run') {
      createAttempt = args.find(value => value.startsWith('tale.create-attempt='))?.split('=')[1] ?? '';
      return {...success,exitCode:1,stderr:'runtime startup failed'};
    }
    if (args[0] === 'inspect') {
      if (containerGone) return {...success,exitCode:1,stderr:'No such container'};
      const format = args[2];
      if (format.includes('tale.create-attempt')) return {...success,stdout:containerId+'\\t0\\t'+createAttempt};
      if (format.includes('tale.docker')) return {...success,stdout:containerId+'\\tfalse\\t'};
      return {...success,stdout:format.includes('Mounts') ? '' : 'true'};
    }
    return {...success,stdout:'{"tale.sandbox-cache":"1"}'};
  },
  dockerRm: async (target) => {
    removalTargets.push(target);
    if (options.removalFails) return {...success,exitCode:1,stderr:'device or resource busy'};
    containerGone = true;
    return success;
  },
}));
const {DockerSessionBackend} = await import(join(source,'backend/docker/docker-session-backend.ts'));
const {WorkspaceTrash} = await import(join(source,'session/workspace-trash.ts'));
const {TEST_SESSION_CONFIG} = await import(join(source,'session/session-test-config.ts'));
const root = await mkdtemp(join(tmpdir(),'tale-create-cleanup-'));
const workspace = join(root,'ses-failed');
const owner = join(root,'.owners','failed.org');
if (options.resumed) {
  await mkdir(workspace);
  await writeFile(join(workspace,'keep.txt'),'preserved work');
}
const gate = Promise.withResolvers();
const trash = new WorkspaceTrash(root, async (path) => {
  await gate.promise;
  await rm(path,{recursive:true,force:true});
});
let discarded = 0;
const discard = trash.discard.bind(trash);
trash.discard = async (path) => {
  discarded += 1;
  if (options.discardFails) throw new Error('EACCES: workspace cannot be discarded');
  return discard(path);
};
const cfg = {
 backend:'docker',instance:'',sandboxToken:'test',runtimeImage:'runtime:test',runtimeTier:'runc',dockerInContainer:false,dockerBuildCache:false,
 transparentEgress:false,hostSessionRoot:root,cacheVolumePrefix:{pip:'pip',npm:'npm',bun:'bun'},
 egressNetwork:'control',egressProxy:'http://egress:3128',
 session:{...TEST_SESSION_CONFIG,agentProfile:{...TEST_SESSION_CONFIG.agentProfile,uid:process.getuid() || 10001,gid:process.getgid() || 10001}},
};
let error = null;
let destroyError = null;
const backend = new DockerSessionBackend(cfg,trash);
try {
  await backend.createSession({sessionId:'failed',organizationId:'org-failed',profile:'agent',env:{},createdAtMs:0,ttlMs:1000,idleTimeoutMs:1000});
} catch (e) { error = e.message; }
if (options.destroyAfterFailure) {
  try { await backend.destroySession('failed'); }
  catch (e) { destroyError = e.message; }
}
const exists = async (path) => stat(path).then(() => true, () => false);
const result = {error,destroyError,warnings,workspace:await exists(workspace),owner:await exists(owner),trashEntries:(await readdir(trash.dir).catch(() => [])).length,discarded,containerGone,removalTargets};
gate.resolve();
await trash.empty();
await rm(root,{recursive:true,force:true});
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
  if (exit !== 0) throw new Error(`Failed-create probe failed: ${stderr}`);
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}');
}

describe('Docker session failed-create cleanup', () => {
  test('a failed container removal preserves its workspace and ownership', async () => {
    const result = await failedCreate({ removalFails: true });
    expect(result.error).toContain('runtime startup failed');
    expect(result.warnings.join('\n')).toContain('device or resource busy');
    expect(result.workspace).toBe(true);
    expect(result.owner).toBe(true);
    expect(result.discarded).toBe(0);
    expect(result.containerGone).toBe(false);
    expect(result.removalTargets).toEqual(['a'.repeat(64)]);
  });

  test('a later failed destroy retains the owner marker for retry', async () => {
    const result = await failedCreate({
      discardFails: true,
      destroyAfterFailure: true,
    });
    expect(result.error).toContain('runtime startup failed');
    expect(result.destroyError).toContain('could not be deleted');
    expect(result.workspace).toBe(true);
    expect(result.owner).toBe(true);
  });

  test('a fresh failed create releases its compute and preserves workspace ownership', async () => {
    const result = await failedCreate({});
    expect(result.error).toContain('runtime startup failed');
    expect(result.workspace).toBe(true);
    expect(result.owner).toBe(true);
    expect(result.discarded).toBe(0);
    expect(result.trashEntries).toBe(0);
    expect(result.containerGone).toBe(true);
    expect(result.removalTargets).toEqual(['a'.repeat(64)]);
  });

  test('a failed resume releases compute and preserves the existing workspace', async () => {
    const result = await failedCreate({ resumed: true });
    expect(result.error).toContain('runtime startup failed');
    expect(result.workspace).toBe(true);
    expect(result.owner).toBe(true);
    expect(result.discarded).toBe(0);
    expect(result.containerGone).toBe(true);
  });

  test('a later explicit destroy discards the failed create workspace and ownership', async () => {
    const result = await failedCreate({ destroyAfterFailure: true });
    expect(result.error).toContain('runtime startup failed');
    expect(result.destroyError).toBeNull();
    expect(result.workspace).toBe(false);
    expect(result.owner).toBe(false);
    expect(result.discarded).toBe(1);
    expect(result.trashEntries).toBe(1);
  });
});
