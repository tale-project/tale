// Ends the processes an exec leaves behind. An exec owns everything it
// started: its process group (the child is spawned detached, so the group id
// is the child's pid) and every process that carries its tag in the
// environment, which a descendant inherits even after it moved to a group or
// session of its own (`setsid`, a browser spawned detached by its driver).
// Without this, a backgrounded `npm run dev &`, a `nohup` worker or a browser
// whose driver was killed keeps its memory and pids until the container
// stops, while the session reads idle.

import { readdirSync, readFileSync } from 'node:fs';

/** The environment variable every exec's processes carry: the exec id. */
export const EXEC_TAG_ENV = 'TALE_EXEC_ID';

export interface ReaperDeps {
  /** Where the process table is read (Linux `/proc`); absent elsewhere. */
  procRoot?: string;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  /** Never signalled: this daemon itself. */
  selfPid?: number;
}

/** Errors that mean "that process is gone or not ours to judge". */
const VANISHED = new Set(['ENOENT', 'ESRCH', 'EACCES', 'EPERM']);

function errorCode(err: unknown): string | undefined {
  if (err instanceof Error && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return undefined;
}

/** The processes whose environment carries the tag of `execId`. Reads
 * nothing but the process table; a process of another user (the
 * entrypoint's root daemons) cannot be read and is never a match. */
export function taggedPids(execId: string, deps: ReaperDeps = {}): number[] {
  const root = deps.procRoot ?? '/proc';
  const selfPid = deps.selfPid ?? process.pid;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (err) {
    // No process table here (a development host that is not Linux): the
    // process group is then the only handle on an exec's processes.
    if (errorCode(err) !== 'ENOENT') {
      console.warn('[runnerd] cannot read the process table:', err);
    }
    return [];
  }
  const tag = `${EXEC_TAG_ENV}=${execId}`;
  const pids: number[] = [];
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid <= 1 || pid === selfPid) continue;
    let environ: string;
    try {
      environ = readFileSync(`${root}/${name}/environ`, 'latin1');
    } catch (err) {
      // A process that exited between the listing and the read, or one
      // another user owns, is not this exec's to end.
      if (!VANISHED.has(errorCode(err) ?? '')) {
        console.warn(`[runnerd] cannot read the environment of ${pid}:`, err);
      }
      continue;
    }
    if (environ.split('\0').includes(tag)) pids.push(pid);
  }
  return pids;
}

/** Signal an exec's process group and every process tagged with it. Returns
 * how many targets the signal reached. A target that is already gone is the
 * normal case (the exec ended cleanly) and is not reported. */
export function signalExecProcesses(
  execId: string,
  groupId: number | undefined,
  signal: NodeJS.Signals,
  deps: ReaperDeps = {},
): number {
  const kill = deps.kill ?? ((pid, sig) => process.kill(pid, sig));
  let reached = 0;
  const send = (target: number, label: string) => {
    try {
      kill(target, signal);
      reached += 1;
    } catch (err) {
      if (errorCode(err) !== 'ESRCH') {
        console.warn(`[runnerd] ${signal} to ${label} failed:`, err);
      }
    }
  };
  // Negative pid: the whole process group.
  if (groupId !== undefined && groupId > 1) send(-groupId, `pgroup ${groupId}`);
  for (const pid of taggedPids(execId, deps)) send(pid, `pid ${pid}`);
  return reached;
}
