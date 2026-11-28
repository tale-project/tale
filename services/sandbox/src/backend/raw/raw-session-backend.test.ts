import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TEST_SESSION_CONFIG } from '../../session/session-test-config.ts';
import type { SpawnerConfig } from '../../types.ts';
import { SessionExistsError, SessionPlacementError } from '../types.ts';
import type { RawConfig, RawSlot } from './raw-config.ts';
import type {
  ProcessEntry,
  RawProcesses,
  RunnerdLaunch,
} from './raw-processes.ts';
import { RawRelayDirectory } from './raw-relays.ts';
import { RawSessionBackend, type RawHostActs } from './raw-session-backend.ts';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

/** What a promise rejected with, or null when it resolved. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

const ORIGINS = [
  ['http://backend-api:3005', 'http://127.0.0.1:41005'],
  ['http://sandbox-llm-gateway:8080', 'http://127.0.0.1:41080'],
] as const;

/** A host whose processes are a table the test owns: a launched runnerd
 * writes its ready file at once and runs until it is signalled. */
class FakeHost implements RawProcesses {
  table: ProcessEntry[] = [];
  launched: RunnerdLaunch[] = [];
  signals: Array<[number, NodeJS.Signals]> = [];
  private nextPid = 5000;
  /** Processes that ignore SIGTERM (a stop must SIGKILL them). */
  stubborn = new Set<number>();

  async list(): Promise<ProcessEntry[]> {
    return this.table.map((entry) => ({ ...entry }));
  }
  async identity(pid: number): Promise<string | null> {
    return this.table.some(
      (entry) => entry.pid === pid && entry.zombie !== true,
    )
      ? `start-${pid}`
      : null;
  }
  signal(pid: number, signal: NodeJS.Signals): boolean {
    this.signals.push([pid, signal]);
    const had = this.table.some((entry) => entry.pid === pid);
    if (signal === 'SIGKILL' || !this.stubborn.has(pid)) {
      this.table = this.table.filter((entry) => entry.pid !== pid);
    }
    return had;
  }
  async launch(launch: RunnerdLaunch): Promise<number> {
    const pid = this.nextPid++;
    this.launched.push(launch);
    const uid = launch.uid ?? process.getuid?.() ?? 1000;
    this.table.push({ pid, ppid: 1, pgid: pid, uid });
    const ready = launch.env.TALE_RUNNERD_READY_FILE;
    if (ready !== undefined) {
      await writeFile(
        ready,
        JSON.stringify({ port: 40000 + (pid % 1000), pid }),
      );
    }
    return pid;
  }
  async run(): Promise<{ code: number; stdout: string; stderr: string }> {
    return { code: 0, stdout: '', stderr: '' };
  }
  /** A process the session's exec left in a group of its own. */
  spawnChild(parent: number, uid: number): number {
    const pid = this.nextPid++;
    this.table.push({ pid, ppid: parent, pgid: pid, uid });
    return pid;
  }
}

class FakeActs implements RawHostActs {
  calls: string[] = [];
  async chownTree(path: string, uid: number, gid: number): Promise<void> {
    this.calls.push(`chownTree ${path} ${uid}:${gid}`);
  }
  async chown(path: string, uid: number, gid: number): Promise<void> {
    this.calls.push(`chown ${path} ${uid}:${gid}`);
  }
  async reclaimSlot(slot: RawSlot): Promise<void> {
    this.calls.push(`reclaim ${slot.user}`);
  }
}

async function setup(
  isolation: 'isolated' | 'shared',
  slotCount = 2,
): Promise<{
  backend: RawSessionBackend;
  host: FakeHost;
  acts: FakeActs;
  root: string;
  relays: RawRelayDirectory;
}> {
  const root = await mkdtemp(join(tmpdir(), 'tale-raw-backend-'));
  dirs.push(root);
  for (const dir of ['sessions', 'control', 'logs', 'bin']) {
    await mkdir(join(root, dir), { recursive: true });
  }
  await writeFile(join(root, 'bin', 'tale-git-credential'), '#!/bin/sh\n');
  await writeFile(join(root, 'claude.json'), '{"hooks":{}}');
  const slots: RawSlot[] =
    isolation === 'isolated'
      ? Array.from({ length: slotCount }, (_, i) => ({
          user: `tale-slot-0${i + 1}`,
          uid: 61001 + i,
          gid: 61001 + i,
          home: join(root, 'slots', `tale-slot-0${i + 1}`),
        }))
      : [];
  const raw: RawConfig = {
    root,
    isolation,
    slots,
    runnerd: ['/usr/local/lib/tale-sandbox/tale', join(root, 'runnerd.mjs')],
    runnerdEnv: { BUN_BE_BUN: '1' },
    bin: join(root, 'bin'),
    path: ['/opt/tale-agents/bin', '/usr/bin', '/bin'],
    claudeSettings: join(root, 'claude.json'),
  };
  const cfg: Pick<SpawnerConfig, 'backend' | 'sandboxToken' | 'session'> = {
    backend: 'raw',
    sandboxToken: 'local-token',
    session: { ...TEST_SESSION_CONFIG, createHealthTimeoutMs: 2_000 },
  };
  const host = new FakeHost();
  const acts = new FakeActs();
  const relays = new RawRelayDirectory();
  relays.publish(ORIGINS);
  const backend = new RawSessionBackend(cfg, raw, {
    processes: host,
    acts,
    relays,
    health: async () => ({
      ok: true,
      bootedAtMs: 0,
      lastActivityAtMs: 0,
      liveExecs: 0,
    }),
    envPatch: async () => [],
  });
  return { backend, host, acts, root, relays };
}

function spec(sessionId: string) {
  return {
    sessionId,
    organizationId: 'org-1',
    profile: 'agent' as const,
    ttlMs: 60_000,
    idleTimeoutMs: 30_000,
    env: {},
    createdAtMs: 1_000,
  };
}

describe('RawSessionBackend create', () => {
  it('lays out the session and starts runnerd with the session view', async () => {
    const { backend, host, root } = await setup('shared');
    const result = await backend.createSession(spec('s1'));
    expect(result.resumed).toBe(false);
    expect(result.incarnation).toMatch(/^raw-/);
    const sessionRoot = join(root, 'sessions', 'ses-s1');
    for (const dir of [
      'workspace',
      'uploads',
      'output',
      '.runtime/home/.claude',
      '.runtime/tmp',
    ]) {
      expect(existsSync(join(sessionRoot, dir))).toBe(true);
    }
    expect(
      await readFile(
        join(sessionRoot, '.runtime/home/.claude/settings.json'),
        'utf8',
      ),
    ).toBe('{"hooks":{}}');
    const launch = host.launched[0];
    expect(launch?.argv).toEqual([
      '/usr/local/lib/tale-sandbox/tale',
      join(root, 'runnerd.mjs'),
    ]);
    expect(launch?.cwd).toBe(join(sessionRoot, 'workspace'));
    expect(launch?.uid).toBeUndefined();
    const env = launch?.env ?? {};
    expect(env.BUN_BE_BUN).toBe('1');
    expect(env.HOME).toBe(join(sessionRoot, '.runtime/home'));
    expect(env.TMPDIR).toBe(join(sessionRoot, '.runtime/tmp'));
    expect(env.TALE_WORKSPACE_ROOT).toBe(sessionRoot);
    expect(env.TALE_RUNNERD_LISTEN).toBe('127.0.0.1:0');
    expect(env.TALE_RUNNERD_TOKEN_FD).toBe('3');
    expect(env.TALE_RUNNERD_TOKEN).toBeUndefined();
    expect(env.PATH?.split(':')).toEqual([
      join(sessionRoot, '.runtime/deps/python/bin'),
      join(sessionRoot, '.runtime/deps/node/bin'),
      join(root, 'bin'),
      '/opt/tale-agents/bin',
      '/usr/bin',
      '/bin',
    ]);
    expect(JSON.parse(env.TALE_SESSION_VIEW ?? '{}')).toEqual({
      root: '/agent',
      real: sessionRoot,
      origins: ORIGINS.map((pair) => [...pair]),
      paths: [
        [
          '/usr/local/bin/tale-git-credential',
          join(root, 'bin', 'tale-git-credential'),
        ],
      ],
    });
    // The token never rides the environment; each incarnation has its own.
    expect(launch?.token).toMatch(/^[0-9a-f]{64}$/);
    expect(backend.runnerdToken('s1')).toBe(launch?.token);
    expect(await backend.resolveEndpoint('s1', 1_000)).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+$/,
    );
  });

  it('refuses a second create while its runnerd runs', async () => {
    const { backend } = await setup('shared');
    await backend.createSession(spec('s1'));
    expect(await rejection(backend.createSession(spec('s1')))).toBeInstanceOf(
      SessionExistsError,
    );
  });

  it('gives each start a token of its own and resumes onto the kept files', async () => {
    const { backend, host } = await setup('shared');
    await backend.createSession(spec('s1'));
    const first = backend.runnerdToken('s1');
    await backend.stopSession('s1');
    expect(backend.runnerdToken('s1')).toBeUndefined();
    const again = await backend.createSession(spec('s1'));
    expect(again.resumed).toBe(true);
    expect(backend.runnerdToken('s1')).not.toBe(first);
    expect(host.launched).toHaveLength(2);
  });

  it('waits for the relays before it starts a session', async () => {
    const { backend } = await setup('shared');
    const fresh = new RawRelayDirectory();
    Reflect.set(backend, 'relays', fresh);
    const create = backend.createSession(spec('s1'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    fresh.publish(ORIGINS);
    expect(await create).toMatchObject({ resumed: false });
  });
});

describe('RawSessionBackend on an isolated device', () => {
  it('runs each session as a slot and hands the files to it', async () => {
    const { backend, host, acts, root } = await setup('isolated');
    await backend.createSession(spec('s1'));
    await backend.createSession(spec('s2'));
    expect(host.launched.map((launch) => launch.uid)).toEqual([61001, 61002]);
    expect(acts.calls).toContain(
      `chownTree ${join(root, 'sessions', 'ses-s1')} 61001:61001`,
    );
    expect(host.launched[0]?.env.USER).toBe('tale-slot-01');
  });

  it('refuses a session when every slot runs one', async () => {
    const { backend } = await setup('isolated', 1);
    await backend.createSession(spec('s1'));
    expect(await rejection(backend.createSession(spec('s2')))).toBeInstanceOf(
      SessionPlacementError,
    );
  });

  it('ends every process of the slot, takes it back and closes the files on stop', async () => {
    const { backend, host, acts, root } = await setup('isolated');
    await backend.createSession(spec('s1'));
    const runnerd = host.launched.length > 0 ? (host.table[0]?.pid ?? 0) : 0;
    const leftover = host.spawnChild(1, 61001);
    host.stubborn.add(leftover);
    // A process of the other slot is not this session's.
    const other = host.spawnChild(1, 61002);
    expect(await backend.stopSession('s1')).toBe(true);
    const left = host.table.map((entry) => entry.pid);
    expect(left).not.toContain(runnerd);
    expect(left).not.toContain(leftover);
    expect(left).toContain(other);
    expect(host.signals).toContainEqual([leftover, 'SIGKILL']);
    expect(acts.calls).toContain('reclaim tale-slot-01');
    expect(acts.calls).toContain(
      `chown ${join(root, 'sessions', 'ses-s1')} 0:0`,
    );
    expect((await stat(join(root, 'sessions', 'ses-s1'))).mode & 0o777).toBe(
      0o700,
    );
    // The slot is free again: a second session takes it.
    await backend.createSession(spec('s2'));
    expect(host.launched[1]?.uid).toBe(61001);
  });

  it('resumes a session on the slot its files belong to', async () => {
    const { backend, host, acts } = await setup('isolated');
    await backend.createSession(spec('s1'));
    await backend.createSession(spec('s2'));
    await backend.stopSession('s1');
    await backend.stopSession('s2');
    acts.calls = [];
    await backend.createSession(spec('s2'));
    expect(host.launched.at(-1)?.uid).toBe(61002);
    // Its files are that slot's already: no recursive chown.
    expect(acts.calls.some((call) => call.startsWith('chownTree'))).toBe(false);
  });

  it('ignores a zombie when it ends a slot', async () => {
    const { backend, host } = await setup('isolated');
    await backend.createSession(spec('s1'));
    host.table.push({
      pid: 9999,
      ppid: 1,
      pgid: 9999,
      uid: 61001,
      zombie: true,
    });
    expect(await backend.stopSession('s1')).toBe(true);
  });
});

describe('RawSessionBackend reading and destroying', () => {
  it('lists running sessions and a dead runnerd as ended', async () => {
    const { backend, host } = await setup('shared');
    await backend.createSession(spec('s1'));
    await backend.createSession(spec('s2'));
    const second = host.launched.length;
    expect(second).toBe(2);
    // s2's runnerd died (a reboot).
    host.table = host.table.slice(0, 1);
    const sessions = await backend.listSessions();
    const rows = sessions
      .map((s) => [s.sessionId, s.state, s.ended === true])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(rows).toEqual([
      ['s1', 'ready', false],
      ['s2', 'degraded', true],
    ]);
    expect(await backend.sessionExists('s1', 1_000)).toBe(true);
    expect(await backend.sessionExists('s1', 2_000)).toBe(false);
    expect(await backend.sessionExists('s2')).toBe(false);
  });

  it('records a pin and reports it with the workspaces', async () => {
    const { backend } = await setup('shared');
    await backend.createSession(spec('s1'));
    await backend.setPinned('s1', true, 1_000);
    expect((await backend.listSessions())[0]?.pinned).toBe(true);
    const workspaces = await backend.listWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({
      sessionId: 's1',
      active: true,
      pinned: true,
      organizationId: 'org-1',
    });
  });

  it('destroys the compute, the record and the workspace', async () => {
    const { backend, host, root } = await setup('shared');
    await backend.createSession(spec('s1'));
    expect(await backend.destroySession('s1')).toBe(true);
    expect(host.table).toHaveLength(0);
    expect(existsSync(join(root, 'sessions', 'ses-s1'))).toBe(false);
    expect(existsSync(join(root, 'control', 's1.json'))).toBe(false);
    expect(await backend.workspaceDeletion('s1', 2_000)).toBe('done');
    expect(await backend.destroySession('s1')).toBe(false);
  });
});
