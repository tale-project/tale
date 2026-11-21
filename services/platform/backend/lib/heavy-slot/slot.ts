/**
 * The heavy slot: where this process does the work whose memory follows the
 * size of a file — reading a document's text, converting a recording.
 *
 * Two promises, which the rest of the backend relies on:
 *
 *  - **One at a time.** A process runs `HEAVY_SLOTS` such jobs at once (one
 *    by default), whatever the job queues' own concurrency. Five files
 *    indexed together used to cost five files' worth of memory at the same
 *    moment; now the others wait their turn, and the work each does after
 *    its turn — the embedding calls, the writes — overlaps as before.
 *  - **In a process of its own, under a cap.** Each job runs in a child
 *    process that is started for it and gone when it ends. The supervisor
 *    samples what the child holds four times a second and kills it above
 *    `HEAVY_SLOT_MEMORY_MB`; the job fails with {@link HeavyLimitError},
 *    which names the limit and the setting that raises it. The process
 *    that serves requests keeps its size, and a file that would have taken
 *    it down takes down the child alone (tale-project/tale#4942).
 *
 * What it is not: a sandbox. The child runs as the same user on the same
 * filesystem. It is given no secrets (see {@link childEnvironment}) and
 * no network work, and that is all.
 */

import {
  type ChildProcess,
  fork,
  type Serializable,
  spawn,
} from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

import {
  MEMORY_LIMIT_SETTING,
  memoryLimitSentence,
} from '../../../lib/shared/memory-limit.ts';
import { BUILT } from '../layout.ts';
import { readCountedMemory } from './memory.ts';

/** The variable that caps one heavy job's memory, in MiB. A job that goes
 * over fails with an error that names it. */
export const HEAVY_SLOT_MEMORY_VARIABLE = MEMORY_LIMIT_SETTING;

export const DEFAULT_HEAVY_SLOTS = 1;
/** Room for any ordinary file. `tale deploy` sets a small host's own value
 * for the one process it starts there. */
export const DEFAULT_HEAVY_SLOT_MEMORY_MB = 512;

export interface HeavySlotSettings {
  /** Heavy jobs this process runs at once. */
  readonly slots: number;
  /** The most memory one of them may hold, in MiB. */
  readonly memoryMb: number;
}

let settings: HeavySlotSettings = {
  slots: DEFAULT_HEAVY_SLOTS,
  memoryMb: DEFAULT_HEAVY_SLOT_MEMORY_MB,
};

/** Set the slot from the environment, once, at boot (`main.ts`). */
export function configureHeavySlot(next: Partial<HeavySlotSettings>): void {
  settings = { ...settings, ...next };
}

export function heavySlotSettings(): HeavySlotSettings {
  return settings;
}

let inline = false;

/**
 * Do a document's work in this process instead of a child: for a suite that
 * tests what is made of a document, and not the process it is made in. The
 * work is the same code either way (`operations.ts`), and still waits its
 * turn for a slot. The server suites run this way (`tests/setup-server.ts`);
 * the suites of this directory start real children.
 */
export function runHeavySlotInline(on: boolean): void {
  inline = on;
}

export function heavySlotInline(): boolean {
  return inline;
}

/**
 * Who waits ahead of whom. `interactive` is work a person is waiting on now:
 * the read a message waits for, a document a chat turn fetched. `background`
 * is everything a queue works through. A job a person waits for goes first,
 * and not always: of every five turns one is a queued job's, when one waits
 * ({@link INTERACTIVE_RUN}).
 */
export type HeavyPriority = 'interactive' | 'background';

/**
 * A heavy job needed more memory than this process gives one. Its message
 * names the limit and the setting that raises it, in the words every lane
 * stores for it (`lib/shared/memory-limit.ts`): a surface that shows the
 * failure reads the limit back out of them.
 */
export class HeavyLimitError extends Error {
  /** What a lane that sorts failures by code sorts this one by. */
  readonly code = 'HEAVY_SLOT_MEMORY_LIMIT';
  /** The cap it went over, in MiB. */
  readonly limitMb: number;

  constructor(limitMb: number) {
    super(memoryLimitSentence(limitMb));
    this.name = 'HeavyLimitError';
    this.limitMb = limitMb;
  }
}

// ----------------------------------------------------------------- the queue

type Release = () => void;

interface Waiter {
  readonly grant: (release: Release) => void;
}

const waiting: Record<HeavyPriority, Waiter[]> = {
  interactive: [],
  background: [],
};
let running = 0;

/**
 * How many jobs a person waits for go in a row past a queued job that is
 * waiting. Every upload is read for whoever uploaded it, so while uploads
 * keep coming there is always such a job in line: going first every time,
 * they held a document's index back until its own job gave up on it. After
 * this many, the queued job that has waited longest takes a turn.
 */
const INTERACTIVE_RUN = 4;
let wentPast = 0;

/** Who is next in line, taken out of it. */
function nextInLine(): Waiter | undefined {
  const queued = waiting.background.length > 0;
  if (
    waiting.interactive.length > 0 &&
    !(queued && wentPast >= INTERACTIVE_RUN)
  ) {
    wentPast = queued ? wentPast + 1 : 0;
    return waiting.interactive.shift();
  }
  wentPast = 0;
  return waiting.background.shift();
}

function releaser(): Release {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = nextInLine();
    if (next === undefined) running -= 1;
    // The slot passes straight to the next in line: `running` stays.
    else next.grant(releaser());
  };
}

function acquire(
  priority: HeavyPriority,
  signal: AbortSignal | undefined,
): Promise<Release> {
  return new Promise<Release>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    if (running < settings.slots) {
      running += 1;
      resolve(releaser());
      return;
    }
    const queue = waiting[priority];
    const waiter: Waiter = {
      grant: (release) => {
        signal?.removeEventListener('abort', giveUp);
        resolve(release);
      },
    };
    const giveUp = (): void => {
      const at = queue.indexOf(waiter);
      if (at !== -1) queue.splice(at, 1);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', giveUp, { once: true });
    queue.push(waiter);
  });
}

/** How many jobs hold a slot, and how many wait for one. */
export function heavySlotLoad(): { running: number; waiting: number } {
  return {
    running,
    waiting: waiting.interactive.length + waiting.background.length,
  };
}

/**
 * Run `work` while holding a slot. It waits its turn first, behind the jobs
 * already waiting at its priority; an `interactive` job goes ahead of the
 * `background` ones, which take every fifth turn while both wait. A caller
 * that gives up while waiting (`signal`) leaves the line with its signal's
 * reason.
 */
export async function withHeavySlot<T>(
  options: { priority: HeavyPriority; signal?: AbortSignal },
  work: () => Promise<T>,
): Promise<T> {
  const release = await acquire(options.priority, options.signal);
  try {
    return await work();
  } finally {
    release();
  }
}

// ------------------------------------------------------------- the watchdog

/** How often the supervisor reads what the child holds: the rate the memory
 * benchmark samples a container at, so a peak the one sees the other does. */
const WATCH_INTERVAL_MS = 250;
/**
 * How often it reads once the child holds half its cap, and how soon it
 * reads first. A child fills memory far faster than four readings a second
 * can follow: at this rate one that is on its way over the cap is stopped a
 * few megabytes past it, not a few hundred.
 */
const WATCH_CLOSELY_MS = 25;
/** How much of a dead child's stderr is kept for its death notice. */
const STDERR_TAIL_BYTES = 4096;
const MIB = 1024 * 1024;

/**
 * V8's and Node's own words for memory that ran out: `Reached heap limit
 * Allocation failed - JavaScript heap out of memory` and its kin. `FATAL
 * ERROR` alone says nothing of memory: Node opens every fatal error with it.
 */
const HEAP_EXHAUSTED = /heap out of memory|process out of memory/;

interface ChildOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderrTail: string;
  /** True when the supervisor killed it for holding more than the cap. */
  readonly overCap: boolean;
  /** True when the supervisor killed it, for any reason of its own. */
  readonly killed: boolean;
  /** The most it was seen to hold, in bytes; 0 where that cannot be read. */
  readonly peakBytes: number;
}

export interface SuperviseOptions {
  readonly memoryMb: number;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  /** What the job is, for the error of one that ran out of time. */
  readonly label: string;
  /** Reads a process's counted memory; the tests put a fake here. */
  readonly readMemory?: (pid: number) => number | null;
  readonly watchIntervalMs?: number;
}

/**
 * Watch a started child until it is gone: kill it above the cap, when its
 * caller gives up, and when it outlives its time. Resolves with how it
 * ended; rejects with the caller's reason, or with the timeout.
 */
function supervise(
  child: ChildProcess,
  options: SuperviseOptions,
): Promise<ChildOutcome> {
  const readMemory = options.readMemory ?? readCountedMemory;
  const capBytes = options.memoryMb * MIB;
  return new Promise<ChildOutcome>((resolve, reject) => {
    let stderrTail = '';
    let overCap = false;
    let killed = false;
    let peakBytes = 0;
    let stopped: unknown;

    const kill = (): void => {
      if (child.exitCode === null && child.signalCode === null) {
        killed = true;
        child.kill('SIGKILL');
      }
    };
    if (child.pid !== undefined) preferToTheOthers(child.pid);
    const unhurried = options.watchIntervalMs ?? WATCH_INTERVAL_MS;
    const closely = Math.min(unhurried, WATCH_CLOSELY_MS);
    let watch: NodeJS.Timeout;
    const look = (): void => {
      let next = unhurried;
      const held = child.pid === undefined ? null : readMemory(child.pid);
      if (held !== null) {
        if (held > peakBytes) peakBytes = held;
        if (held > capBytes) {
          overCap = true;
          kill();
          return;
        }
        if (held > capBytes / 2) next = closely;
      }
      watch = setTimeout(look, next);
    };
    watch = setTimeout(look, closely);
    const deadline = setTimeout(() => {
      // "Timed out", in the words a lane sorts a failure by.
      stopped = new Error(
        `${options.label} timed out: it took longer than the ${Math.ceil(options.timeoutMs / 1000)} s it is given`,
      );
      kill();
    }, options.timeoutMs);
    const onAbort = (): void => {
      stopped = options.signal?.reason ?? new Error('aborted');
      kill();
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrTail = (stderrTail + String(chunk)).slice(-STDERR_TAIL_BYTES);
    });
    let finished = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(watch);
      clearTimeout(deadline);
      options.signal?.removeEventListener('abort', onAbort);
      if (stopped !== undefined) {
        reject(stopped);
        return;
      }
      resolve({ code, signal, stderrTail, overCap, killed, peakBytes });
    };
    child.once('error', (error) => {
      stopped ??= new Error(
        `${options.label} could not start: ${error.message}`,
        { cause: error },
      );
      finish(null, null);
    });
    // 'close', not 'exit': stderr has drained, so the tail holds V8's last
    // words when there were any.
    child.once('close', finish);
  });
}

/**
 * Whether a dead child ran out of memory: killed above the cap, stopped by
 * V8 at its heap limit, which is set from the same cap, or killed by
 * somebody else. Nothing but the system kills a child out of hand, and the
 * system does it for want of memory: the container's limit, or the host's.
 * The same file would meet the same end on every retry.
 */
function ranOutOfMemory(outcome: ChildOutcome): boolean {
  return (
    outcome.overCap ||
    HEAP_EXHAUSTED.test(outcome.stderrTail) ||
    (outcome.signal === 'SIGKILL' && !outcome.killed)
  );
}

let preferenceRefused = false;

/**
 * Tell the system that, should it have to stop a process for want of
 * memory, this child is the one to stop: it reads one file, which then
 * fails with the limit, where the database or this process would take the
 * deployment with it. Linux only, and best effort: a system that does not
 * let the score be set says so once.
 */
function preferToTheOthers(pid: number): void {
  if (process.platform !== 'linux') return;
  writeFile(`/proc/${pid}/oom_score_adj`, '1000').catch((error: unknown) => {
    // The child may be gone already; anything else is worth one line.
    if (isRecord(error) && error.code === 'ENOENT') return;
    if (preferenceRefused) return;
    preferenceRefused = true;
    console.warn(
      `[heavy-slot] could not mark a child as the first to stop when memory runs out: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

/**
 * The error of a job that was stopped at its cap, said once in the log for
 * whoever runs the deployment: what was being done, the cap, and the
 * variable that raises it. The person who uploaded the file reads the same
 * on the file.
 */
function stoppedAtCap(
  label: string,
  memoryMb: number,
  outcome: ChildOutcome,
): HeavyLimitError {
  const held =
    outcome.peakBytes > 0
      ? `, holding ${Math.round(outcome.peakBytes / MIB)} MiB when last seen`
      : '';
  console.warn(
    `[heavy-slot] ${label} needed more than the ${memoryMb} MiB one file is given and was stopped${held}; ${MEMORY_LIMIT_SETTING} raises the limit`,
  );
  return new HeavyLimitError(memoryMb);
}

/**
 * The error of a job whose child said, before it tried, that the document
 * would not fit under the cap: the same error as for a job that was
 * stopped, and the same line in the log.
 */
export function refusedAtCap(
  label: string,
  memoryMb: number = settings.memoryMb,
): HeavyLimitError {
  console.warn(
    `[heavy-slot] ${label} needs more than the ${memoryMb} MiB one file is given and was not attempted; ${MEMORY_LIMIT_SETTING} raises the limit`,
  );
  return new HeavyLimitError(memoryMb);
}

/** Where V8's report of a heap that ran out begins: thirty lines of its
 * collections and its native stack, which say nothing this process does not
 * say in one ({@link stoppedAtCap}). */
const HEAP_REPORT_START = '<--- Last few GCs --->';

function describeDeath(outcome: ChildOutcome): string {
  const how = outcome.signal ?? `exit code ${String(outcome.code)}`;
  const last = outcome.stderrTail.trim().split('\n').at(-1) ?? '';
  return last === '' ? how : `${how}: ${last}`;
}

// ------------------------------------------------------- the child programs

/**
 * What a child inherits of this process's environment: enough to find its
 * program and its dates, and the directory the PII patterns are read from.
 * No credential reaches a process whose job is to read a stranger's file.
 */
const CHILD_ENV_KEYS = [
  'PATH',
  'TZ',
  'LANG',
  'LC_ALL',
  'TALE_CONFIG_SYSTEM_DIR',
  'DEBUG_KNOWLEDGE',
] as const;

/**
 * How many memory arenas the C library gives a child's threads, unless this
 * process was started with a number of its own. A reader's buffers are
 * allocated on one thread and freed on another; with an arena for each,
 * what one freed is no use to the next, and a child holds memory it does
 * not use under a cap that counts it.
 */
const CHILD_MALLOC_ARENAS = '2';

export function childEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {
    MALLOC_ARENA_MAX: env.MALLOC_ARENA_MAX ?? CHILD_MALLOC_ARENAS,
  };
  for (const key of CHILD_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * The V8 flags a node child starts with, from its cap. The heap may take
 * three fifths of the cap: the rest is for what a reader keeps outside the
 * heap (a zip's inflated bytes, a PDF's loaded ranges). A small young
 * generation and an exposed collector let a small cap be honoured by
 * collecting, where V8 would otherwise grow first.
 */
export function childHeapFlags(memoryMb: number): string[] {
  return [
    `--max-old-space-size=${Math.max(32, Math.floor(memoryMb * 0.6))}`,
    `--max-semi-space-size=${memoryMb <= 256 ? 1 : 8}`,
    '--expose-gc',
  ];
}

/** Under Bun the V8 flags mean nothing and TypeScript runs as it is. */
const UNDER_BUN = 'bun' in process.versions;

/** What makes node run the backend's TypeScript sources: the flags the
 * backend itself starts with from a checkout (`docker-entrypoint.sh`). */
function sourceFlags(): string[] {
  if (BUILT || UNDER_BUN) return [];
  return [
    '--experimental-transform-types',
    '--disable-warning=ExperimentalWarning',
    '--import',
    fileURLToPath(new URL('../../node-loader.mjs', import.meta.url)),
  ];
}

export interface RunOptions {
  readonly signal?: AbortSignal;
  /** How long the job may run; fifteen minutes unless said. */
  readonly timeoutMs?: number;
  /** What the job is, for its errors. */
  readonly label: string;
  /** The cap, where it is not the configured one (the tests). */
  readonly memoryMb?: number;
  readonly readMemory?: (pid: number) => number | null;
  readonly watchIntervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/**
 * Run one node program as a capped child and answer what it sends back.
 *
 * The program says `{ ready: true }` once it can take its request, receives
 * `request`, and answers with one message, after which it exits. A child
 * that dies without an answer fails the job: with {@link HeavyLimitError}
 * when it ran out of memory, and with how it died otherwise.
 *
 * The caller holds a slot (`withHeavySlot`); this function does not wait
 * for one.
 */
export async function runNodeChild(
  programUrl: URL,
  request: Serializable,
  options: RunOptions,
): Promise<unknown> {
  const memoryMb = options.memoryMb ?? settings.memoryMb;
  const child = fork(fileURLToPath(programUrl), [], {
    execArgv: UNDER_BUN ? [] : [...childHeapFlags(memoryMb), ...sourceFlags()],
    env: childEnvironment(),
    // What the child logs is this process's log: its stdout is this one's,
    // and its stderr is passed on below, where its end is also kept for
    // the notice of a child that died.
    stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
    serialization: 'json',
  });
  let heapReport = false;
  child.stderr?.on('data', (chunk: Buffer) => {
    if (heapReport) return;
    const reportAt = chunk.indexOf(HEAP_REPORT_START);
    if (reportAt === -1) {
      process.stderr.write(chunk);
      return;
    }
    heapReport = true;
    if (reportAt > 0) process.stderr.write(chunk.subarray(0, reportAt));
  });
  // The stderr pipe is a net.Socket at runtime; typed as a Readable.
  if (child.stderr instanceof Socket) child.stderr.unref();

  let answered = false;
  let answer: unknown;
  child.on('message', (message: unknown) => {
    if (isRecord(message) && message.ready === true) {
      child.send(request, (error) => {
        if (error !== null) {
          console.warn(
            `[heavy-slot] ${options.label}: the request could not be delivered:`,
            error.message,
          );
        }
      });
      return;
    }
    if (answered) return;
    answered = true;
    answer = message;
    // It exits by itself once the answer is flushed; this is for a child
    // that does not.
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }, 2_000).unref();
  });

  const outcome = await supervise(child, {
    memoryMb,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    label: options.label,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.readMemory !== undefined
      ? { readMemory: options.readMemory }
      : {}),
    ...(options.watchIntervalMs !== undefined
      ? { watchIntervalMs: options.watchIntervalMs }
      : {}),
  });
  if (answered) return answer;
  if (ranOutOfMemory(outcome)) {
    throw stoppedAtCap(options.label, memoryMb, outcome);
  }
  throw new Error(
    `${options.label} stopped before it answered (${describeDeath(outcome)})`,
  );
}

/**
 * Run one command (ffmpeg, say) as a capped child and answer its output. A
 * command that exits with anything but 0 throws with the end of its stderr;
 * one killed above the cap throws {@link HeavyLimitError}.
 *
 * The caller holds a slot (`withHeavySlot`).
 */
export async function runCommand(
  command: string,
  args: readonly string[],
  options: RunOptions,
): Promise<{ stdout: string; stderr: string }> {
  const memoryMb = options.memoryMb ?? settings.memoryMb;
  const child = spawn(command, [...args], {
    // As for a node child: a program that reads a stranger's file is handed
    // none of this process's secrets.
    env: childEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const outcome = await supervise(child, {
    memoryMb,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    label: options.label,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.readMemory !== undefined
      ? { readMemory: options.readMemory }
      : {}),
    ...(options.watchIntervalMs !== undefined
      ? { watchIntervalMs: options.watchIntervalMs }
      : {}),
  });
  if (outcome.overCap || (outcome.signal === 'SIGKILL' && !outcome.killed)) {
    throw stoppedAtCap(options.label, memoryMb, outcome);
  }
  if (outcome.code !== 0) {
    throw new Error(
      `${command} exited ${outcome.signal ?? String(outcome.code)}; stderr tail: ${stderr.slice(-400)}`,
    );
  }
  return { stdout, stderr };
}
