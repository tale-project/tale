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
// individually only the exec's processes that left it — a second SIGTERM
// lands inside a handler the first one started (a wrapper's cleanup, a
// harness writing its transcript) and cuts it short.
//
// Where the exec runs under its subreaper shim (tale-exec-shim), its
// processes are the shim's descendants: a process that leaves the group,
// moves to a session of its own and rewrites its environment and title is
// still reparented to the shim, and found by walking down from it. Without
// the shim, the environment tag is what finds such a process, and one that
// both left the group and rewrote its environment is out of reach.
//
// A group's number is the exec's only while the group lives: once its last
// process is gone, the number may be reused. A round that comes later than
// the exec's end therefore needs proof. A process of the group the exec left
// (its pid and start time, recorded while the group was certainly the
// exec's) still in it is one, and so is a process tagged with the exec.
//
// Reading another process's environment takes that process's memory lock,
// which a process stuck under memory pressure can hold for minutes. So a
// group known to be the exec's is signalled before the table is read, a scan
// answers with what it read once its deadline passes, and a process whose
// read did not come back is skipped until it is gone or the read returns.

import { readdir, readFile } from 'node:fs/promises';

/** The environment variable every exec's processes carry: the exec id. */
export const EXEC_TAG_ENV = 'TALE_EXEC_ID';

/** How long one scan of the process table waits for its reads. */
const SCAN_DEADLINE_MS = 2_000;

export interface ReaperDeps {
  /** Where the process table is read (Linux `/proc`); absent elsewhere. */
  procRoot?: string;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  /** Never signalled: this daemon itself. */
  selfPid?: number;
  /** How long a scan waits for its reads; {@link SCAN_DEADLINE_MS} unless
   * set. */
  scanDeadlineMs?: number;
  /** Lists the process table; `readdir` unless set. */
  listDir?: (root: string) => Promise<string[]>;
}

/** A process of an exec's group, as a scan saw it while the group was
 * certainly the exec's: with its start time, it names that one process even
 * after the pid is reused. */
export interface GroupMember {
  pid: number;
  startTime: string;
}

/** An exec whose processes a round ends: its id and its process group. */
export interface ReapTarget {
  execId: string;
  groupId: number | undefined;
  /** The exec's subreaper shim: every process the exec started is its
   * descendant. Walked only while `rootAlive()` holds — the shim waits until
   * its last descendant is gone, so until it has exited its pid names it. */
  rootPid?: number;
  rootAlive?: () => boolean;
  rootComplete?: () => boolean;
  groupOnly?: boolean;
  /** The group is certainly still the exec's: the round comes as its leader
   * exits (or while it runs), before the number can be reused. Otherwise the
   * group is signalled only while a process tagged with the exec, or one of
   * {@link members}, is in it. */
  groupKnown?: boolean;
  /** The group's processes as a scan saw them while it was the exec's. */
  members?: Promise<readonly GroupMember[]>;
}

/** Errors that mean "that process is gone or not ours to judge". */
const VANISHED = new Set(['ENOENT', 'ESRCH', 'EACCES', 'EPERM']);

function errorCode(err: unknown): string | undefined {
  if (err instanceof Error && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return undefined;
}

interface ProcessEntry {
  pid: number;
  /** Its parent, the line descendants are walked along. */
  ppid: number;
  pgrp: number;
  /** When the process started (`stat` field 22, in clock ticks since boot):
   * with the pid, it names one process even after the pid is reused. */
  startTime: string;
  /** The exec it is tagged with; absent when untagged, or while its
   * environment cannot be read. */
  execId?: string;
}

/** The parent, process group and start time of a `/proc/<pid>/stat` line:
 * the fourth, fifth and twenty-second field, read after the command name,
 * which may itself hold spaces and parentheses. */
function parseStat(
  stat: string,
): { ppid: number; pgrp: number; startTime: string } | null {
  const end = stat.lastIndexOf(')');
  if (end === -1) return null;
  // The fields after the command name start with the third, the state.
  const fields = stat.slice(end + 2).split(' ');
  const ppid = Number(fields[1]);
  const pgrp = Number(fields[2]);
  const startTime = fields[19];
  if (!Number.isInteger(ppid) || ppid < 0) return null;
  if (!Number.isInteger(pgrp) || pgrp <= 0) return null;
  if (startTime === undefined || !/^\d+$/.test(startTime)) return null;
  return { ppid, pgrp, startTime };
}

/** A read that did not come back within its scan, until it does. */
interface StalledRead {
  /** The process's start time, when its `stat` was read: a new process under
   * the same pid is read again. Absent when even the `stat` read stalled. */
  startTime?: string;
}

/** Per process table: the pids whose read is still out. */
const stalledByRoot = new Map<string, Map<number, StalledRead>>();
/** The environment reads out now, by process: scans that run at once share
 * one, so a stuck process holds one thread of the pool, not one per scan. */
const environReads = new Map<string, Promise<string>>();
let readsInFlight = 0;

/** How many reads of the process table have not come back. Each holds one
 * thread of libuv's pool, which `process.exit` waits for. */
export function pendingProcReads(): number {
  return readsInFlight;
}

function tracked<T>(read: Promise<T>): Promise<T> {
  readsInFlight += 1;
  return read.finally(() => {
    readsInFlight -= 1;
  });
}

/** Every readable process, each with the exec it is tagged with, or null
 * when there is no process table here (a development host that is not
 * Linux). Async: a read of another process's environment can wait on that
 * process's memory lock, which must never stall this daemon's only event
 * loop. Answers with what it read once the deadline passes. Without
 * `withTags`, only `stat` is read: no process's memory lock is taken. */
async function readProcessTable(
  deps: ReaperDeps,
  withTags = true,
): Promise<ProcessEntry[] | null> {
  const deadlineMs = deps.scanDeadlineMs ?? SCAN_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'cut'>((resolve) => {
    timer = setTimeout(() => resolve('cut'), deadlineMs);
  });
  try {
    return await scanProcessTable(deps, withTags, deadline, deadlineMs);
  } finally {
    clearTimeout(timer);
  }
}

async function scanProcessTable(
  deps: ReaperDeps,
  withTags: boolean,
  deadline: Promise<'cut'>,
  deadlineMs: number,
): Promise<ProcessEntry[] | null> {
  const root = deps.procRoot ?? '/proc';
  const selfPid = deps.selfPid ?? process.pid;
  let entries: string[];
  try {
    const list = deps.listDir ?? ((dir: string) => readdir(dir));
    const listing = await Promise.race([tracked(list(root)), deadline]);
    if (listing === 'cut') {
      console.warn(`[runnerd] listing ${root} took over ${deadlineMs} ms`);
      return [];
    }
    entries = listing;
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') {
      console.warn('[runnerd] cannot read the process table:', err);
    }
    return null;
  }
  let stalled = stalledByRoot.get(root);
  if (stalled === undefined) {
    stalled = new Map();
    stalledByRoot.set(root, stalled);
  }
  const prefix = `${EXEC_TAG_ENV}=`;
  const listed = new Set<number>();
  const found: ProcessEntry[] = [];
  // The reads still out, with what each has learned so far.
  const unsettled = new Map<number, StalledRead>();
  // The marks this scan left, so a read that comes back late clears its own.
  const marks = new Map<number, StalledRead>();
  const readOne = async (name: string, known: Map<number, StalledRead>) => {
    if (!/^\d+$/.test(name)) return;
    const pid = Number(name);
    if (pid <= 1 || pid === selfPid) return;
    listed.add(pid);
    const mark = known.get(pid);
    if (mark !== undefined && mark.startTime === undefined) return;
    unsettled.set(pid, {});
    try {
      let stat: string;
      try {
        stat = await tracked(readFile(`${root}/${name}/stat`, 'latin1'));
      } catch (err) {
        // A process that exited between the listing and the read, or one
        // another user owns, is not an exec's to end.
        if (!VANISHED.has(errorCode(err) ?? '')) {
          console.warn(`[runnerd] cannot read process ${pid}:`, err);
        }
        return;
      }
      const parsed = parseStat(stat);
      if (parsed === null) return;
      const entry: ProcessEntry = { pid, ...parsed };
      found.push(entry);
      if (!withTags) {
        return;
      }
      if (mark !== undefined) {
        if (mark.startTime === parsed.startTime) {
          // Its environment read has not come back: known by its group.
          return;
        }
        // The pid names a new process now.
        known.delete(pid);
      }
      unsettled.set(pid, { startTime: parsed.startTime });
      const key = `${root}/${name}@${parsed.startTime}`;
      let read = environReads.get(key);
      if (read === undefined) {
        read = tracked(readFile(`${root}/${name}/environ`, 'latin1')).finally(
          () => environReads.delete(key),
        );
        environReads.set(key, read);
      }
      let environ: string;
      try {
        environ = await read;
      } catch (err) {
        const code = errorCode(err) ?? '';
        if (!VANISHED.has(code)) {
          console.warn(`[runnerd] cannot read process ${pid}:`, err);
        }
        if (code !== 'EACCES' && code !== 'EPERM') {
          found.splice(found.indexOf(entry), 1);
        }
        // One whose environment is not ours to read still stands in its
        // parent's line: a shim's descendants are walked through it.
        return;
      }
      const tag = environ.split('\0').find((e) => e.startsWith(prefix));
      if (tag !== undefined) entry.execId = tag.slice(prefix.length);
    } finally {
      unsettled.delete(pid);
      const left = marks.get(pid);
      if (left !== undefined && known.get(pid) === left) known.delete(pid);
    }
  };
  const reads = Promise.all(entries.map((name) => readOne(name, stalled)));
  const cut = await Promise.race([
    reads.then(() => false),
    deadline.then(() => true),
  ]);
  for (const pid of stalled.keys()) {
    if (!listed.has(pid)) stalled.delete(pid);
  }
  if (cut) {
    for (const [pid, read] of unsettled) {
      marks.set(pid, read);
      stalled.set(pid, read);
    }
    console.warn(
      `[runnerd] process reads still out after ${deadlineMs} ms, skipped until they return: ${[...unsettled.keys()].join(', ')}`,
    );
  }
  // A copy: reads that come back later must not change this scan's answer.
  return found.map((entry) => Object.assign({}, entry));
}

/** The processes whose environment carries the tag of `execId`. */
export async function taggedPids(
  execId: string,
  deps: ReaperDeps = {},
): Promise<number[]> {
  const table = await readProcessTable(deps);
  return (table ?? [])
    .filter((proc) => proc.execId === execId)
    .map((proc) => proc.pid)
    .sort((a, b) => a - b);
}

/** The processes in `groupId` now, read from `stat` alone; empty without a
 * process table. Taken while the group is certainly the exec's, it lets a
 * later round prove the group still is. */
export async function groupMembers(
  groupId: number | undefined,
  deps: ReaperDeps = {},
): Promise<GroupMember[]> {
  if (groupId === undefined || groupId <= 1) return [];
  const table = await readProcessTable(deps, false);
  return (table ?? [])
    .filter((proc) => proc.pgrp === groupId)
    .map(({ pid, startTime }) => ({ pid, startTime }));
}

/** The members a target recorded, or none when recording them failed. */
async function recordedMembers(
  target: ReapTarget,
): Promise<readonly GroupMember[]> {
  if (target.members === undefined) return [];
  try {
    return await target.members;
  } catch (err) {
    console.warn(`[runnerd] no group record for exec ${target.execId}:`, err);
    return [];
  }
}

/** One set of indexes for the whole round. A session can keep many execs'
 * leftovers while another exec runs: rebuilding ancestry and matching tags
 * against the full table for each target makes every prune quadratic. */
function indexProcesses(table: readonly ProcessEntry[]) {
  return {
    byPid: new Map(table.map((proc) => [proc.pid, proc])),
    byExec: Map.groupBy(table, (proc) => proc.execId),
    byParent: Map.groupBy(table, (proc) => proc.ppid),
    byGroup: Map.groupBy(table, (proc) => proc.pgrp),
  };
}

type ProcessIndex = ReturnType<typeof indexProcesses>;

/** Whether a recorded member of the group is still in it. */
function memberStillIn(
  group: number,
  members: readonly GroupMember[],
  index: ProcessIndex,
): boolean {
  return members.some((member) => {
    const proc = index.byPid.get(member.pid);
    return proc?.pgrp === group && proc.startTime === member.startTime;
  });
}

const groupOf = ({ groupId }: ReapTarget): number | null =>
  groupId !== undefined && groupId > 1 ? groupId : null;

/** Whether a target's shim may be walked: it has one, and it still runs. */
function rootOf(target: ReapTarget): number | null {
  if (target.rootPid === undefined || target.rootPid <= 1) return null;
  return target.rootAlive?.() === false ? null : target.rootPid;
}

/** The descendants of `root` in the table, the root itself left out. */
function descendantsOf(root: number, index: ProcessIndex): ProcessEntry[] {
  const found: ProcessEntry[] = [];
  const queue = [root];
  const seen = new Set<number>([root]);
  // Array iteration visits appended descendants without shifting the rest
  // of a wide process tree once per node.
  for (const next of queue) {
    for (const child of index.byParent.get(next) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      found.push(child);
      queue.push(child.pid);
    }
  }
  return found;
}

/** A target's processes in the table: the ones tagged with the exec and
 * the descendants of its shim, each once. */
function processesOf(target: ReapTarget, index: ProcessIndex): ProcessEntry[] {
  if (target.rootComplete?.() === true) return [];
  const owned = new Map<number, ProcessEntry>();
  for (const proc of index.byExec.get(target.execId) ?? []) {
    owned.set(proc.pid, proc);
  }
  const root = rootOf(target);
  if (root !== null) {
    for (const proc of descendantsOf(root, index)) owned.set(proc.pid, proc);
  }
  owned.delete(root ?? -1);
  return [...owned.values()].filter(
    (proc) => target.groupOnly !== true || proc.pgrp === groupOf(target),
  );
}

/** Whether every target is found by its shim: the scan then reads `stat`
 * alone and takes no process's memory lock. */
function rootsSuffice(targets: readonly ReapTarget[]): boolean {
  return targets.every(
    (target) => target.rootComplete?.() === true || rootOf(target) !== null,
  );
}

/** Per target, whether any of its processes is left: one tagged with the
 * exec, or a recorded member still in its group. Null when there is no
 * process table here. */
export async function processesLeft(
  targets: readonly ReapTarget[],
  deps: ReaperDeps = {},
): Promise<boolean[] | null> {
  if (targets.every((target) => target.rootComplete?.() === true)) {
    return targets.map(() => false);
  }
  const [table, recorded] = await Promise.all([
    readProcessTable(deps, !rootsSuffice(targets)),
    Promise.all(targets.map(recordedMembers)),
  ]);
  if (table === null) return null;
  const indexed = indexProcesses(table);
  return targets.map((target, index) => {
    if (target.rootComplete?.() === true) return false;
    if (processesOf(target, indexed).length > 0) return true;
    const group = groupOf(target);
    return (
      group !== null && memberStillIn(group, recorded[index] ?? [], indexed)
    );
  });
}

/** Send `signal` to `target` (a negative pid: a process group); true when
 * it was delivered. A target already gone is skipped quietly. */
function deliver(
  deps: ReaperDeps,
  target: number,
  signal: NodeJS.Signals,
  label: string,
): boolean {
  const kill = deps.kill ?? ((pid, sig) => process.kill(pid, sig));
  try {
    kill(target, signal);
    return true;
  } catch (err) {
    if (errorCode(err) !== 'ESRCH') {
      console.warn(`[runnerd] ${signal} to ${label} failed:`, err);
    }
    return false;
  }
}

/** Signal an exec's process group, and nothing else, without reading the
 * process table: for a group certainly the exec's (its leader still runs).
 * True when the signal was delivered. */
export function signalGroup(
  groupId: number | undefined,
  signal: NodeJS.Signals,
  deps: ReaperDeps = {},
): boolean {
  if (groupId === undefined || groupId <= 1) return false;
  return deliver(deps, -groupId, signal, `pgroup ${groupId}`);
}

/** What a round did. */
export interface RoundResult {
  /** How many signals were delivered. */
  reached: number;
  /** Per target, in order: the processes of its group the round saw while
   * it counted the group as the exec's — empty when it did not, or without
   * a process table. */
  members: GroupMember[][];
}

/**
 * Signal what the targets left running: each process once. A target's
 * group is signalled when it is certainly still the exec's (`groupKnown`, at
 * once, before the table is read; or while a process tagged with the exec,
 * or a recorded member, is still in it), and every tagged process outside
 * its group on its own. Without a process table only the group can be
 * signalled.
 */
export async function signalExecProcesses(
  targets: readonly ReapTarget[],
  signal: NodeJS.Signals,
  deps: ReaperDeps = {},
): Promise<RoundResult> {
  if (targets.length === 0) return { reached: 0, members: [] };
  if (targets.every((target) => target.rootComplete?.() === true)) {
    return { reached: 0, members: targets.map(() => []) };
  }
  let reached = 0;
  const send = (target: number, label: string) => {
    if (deliver(deps, target, signal, label)) reached += 1;
  };
  // Negative pid: the whole process group. Sent before the scan, which can
  // wait on a stuck process for as long as its deadline.
  const groupSent = targets.map((target) => {
    if (target.rootComplete?.() === true) return false;
    const group = groupOf(target);
    if (group === null || target.groupKnown !== true) return false;
    send(-group, `pgroup ${group}`);
    return true;
  });
  const [table, recorded] = await Promise.all([
    readProcessTable(deps, !rootsSuffice(targets)),
    Promise.all(targets.map(recordedMembers)),
  ]);
  const indexed = table === null ? null : indexProcesses(table);
  const members = targets.map((target, index) => {
    if (target.rootComplete?.() === true) return [];
    const group = groupOf(target);
    const owned = indexed === null ? [] : processesOf(target, indexed);
    let groupReached = groupSent[index] === true;
    if (
      !groupReached &&
      group !== null &&
      (indexed === null
        ? target.groupOnly !== true
        : owned.some((proc) => proc.pgrp === group) ||
          memberStillIn(group, recorded[index] ?? [], indexed))
    ) {
      send(-group, `pgroup ${group}`);
      groupReached = true;
    }
    for (const proc of owned) {
      if (groupReached && proc.pgrp === group) continue;
      send(proc.pid, `pid ${proc.pid}`);
    }
    if (!groupReached || group === null || indexed === null) return [];
    return (indexed.byGroup.get(group) ?? []).map(({ pid, startTime }) => ({
      pid,
      startTime,
    }));
  });
  return { reached, members };
}
