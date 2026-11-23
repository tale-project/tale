/**
 * Where a heavy job keeps its files: the document it reads, the text and the
 * chunks it makes, a recording and what ffmpeg makes of it.
 *
 * A directory of the job's own under the system's temporary directory, which
 * in a deployment is the container's disk: what is there costs no memory. A
 * job removes its directory when it ends. A process that was killed before
 * it could leaves one behind: a recording of gigabytes, or a document's
 * text. Those are removed by whichever process looks next, at its start and
 * every few minutes after ({@link sweepJobDirs}).
 *
 * A directory says whose it is in its name: the machine, the process, and
 * when that process started. A process that finds one whose owner is gone
 * removes it at once, however new it is, so that a process killed over and
 * over does not fill the disk one job at a time.
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';

const JOB_DIR_PREFIX = 'tale-heavy-';

/** How old a directory must be to go when its owner cannot be told. */
const STALE_AFTER_MS = 60 * 60_000;
/** How often the directories are looked through after the start. */
const SWEEP_EVERY_MS = 10 * 60_000;

/**
 * When the process `pid` started, in the system's own ticks since it booted,
 * or `null` where that cannot be read: no such process, or no `/proc`. A
 * process id is handed out again once its process is gone; with its start,
 * it names one process.
 */
function startOf(pid: number): string | null {
  try {
    const line = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // "pid (name) state …": the name may hold spaces and brackets, so the
    // fields are counted from its closing bracket. The start is the 22nd.
    const fields = line.slice(line.lastIndexOf(')') + 2).split(' ');
    return fields[19] ?? null;
  } catch (error) {
    // No such process, which is an answer, or no `/proc` on this system.
    if (isMissing(error)) return null;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ESRCH')
  );
}

/** This machine, as it may stand in a file name. Two containers that share a
 * temporary directory count their processes apart: a process is only ever
 * looked up on the machine that named it. */
const MACHINE = hostname()
  .replace(/[^A-Za-z0-9.]/g, '')
  .slice(0, 32);

interface Owner {
  readonly machine: string;
  readonly pid: number;
  readonly start: string;
}

const SELF: Owner | null = (() => {
  const start = startOf(process.pid);
  return start === null ? null : { machine: MACHINE, pid: process.pid, start };
})();

/** `tale-heavy-<machine>-<pid>-<start>-<random>`. */
const OWNED = /^tale-heavy-([A-Za-z0-9.]*)-(\d+)-(\d+)-/;

function ownerOf(name: string): Owner | null {
  const parts = OWNED.exec(name);
  if (parts === null) return null;
  return {
    machine: parts[1] ?? '',
    pid: Number(parts[2]),
    start: parts[3] ?? '',
  };
}

/** The directories of this process's jobs that are still at work. */
const atWork = new Set<string>();

/** Make a directory for one job, readable by this user alone. */
export async function newJobDir(): Promise<string> {
  const owned =
    SELF === null ? '' : `${SELF.machine}-${SELF.pid}-${SELF.start}-`;
  const dir = await mkdtemp(path.join(tmpdir(), `${JOB_DIR_PREFIX}${owned}`));
  atWork.add(dir);
  return dir;
}

/** Remove a job's directory and what is in it. Never throws: a directory
 * that stays behind is the next look's to remove. */
export async function removeJobDir(dir: string): Promise<void> {
  atWork.delete(dir);
  await rm(dir, { recursive: true, force: true }).catch((error: unknown) => {
    console.warn(
      `[heavy-slot] the job directory ${dir} could not be removed:`,
      error,
    );
  });
}

/** Whether a job directory is nobody's any more. */
async function isLeftBehind(
  dir: string,
  olderThanMs: number,
): Promise<boolean> {
  const owner = ownerOf(path.basename(dir));
  if (owner !== null && SELF !== null && owner.machine === SELF.machine) {
    // A process of this machine: it can be looked up.
    if (owner.pid === SELF.pid && owner.start === SELF.start) {
      // This process's own: left behind when no job of it is at work there.
      return !atWork.has(dir);
    }
    return startOf(owner.pid) !== owner.start;
  }
  // Another machine's, or one that says nothing of its owner: only its age
  // can tell, so that a process sharing this temporary directory keeps the
  // job it is on.
  const { mtimeMs } = await stat(dir);
  return Date.now() - mtimeMs >= olderThanMs;
}

/**
 * Remove the job directories that are nobody's: those of a process of this
 * machine that is gone, at once, and those whose owner cannot be told once
 * they have been untouched for `olderThanMs`. Answers how many were removed.
 */
export async function sweepJobDirs(
  olderThanMs = STALE_AFTER_MS,
): Promise<number> {
  const root = tmpdir();
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    console.warn(`[heavy-slot] ${root} could not be listed:`, error);
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.startsWith(JOB_DIR_PREFIX)) continue;
    const dir = path.join(root, name);
    try {
      if (!(await isLeftBehind(dir, olderThanMs))) continue;
      await rm(dir, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      // Removed meanwhile by its own job: that is what was wanted.
      if (isMissing(error)) continue;
      console.warn(`[heavy-slot] ${dir} could not be removed:`, error);
    }
  }
  return removed;
}

/**
 * Look through the job directories now, and every ten minutes from now on,
 * for as long as this process runs. A process is killed at any time, and
 * the one that takes over starts within seconds: what it finds may be of a
 * process on another machine that is still at work, which only time tells.
 * Answers how to stop looking.
 */
export function keepJobDirsSwept(
  report: (removed: number) => void = () => undefined,
): () => void {
  const look = (): void => {
    void sweepJobDirs().then((removed) => {
      if (removed > 0) report(removed);
    });
  };
  look();
  const timer = setInterval(look, SWEEP_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
