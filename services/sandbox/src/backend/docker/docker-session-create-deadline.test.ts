import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The session's `docker run` within the create's budget. Module mocks run in
// a separate Bun process so they cannot replace the real exports other suites
// use.
async function createWithin(options: {
  /** The create's budget (SANDBOX_SESSION_CREATE_TIMEOUT_MS). */
  budgetMs: number;
  /** What the route spends of it before the backend's create starts. */
  spentMs: number;
  /** How the run ends: a docker CLI that outlasts the budget and is killed,
   * the run's own timeout, the budget's abort, or a failure of its own
   * whose cleanup outlasts the budget. */
  run: 'outlasts' | 'own-timeout' | 'budget-abort' | 'fails';
}): Promise<{
  error: string | null;
  /** The timeout the run was given. */
  runTimeoutMs: number | null;
  /** What was left of the budget when the run started, by the probe's clock. */
  leftMs: number | null;
  elapsedMs: number;
}> {
  const script = `
import { mock } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const source = ${JSON.stringify(resolve(import.meta.dir, '../..'))};
const options = ${JSON.stringify(options)};
const success = {exitCode:0,stdout:'',stderr:'',stdoutTruncated:false,stderrTruncated:false};
const spawnPath = join(source,'spawn-util.ts');
const realSpawn = await import(spawnPath);
// Taken before the mock replaces the module's exports.
const realRunDocker = realSpawn.runDocker;
const {operationSignal,withOperationBudget} = await import(join(source,'operation-budget.ts'));
const root = await mkdtemp(join(tmpdir(),'tale-create-deadline-'));
// A docker CLI that answers long after any budget here.
const slowDocker = join(root,'docker');
await writeFile(slowDocker,'#!/bin/sh\\nexec sleep 30\\n');
await chmod(slowDocker,0o755);
process.env.DOCKER_BIN = slowDocker;
let startedAt = 0;
let runTimeoutMs = null;
let leftMs = null;
console.warn = () => {};
mock.module(spawnPath, () => ({...realSpawn,
  runDocker: async (args, opts = {}) => {
    if (args[0] === 'run') {
      runTimeoutMs = opts.timeoutMs ?? null;
      leftMs = options.budgetMs - (performance.now() - startedAt);
      if (options.run === 'outlasts') return realRunDocker(args, opts);
      if (options.run === 'own-timeout') return {...success,exitCode:124};
      if (options.run === 'fails') return {...success,exitCode:125,stderr:'docker: Error response from daemon: boom.'};
      // The budget's abort kills the CLI, which then has no exit code.
      const signal = operationSignal();
      await new Promise((done) => signal.addEventListener('abort',done,{once:true}));
      return {...success,exitCode:-1};
    }
    if (args[0] === 'inspect') {
      // The failed run's cleanup answers once the budget has ended.
      if (options.run === 'fails' && runTimeoutMs !== null) await Bun.sleep(Math.max(0, options.budgetMs - (performance.now() - startedAt)) + 50);
      // The run left no container for the cleanup to remove.
      return {...success,exitCode:1,stderr:'Error: No such object: tale-sbx-ses-deadline'};
    }
    return {...success,stdout:'{"tale.sandbox-cache":"1"}'};
  },
  dockerRm: async () => success,
}));
const {DockerSessionBackend} = await import(join(source,'backend/docker/docker-session-backend.ts'));
const {TEST_SESSION_CONFIG} = await import(join(source,'session/session-test-config.ts'));
const cfg = {
 backend:'docker',instance:'',sandboxToken:'test',runtimeImage:'runtime:test',runtimeTier:'runc',dockerInContainer:false,dockerBuildCache:false,
 transparentEgress:false,hostSessionRoot:root,cacheVolumePrefix:{pip:'pip',npm:'npm',bun:'bun'},
 egressNetwork:'control',egressProxy:'http://egress:3128',
 session:{...TEST_SESSION_CONFIG,createHealthTimeoutMs:options.budgetMs,agentProfile:{...TEST_SESSION_CONFIG.agentProfile,uid:process.getuid() || 10001,gid:process.getgid() || 10001}},
};
const backend = new DockerSessionBackend(cfg);
let error = null;
startedAt = performance.now();
// As the route runs it: the backend's create gets what the route left.
try {
  await withOperationBudget(options.budgetMs, async () => {
    await Bun.sleep(options.spentMs);
    await backend.createSession({sessionId:'deadline',organizationId:'org-deadline',profile:'agent',env:{},createdAtMs:0,ttlMs:1000,idleTimeoutMs:1000,signal:operationSignal()});
  });
} catch (e) { error = e.message; }
const elapsedMs = performance.now() - startedAt;
await rm(root,{recursive:true,force:true});
console.log(JSON.stringify({error,runTimeoutMs,leftMs,elapsedMs}));
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
  if (exit !== 0) throw new Error(`Create-deadline probe failed: ${stderr}`);
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}');
}

const timedOut = (runTimeoutMs: number | null, budgetMs: number) =>
  `docker run (session) timed out after ${runTimeoutMs} ms, the rest of the create's ${budgetMs} ms budget (SANDBOX_SESSION_CREATE_TIMEOUT_MS)`;

/** The run had what was left of the create's budget when it started. */
function expectRestOfBudget(result: {
  runTimeoutMs: number | null;
  leftMs: number | null;
}): void {
  expect(result.runTimeoutMs).not.toBeNull();
  expect(result.leftMs).not.toBeNull();
  expect(
    Math.abs((result.runTimeoutMs ?? 0) - (result.leftMs ?? 0)),
  ).toBeLessThan(10);
}

describe("the session's docker run within the create's budget", () => {
  test('a docker that outlasts a short budget is killed when it ends, and the create says it timed out', async () => {
    const result = await createWithin({
      budgetMs: 1_500,
      spentMs: 300,
      run: 'outlasts',
    });
    expect(result.error).toBe(timedOut(result.runTimeoutMs, 1_500));
    expectRestOfBudget(result);
    expect(result.leftMs).toBeLessThan(1_250);
    // The create ends with its budget, not with the CLI's 30 s.
    expect(result.elapsedMs).toBeGreaterThan(1_450);
    expect(result.elapsedMs).toBeLessThan(10_000);
  }, 30_000);

  test('a run that times out on its own had the rest of the default budget, far more than 30 s', async () => {
    const result = await createWithin({
      budgetMs: 180_000,
      spentMs: 0,
      run: 'own-timeout',
    });
    expect(result.error).toBe(timedOut(result.runTimeoutMs, 180_000));
    expectRestOfBudget(result);
    expect(result.runTimeoutMs).toBeGreaterThan(170_000);
  }, 30_000);

  test("a run the budget's abort kills says it timed out too", async () => {
    const result = await createWithin({
      budgetMs: 300,
      spentMs: 100,
      run: 'budget-abort',
    });
    expect(result.error).toBe(timedOut(result.runTimeoutMs, 300));
    expectRestOfBudget(result);
  }, 30_000);

  test('a run that fails on its own says how, though its cleanup outlasts the budget', async () => {
    const result = await createWithin({
      budgetMs: 1_000,
      spentMs: 0,
      run: 'fails',
    });
    expect(result.error).toBe(
      'docker run (session) failed: docker: Error response from daemon: boom.',
    );
    expectRestOfBudget(result);
    // The budget did end before the failure was answered.
    expect(result.elapsedMs).toBeGreaterThan(1_000);
  }, 30_000);
});
