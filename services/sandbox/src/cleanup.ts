// Two-layer cleanup, audit-cleaned per round-2 findings.
//
//   1. Boot sweep: docker rm any tale.sandbox=1 container left over from a
//      previous spawner process, AND host-dir sweep over stale legacy
//      one-shot exec dirs whose mtime is past the watchdog cutoff (session
//      workspaces, in either layout, are never touched — see
//      sweepHostSessionDirs). The dead "volume sweep" that the original code
//      shipped is gone — workspaces are host bind mounts (no volume), and the
//      cache volumes carry a different label and MUST NOT be reaped.
//   2. Periodic sweep: every 5 min, kill any tale-sbx-* container whose
//      `tale.started=<ms>` label is older than 2× max_timeout AND whose
//      session id isn't in the live in-flight set. Same host-dir sweep
//      for orphan one-shot dirs.
//   3. SIGTERM handler (in server.ts after refactor): stop accepting new
//      requests, wait for in-flight count to drop, then exit.

import type { Dirent } from 'node:fs';
import { mkdir, readdir, rm, rmdir, stat, utimes } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';

import type { ExecutionBackend } from './backend/types.ts';
import { isSessionWorkspaceDirName } from './session/session-naming.ts';
import { dockerRm, dockerRmSucceeded, runDocker } from './spawn-util.ts';
import type { SpawnerConfig } from './types.ts';
import { ID_ALPHABET_RE } from './wire.ts';

const PERIODIC_INTERVAL_MS = 5 * 60_000;
const SPAWNER_LOCK_FILE = '.spawner.lock';
// If an existing lock file is fresher than this, treat the previous spawner
// as still alive and refuse to start. Otherwise we assume the previous
// process crashed without cleanup and take over the lock.
const SPAWNER_LOCK_FRESH_MS = 60_000;
// Refresh the lock's mtime at 1/3 of the freshness window so a peer
// looking for a "fresh" lock always sees one as long as we're alive.
// Without this the lock starts looking stale once we cross the
// freshness threshold and a second spawner would happily reclaim it,
// defeating the lock's only purpose (audit follow-up F15).
const SPAWNER_LOCK_REFRESH_MS = Math.floor(SPAWNER_LOCK_FRESH_MS / 3);
let lockRefreshHandle: ReturnType<typeof setInterval> | undefined;

interface SpawnerLockPayload {
  pid: number;
  hostname: string;
  bootEpoch: number;
}

/**
 * Decide whether the process recorded in a lock payload is still running.
 *
 * Only meaningful when the lock was written by a peer on the SAME host — a
 * PID from another machine tells us nothing, so we conservatively treat a
 * cross-host (or unparseable) lock as alive and let the freshness window be
 * the arbiter. On this host, `process.kill(pid, 0)` sends no signal but
 * throws `ESRCH` when no such process exists, which is our "holder is dead"
 * signal. `EPERM` means the process exists but is owned by another user →
 * alive.
 */
function isLockHolderAlive(rawPayload: string): boolean {
  let parsed: Partial<SpawnerLockPayload>;
  try {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    parsed = JSON.parse(rawPayload) as Partial<SpawnerLockPayload>;
  } catch {
    return true;
  }
  if (
    typeof parsed.pid !== 'number' ||
    parsed.hostname !== hostname() ||
    parsed.pid <= 0
  ) {
    return true;
  }
  try {
    process.kill(parsed.pid, 0);
    return true;
  } catch (err) {
    const code =
      err instanceof Error && 'code' in err
        ? // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          (err as { code?: string }).code
        : undefined;
    // ESRCH → no such process (dead). Any other error (e.g. EPERM) means the
    // process exists, so treat the holder as alive.
    return code !== 'ESRCH';
  }
}

/**
 * Best-effort cross-process lock for the host session root. Prevents two
 * spawners pointed at the same `/var/lib/tale-sandbox/sessions/` from
 * stomping on each other — specifically, prevents bootSweep's host-dir
 * sweep from deleting another live spawner's in-flight workspace
 * (audit finding R2-B5).
 *
 * Lock contract: if a fresh lock (mtime within SPAWNER_LOCK_FRESH_MS)
 * exists, refuse to start. Otherwise overwrite. On graceful shutdown the
 * server.ts caller deletes the lock; an ungraceful exit leaves the lock
 * stale and the next start can reclaim it after the freshness window.
 */
export async function acquireSpawnerLock(cfg: SpawnerConfig): Promise<void> {
  await mkdir(cfg.hostSessionRoot, { recursive: true });
  const lockPath = join(cfg.hostSessionRoot, SPAWNER_LOCK_FILE);
  try {
    const st = await stat(lockPath);
    // Clamp to [0, ∞) to defend against backward wall-clock skew (NTP
    // step, VM snapshot resume). A negative `age` would otherwise read
    // as "fresh forever" via the `<` comparison even though the lock
    // hasn't been touched in minutes (audit follow-up F15).
    const age = Math.max(0, Date.now() - st.mtimeMs);
    if (age < SPAWNER_LOCK_FRESH_MS) {
      let existing = '<unreadable>';
      try {
        existing = await Bun.file(lockPath).text();
      } catch (err) {
        console.warn(`[sandbox.lock] reading existing lock failed:`, err);
      }
      // A fresh mtime alone doesn't prove the previous spawner is alive: a
      // hard kill (turbo/vite restart, SIGKILL) leaves the lock behind with
      // a recent mtime but a dead PID. Probe the recorded PID on this host —
      // if it's gone, the lock is orphaned and we reclaim it immediately
      // instead of stranding the dev server for the full freshness window.
      if (!isLockHolderAlive(existing)) {
        console.warn(
          `[sandbox.lock] reclaiming orphaned lock at ${lockPath} ` +
            `(holder dead, age=${age}ms): ${existing.trim()}`,
        );
      } else {
        throw new Error(
          `Another spawner appears to be running at ${cfg.hostSessionRoot} ` +
            `(lock fresh, age=${age}ms): ${existing.trim()}`,
        );
      }
    } else {
      // Stale lock; fall through to overwrite.
      console.warn(
        `[sandbox.lock] reclaiming stale lock at ${lockPath} (age=${age}ms)`,
      );
    }
  } catch (err) {
    // `code` is a non-standard property only present on NodeJS fs errors; the
    // `instanceof Error` + `'code' in err` guards above prove it exists at
    // runtime, but TS can't narrow to the typed shape, so we read it through a
    // minimal interface.
    const code =
      err instanceof Error && 'code' in err
        ? // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          (err as { code?: string }).code
        : undefined;
    if (code !== 'ENOENT') {
      // Either the lock-fresh refusal above (rethrow) OR an unexpected error.
      if (err instanceof Error && err.message.startsWith('Another spawner')) {
        throw err;
      }
      console.warn(`[sandbox.lock] stat ${lockPath} failed:`, err);
    }
  }
  const payload: SpawnerLockPayload = {
    pid: process.pid,
    hostname: hostname(),
    bootEpoch: Date.now(),
  };
  await Bun.write(lockPath, JSON.stringify(payload));
  // Keep the lock visibly "alive" via mtime refresh while the process
  // runs. Stops a long-running spawner from accidentally looking stale
  // to a peer that started later than SPAWNER_LOCK_FRESH_MS after our
  // initial write.
  if (lockRefreshHandle !== undefined) clearInterval(lockRefreshHandle);
  lockRefreshHandle = setInterval(() => {
    const now = Date.now() / 1000;
    utimes(lockPath, now, now).catch((err) => {
      console.warn(`[sandbox.lock] refresh ${lockPath} failed:`, err);
    });
  }, SPAWNER_LOCK_REFRESH_MS);
  // Don't keep the event loop alive solely to refresh the lock — the
  // shutdown handler will clear this. .unref() avoids a hung-process
  // case if every other timer is cleared.
  lockRefreshHandle.unref?.();
}

/**
 * Drop the lock on graceful shutdown so a fast restart doesn't need to wait
 * out the freshness window. Called by DockerBackend.shutdown().
 */
export async function releaseSpawnerLock(cfg: SpawnerConfig): Promise<void> {
  if (lockRefreshHandle !== undefined) {
    clearInterval(lockRefreshHandle);
    lockRefreshHandle = undefined;
  }
  const lockPath = join(cfg.hostSessionRoot, SPAWNER_LOCK_FILE);
  try {
    await rm(lockPath, { force: true });
  } catch (err) {
    console.warn(`[sandbox.lock] release ${lockPath} failed:`, err);
  }
}

/** A sweep's `docker rm`: true only when the container is verifiably gone.
 * `dockerRm` never rejects (a timeout is exitCode 124), so the result must be
 * judged — a swallowed failure would count a still-running container as
 * removed. Logged, never thrown: one stuck container must not stop the sweep. */
async function sweepRm(containerName: string, label: string): Promise<boolean> {
  let removal;
  try {
    removal = await dockerRm(containerName);
  } catch (err) {
    console.warn(`${label} docker rm ${containerName} failed:`, err);
    return false;
  }
  if (!dockerRmSucceeded(removal)) {
    console.warn(
      `${label} docker rm ${containerName} failed (exit ${removal.exitCode}): ${removal.stderr.trim()}`,
    );
    return false;
  }
  return true;
}

async function listLabeledContainers(...labels: string[]): Promise<string[]> {
  // Each `-f label=…` is AND-ed by docker.
  const filters = labels.flatMap((l) => ['-f', `label=${l}`]);
  const result = await runDocker(['ps', '-aq', ...filters]);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Read one directory level, or null when it can't be read. A missing dir is
 * not an error (first boot at the root; a concurrent destroy below it); any
 * other failure is logged. Callers treat null as "leave it alone".
 */
async function readDirEntries(dir: string): Promise<Dirent[] | null> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
      console.warn(`[sandbox.cleanup] failed to read ${dir}:`, err);
    }
    return null;
  }
}

// Legacy colour roots (`<root>/<colour>/`) sit directly under the session
// root; nothing deeper was ever a session root.
const LEGACY_ROOT_MAX_DEPTH = 1;

/**
 * Host-dir sweep — removes ONLY stale legacy one-shot exec dirs, never a
 * session workspace. The layout rules it enforces (the resume side of the same
 * contract is docker-session-backend.ts resolveWorkspaceDir):
 *
 *   <root>/ses-<id>            flat session workspace          → never touched
 *   <root>/<colour>/ses-<id>   legacy colour-rooted workspace  → never touched;
 *                              a dir holding any such child is a legacy session
 *                              root — swept one level down, never removed
 *                              itself (once emptied it is reaped like any
 *                              stale dir, via a non-recursive rmdir)
 *   <root>/<execId>            legacy one-shot exec dir (its name was the raw
 *   <root>/<colour>/<execId>   executionId, ID_ALPHABET_RE) → removed once its
 *                              mtime is past `staleThreshold` and it's not live
 *   anything else              files, dot-dirs, names outside the id alphabet,
 *                              unreadable dirs → never touched
 *
 * Session workspaces are lifecycle-managed by destroySession alone: the
 * TTL/idle reaper STOPS a session and keeps its data, so age says nothing about
 * whether a `ses-*` dir is wanted — a stopped session resumes against it days
 * later, and a live one has it bind-mounted. Fail-safe by construction: an
 * un-swept unknown dir is a small leak; a deleted workspace is user data loss.
 */
export async function sweepHostSessionDirs(
  hostSessionRoot: string,
  staleThreshold: number,
  isLive: (executionId: string) => boolean = () => false,
): Promise<number> {
  return sweepDirLevel(hostSessionRoot, staleThreshold, isLive, 0);
}

async function sweepDirLevel(
  dir: string,
  staleThreshold: number,
  isLive: (executionId: string) => boolean,
  depth: number,
): Promise<number> {
  const entries = await readDirEntries(dir);
  if (entries === null) return 0;
  let removed = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (isSessionWorkspaceDirName(e.name)) continue;
    // Not a name a one-shot exec could have had → unknown provenance → skip.
    if (!ID_ALPHABET_RE.test(e.name)) continue;
    const abs = join(dir, e.name);
    const children = await readDirEntries(abs);
    if (children === null) continue;
    if (
      children.some((c) => c.isDirectory() && isSessionWorkspaceDirName(c.name))
    ) {
      // A legacy session root: sweep the one-shot leftovers beside its
      // sessions, but never the root itself while it holds a workspace.
      if (depth < LEGACY_ROOT_MAX_DEPTH) {
        removed += await sweepDirLevel(abs, staleThreshold, isLive, depth + 1);
      }
      continue;
    }
    let st;
    try {
      st = await stat(abs);
    } catch (err) {
      console.warn(`[sandbox.cleanup] stat ${abs} failed:`, err);
      continue;
    }
    if (st.mtimeMs >= staleThreshold || isLive(e.name)) continue;
    try {
      // An empty dir goes through the non-recursive rmdir: atomic, and it
      // fails (ENOTEMPTY) instead of racing anything that just landed inside.
      if (children.length === 0) await rmdir(abs);
      else await rm(abs, { recursive: true, force: true });
      removed += 1;
      console.log(
        `[sandbox.cleanup] removed stale one-shot dir ${abs} (mtime ${st.mtime.toISOString()})`,
      );
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOTEMPTY') {
        continue;
      }
      console.warn(`[sandbox.cleanup] rm ${abs} failed:`, err);
    }
  }
  return removed;
}

export async function bootSweep(cfg?: SpawnerConfig): Promise<void> {
  // The sandbox tier is a single container that rolls in-place; there is no
  // colour to scope the sweep to. The boot sweep only reaps the ONE-SHOT
  // `tale.sandbox=1` (+ staging) leftovers — persistent session containers
  // carry the distinct `tale.sandbox-session=1` label and are never touched
  // here, so re-adoption can recover them.
  const containers = await listLabeledContainers('tale.sandbox=1');
  for (const c of containers) {
    await sweepRm(c, '[sandbox.bootSweep]');
  }
  const stagingContainers = await listLabeledContainers(
    'tale.sandbox-staging=1',
  );
  for (const c of stagingContainers) {
    await sweepRm(c, '[sandbox.bootSweep] staging');
  }
  let dirsRemoved = 0;
  if (cfg) {
    // Belt-and-braces: even with the acquireSpawnerLock guarantee above
    // that no other live spawner shares this hostSessionRoot, use the
    // same `2 × maxTimeoutMs` staleness cutoff as the periodic sweep.
    // Dirs younger than that may belong to a recently-killed previous
    // spawner whose in-flight workspace was reaped along with its
    // container; nothing references them anymore so they're safe to
    // delete, but the conservative cutoff matches the rest of the code
    // path's contract and is robust under any future change where the
    // lock acquire is loosened (audit finding R2-B5).
    dirsRemoved = await sweepHostSessionDirs(
      cfg.hostSessionRoot,
      Date.now() - 2 * cfg.maxTimeoutMs,
    );
  }
  if (containers.length > 0 || dirsRemoved > 0) {
    console.log(
      `[sandbox] boot sweep removed ${containers.length} container(s) and ${dirsRemoved} session dir(s)`,
    );
  }
}

/**
 * Docker-specific orphan reap: kill any `tale-sbx-*` container whose
 * `tale.started` label predates `staleThreshold` and whose session id is no
 * longer live, then sweep orphaned host session dirs. Called by
 * `DockerBackend.sweepOrphans` (boot + periodic). Returns the count removed
 * (containers + dirs); errors are logged, never thrown, so the periodic
 * scheduler keeps running.
 */
export async function dockerSweepOrphans(
  cfg: SpawnerConfig,
  staleThreshold: number,
  isLive: (executionId: string) => boolean,
): Promise<number> {
  let removed = 0;
  // Match the prior startPeriodicSweep semantics: a failed/throwing `docker
  // ps` short-circuits the whole tick (neither the container loop NOR the
  // host-dir sweep runs), so we don't reap host session dirs while the daemon
  // is unreachable.
  let containerProbeOk = false;
  try {
    const result = await runDocker([
      'ps',
      '-a',
      '--filter',
      'label=tale.sandbox=1',
      '--format',
      '{{.Names}}\t{{.Labels}}',
    ]);
    if (result.exitCode === 0) {
      containerProbeOk = true;
      for (const line of result.stdout.split('\n')) {
        const [name, labels] = line.split('\t');
        if (!name) continue;
        const m = labels?.match(/tale\.started=(\d+)/);
        if (!m) continue;
        const started = Number.parseInt(m[1] ?? '0', 10);
        if (Number.isNaN(started) || started >= staleThreshold) continue;
        // session id is the second component of the name (tale-sbx-<id>).
        const sessionId = name.replace(/^tale-sbx-/, '');
        if (isLive(sessionId)) continue;
        if (!(await sweepRm(name, '[sandbox.periodic] stale'))) continue;
        removed += 1;
        console.log(
          `[sandbox] periodic sweep removed stale container ${name} (started ${new Date(started).toISOString()})`,
        );
      }
    }
  } catch (err) {
    console.warn(`[sandbox.periodic] container sweep error:`, err);
  }
  // Host-dir sweep: legacy one-shot exec dirs that lived past the stale
  // threshold without an active in-flight entry are orphaned (session
  // workspaces are never touched — see sweepHostSessionDirs). Replaces the
  // old volume-sweep block that targeted volumes nobody creates (audit
  // finding R2-3 C5). Gated on the container probe so a wedged daemon defers
  // dir reaping to the next cycle (matches the prior short-circuit).
  if (containerProbeOk) {
    removed += await sweepHostSessionDirs(
      cfg.hostSessionRoot,
      staleThreshold,
      isLive,
    );
    // Reap orphaned per-session inner-docker (DinD) storage volumes. A volume
    // still attached to a live session container fails `volume rm` and is
    // skipped; only volumes whose session is gone (crash, missed teardown) are
    // removed. Cheap + opportunistic — runs even if DinD is currently disabled
    // so a config flip-back doesn't leak the old volumes.
    removed += await sweepOrphanDindVolumes();
  }
  return removed;
}

/** Best-effort removal of dangling DinD storage volumes (label
 * tale.sandbox-dind=1). In-use volumes fail `volume rm` and are left alone. */
async function sweepOrphanDindVolumes(): Promise<number> {
  let removed = 0;
  try {
    const ls = await runDocker([
      'volume',
      'ls',
      '-q',
      '--filter',
      'label=tale.sandbox-dind=1',
    ]);
    if (ls.exitCode !== 0) return 0;
    for (const name of ls.stdout.split('\n')) {
      const vol = name.trim();
      if (!vol) continue;
      const rmRes = await runDocker(['volume', 'rm', vol], {
        timeoutMs: 10_000,
      });
      if (rmRes.exitCode === 0) {
        removed += 1;
        console.log(
          `[sandbox] periodic sweep removed orphan dind volume ${vol}`,
        );
      }
      // Non-zero = in use by a live session → expected, skip silently.
    }
  } catch (err) {
    console.warn('[sandbox.periodic] dind volume sweep error:', err);
  }
  return removed;
}

/**
 * Generic periodic-sweep scheduler. Backend-agnostic: every 5 min it asks the
 * active backend to reap orphans (DockerBackend → `dockerSweepOrphans`; a
 * future KubernetesBackend → a label-selector Pod delete).
 */
export function startPeriodicSweep(
  backend: ExecutionBackend,
  cfg: SpawnerConfig,
): () => void {
  const interval = setInterval(() => {
    void backend
      .sweepOrphans({
        staleBeforeMs: Date.now() - 2 * cfg.maxTimeoutMs,
        // No one-shot execs remain — every run is a session, swept by the
        // session TTL/idle reaper via its own label. This only reaps stray
        // legacy `tale.sandbox=1` one-shot containers, none of which are live.
        isLive: () => false,
      })
      .catch((err) => {
        console.warn(`[sandbox.periodic] sweep error:`, err);
      });
  }, PERIODIC_INTERVAL_MS);
  return () => clearInterval(interval);
}

/**
 * Graceful shutdown handler.
 *
 * The original code called `process.exit(0)` immediately after issuing
 * `docker kill` for every in-flight id — but `executeRequest`'s finally
 * block (which rm -rfs the host session dir) was racing with the exit,
 * so SIGTERM mid-execution leaked the host workspace. The new flow:
 *
 *   1. Mark "draining" so the HTTP layer stops accepting new work
 *      (callers pass the stop callback in).
 *   2. Issue `cancelExecution` for every in-flight id; this aborts the
 *      runDocker subprocess via AbortSignal and lets each
 *      `executeRequest` proceed to its finally block.
 *   3. Wait (with a 20s ceiling) for the in-flight Map to drain.
 *   4. exit().
 */
export function installSignalHandlers(
  stopAccepting: () => void,
  backend: ExecutionBackend,
): void {
  let shuttingDown = false;
  const onTerm = async (sig: string) => {
    if (shuttingDown) {
      console.warn(`[sandbox] received second ${sig}; forcing exit`);
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`[sandbox] received ${sig}; draining in-flight executions`);
    // Wrap the whole drain in try/finally so process.exit ALWAYS runs: a
    // rejected backend.shutdown() (or any awaited step) would otherwise leave
    // the handler hung and the container ignoring SIGTERM until docker SIGKILLs
    // it at the stop timeout.
    try {
      try {
        stopAccepting();
      } catch (err) {
        console.warn(`[sandbox.shutdown] stopAccepting failed:`, err);
      }
      // Every run is a session now; the session subsystem drains its own
      // containers (linger + TTL reaper) on shutdown, so there is no one-shot
      // in-flight registry left to quiesce here.
      await backend.shutdown();
    } catch (err) {
      console.error('[sandbox.shutdown] drain/shutdown failed:', err);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void onTerm('SIGTERM'));
  process.on('SIGINT', () => void onTerm('SIGINT'));
}
