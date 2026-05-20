// Two-layer cleanup, audit-cleaned per round-2 findings.
//
//   1. Boot sweep: docker rm any tale.sandbox=1 container left over from a
//      previous spawner process, AND host-dir sweep over old session dirs
//      whose mtime is past the watchdog cutoff. The dead "volume sweep"
//      that the original code shipped is gone — workspaces are host bind
//      mounts (no volume), and the cache volumes carry a different label
//      and MUST NOT be reaped.
//   2. Periodic sweep: every 5 min, kill any tale-sbx-* container whose
//      `tale.started=<ms>` label is older than 2× max_timeout AND whose
//      session id isn't in the live in-flight set. Same host-dir sweep
//      for orphan session dirs.
//   3. SIGTERM handler (in server.ts after refactor): stop accepting new
//      requests, wait for in-flight count to drop, then exit.

import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { runDocker, dockerRm } from './spawn-util.ts';
import { cancelExecution, inFlightIds, isInFlight } from './spawn.ts';
import type { SpawnerConfig } from './types.ts';

const PERIODIC_INTERVAL_MS = 5 * 60_000;

async function listLabeledContainers(label: string): Promise<string[]> {
  const result = await runDocker(['ps', '-aq', '-f', `label=${label}`]);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function sweepHostSessionDirs(
  cfg: SpawnerConfig,
  staleThreshold: number,
): Promise<number> {
  let entries;
  try {
    entries = await readdir(cfg.hostSessionRoot, { withFileTypes: true });
  } catch (err) {
    // Root not yet created (first boot) — fine.
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return 0;
    }
    console.warn(
      `[sandbox.cleanup] failed to read host session root ${cfg.hostSessionRoot}:`,
      err,
    );
    return 0;
  }
  let removed = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (isInFlight(e.name)) continue;
    const abs = join(cfg.hostSessionRoot, e.name);
    let st;
    try {
      st = await stat(abs);
    } catch (err) {
      console.warn(`[sandbox.cleanup] stat ${abs} failed:`, err);
      continue;
    }
    if (st.mtimeMs >= staleThreshold) continue;
    try {
      await rm(abs, { recursive: true, force: true });
      removed += 1;
    } catch (err) {
      console.warn(`[sandbox.cleanup] rm ${abs} failed:`, err);
    }
  }
  return removed;
}

export async function bootSweep(cfg?: SpawnerConfig): Promise<void> {
  const containers = await listLabeledContainers('tale.sandbox=1');
  for (const c of containers) {
    try {
      await dockerRm(c);
    } catch (err) {
      console.warn(`[sandbox.bootSweep] dockerRm ${c} failed:`, err);
    }
  }
  const stagingContainers = await listLabeledContainers(
    'tale.sandbox-staging=1',
  );
  for (const c of stagingContainers) {
    try {
      await dockerRm(c);
    } catch (err) {
      console.warn(`[sandbox.bootSweep] dockerRm staging ${c} failed:`, err);
    }
  }
  let dirsRemoved = 0;
  if (cfg) {
    // Any session dir on disk at boot belongs to a previous spawner
    // process; nothing is in-flight yet, so we can clean them
    // unconditionally (no mtime check).
    dirsRemoved = await sweepHostSessionDirs(cfg, Date.now() + 1);
  }
  if (containers.length > 0 || dirsRemoved > 0) {
    console.log(
      `[sandbox] boot sweep removed ${containers.length} container(s) and ${dirsRemoved} session dir(s)`,
    );
  }
}

export function startPeriodicSweep(cfg: SpawnerConfig): () => void {
  const interval = setInterval(async () => {
    try {
      const result = await runDocker([
        'ps',
        '-a',
        '--filter',
        'label=tale.sandbox=1',
        '--format',
        '{{.Names}}\t{{.Labels}}',
      ]);
      if (result.exitCode !== 0) return;
      const now = Date.now();
      const staleThreshold = now - 2 * cfg.maxTimeoutMs;
      for (const line of result.stdout.split('\n')) {
        const [name, labels] = line.split('\t');
        if (!name) continue;
        const m = labels?.match(/tale\.started=(\d+)/);
        if (!m) continue;
        const started = Number.parseInt(m[1] ?? '0', 10);
        if (Number.isNaN(started) || started >= staleThreshold) continue;
        // session id is the second component of the name (tale-sbx-<id>).
        const sessionId = name.replace(/^tale-sbx-/, '');
        if (isInFlight(sessionId)) continue;
        try {
          await dockerRm(name);
        } catch (err) {
          console.warn(
            `[sandbox.periodic] dockerRm stale ${name} failed:`,
            err,
          );
          continue;
        }
        console.log(
          `[sandbox] periodic sweep removed stale container ${name} (started ${new Date(started).toISOString()})`,
        );
      }
      // Host-dir sweep: per-execution session dirs that lived past the
      // stale threshold without an active in-flight entry are orphaned.
      // Replaces the old volume-sweep block that targeted volumes nobody
      // creates (audit finding R2-3 C5).
      await sweepHostSessionDirs(cfg, staleThreshold);
    } catch (err) {
      console.warn(`[sandbox.periodic] sweep error:`, err);
    }
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
export function installSignalHandlers(stopAccepting: () => void): void {
  let shuttingDown = false;
  const onTerm = async (sig: string) => {
    if (shuttingDown) {
      console.warn(`[sandbox] received second ${sig}; forcing exit`);
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`[sandbox] received ${sig}; draining in-flight executions`);
    try {
      stopAccepting();
    } catch (err) {
      console.warn(`[sandbox.shutdown] stopAccepting failed:`, err);
    }
    const ids = inFlightIds();
    await Promise.allSettled(
      ids.map((id) =>
        cancelExecution(id).catch((err) => {
          console.warn(`[sandbox.shutdown] cancel ${id} failed:`, err);
        }),
      ),
    );
    const deadline = Date.now() + 20_000;
    while (inFlightIds().length > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    }
    const remaining = inFlightIds();
    if (remaining.length > 0) {
      console.warn(
        `[sandbox] shutdown deadline; ${remaining.length} execution(s) still in-flight (${remaining.join(', ')})`,
      );
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void onTerm('SIGTERM'));
  process.on('SIGINT', () => void onTerm('SIGINT'));
}
