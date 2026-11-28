// Sessions as plain processes on the device itself (SANDBOX_BACKEND=raw): no
// container, no virtual machine. A session is a directory and one runnerd
// process; see docs/raw.md for the contract.
//
// Layout under the device's root (RawConfig.root):
//
//   sessions/ses-<id>/   the session's `/agent` (workspace, uploads, output,
//                        .runtime/home, .runtime/tmp, …) — 0700, its slot's
//                        while it runs, root's (and so no slot's) while not
//   sessions/.trash/     destroyed sessions, emptied in the background
//   control/<id>.json    the record: who, since when, pinned, which slot, and
//                        the running runnerd (pid, start, port, token) — the
//                        spawner's alone (0600)
//   logs/<id>.log        runnerd's own output
//
// An isolated device runs each session as one of its slot accounts and ends a
// session by ending every process of that account, then takes back what the
// account left outside the session (its temporary files, its home, its
// crontab), so the next session on the slot starts clean. A shared device runs
// every session as its own account and ends what descends from runnerd.

import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import {
  chmod,
  chown,
  copyFile,
  lchown,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import {
  operationRemainingMs,
  operationSignal,
} from '../../operation-budget.ts';
import {
  runnerdEnvPatch,
  runnerdHealth,
} from '../../session/runnerd-client.ts';
import {
  RUNNERD_INCARNATION_ENV,
  RUNNERD_LISTEN_ENV,
  RUNNERD_READY_FILE_ENV,
} from '../../session/runnerd-protocol.ts';
import {
  isSessionWorkspaceDirName,
  sessionWorkspaceDirName,
} from '../../session/session-naming.ts';
import {
  workspaceTrash,
  type WorkspaceTrash,
} from '../../session/workspace-trash.ts';
import {
  largestWorkspaces,
  measureWorkspaces,
  type LargestWorkspaces,
} from '../../session/workspace-usage.ts';
import type { SpawnerConfig } from '../../types.ts';
import type { SandboxSessionProfile } from '../../wire.ts';
import {
  SessionExistsError,
  SessionIncarnationChangedError,
  SessionPlacementError,
  type BackendSession,
  type BackendWorkspace,
  type CreateSessionResult,
  type OrganizationTeardownResult,
  type SessionBackend,
  type SessionSpec,
  type StopSessionOptions,
  type WorkspaceDeletion,
} from '../types.ts';
import type { RawConfig, RawSlot } from './raw-config.ts';
import {
  descendantsOf,
  endProcesses,
  hostProcesses,
  type ProcessEntry,
  type RawProcesses,
} from './raw-processes.ts';
import { rawRelays, type RawRelayDirectory } from './raw-relays.ts';

/** The contract's root, which runnerd maps onto the session's directory. */
const CONTRACT_ROOT = '/agent';

/** What every session directory holds before runnerd starts — the image's
 * entrypoint makes the same (services/sandbox-runtime/entrypoint.sh). */
const SESSION_DIRS = [
  'workspace',
  'uploads',
  'output',
  '.runtime/home',
  '.runtime/home/.codex',
  '.runtime/home/.claude',
  '.runtime/home/.cache/node-compile-cache',
  '.runtime/tmp',
  '.runtime/deps/python',
  '.runtime/deps/node',
  '.runtime/tale',
] as const;

/** How long a create waits for the device's relays to listen. */
const RELAYS_WAIT_MS = 30_000;
/** The ready file runnerd writes, under the session's directory. */
const READY_FILE = '.runtime/runnerd-ready.json';

interface RunnerdRecord {
  pid: number;
  /** The process's start time, which a reused pid does not share. */
  start: string;
  port: number;
  /** This incarnation's runnerd token: a new one each start, so one a
   * session ever learned opens no later runnerd. */
  token: string;
  incarnation: string;
}

interface SessionRecord {
  v: 1;
  sessionId: string;
  organizationId: string;
  profile: SandboxSessionProfile;
  createdAtMs: number;
  ttlMs: number;
  idleTimeoutMs: number;
  pinned: boolean;
  /** The slot account the session runs as now (isolated, running). */
  slot: string | null;
  /** The account the session's files belong to (isolated): the last slot
   * it ran as. */
  owner: { uid: number; gid: number } | null;
  runnerd: RunnerdRecord | null;
  touchedAtMs: number;
}

function isMissing(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (value === null || typeof value !== 'object') return false;
  const r = Object.fromEntries(Object.entries(value));
  return (
    r.v === 1 &&
    typeof r.sessionId === 'string' &&
    typeof r.organizationId === 'string' &&
    typeof r.profile === 'string' &&
    typeof r.createdAtMs === 'number' &&
    typeof r.ttlMs === 'number' &&
    typeof r.idleTimeoutMs === 'number' &&
    typeof r.pinned === 'boolean'
  );
}

/** Host acts that change ownership and take back what a slot left. */
export interface RawHostActs {
  /** `chown -R -h uid:gid path`: never follows a link the session planted. */
  chownTree(path: string, uid: number, gid: number): Promise<void>;
  /** Give one entry (no link followed) to `uid:gid`. */
  chown(path: string, uid: number, gid: number): Promise<void>;
  /** Take back what `slot` left outside its sessions: its temporary files,
   * its home, its crontab, (macOS) its launchd domain. */
  reclaimSlot(slot: RawSlot): Promise<void>;
}

function hostActs(processes: RawProcesses = hostProcesses): RawHostActs {
  const must = async (argv: string[], what: string) => {
    const result = await processes.run(argv, { timeoutMs: 120_000 });
    if (result.code !== 0) {
      throw new Error(
        `${what} failed (${result.code}): ${result.stderr.trim()}`,
      );
    }
  };
  // A step a host may lack the program for (a minimal Linux has no crontab):
  // what is not there has nothing of the slot's to take back.
  const tolerate = async (argv: string[], what: string) => {
    let result: { code: number; stderr: string };
    try {
      result = await processes.run(argv, { timeoutMs: 60_000 });
    } catch (err) {
      if (err instanceof Error && /not found|ENOENT/i.test(err.message)) return;
      throw err;
    }
    if (result.code !== 0 && result.stderr.trim() !== '') {
      console.warn(
        `[sandbox.raw] ${what} answered ${result.code}: ${result.stderr.trim()}`,
      );
    }
  };
  return {
    async chownTree(path, uid, gid) {
      await must(
        ['chown', '-R', '-h', `${uid}:${gid}`, path],
        `chown of ${path}`,
      );
    },
    async chown(path, uid, gid) {
      await lchown(path, uid, gid);
    },
    async reclaimSlot(slot) {
      const temp =
        process.platform === 'darwin'
          ? ['/private/tmp', '/private/var/tmp', '/private/var/folders']
          : ['/tmp', '/var/tmp', '/dev/shm'];
      for (const dir of temp) {
        // Depth first, on this filesystem only, the slot's own entries alone.
        await tolerate(
          [
            'find',
            dir,
            '-xdev',
            '-depth',
            '-mindepth',
            '1',
            '-user',
            String(slot.uid),
            '-delete',
          ],
          `clearing ${slot.user}'s files in ${dir}`,
        );
      }
      await tolerate(
        ['crontab', '-r', '-u', slot.user],
        `clearing ${slot.user}'s crontab`,
      );
      if (process.platform === 'darwin') {
        await tolerate(
          ['launchctl', 'bootout', `user/${slot.uid}`],
          `ending ${slot.user}'s launchd domain`,
        );
      }
      // The home the system records for the slot: emptied and handed back.
      await rm(slot.home, { recursive: true, force: true });
      await mkdir(slot.home, { recursive: true, mode: 0o700 });
      await chown(slot.home, slot.uid, slot.gid);
      await chmod(slot.home, 0o700);
    },
  };
}

export interface RawSessionBackendDeps {
  processes?: RawProcesses;
  acts?: RawHostActs;
  relays?: RawRelayDirectory;
  /** runnerd's health, asked until it answers (session/runnerd-client.ts). */
  health?: typeof runnerdHealth;
  envPatch?: typeof runnerdEnvPatch;
  trash?: WorkspaceTrash;
  /** Whether the spawner runs as root (an isolated device must). */
  isRoot?: () => boolean;
  now?: () => number;
}

export class RawSessionBackend implements SessionBackend {
  readonly kind = 'raw' as const;
  private readonly processes: RawProcesses;
  private readonly acts: RawHostActs;
  private readonly relays: RawRelayDirectory;
  private readonly health: typeof runnerdHealth;
  private readonly envPatch: typeof runnerdEnvPatch;
  private readonly trashOverride: WorkspaceTrash | null;
  private readonly now: () => number;
  /** Lifecycle changes of one session run one after another. */
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Slots taken now, by slot user → session id. */
  private readonly taken = new Map<string, string>();
  /** The running runnerds' tokens, by session id: kept current by create,
   * adoption (listSessions) and endpoint resolution, read synchronously by
   * the session routes. */
  private readonly tokens = new Map<string, string>();
  private slotsLoaded = false;

  constructor(
    private readonly cfg: Pick<SpawnerConfig, 'session'>,
    private readonly raw: RawConfig,
    deps: RawSessionBackendDeps = {},
  ) {
    this.processes = deps.processes ?? hostProcesses;
    this.acts = deps.acts ?? hostActs(this.processes);
    this.relays = deps.relays ?? rawRelays;
    this.health = deps.health ?? runnerdHealth;
    this.envPatch = deps.envPatch ?? runnerdEnvPatch;
    this.trashOverride = deps.trash ?? null;
    this.now = deps.now ?? Date.now;
  }

  // ── Paths ─────────────────────────────────────────────────────────────

  private canonicalRoot: string | null = null;

  /** The device's root as the kernel names it: macOS's `/tmp` and `/var`
   * are links into `/private`, and runnerd holds every path to the realpath
   * of its root, so a session's root must already be one. Resolved once
   * (RawHostBackend.init made the directory). */
  private root(): string {
    if (this.canonicalRoot !== null) return this.canonicalRoot;
    try {
      this.canonicalRoot = realpathSync(this.raw.root);
    } catch (err) {
      if (!isMissing(err)) throw err;
      return this.raw.root;
    }
    return this.canonicalRoot;
  }

  private sessionsDir(): string {
    return join(this.root(), 'sessions');
  }

  /** The session's `/agent` on this device. */
  sessionRoot(sessionId: string): string {
    return join(this.sessionsDir(), sessionWorkspaceDirName(sessionId));
  }

  private recordPath(sessionId: string): string {
    return join(this.root(), 'control', `${sessionId}.json`);
  }

  private logPath(sessionId: string): string {
    return join(this.root(), 'logs', `${sessionId}.log`);
  }

  /** The trash under the canonical sessions directory (resolved on first
   * use, after the host backend made the root). */
  private get trash(): WorkspaceTrash {
    return this.trashOverride ?? workspaceTrash(this.sessionsDir());
  }

  // ── Records ───────────────────────────────────────────────────────────

  private async readRecord(sessionId: string): Promise<SessionRecord | null> {
    let text: string;
    try {
      text = await readFile(this.recordPath(sessionId), 'utf8');
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      console.warn(
        `[sandbox.raw] the record of ${sessionId} is not JSON; reading it as absent`,
      );
      return null;
    }
    return isSessionRecord(value) && value.sessionId === sessionId
      ? value
      : null;
  }

  private async writeRecord(record: SessionRecord): Promise<void> {
    const path = this.recordPath(record.sessionId);
    const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  }

  private async removeRecord(sessionId: string): Promise<void> {
    await rm(this.recordPath(sessionId), { force: true });
  }

  private async allRecords(): Promise<SessionRecord[]> {
    let names: string[];
    try {
      names = await readdir(join(this.root(), 'control'));
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
    const out: SessionRecord[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const record = await this.readRecord(name.slice(0, -'.json'.length));
      if (record !== null) out.push(record);
    }
    return out;
  }

  // ── Locks and slots ───────────────────────────────────────────────────

  private async locked<T>(
    sessionId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const before = this.locks.get(sessionId) ?? Promise.resolve();
    const run = before.then(work, work);
    const tail = run.catch(() => undefined);
    this.locks.set(sessionId, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(sessionId) === tail) this.locks.delete(sessionId);
    }
  }

  /** The slots running sessions hold, read once from the records. */
  private async loadSlots(): Promise<void> {
    if (this.slotsLoaded) return;
    for (const record of await this.allRecords()) {
      if (record.slot !== null && record.runnerd !== null) {
        this.taken.set(record.slot, record.sessionId);
      }
    }
    this.slotsLoaded = true;
  }

  /** A free slot, the one the session's files belong to first. */
  private async takeSlot(
    sessionId: string,
    owner: SessionRecord['owner'],
  ): Promise<RawSlot> {
    await this.loadSlots();
    const free = this.raw.slots.filter((slot) => !this.taken.has(slot.user));
    const slot =
      free.find((s) => owner !== null && s.uid === owner.uid) ?? free[0];
    if (slot === undefined) {
      throw new SessionPlacementError(
        'full',
        `every slot account of this device runs a session (${this.raw.slots.length})`,
      );
    }
    this.taken.set(slot.user, sessionId);
    return slot;
  }

  private releaseSlot(user: string | null, sessionId: string): void {
    if (user !== null && this.taken.get(user) === sessionId)
      this.taken.delete(user);
  }

  private slotNamed(user: string | null): RawSlot | null {
    return this.raw.slots.find((slot) => slot.user === user) ?? null;
  }

  // ── Liveness ──────────────────────────────────────────────────────────

  private async runnerdAlive(runnerd: RunnerdRecord | null): Promise<boolean> {
    if (runnerd === null) return false;
    return (await this.processes.identity(runnerd.pid)) === runnerd.start;
  }

  // ── Create ────────────────────────────────────────────────────────────

  async createSession(spec: SessionSpec): Promise<CreateSessionResult> {
    return await this.locked(spec.sessionId, () => this.create(spec));
  }

  private async create(spec: SessionSpec): Promise<CreateSessionResult> {
    const signal = operationSignal(spec.signal);
    const existing = await this.readRecord(spec.sessionId);
    if (existing !== null && (await this.runnerdAlive(existing.runnerd))) {
      throw new SessionExistsError(
        spec.sessionId,
        `runnerd ${existing.runnerd?.pid} runs for it`,
      );
    }
    const root = this.sessionRoot(spec.sessionId);
    const resumed = await exists(root);
    const origins = await this.relays.ready(
      Math.min(RELAYS_WAIT_MS, operationRemainingMs() ?? RELAYS_WAIT_MS),
      signal,
    );

    const isolated = this.raw.isolation === 'isolated';
    const slot = isolated
      ? await this.takeSlot(spec.sessionId, existing?.owner ?? null)
      : null;
    const token = randomBytes(32).toString('hex');
    const incarnation = `raw-${this.now().toString(36)}-${randomBytes(6).toString('hex')}`;
    let pid: number | null = null;
    try {
      await this.prepareDirectory(spec.sessionId, root, slot, existing);
      const record: SessionRecord = {
        v: 1,
        sessionId: spec.sessionId,
        organizationId: spec.organizationId,
        profile: spec.profile,
        createdAtMs: spec.createdAtMs,
        ttlMs: spec.ttlMs,
        idleTimeoutMs: spec.idleTimeoutMs,
        // A new create always starts unpinned (types.ts, setPinned).
        pinned: false,
        slot: slot?.user ?? null,
        owner: slot === null ? null : { uid: slot.uid, gid: slot.gid },
        runnerd: null,
        touchedAtMs: this.now(),
      };
      // Written before runnerd starts: a spawner that dies mid-create still
      // finds the slot taken and the session's processes to end.
      await this.writeRecord(record);
      await rm(join(root, READY_FILE), { force: true });
      const helpers = await this.helperPaths();
      pid = await this.processes.launch({
        argv: this.raw.runnerd,
        env: this.runnerdEnv(
          spec.sessionId,
          root,
          slot,
          origins,
          incarnation,
          helpers,
        ),
        cwd: join(root, 'workspace'),
        logPath: this.logPath(spec.sessionId),
        token,
        ...(slot === null ? {} : { uid: slot.uid, gid: slot.gid }),
      });
      const start = await this.processes.identity(pid);
      if (start === null) {
        throw new Error(
          `runnerd ${pid} ended as soon as it started (${this.logPath(spec.sessionId)})`,
        );
      }
      const port = await this.waitForReady(
        spec.sessionId,
        root,
        pid,
        start,
        token,
        signal,
      );
      record.runnerd = { pid, start, port, token, incarnation };
      record.touchedAtMs = this.now();
      await this.writeRecord(record);
      this.tokens.set(spec.sessionId, token);
      // The seed environment goes over runnerd's API, never on its command
      // line or in its environment, where every process of the slot could
      // read it (the Docker backend does the same).
      if (Object.keys(spec.env).length > 0) {
        const denied = await this.envPatch(
          { baseUrl: `http://127.0.0.1:${port}`, token },
          { set: spec.env },
          signal,
        );
        if (denied.length > 0) {
          console.warn(
            `[sandbox.raw] runnerd refused seed env keys for ${spec.sessionId}: ${denied.join(', ')}`,
          );
        }
      }
      signal?.throwIfAborted();
      return { resumed, incarnation };
    } catch (err) {
      await this.cleanupFailedCreate(spec.sessionId, pid, slot);
      throw err;
    }
  }

  /** Make the session's directory, give it to its slot, and lay out what a
   * session starts with. */
  private async prepareDirectory(
    sessionId: string,
    root: string,
    slot: RawSlot | null,
    existing: SessionRecord | null,
  ): Promise<void> {
    await mkdir(root, { recursive: true, mode: 0o700 });
    for (const dir of SESSION_DIRS) {
      await mkdir(join(root, dir), { recursive: true, mode: 0o700 });
    }
    // A container's temporary files died with it: what an earlier
    // incarnation left in the session's temp goes now.
    await rm(join(root, '.runtime/tmp'), { recursive: true, force: true });
    await rm(join(root, '.runtime/tale/steer'), {
      recursive: true,
      force: true,
    });
    await mkdir(join(root, '.runtime/tmp'), { recursive: true, mode: 0o700 });
    if (this.raw.claudeSettings !== null) {
      // The image's managed settings (the plan gate, the steer and vision
      // hooks) as the session's own user settings: CLAUDE_CONFIG_DIR is the
      // session's, so they bind no one else on the device. Laid out again on
      // every start, so a turn that edited them gets the device's back.
      await copyFile(
        this.raw.claudeSettings,
        join(root, '.runtime/home/.claude/settings.json'),
      );
    }
    if (slot === null) return;
    const owner = existing?.owner;
    const fresh = owner === null || owner === undefined;
    if (fresh || owner.uid !== slot.uid || owner.gid !== slot.gid) {
      await this.acts.chownTree(root, slot.uid, slot.gid);
    } else {
      // Its files are the slot's already; what the spawner just laid out is
      // not (it runs as root).
      for (const dir of [
        ...SESSION_DIRS,
        '.runtime/home/.claude/settings.json',
      ]) {
        await this.acts
          .chown(join(root, dir), slot.uid, slot.gid)
          .catch((err: unknown) => {
            if (!isMissing(err)) throw err;
          });
      }
      await this.acts.chown(root, slot.uid, slot.gid);
    }
    await chmod(root, 0o700);
  }

  private runnerdEnv(
    sessionId: string,
    root: string,
    slot: RawSlot | null,
    origins: ReadonlyArray<readonly [string, string]>,
    incarnation: string,
    helpers: ReadonlyArray<readonly [string, string]>,
  ): Record<string, string> {
    const home = join(root, '.runtime/home');
    const path = [
      join(root, '.runtime/deps/python/bin'),
      join(root, '.runtime/deps/node/bin'),
      this.raw.bin,
      ...this.raw.path,
    ].join(':');
    const user = slot?.user ?? process.env.USER ?? process.env.LOGNAME ?? '';
    return {
      ...this.raw.runnerdEnv,
      PATH: path,
      HOME: home,
      TMPDIR: join(root, '.runtime/tmp'),
      ...(user === '' ? {} : { USER: user, LOGNAME: user }),
      SHELL: '/bin/bash',
      LANG: process.env.LANG ?? 'C.UTF-8',
      PIP_TARGET: join(root, '.runtime/deps/python'),
      PYTHONPATH: join(root, '.runtime/deps/python'),
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
      NPM_CONFIG_PREFIX: join(root, '.runtime/deps/node'),
      NODE_PATH: join(root, '.runtime/deps/node/lib/node_modules'),
      TALE_RUNNER_NODE_COMPILE_CACHE: join(home, '.cache/node-compile-cache'),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      TALE_RAW_SESSION: sessionId,
      TALE_WORKSPACE_ROOT: root,
      TALE_SESSION_VIEW: JSON.stringify({
        root: CONTRACT_ROOT,
        real: root,
        origins,
        ...(helpers.length > 0 ? { paths: helpers } : {}),
      }),
      [RUNNERD_LISTEN_ENV]: '127.0.0.1:0',
      [RUNNERD_READY_FILE_ENV]: join(root, READY_FILE),
      TALE_RUNNERD_TOKEN_FD: '3',
      TALE_RUNNERD_NONDUMPABLE: 'platform',
      [RUNNERD_INCARNATION_ENV]: incarnation,
      // No subreaper shim ships outside the image; runnerd ends an exec's
      // leftovers by group and tag, and a stop ends the slot's processes.
      TALE_EXEC_SHIM: '',
    };
  }

  private helpers: ReadonlyArray<readonly [string, string]> | null = null;

  /** Where the platform names the runtime's helper programs (the image's
   * `/usr/local/bin/tale-…`, e.g. the git credential helper it arms) and
   * where this device has them: every `tale-…` program in RawConfig.bin. */
  private async helperPaths(): Promise<
    ReadonlyArray<readonly [string, string]>
  > {
    if (this.helpers !== null) return this.helpers;
    let names: string[] = [];
    try {
      names = await readdir(this.raw.bin);
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    this.helpers = names
      .filter((name) => /^tale-[a-z0-9-]+$/.test(name))
      .sort()
      .map(
        (name) => [`/usr/local/bin/${name}`, join(this.raw.bin, name)] as const,
      );
    return this.helpers;
  }

  /** Wait until runnerd says which port it took and answers its health
   * check — failing as soon as its process is gone. */
  private async waitForReady(
    sessionId: string,
    root: string,
    pid: number,
    start: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<number> {
    const budget =
      operationRemainingMs() ?? this.cfg.session.createHealthTimeoutMs;
    const deadline =
      this.now() + Math.min(budget, this.cfg.session.createHealthTimeoutMs);
    let port: number | null = null;
    for (let miss = 1; ; miss += 1) {
      signal?.throwIfAborted();
      if (port === null) port = await this.readReadyPort(root, pid);
      if (port !== null) {
        try {
          await this.health(
            { baseUrl: `http://127.0.0.1:${port}`, token },
            signal,
          );
          return port;
        } catch {
          // Not answering yet.
        }
      }
      if (miss % 5 === 0 && (await this.processes.identity(pid)) !== start) {
        throw new Error(
          `runnerd of ${sessionId} exited before it became ready; see ${this.logPath(sessionId)}`,
        );
      }
      if (this.now() > deadline) {
        throw new Error(`runnerd of ${sessionId} did not become ready in time`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** The port runnerd's ready file names, when it is this runnerd's. */
  private async readReadyPort(
    root: string,
    pid: number,
  ): Promise<number | null> {
    let text: string;
    try {
      text = await readFile(join(root, READY_FILE), 'utf8');
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
    try {
      const value: unknown = JSON.parse(text);
      if (value === null || typeof value !== 'object') return null;
      const ready = Object.fromEntries(Object.entries(value));
      const port = ready.port;
      return ready.pid === pid &&
        typeof port === 'number' &&
        Number.isInteger(port) &&
        port > 0 &&
        port <= 65_535
        ? port
        : null;
    } catch {
      return null;
    }
  }

  /** A create that failed leaves nothing running and the slot free; the
   * directory stays, as the Docker backend leaves its workspace for a retry
   * or an explicit destroy. */
  private async cleanupFailedCreate(
    sessionId: string,
    pid: number | null,
    slot: RawSlot | null,
  ): Promise<void> {
    try {
      await this.endSessionProcesses(sessionId, pid, slot, 0);
      if (slot !== null) await this.parkSlot(sessionId, slot);
      const record = await this.readRecord(sessionId);
      if (record !== null) {
        record.runnerd = null;
        record.slot = null;
        await this.writeRecord(record);
      }
    } catch (err) {
      console.warn(
        `[sandbox.raw] failed-create cleanup of ${sessionId} incomplete:`,
        err,
      );
    } finally {
      this.tokens.delete(sessionId);
      this.releaseSlot(slot?.user ?? null, sessionId);
    }
  }

  // ── Ending a session's compute ───────────────────────────────────────

  /** End every process of the session: of its slot on an isolated device,
   * what descends from its runnerd (and that runnerd's group) on a shared
   * one. */
  private async endSessionProcesses(
    sessionId: string,
    pid: number | null,
    slot: RawSlot | null,
    graceMs: number,
  ): Promise<void> {
    if (slot !== null) {
      await endProcesses(
        this.processes,
        (table) => table.filter((entry) => entry.uid === slot.uid),
        { graceMs, what: `slot ${slot.user}` },
      );
      return;
    }
    if (pid === null) return;
    const select = (table: readonly ProcessEntry[]) => {
      const runnerd = table.find((entry) => entry.pid === pid);
      const below = descendantsOf(table, pid);
      const groups = new Set(below.map((entry) => entry.pgid));
      if (runnerd !== undefined) groups.add(runnerd.pgid);
      groups.delete(0);
      groups.delete(1);
      // Everything in a group that runnerd or one of its execs led, even
      // once its parent is gone; never the spawner's own group.
      const own = process.pid;
      const ownGroup = table.find((entry) => entry.pid === own)?.pgid;
      if (ownGroup !== undefined) groups.delete(ownGroup);
      return table.filter(
        (entry) =>
          entry.pid === pid ||
          below.some((child) => child.pid === entry.pid) ||
          groups.has(entry.pgid),
      );
    };
    await endProcesses(this.processes, select, {
      graceMs,
      what: `session ${sessionId}`,
    });
  }

  /** Hand the slot back: take back what it left, and close the session's
   * directory to every slot until it runs again. */
  private async parkSlot(sessionId: string, slot: RawSlot): Promise<void> {
    const root = this.sessionRoot(sessionId);
    if (await exists(root)) {
      // Only the top directory: no slot can enter it now, whoever runs as
      // this slot next, while its files keep their owner for the next start.
      await this.acts.chown(root, 0, 0);
      await chmod(root, 0o700);
    }
    await this.acts.reclaimSlot(slot);
  }

  async stopSession(
    sessionId: string,
    expectedCreatedAtMs?: number,
    options: StopSessionOptions = {},
  ): Promise<boolean> {
    return await this.locked(sessionId, async () => {
      const record = await this.readRecord(sessionId);
      if (record === null) return false;
      if (
        expectedCreatedAtMs !== undefined &&
        record.createdAtMs !== expectedCreatedAtMs
      ) {
        throw new SessionIncarnationChangedError(
          sessionId,
          `recorded ${record.createdAtMs}, asked for ${expectedCreatedAtMs}`,
        );
      }
      const slot = this.slotNamed(record.slot);
      if (record.runnerd === null && slot === null) return false;
      const pid = record.runnerd?.pid ?? null;
      const graceMs = Math.max(0, options.graceMs ?? 0);
      if (
        graceMs > 0 &&
        pid !== null &&
        (await this.runnerdAlive(record.runnerd))
      ) {
        // runnerd passes a stop on to every live exec (a harness writes its
        // transcript) before it exits.
        this.processes.signal(pid, 'SIGTERM');
      }
      await this.endSessionProcesses(sessionId, pid, slot, graceMs);
      if (slot !== null) await this.parkSlot(sessionId, slot);
      record.runnerd = null;
      record.slot = null;
      record.pinned = false;
      record.touchedAtMs = this.now();
      await this.writeRecord(record);
      this.tokens.delete(sessionId);
      this.releaseSlot(slot?.user ?? null, sessionId);
      return true;
    });
  }

  async destroySession(sessionId: string): Promise<boolean> {
    return await this.locked(sessionId, async () => {
      const record = await this.readRecord(sessionId);
      const slot = this.slotNamed(record?.slot ?? null);
      const pid = record?.runnerd?.pid ?? null;
      if (record?.runnerd !== null && record !== null) {
        await this.endSessionProcesses(sessionId, pid, slot, 0);
      } else if (slot !== null) {
        await this.endSessionProcesses(sessionId, null, slot, 0);
      }
      if (slot !== null) await this.acts.reclaimSlot(slot);
      this.releaseSlot(slot?.user ?? null, sessionId);
      this.tokens.delete(sessionId);
      const root = this.sessionRoot(sessionId);
      const had = record !== null || (await exists(root));
      // Out of use at once; the bytes go in the background (workspaceDeletion).
      await this.trash.discard(root);
      await this.removeRecord(sessionId);
      await rm(this.logPath(sessionId), { force: true });
      return had;
    });
  }

  async workspaceDeletion(
    sessionId: string,
    waitMs = 0,
  ): Promise<WorkspaceDeletion> {
    const name = this.sessionRoot(sessionId);
    return waitMs > 0
      ? this.trash.settle(name, waitMs)
      : this.trash.deletion(name);
  }

  // ── Reading ───────────────────────────────────────────────────────────

  async resolveEndpoint(
    sessionId: string,
    expectedCreatedAtMs?: number,
  ): Promise<string> {
    const record = await this.readRecord(sessionId);
    if (record?.runnerd === null || record === null) {
      throw new Error(`session ${sessionId} has no running runnerd`);
    }
    if (expectedCreatedAtMs !== undefined) {
      if (
        record.createdAtMs !== expectedCreatedAtMs ||
        !(await this.runnerdAlive(record.runnerd))
      ) {
        throw new SessionIncarnationChangedError(
          sessionId,
          'runnerd gone or another incarnation before endpoint resolution',
        );
      }
    }
    this.tokens.set(sessionId, record.runnerd.token);
    return `http://127.0.0.1:${record.runnerd.port}`;
  }

  /** The token of the session's running runnerd (one per incarnation). */
  runnerdToken(sessionId: string): string | undefined {
    return this.tokens.get(sessionId);
  }

  async sessionExists(
    sessionId: string,
    expectedCreatedAtMs?: number,
  ): Promise<boolean> {
    const record = await this.readRecord(sessionId);
    if (record === null || record.runnerd === null) return false;
    if (
      expectedCreatedAtMs !== undefined &&
      record.createdAtMs !== expectedCreatedAtMs
    ) {
      return false;
    }
    return await this.runnerdAlive(record.runnerd);
  }

  async hasWorkspace(sessionId: string): Promise<boolean> {
    return await exists(this.sessionRoot(sessionId));
  }

  async listSessions(organizationId?: string): Promise<BackendSession[]> {
    const out: BackendSession[] = [];
    for (const record of await this.allRecords()) {
      if (record.runnerd === null) continue;
      if (
        organizationId !== undefined &&
        record.organizationId !== organizationId
      )
        continue;
      const alive = await this.runnerdAlive(record.runnerd);
      if (alive) this.tokens.set(record.sessionId, record.runnerd.token);
      out.push({
        sessionId: record.sessionId,
        organizationId: record.organizationId,
        profile: record.profile,
        docker: false,
        createdAtMs: record.createdAtMs,
        ttlMs: record.ttlMs,
        idleTimeoutMs: record.idleTimeoutMs,
        state: alive ? 'ready' : 'degraded',
        pinned: record.pinned,
        ...(alive ? {} : { ended: true }),
      });
    }
    return out;
  }

  async setPinned(
    sessionId: string,
    pinned: boolean,
    expectedCreatedAtMs?: number,
  ): Promise<void> {
    await this.locked(sessionId, async () => {
      const record = await this.readRecord(sessionId);
      if (record === null)
        throw new Error(`session ${sessionId} has no record`);
      if (
        expectedCreatedAtMs !== undefined &&
        record.createdAtMs !== expectedCreatedAtMs
      ) {
        throw new SessionIncarnationChangedError(
          sessionId,
          'pin of another incarnation',
        );
      }
      record.pinned = pinned;
      await this.writeRecord(record);
    });
  }

  async listWorkspaces(): Promise<BackendWorkspace[]> {
    let names: string[];
    try {
      names = await readdir(this.sessionsDir());
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
    const out: BackendWorkspace[] = [];
    for (const name of names) {
      if (!isSessionWorkspaceDirName(name)) continue;
      const sessionId = name.slice('ses-'.length);
      const record = await this.readRecord(sessionId);
      let touchedAtMs = record?.touchedAtMs ?? 0;
      try {
        const info = await stat(join(this.sessionsDir(), name));
        touchedAtMs = Math.max(touchedAtMs, info.mtimeMs, info.ctimeMs);
      } catch (err) {
        if (isMissing(err)) continue;
        throw err;
      }
      out.push({
        sessionId,
        touchedAtMs,
        active: record?.runnerd !== null && record !== null,
        pinned: record?.pinned === true,
        ...(record === null ? {} : { organizationId: record.organizationId }),
      });
    }
    return out;
  }

  async largestWorkspaces(limit: number): Promise<LargestWorkspaces> {
    return await largestWorkspaces(this.sessionsDir(), { limit });
  }

  async workspaceSizes(
    sessionIds: readonly string[],
  ): Promise<ReadonlyMap<string, number | null>> {
    return await measureWorkspaces(this.sessionsDir(), sessionIds);
  }

  async listOrganizationResources(): Promise<string[]> {
    // No build helpers, networks or caches beside the workspaces.
    return [];
  }

  async teardownOrganization(): Promise<OrganizationTeardownResult> {
    return { containers: 0, volumes: 0, networks: 0 };
  }

  async reconcileBuildCache(): Promise<void> {
    // No shared build cache on a raw device.
  }

  /** The slot accounts no running session holds but that still run a
   * process: what a crash between a slot's start and its record left. */
  async strayProcesses(): Promise<number> {
    if (this.raw.isolation !== 'isolated') return 0;
    await this.loadSlots();
    let ended = 0;
    for (const slot of this.raw.slots) {
      if (this.taken.has(slot.user)) continue;
      ended += await endProcesses(
        this.processes,
        (table) => table.filter((entry) => entry.uid === slot.uid),
        { what: `idle slot ${slot.user}` },
      );
    }
    return ended;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}
