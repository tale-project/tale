// Ends the processes an exec leaves behind. An exec owns everything it
// started: its process group (the child is spawned detached, so the group id
// is the child's pid) and every process that carries its tag in the
// environment, which a descendant inherits even after it moved to a group or
// session of its own (`setsid`, a browser spawned detached by its driver).
// Without this, a backgrounded `npm run dev &`, a `nohup` worker or a browser
// whose driver was killed keeps its memory and pids until the container
// stops, while the session reads idle.
//
// Each process is signalled ONCE per round: the group as a whole, and
// individually only the tagged processes that left it — a second SIGTERM
// lands inside a handler the first one started (a wrapper's cleanup, a
// harness writing its transcript) and cuts it short. A process that both left
// the group and rewrote its environment (a `setsid` server that sets its own
// title) is out of reach; a per-exec cgroup would be the way to catch it.

import { readdir, readFile } from 'node:fs/promises';

/** The environment variable every exec's processes carry: the exec id. */
export const EXEC_TAG_ENV = 'TALE_EXEC_ID';

export interface ReaperDeps {
  /** Where the process table is read (Linux `/proc`); absent elsewhere. */
  procRoot?: string;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  /** Never signalled: this daemon itself. */
  selfPid?: number;
}

/** An exec whose processes a round ends: its id and its process group. */
export interface ReapTarget {
  execId: string;
  groupId: number | undefined;
  /** The group is certainly still the exec's: the round comes as its leader
   * exits (or while it runs), before the number can be reused. Otherwise the
   * group is signalled only while a process tagged with the exec is in it. */
  groupKnown?: boolean;
}

/** Errors that mean "that process is gone or not ours to judge". */
const VANISHED = new Set(['ENOENT', 'ESRCH', 'EACCES', 'EPERM']);

function errorCode(err: unknown): string | undefined {
  if (err instanceof Error && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return undefined;
}

interface TaggedProcess {
  pid: number;
  pgrp: number;
  execId: string;
}

/** The process group of a `/proc/<pid>/stat` line: the fifth field, read
 * after the command name, which may itself hold spaces and parentheses. */
function pgrpOf(stat: string): number | null {
  const end = stat.lastIndexOf(')');
  if (end === -1) return null;
  const fields = stat.slice(end + 2).split(' ');
  const pgrp = Number(fields[2]);
  return Number.isInteger(pgrp) && pgrp > 0 ? pgrp : null;
}

/** Every readable process carrying an exec tag, or null when there is no
 * process table here (a development host that is not Linux). Async: a read
 * of another process's environment can wait on that process's memory lock,
 * which must never stall this daemon's only event loop. */
async function readTaggedProcesses(
  deps: ReaperDeps,
): Promise<TaggedProcess[] | null> {
  const root = deps.procRoot ?? '/proc';
  const selfPid = deps.selfPid ?? process.pid;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') {
      console.warn('[runnerd] cannot read the process table:', err);
    }
    return null;
  }
  const prefix = `${EXEC_TAG_ENV}=`;
  const found: TaggedProcess[] = [];
  await Promise.all(
    entries.map(async (name) => {
      if (!/^\d+$/.test(name)) return;
      const pid = Number(name);
      if (pid <= 1 || pid === selfPid) return;
      let environ: string;
      let stat: string;
      try {
        [environ, stat] = await Promise.all([
          readFile(`${root}/${name}/environ`, 'latin1'),
          readFile(`${root}/${name}/stat`, 'latin1'),
        ]);
      } catch (err) {
        // A process that exited between the listing and the read, or one
        // another user owns, is not an exec's to end.
        if (!VANISHED.has(errorCode(err) ?? '')) {
          console.warn(`[runnerd] cannot read process ${pid}:`, err);
        }
        return;
      }
      const tag = environ.split('\0').find((entry) => entry.startsWith(prefix));
      const pgrp = pgrpOf(stat);
      if (tag === undefined || pgrp === null) return;
      found.push({ pid, pgrp, execId: tag.slice(prefix.length) });
    }),
  );
  return found;
}

/** The processes whose environment carries the tag of `execId`. */
export async function taggedPids(
  execId: string,
  deps: ReaperDeps = {},
): Promise<number[]> {
  const table = await readTaggedProcesses(deps);
  return (table ?? [])
    .filter((proc) => proc.execId === execId)
    .map((proc) => proc.pid)
    .sort((a, b) => a - b);
}

/** The execs that still have a tagged process running, or null when there
 * is no process table here. */
export async function execsWithProcesses(
  deps: ReaperDeps = {},
): Promise<Set<string> | null> {
  const table = await readTaggedProcesses(deps);
  return table === null ? null : new Set(table.map((proc) => proc.execId));
}

/**
 * Signal what the targets left running: each process once. A target's
 * group is signalled when it is certainly still the exec's (`groupKnown`, or
 * a process tagged with the exec is still in it), and every tagged process
 * outside its group on its own. Without a process table only the group can
 * be signalled. Returns how many targets the signal reached.
 */
export async function signalExecProcesses(
  targets: readonly ReapTarget[],
  signal: NodeJS.Signals,
  deps: ReaperDeps = {},
): Promise<number> {
  if (targets.length === 0) return 0;
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
  const table = await readTaggedProcesses(deps);
  for (const { execId, groupId, groupKnown } of targets) {
    const group = groupId !== undefined && groupId > 1 ? groupId : null;
    const members = (table ?? []).filter((proc) => proc.execId === execId);
    const groupIsTheExecs =
      group !== null &&
      (table === null ||
        groupKnown === true ||
        members.some((proc) => proc.pgrp === group));
    // Negative pid: the whole process group.
    if (groupIsTheExecs) send(-group, `pgroup ${group}`);
    for (const proc of members) {
      if (groupIsTheExecs && proc.pgrp === group) continue;
      send(proc.pid, `pid ${proc.pid}`);
    }
  }
  return reached;
}
