import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

// Containers that never got going: what the Docker backend removes, and what
// it leaves alone. Module mocks run in a separate Bun process so they cannot
// replace the real exports other suites use.

const CREATE_BUDGET_MS = 180_000;
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const STAMP = NOW - 2 * 60 * 60_000;
const ID = 'c'.repeat(64);

interface Scenario {
  /** What `docker inspect` of the session container answers; null = gone. */
  container: {
    status: string;
    stamp: number;
    dockerCreatedMs: number;
    docker?: 'true' | 'false';
  } | null;
  expectedCreatedAtMs?: number;
  rmFails?: boolean;
  inspectFails?: boolean;
}

interface Outcome {
  result: boolean | null;
  error: string | null;
  removed: string[];
  volumes: string[];
  workspaceKept: boolean;
  pinCleared: boolean;
}

async function reap(scenarios: Scenario[]): Promise<Outcome[]> {
  const sourceRoot = resolve(import.meta.dir, '../..');
  const script = `
import { mock } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const source = ${JSON.stringify(sourceRoot)};
const scenarios = ${JSON.stringify(scenarios)};
const ID = ${JSON.stringify(ID)};
Date.now = () => ${NOW};
const success = {exitCode:0, stdout:'', stderr:'', stdoutTruncated:false, stderrTruncated:false};
let current = null;
let removed = [];
let volumes = [];
const spawnPath = join(source,'spawn-util.ts');
const realSpawn = await import(spawnPath);
mock.module(spawnPath, () => ({...realSpawn,
  runDocker: async (args) => {
    if (args[0] === 'inspect') {
      if (current.inspectFails) return {...success, exitCode:1, stderr:'Cannot connect to the Docker daemon'};
      const c = current.container;
      if (c === null) return {...success, exitCode:1, stderr:'Error: No such object: tale-sbx-ses-stuck'};
      return {...success, stdout:[ID, String(c.stamp), c.status, new Date(c.dockerCreatedMs).toISOString(), c.docker ?? '', ''].join('\\t') + '\\n'};
    }
    if (args[0] === 'volume' && args[1] === 'rm') { volumes.push(args.at(-1)); return success; }
    return success;
  },
  dockerRm: async (target) => {
    removed.push(target);
    return current.rmFails ? {...success, exitCode:1, stderr:'device or resource busy'} : success;
  },
}));
console.warn = () => {};
const {DockerSessionBackend} = await import(join(source,'backend/docker/docker-session-backend.ts'));
const {TEST_SESSION_CONFIG} = await import(join(source,'session/session-test-config.ts'));
const outcomes = [];
for (const scenario of scenarios) {
  const root = await mkdtemp(join(tmpdir(),'tale-stale-'));
  await mkdir(join(root,'ses-stuck'));
  await writeFile(join(root,'ses-stuck','work.txt'),'kept');
  await mkdir(join(root,'.pins'));
  await writeFile(join(root,'.pins','stuck.pinned'),'1');
  const cfg = {backend:'docker', sandboxToken:'test', runtimeImage:'runtime:test', runtimeTier:'runc',
    dockerInContainer:false, dockerBuildCache:false, transparentEgress:false, hostSessionRoot:root,
    cacheVolumePrefix:{pip:'pip',npm:'npm',bun:'bun'}, egressNetwork:'control', egressProxy:'http://egress:3128',
    session:{...TEST_SESSION_CONFIG, createHealthTimeoutMs:${CREATE_BUDGET_MS}}};
  const backend = new DockerSessionBackend(cfg);
  current = scenario; removed = []; volumes = [];
  let result = null, error = null;
  try { result = await backend.reapStaleSession('stuck', scenario.expectedCreatedAtMs ?? ${STAMP}); }
  catch (e) { error = e.message; }
  const exists = async (p) => stat(p).then(() => true, () => false);
  outcomes.push({result, error, removed, volumes,
    workspaceKept: await exists(join(root,'ses-stuck','work.txt')),
    pinCleared: !(await exists(join(root,'.pins','stuck.pinned')))});
  await rm(root,{recursive:true,force:true});
}
console.log(JSON.stringify(outcomes));
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
  if (exit !== 0) throw new Error(`Stale reap probe failed: ${stderr}`);
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '[]');
}

const abandoned = (status: string, docker?: 'true' | 'false') => ({
  container: { status, stamp: STAMP, dockerCreatedMs: STAMP, docker },
});

describe('Docker containers stuck before they ever ran', () => {
  test('created, paused and restarting containers past the create budget are removed by id, the workspace kept', async () => {
    const outcomes = await reap([
      abandoned('created'),
      abandoned('paused'),
      abandoned('restarting', 'true'),
    ]);
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({
        result: true,
        error: null,
        removed: [ID],
        workspaceKept: true,
        pinCleared: true,
      });
    }
    // Only the session that ran Docker inside had an inner image store.
    expect(outcomes.map((o) => o.volumes)).toEqual([
      [],
      [],
      ['tale-dind-stuck'],
    ]);
  });

  test('a fresh incarnation is never reaped, whatever the state', async () => {
    const outcomes = await reap([
      // Created within the budget and its slack: a create may still be at it.
      {
        container: {
          status: 'created',
          stamp: NOW - CREATE_BUDGET_MS,
          dockerCreatedMs: NOW - CREATE_BUDGET_MS,
        },
        expectedCreatedAtMs: NOW - CREATE_BUDGET_MS,
      },
      // An old stamp on a container Docker created just now.
      {
        container: { status: 'created', stamp: STAMP, dockerCreatedMs: NOW },
      },
      // The id now names another incarnation than the one listed.
      {
        container: {
          status: 'created',
          stamp: STAMP + 1,
          dockerCreatedMs: STAMP,
        },
      },
    ]);
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({
        result: false,
        error: null,
        removed: [],
        volumes: [],
        workspaceKept: true,
        pinCleared: false,
      });
    }
  });

  test('a running, ended or unknown container is not this path’s to remove', async () => {
    const outcomes = await reap([
      abandoned('running'),
      abandoned('exited'),
      abandoned('removing'),
      { container: { status: 'created', stamp: 0, dockerCreatedMs: STAMP } },
    ]);
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ result: false, removed: [] });
    }
  });

  test('a container already gone counts as removed; an unreadable or failed removal throws', async () => {
    const [gone, unreadable, refused] = await reap([
      { container: null },
      { ...abandoned('created'), inspectFails: true },
      { ...abandoned('created'), rmFails: true },
    ]);
    expect(gone).toMatchObject({ result: true, removed: [] });
    expect(unreadable?.error).toContain('cannot identify session stuck');
    expect(unreadable?.removed).toEqual([]);
    expect(refused?.error).toContain('docker rm tale-sbx-ses-stuck failed');
    expect(refused?.pinCleared).toBe(false);
  });
});
