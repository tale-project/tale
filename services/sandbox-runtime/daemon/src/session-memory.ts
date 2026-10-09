// The session's memory, as its cgroup counts it. A session container is one
// cgroup with a hard limit (`--memory` on Docker, the Pod's limit on
// Kubernetes); every exec, this daemon and the inner Docker engine draw on
// it, and past the limit the kernel's OOM killer ends a process of the
// session — most often the agent itself, the largest one. Reading the
// cgroup's own files lets runnerd refuse to start more work into a session
// that is about to run out, and say afterwards when it did.
//
// Inside the container's cgroup namespace its cgroup is the root of
// /sys/fs/cgroup. Under Docker-in-sandbox the entrypoint moves every process
// into a leaf (`init`) so the root can delegate controllers, but the root's
// files still count the whole session: memory.current and memory.stat are
// hierarchical. On cgroup v1, or a host that shares its cgroup namespace,
// the files are missing or have no limit, and nothing here judges.

import { readFile } from 'node:fs/promises';

/** The share of its limit a session's working set may reach before runnerd
 * refuses to start another exec in it, when `TALE_EXEC_ADMISSION_MEMORY_PERCENT`
 * is unset. */
export const DEFAULT_ADMISSION_MEMORY_PERCENT = 90;
/** How long a refused start is told to wait before it asks again. */
export const MEMORY_BUSY_RETRY_AFTER_SECONDS = 5;
/** The cgroup root inside a session container. */
const CGROUP_ROOT = '/sys/fs/cgroup';

/** The session's memory as its cgroup reports it. */
export interface SessionMemory {
  /** `memory.current`: every page charged to the session, the file cache
   * included. */
  currentBytes: number;
  /** `memory.max`, or null when the session has no limit (`max`). */
  maxBytes: number | null;
  /** What the session uses that the kernel cannot drop at once: current
   * minus the inactive file cache (`memory.stat` `inactive_file`) — the
   * working set Docker's and Kubernetes' own figures report. A session that
   * read many files sits near its limit on cache alone, which a new exec
   * simply reclaims. */
  workingSetBytes: number;
}

/** The share `env` sets: `TALE_EXEC_ADMISSION_MEMORY_PERCENT`, a whole
 * percentage from 1 to 100, or 0 to admit every exec;
 * {@link DEFAULT_ADMISSION_MEMORY_PERCENT} when unset or out of range. */
export function admissionMemoryPercentFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.TALE_EXEC_ADMISSION_MEMORY_PERCENT;
  if (raw === undefined || raw.trim() === '')
    return DEFAULT_ADMISSION_MEMORY_PERCENT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    console.warn(
      `[runnerd] TALE_EXEC_ADMISSION_MEMORY_PERCENT=${JSON.stringify(raw)} is not a whole percentage; using ${DEFAULT_ADMISSION_MEMORY_PERCENT}`,
    );
    return DEFAULT_ADMISSION_MEMORY_PERCENT;
  }
  return value;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** One cgroup file, or null when it is not there. */
async function readCgroupFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'latin1');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT')
      console.warn(`[runnerd] cannot read ${path}:`, error);
    return null;
  }
}

/** The value of one `key value` line of a cgroup stat file, or null. */
export function statValue(text: string, key: string): number | null {
  const line = new RegExp(`^${key} (\\d+)$`, 'm').exec(text);
  return line?.[1] === undefined ? null : Number(line[1]);
}

/** The session's memory, or null where its cgroup cannot be read.
 * TALE_CGROUP_ROOT names another cgroup root for hermetic unit tests. */
export async function readSessionMemory(
  root = process.env.TALE_CGROUP_ROOT ?? CGROUP_ROOT,
): Promise<SessionMemory | null> {
  const [current, max, stat] = await Promise.all([
    readCgroupFile(`${root}/memory.current`),
    readCgroupFile(`${root}/memory.max`),
    readCgroupFile(`${root}/memory.stat`),
  ]);
  const currentBytes = Number(current?.trim());
  if (current === null || !Number.isSafeInteger(currentBytes)) return null;
  const limit = max?.trim();
  const maxBytes =
    limit === undefined || limit === 'max' || !/^\d+$/.test(limit)
      ? null
      : Number(limit);
  const inactiveFile = stat === null ? null : statValue(stat, 'inactive_file');
  return {
    currentBytes,
    maxBytes,
    workingSetBytes: Math.max(0, currentBytes - (inactiveFile ?? 0)),
  };
}

/** How many processes the OOM killer has ended in the session so far
 * (`memory.events` `oom_kill`, which counts the whole subtree), or null
 * where the cgroup cannot be read. */
export async function readOomKills(
  root = process.env.TALE_CGROUP_ROOT ?? CGROUP_ROOT,
): Promise<number | null> {
  const events = await readCgroupFile(`${root}/memory.events`);
  return events === null ? null : statValue(events, 'oom_kill');
}

/** The session's memory peak since the container started (`memory.peak`,
 * Linux 5.19 and later), or null where the kernel reports none. */
export async function readMemoryPeak(
  root = process.env.TALE_CGROUP_ROOT ?? CGROUP_ROOT,
): Promise<number | null> {
  const peak = (await readCgroupFile(`${root}/memory.peak`))?.trim();
  return peak !== undefined && /^\d+$/.test(peak) ? Number(peak) : null;
}

/** Whether a session this full refuses a new exec: its working set has
 * reached `percent` of its limit. Never without a limit, a reading, or with
 * the check off (0). */
export function memoryRefusesExec(
  memory: SessionMemory | null,
  percent: number,
): boolean {
  if (memory === null || memory.maxBytes === null || percent <= 0) return false;
  return memory.workingSetBytes * 100 >= memory.maxBytes * percent;
}
