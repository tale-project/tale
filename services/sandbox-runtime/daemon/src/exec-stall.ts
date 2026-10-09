// The stall watch: ends a session exec that has gone quiet AND idle. An agent
// CLI that hangs — waiting on a socket that never answers, a tool blocked on
// input nobody sends — would otherwise hold its session, its memory and one of
// the session's live-exec places for as long as its drainer keeps attaching,
// and every attach re-arms the orphan deadline. Either sign alone is ordinary:
// a build prints nothing for minutes while it computes, a dev server idles for
// hours and prints a line per request. Together — no output event for the
// whole stall window, and under 1% of one CPU used for the exec over that same
// window — they are what a hang looks like.
//
// CPU is read per exec from /proc, not from the session's cgroup: every exec
// of a session shares one cgroup with this daemon, the other execs and the
// inner Docker daemon, so the cgroup's cpu.stat would let a busy sibling hide
// a hung exec. A process's `stat` carries its own CPU time and the time of
// the children it waited for (utime, stime, cutime, cstime). The exec's
// processes are its subreaper shim and the shim's descendants — the shim
// reaps what they leave, so the time of an ended process stays counted — or,
// without the shim, the exec's process group and what descends from it. Only
// `stat` is read, never `environ`, whose read takes the process's memory
// lock.
//
// One exception is counted for every exec: the containers of the session's
// inner Docker engine. What an exec runs there (`docker run`, `docker compose
// up`) is a child of the engine, not of the exec, and a client that waits for
// a container computing in silence must not read as idle — so the CPU the
// engine's container cgroup used counts as work of each live exec. Where the
// process table cannot be read (no /proc, a scan past its deadline), nothing
// is judged: an exec is never ended on CPU it could not account.

import { readdir, readFile } from 'node:fs/promises';

import { tracked } from './process-reaper.ts';

/** The stall window when `TALE_EXEC_STALL_MS` is unset. */
export const DEFAULT_EXEC_STALL_MS = 45 * 60_000;
/** The share of one CPU an exec must stay under, over the whole window. */
export const STALL_CPU_SHARE = 0.01;
/** The longest pause between two samples of the process table. */
const MAX_SAMPLE_MS = 60_000;
/** How long one scan of the process table may take before its sample is
 * dropped. */
const SCAN_DEADLINE_MS = 5_000;
/** `stat`'s CPU times are in clock ticks (USER_HZ), which Linux fixes at 100
 * per second on every architecture Node runs on. */
const CLOCK_TICKS_PER_SECOND = 100;
/** Microseconds per clock tick, to fold a cgroup's `usage_usec` into ticks. */
const USEC_PER_TICK = 1_000_000 / CLOCK_TICKS_PER_SECOND;
/** The cgroup the session's inner Docker engine creates its containers
 * under: the entrypoint delegates the controllers so dockerd's cgroupfs
 * driver builds its `/docker` tree below the session's root. */
const ENGINE_CGROUP = '/sys/fs/cgroup/docker';

/** The stall window `env` sets: `TALE_EXEC_STALL_MS` in milliseconds, 0 to
 * switch the watch off, {@link DEFAULT_EXEC_STALL_MS} when unset or not a
 * whole number of milliseconds. */
export function execStallMsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.TALE_EXEC_STALL_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_EXEC_STALL_MS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    console.warn(
      `[runnerd] TALE_EXEC_STALL_MS=${JSON.stringify(raw)} is not a whole number of milliseconds; using ${DEFAULT_EXEC_STALL_MS}`,
    );
    return DEFAULT_EXEC_STALL_MS;
  }
  return value;
}

/** Where an exec's processes are: its subreaper shim, or its process group. */
export interface StallTarget {
  rootPid?: number;
  groupId?: number;
}

/** One process as its `stat` describes it, with its CPU time so far. */
export interface ProcCpu {
  pid: number;
  ppid: number;
  pgrp: number;
  /** Start time in clock ticks since boot: with the pid, it names one
   * process even after the pid is reused. */
  startTime: string;
  /** utime + stime + cutime + cstime, in clock ticks. */
  ticks: number;
}

/** The fields of a `/proc/<pid>/stat` line this watch reads, or null. The
 * command name (field 2) may itself hold spaces and parentheses, so the
 * fields are counted from its closing parenthesis. */
export function parseStatCpu(pid: number, stat: string): ProcCpu | null {
  const end = stat.lastIndexOf(')');
  if (end === -1) return null;
  // Index 0 is field 3, the state.
  const fields = stat.slice(end + 2).split(' ');
  const ppid = Number(fields[1]);
  const pgrp = Number(fields[2]);
  const times = [fields[11], fields[12], fields[13], fields[14]].map(Number);
  const startTime = fields[19];
  if (!Number.isInteger(ppid) || ppid < 0) return null;
  if (!Number.isInteger(pgrp) || pgrp < 0) return null;
  if (times.some((time) => !Number.isFinite(time) || time < 0)) return null;
  if (startTime === undefined || !/^\d+$/.test(startTime)) return null;
  return {
    pid,
    ppid,
    pgrp,
    startTime,
    ticks: times.reduce((sum, time) => sum + time, 0),
  };
}

/** Errors that mean the process ended between the listing and the read. */
const GONE = new Set(['ENOENT', 'ESRCH']);

function errorCode(error: unknown): string | undefined {
  return error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** Every readable process with its CPU time, or null when there is no
 * process table here or the scan outlasted its deadline. */
export async function readProcCpu(
  procRoot = '/proc',
  deadlineMs = SCAN_DEADLINE_MS,
): Promise<ProcCpu[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), deadlineMs);
  });
  const scan = async (): Promise<ProcCpu[] | null> => {
    let names: string[];
    try {
      names = await tracked(readdir(procRoot));
    } catch (error) {
      if (errorCode(error) !== 'ENOENT')
        console.warn('[runnerd] stall watch cannot list processes:', error);
      return null;
    }
    const found = await Promise.all(
      names
        .filter((name) => /^\d+$/.test(name))
        .map(async (name) => {
          try {
            const stat = await tracked(
              readFile(`${procRoot}/${name}/stat`, 'latin1'),
            );
            return parseStatCpu(Number(name), stat);
          } catch (error) {
            // Gone between the listing and the read: nothing to count.
            if (!GONE.has(errorCode(error) ?? ''))
              console.warn(
                `[runnerd] stall watch cannot read process ${name}:`,
                error,
              );
            return null;
          }
        }),
    );
    return found.filter((proc): proc is ProcCpu => proc !== null);
  };
  try {
    const table = await Promise.race([scan(), deadline]);
    if (table !== 'late') return table;
    console.warn(
      `[runnerd] stall watch: the process table could not be read within ${deadlineMs} ms; no sample this round`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The CPU time, in microseconds, the inner Docker engine's containers have
 * used (`usage_usec` of the cgroup they run under), or null while there is
 * no such cgroup: no inner engine, or one that has not started. */
export async function readEngineCpuUsec(
  cgroup = ENGINE_CGROUP,
): Promise<number | null> {
  let stat: string;
  try {
    stat = await tracked(readFile(`${cgroup}/cpu.stat`, 'latin1'));
  } catch (error) {
    if (errorCode(error) !== 'ENOENT')
      console.warn('[runnerd] stall watch cannot read the engine CPU:', error);
    return null;
  }
  const line = /^usage_usec (\d+)$/m.exec(stat);
  return line?.[1] === undefined ? null : Number(line[1]);
}

/** The processes of one exec in the table: its shim and the shim's
 * descendants, or its group's processes and their descendants. */
export function processesOfTarget(
  table: readonly ProcCpu[],
  target: StallTarget,
): ProcCpu[] {
  const byParent = Map.groupBy(table, (proc) => proc.ppid);
  const owned = new Map<number, ProcCpu>();
  const queue: ProcCpu[] = [];
  const add = (proc: ProcCpu) => {
    if (owned.has(proc.pid)) return;
    owned.set(proc.pid, proc);
    queue.push(proc);
  };
  if (target.rootPid !== undefined && target.rootPid > 1) {
    const root = table.find((proc) => proc.pid === target.rootPid);
    if (root !== undefined) add(root);
  }
  if (owned.size === 0 && target.groupId !== undefined && target.groupId > 1) {
    for (const proc of table) if (proc.pgrp === target.groupId) add(proc);
  }
  for (const next of queue) {
    for (const child of byParent.get(next.pid) ?? []) add(child);
  }
  return [...owned.values()];
}

/** One reading of an exec's CPU counter. */
export interface CpuSample {
  at: number;
  /** Clock ticks counted for the exec since it was first sampled. Only
   * grows. */
  ticks: number;
}

/**
 * Whether an exec stalled by `now`: no output since `stallMs` ago, and its
 * CPU over the window — from the newest sample at or before the window's
 * start to the newest sample — under {@link STALL_CPU_SHARE} of the time
 * between them. Without a sample that old, the window has not been watched
 * whole, and nothing is judged.
 */
export function isStalled(args: {
  samples: readonly CpuSample[];
  lastOutputAt: number;
  now: number;
  stallMs: number;
}): boolean {
  const { samples, lastOutputAt, now, stallMs } = args;
  if (stallMs <= 0 || now - lastOutputAt < stallMs) return false;
  const windowStart = now - stallMs;
  let base: CpuSample | undefined;
  for (const sample of samples) {
    if (sample.at > windowStart) break;
    base = sample;
  }
  const latest = samples.at(-1);
  if (base === undefined || latest === undefined || latest === base)
    return false;
  const spanMs = latest.at - base.at;
  const usedMs = ((latest.ticks - base.ticks) * 1000) / CLOCK_TICKS_PER_SECOND;
  return usedMs < STALL_CPU_SHARE * spanMs;
}

interface Watched {
  target: () => StallTarget;
  lastOutputAt: number;
  /** The CPU time each process had at the last sample, so a process's time
   * is counted once however long it runs. */
  seen: Map<number, { startTime: string; ticks: number }>;
  ticks: number;
  samples: CpuSample[];
}

export interface StallWatchOptions {
  /** How often the process table is sampled; a tenth of the window, between
   * one second and a minute, unless set. */
  sampleMs?: number;
  now?: () => number;
  /** Reads the process table; {@link readProcCpu} on `/proc` unless set. */
  readTable?: () => Promise<readonly ProcCpu[] | null>;
  /** Reads the inner engine's container CPU; {@link readEngineCpuUsec}
   * unless set. */
  readEngineUsec?: () => Promise<number | null>;
}

/** Watches the live execs of a session and calls `onStall` once for each
 * that stalls ({@link isStalled}); the caller ends it. */
export class StallWatch {
  private readonly watched = new Map<string, Watched>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private sampling = false;
  /** The engine's container CPU at the last sample, while it has one. */
  private engineUsec: number | null = null;
  private readonly sampleMs: number;
  private readonly now: () => number;
  private readonly readTable: () => Promise<readonly ProcCpu[] | null>;
  private readonly readEngineUsec: () => Promise<number | null>;

  constructor(
    private readonly stallMs: number,
    private readonly onStall: (execId: string) => void,
    options: StallWatchOptions = {},
  ) {
    this.sampleMs =
      options.sampleMs ??
      Math.min(MAX_SAMPLE_MS, Math.max(1_000, Math.floor(stallMs / 10)));
    this.now = options.now ?? Date.now;
    this.readTable = options.readTable ?? (() => readProcCpu());
    this.readEngineUsec = options.readEngineUsec ?? (() => readEngineCpuUsec());
  }

  /** The stall window, 0 when the watch is off. */
  get windowMs(): number {
    return this.stallMs;
  }

  /** Start watching an exec that has just started. */
  watch(execId: string, target: () => StallTarget): void {
    if (this.stallMs <= 0) return;
    this.watched.set(execId, {
      target,
      lastOutputAt: this.now(),
      seen: new Map(),
      ticks: 0,
      samples: [],
    });
    if (this.timer === undefined) {
      this.timer = setInterval(() => {
        void this.sample().catch((error: unknown) => {
          console.warn('[runnerd] stall watch sample failed:', error);
        });
      }, this.sampleMs);
      this.timer.unref();
    }
  }

  /** The exec published output: its quiet clock starts again. */
  output(execId: string): void {
    const watched = this.watched.get(execId);
    if (watched !== undefined) watched.lastOutputAt = this.now();
  }

  /** The exec ended. */
  unwatch(execId: string): void {
    this.watched.delete(execId);
    if (this.watched.size === 0 && this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.engineUsec = null;
    }
  }

  /** One round: read the table once, add each exec's CPU since the last
   * round to its counter, and end the ones that stalled. */
  async sample(): Promise<void> {
    if (this.sampling || this.watched.size === 0) return;
    this.sampling = true;
    const stalled: string[] = [];
    try {
      const [table, engineUsec] = await Promise.all([
        this.readTable(),
        this.readEngineUsec(),
      ]);
      if (table === null) return;
      // What the engine's containers used since the last round is work of
      // every exec live now; the first reading only sets the base.
      const engineTicks =
        engineUsec !== null && this.engineUsec !== null
          ? Math.max(0, engineUsec - this.engineUsec) / USEC_PER_TICK
          : 0;
      this.engineUsec = engineUsec;
      const now = this.now();
      for (const [execId, watched] of this.watched) {
        const seen = new Map<number, { startTime: string; ticks: number }>();
        watched.ticks += engineTicks;
        for (const proc of processesOfTarget(table, watched.target())) {
          const before = watched.seen.get(proc.pid);
          // A process first seen counts whole: what it used before this
          // round can only make the exec look busier, never idle.
          watched.ticks +=
            before?.startTime === proc.startTime
              ? Math.max(0, proc.ticks - before.ticks)
              : proc.ticks;
          seen.set(proc.pid, { startTime: proc.startTime, ticks: proc.ticks });
        }
        watched.seen = seen;
        watched.samples.push({ at: now, ticks: watched.ticks });
        // Keep the newest sample at or before the window's start, and every
        // one after it.
        while (
          watched.samples.length > 1 &&
          (watched.samples[1]?.at ?? Infinity) <= now - this.stallMs
        )
          watched.samples.shift();
        if (
          isStalled({
            samples: watched.samples,
            lastOutputAt: watched.lastOutputAt,
            now,
            stallMs: this.stallMs,
          })
        )
          stalled.push(execId);
      }
    } finally {
      this.sampling = false;
    }
    for (const execId of stalled) {
      // Once per exec: its end is the caller's from here.
      this.unwatch(execId);
      this.onStall(execId);
    }
  }

  /** Stop sampling; the daemon is going down. */
  [Symbol.dispose](): void {
    this.watched.clear();
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
