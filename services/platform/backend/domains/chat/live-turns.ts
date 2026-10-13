import type { Sql } from 'postgres';

import { settleInterruptedThread } from './watchdogs.ts';

/**
 * The chat turns this process is running right now, so that a process that is
 * stopping can settle them itself.
 *
 * A chat turn lives in the process that took it: the app's own in the api
 * process, inside the request that sent it; a REST client's in a worker, as a
 * job. When that process stops, the turn ends with it — and the only thing
 * that settled it was the generation sweep (`watchdogs.ts`), ten minutes
 * after its heartbeat stopped. A rolling deploy therefore left every reply
 * still streaming at that moment spinning for ten minutes, then failed. A
 * stopping process now gives its turns the rest of its drain window to
 * finish, and settles the ones still running as interrupted before it
 * closes its database pools — the same terminal state the sweep writes, at
 * once, so the person sees it and can send again.
 *
 * A process that is killed cannot run any of this: the sweep stays the
 * recovery for a hard kill, an out-of-memory exit or a lost host.
 */

interface LiveTurn {
  readonly organizationId: string;
  readonly threadId: string;
  /** The turn's assistant placeholder: the generation row names it, so a
   * settle deletes this turn's row and never a successor's. */
  readonly messageId: string;
}

/** By thread: the generation row's key makes it at most one turn a thread. */
const live = new Map<string, LiveTurn>();
const idleWaiters = new Set<() => void>();

/** A turn has opened its generation row in this process. */
export function trackLiveTurn(turn: LiveTurn): void {
  live.set(turn.threadId, turn);
}

/** A turn has ended — settled, failed or cut — in this process. */
export function untrackLiveTurn(threadId: string): void {
  live.delete(threadId);
  if (live.size === 0) {
    for (const wake of idleWaiters) wake();
    idleWaiters.clear();
  }
}

/** How many turns this process is running. */
export function liveTurnCount(): number {
  return live.size;
}

/** Resolves when no turn is live, or after `timeoutMs`. */
function untilIdle(timeoutMs: number): Promise<void> {
  if (live.size === 0 || timeoutMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      idleWaiters.delete(wake);
      resolve();
    }, timeoutMs);
    const wake = (): void => {
      clearTimeout(timer);
      resolve();
    };
    idleWaiters.add(wake);
  });
}

/** Turns settled at the same time. */
const SETTLE_CONCURRENCY = 8;
/** The most a stopping process spends settling its turns, once the wait is
 * over: its container's stop grace leaves it a few seconds past the drain
 * budget, and a database that is away makes each turn wait for its own
 * connection to fail. */
const SETTLE_BUDGET_MS = 5_000;

/**
 * Let this process's turns finish for up to `timeoutMs`, then settle the ones
 * still running as interrupted. Answers how many it interrupted. Each is
 * settled on its own, several at a time, and a failure is logged, never
 * thrown: the process is stopping, and the sweep will find whatever a dead
 * database kept from this. The settling itself stops after `settleBudgetMs`
 * (five seconds by default), leaving the rest to the sweep.
 */
export async function settleLiveChatTurns(
  sql: Sql,
  timeoutMs: number,
  options: { settleBudgetMs?: number } = {},
): Promise<number> {
  await untilIdle(timeoutMs);
  const pending = [...live.values()];
  const total = pending.length;
  let finished = 0;
  let interrupted = 0;
  const budget = { expired: false };
  const settleOne = async (turn: LiveTurn): Promise<void> => {
    try {
      // One transaction per turn: a database that fails between the delete
      // and the settle leaves the generation row in place for the sweep,
      // rather than a turn with no row that nothing would ever settle.
      const settled = await sql.begin(async (tx) => {
        // The row is the turn's proof of life: gone means it ended on its own
        // between the wait and now, and there is nothing left to settle.
        const cleared = await tx<{ threadId: string }[]>`
          DELETE FROM app.generations
          WHERE thread_id = ${turn.threadId} AND org_id = ${turn.organizationId}
            AND message_id = ${turn.messageId}
          RETURNING thread_id AS "threadId"
        `;
        if (cleared.length === 0) return false;
        await settleInterruptedThread(tx, turn.threadId);
        return true;
      });
      if (settled) interrupted += 1;
    } catch (error) {
      console.warn(
        `[chat] could not settle the interrupted turn of thread ${turn.threadId}:`,
        error instanceof Error ? error.message : error,
      );
    }
    finished += 1;
  };
  const settleAll = async (): Promise<void> => {
    const runners = Array.from(
      { length: Math.min(SETTLE_CONCURRENCY, total) },
      async () => {
        for (
          let turn = pending.shift();
          turn !== undefined && !budget.expired;
          turn = pending.shift()
        ) {
          // A turn that ended while the others were being settled is done.
          if (!live.has(turn.threadId)) {
            finished += 1;
            continue;
          }
          await settleOne(turn);
        }
      },
    );
    await Promise.all(runners);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budgetEnded = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      budget.expired = true;
      resolve();
    }, options.settleBudgetMs ?? SETTLE_BUDGET_MS);
  });
  await Promise.race([settleAll(), budgetEnded]);
  clearTimeout(timer);
  if (budget.expired && finished < total) {
    console.warn(
      `[chat] ${total - finished} interrupted turn(s) left to the generation sweep: the shutdown budget ran out`,
    );
  }
  return interrupted;
}
