import type { ToolCallOptions, ToolCallRequest } from './tools';

/**
 * One round's tool calls, supervised.
 *
 * A round's calls run together. Left alone they bind nothing: any number of
 * them, each as slow as it likes, with nothing writing the turn's heartbeat
 * while they run — so the reply's generation row went stale and was swept as
 * dead under a batch that kept working, Stop reached nothing, and a model (or
 * a document steering it) could hold a sandbox for as long as it kept asking.
 *
 * The batch binds three things. At most {@link MAX_TOOL_CALLS_PER_ROUND}
 * distinct calls run; the rest answer that they did not. While the calls run,
 * the batch writes the turn's heartbeat and reads its Stop every few seconds
 * through the host's `poll`, so the row stays alive and Stop is heard. And
 * the whole round has {@link TOOL_BATCH_MAX_MS}: when a Stop, that time or the
 * turn's own end arrives, every call is told through its signal, given
 * {@link TOOL_BATCH_GRACE_MS} to wrap up, and answers for itself or — one that
 * does not listen — with the reason it was left behind. Every call is paired
 * with a result either way: both wire dialects reject a transcript whose
 * call has none.
 *
 * Layer A: pure — the host brings the execution, the poll and the signal.
 */

/** The most distinct calls one round runs. A round is breadth, not volume:
 * reading several documents at once, making a few files. */
export const MAX_TOOL_CALLS_PER_ROUND = 16;

/** The longest a round's tools may run. One code run takes up to three
 * minutes beside the time to start its sandbox and collect its files, so a
 * round of one fits well and a round of several slow ones does not. */
export const TOOL_BATCH_MAX_MS = 5 * 60_000;

/** How long calls that were told to stop may take to say so. */
export const TOOL_BATCH_GRACE_MS = 15_000;

/** How often a running batch writes the turn's heartbeat and reads its Stop —
 * far inside the minutes the generation watchdog tolerates. */
export const TOOL_BATCH_POLL_MS = 10_000;

/** The result of a call beyond the round's limit. Correctable, like every
 * `invalid_args` answer: the model makes fewer calls, or asks again next round. */
export const TOOL_CALL_OVER_LIMIT_OUTPUT = {
  status: 'invalid_args',
  message: `Too many tool calls in one step (at most ${MAX_TOOL_CALLS_PER_ROUND} run); this call did not run. Make fewer calls per step, or ask again in the next one.`,
} as const;

/** The result of a call the round's time ran out on. */
export const TOOL_CALL_TIMED_OUT_OUTPUT = {
  status: 'error',
  message: `This tool did not finish in the ${TOOL_BATCH_MAX_MS / 60_000} minutes one step may take and was stopped. Do not repeat the same call: answer with what you have, or try something smaller.`,
} as const;

/** The result of a call that was running when the reply was stopped. */
export const TOOL_CALL_INTERRUPTED_OUTPUT = {
  status: 'cancelled',
  message: 'The reply was stopped while this tool ran.',
} as const;

/** The result of a call whose tool failed in a way it should have answered. */
const TOOL_CALL_BROKE_OUTPUT = {
  status: 'error',
  message: 'The tool failed unexpectedly. Tell the user.',
} as const;

export interface ToolBatchLimits {
  readonly maxCalls: number;
  readonly maxMs: number;
  readonly graceMs: number;
  readonly pollMs: number;
}

export interface ToolBatchResult {
  /** One answer per call, in the order the model made them. */
  readonly outputs: unknown[];
  /** The poll reported a Stop while the calls ran: the reply is stopped, whatever
   * the row's flag says by the time the turn reads it again. */
  readonly stopped: boolean;
}

export interface ToolBatchArgs {
  readonly calls: readonly ToolCallRequest[];
  /** Run one call. The host's own guard: it answers, it does not throw. */
  readonly execute: (
    call: ToolCallRequest,
    options: ToolCallOptions,
  ) => Promise<unknown>;
  /** The turn's own signal: a worker stopping, a run's time limit. */
  readonly signal?: AbortSignal | undefined;
  /** Write the turn's heartbeat and read its Stop; true when it was stopped. */
  readonly poll: () => Promise<boolean>;
  readonly limits?: Partial<ToolBatchLimits>;
}

/** Order-insensitive spelling of one call's arguments, for the same-round
 * dedup key: object keys sorted at every depth, so two spellings of the same
 * arguments compare equal. An undefined input keys like null — both read as
 * "no arguments". */
function canonicalArgs(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value) ?? null);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortKeysDeep(entry)]),
    );
  }
  return value;
}

interface Execution {
  settled: boolean;
  output: unknown;
  done: Promise<void>;
}

/**
 * Run a round's calls and answer each, in the order the model made them
 * (`outputs`), and say whether a Stop was heard meanwhile (`stopped`).
 *
 * The model sometimes asks the same question twice in one round, and an
 * identical (name, arguments) pair cannot answer differently — one execution
 * serves every duplicate. Every call still gets its own result, duplicates
 * sharing the one output. A call that failed to parse keys on its raw text:
 * two broken calls are only "the same" when they broke identically.
 */
export async function runToolBatch(
  args: ToolBatchArgs,
): Promise<ToolBatchResult> {
  const limits: ToolBatchLimits = {
    maxCalls: MAX_TOOL_CALLS_PER_ROUND,
    maxMs: TOOL_BATCH_MAX_MS,
    graceMs: TOOL_BATCH_GRACE_MS,
    pollMs: TOOL_BATCH_POLL_MS,
    ...args.limits,
  };
  const stop = new AbortController();
  const signal =
    args.signal === undefined
      ? stop.signal
      : AbortSignal.any([args.signal, stop.signal]);

  const start = (call: ToolCallRequest): Execution => {
    // A turn that already ended starts nothing: its calls are answered as
    // interrupted, the record still pairing each with a result.
    if (signal.aborted) {
      return {
        settled: true,
        output: TOOL_CALL_INTERRUPTED_OUTPUT,
        done: Promise.resolve(),
      };
    }
    const execution: Execution = {
      settled: false,
      output: undefined,
      done: Promise.resolve(),
    };
    execution.done = args.execute(call, { signal }).then(
      (output) => {
        execution.output = output;
        execution.settled = true;
      },
      (error: unknown) => {
        console.warn(
          `[chat] tool ${call.name} broke its never-throws contract: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        execution.output = TOOL_CALL_BROKE_OUTPUT;
        execution.settled = true;
      },
    );
    return execution;
  };

  const byKey = new Map<string, Execution>();
  let running = 0;
  const placed = args.calls.map((call): Execution => {
    const key = `${call.name}\0${call.rawInput ?? canonicalArgs(call.input)}`;
    const known = byKey.get(key);
    if (known !== undefined) return known;
    const execution: Execution =
      running >= limits.maxCalls
        ? {
            settled: true,
            output: TOOL_CALL_OVER_LIMIT_OUTPUT,
            done: Promise.resolve(),
          }
        : start(call);
    if (!execution.settled) running += 1;
    byKey.set(key, execution);
    return execution;
  });

  const finished = Promise.all(placed.map((execution) => execution.done));
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const sleep = (ms: number): Promise<'tick'> =>
    new Promise((resolve) => {
      timers.add(setTimeout(() => resolve('tick'), ms));
    });
  const ended = new Promise<'ended'>((resolve) => {
    if (signal.aborted) resolve('ended');
    else
      signal.addEventListener('abort', () => resolve('ended'), { once: true });
  });

  const startedAt = Date.now();
  let reason: 'stopped' | 'timed-out' | 'ended' | null = null;
  try {
    for (;;) {
      const left = Math.max(0, limits.maxMs - (Date.now() - startedAt));
      const winner = await Promise.race([
        finished.then(() => 'done' as const),
        ended,
        sleep(Math.min(limits.pollMs, left)),
      ]);
      if (winner === 'done') break;
      if (winner === 'ended') {
        reason = 'ended';
        break;
      }
      try {
        if (await args.poll()) {
          reason = 'stopped';
          break;
        }
      } catch (error) {
        // The heartbeat is best effort: a failed write is the next tick's to
        // repair, and the batch must not die over its own bookkeeping.
        console.warn(
          `[chat] tool batch poll failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
      if (Date.now() - startedAt >= limits.maxMs) {
        reason = 'timed-out';
        break;
      }
    }
    if (reason !== null) {
      stop.abort();
      // Calls that listen answer for themselves within the grace; the others
      // are left running and answered for below.
      await Promise.race([finished, sleep(limits.graceMs)]);
    }
  } finally {
    for (const timer of timers) clearTimeout(timer);
  }

  return {
    outputs: placed.map((execution) => {
      if (execution.settled) return execution.output;
      return reason === 'timed-out'
        ? TOOL_CALL_TIMED_OUT_OUTPUT
        : TOOL_CALL_INTERRUPTED_OUTPUT;
    }),
    stopped: reason === 'stopped',
  };
}
