/** Real Postgres proof of the draining worker's hand-over (`jobs/runner.ts`,
 * `handOver`): the actual registered worker (`startWorker`) fetches through
 * pg-boss, and a draining colour hands every claim over to the live one — the
 * claim completed and its successor queued in ONE transaction, with the job's
 * own payload, singleton key and priority, five seconds out.
 *
 * - two distinct keyed jobs of a `short` queue (the policy of
 *   `task.agent_retry_recheck`), drained together, both keep a successor
 *   under their own key once both originals are acknowledged;
 * - a successor whose key finds a job already queued is not doubled — that
 *   job does the work — and a same-key duplicate collapses at its send;
 * - keyless jobs of a standard queue hand over keyless, one successor each;
 * - a job of an `exclusive` queue (one queued-or-active job per key, the
 *   policy of `sandbox.recreate_pinned`) hands over under its key: the claim
 *   ends first, inside the transaction, so it never refuses its own
 *   successor;
 * - the successor is sent only once the completion confirms the claim ended
 *   there: a claim cancelled between its fetch and its hand-over, or one
 *   completed elsewhere meanwhile, gets none (pg-boss completes active jobs
 *   only and answers `affected: 0`);
 * - a refused successor collapses only where a key admits one queued job —
 *   on a `stately` queue as on `short`, into the job already queued under
 *   the key; a refusal on a standard or an `exclusive` queue, or a
 *   completion that confirms nothing, rolls the hand-over back, so the claim
 *   takes pg-boss's failure path instead of ending without a successor
 *   (those answers are synthetic: a wrapped boss gives them, since pg-boss
 *   itself does not there);
 * - a worker that is not draining runs the job and queues nothing.
 *
 * Throwaway queues of this lane, worked by a worker of this lane alone and
 * deleted with their jobs at the end: no real queue and no other lane's job
 * is touched. */
import { randomUUID } from 'node:crypto';

import type { CompleteOptions, PgBoss, SendOptions } from 'pg-boss';
import type { Sql } from 'postgres';

import { startWorker } from './runner.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

interface JobRow {
  id: string;
  name: string;
  state: string;
  key: string | null;
  priority: number;
  seq: number | null;
  /** Seconds between its creation and its start. */
  delay: number;
  /** A failed job's reason, as the worker reported it. */
  message: string | null;
}

const WAIT_MS = 20_000;
/** How long a successor the hand-over must not send gets to show up once
 * the hand-over's completion answered: that send would follow at once, in
 * the same transaction. */
const SETTLE_MS = 3_000;

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = WAIT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return predicate();
}

export async function checkWorkerDrainHandOff(
  sql: Sql,
  boss: PgBoss,
  record: Recorder,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const queues = {
    short: `itest.drain_short_${suffix}`,
    standard: `itest.drain_standard_${suffix}`,
    exclusive: `itest.drain_exclusive_${suffix}`,
    stately: `itest.drain_stately_${suffix}`,
    guard: `itest.drain_guard_${suffix}`,
    guardExclusive: `itest.drain_guard_exclusive_${suffix}`,
    live: `itest.drain_live_${suffix}`,
  };
  const ran: string[] = [];
  let draining = true;
  /** Runs once, inside the worker's own drain decision — after its fetch
   * made the claim active, before the hand-over. */
  let beforeHandOver: (() => Promise<void>) | undefined;
  const jobsOf = (queue: string) =>
    sql<JobRow[]>`
      SELECT id, name, state::text AS state, singleton_key AS key, priority,
             (data ->> 'seq')::int AS seq,
             extract(epoch FROM start_after - created_on)::float8 AS delay,
             output ->> 'message' AS message
      FROM pgboss.job WHERE name = ${queue}
      ORDER BY created_on, id
    `;
  /** A hook for `beforeHandOver`: once the draining worker holds the claim
   * of `seq` (its fetch made it active), act on it — before the hand-over. */
  const whenClaimed = (
    queue: string,
    seq: number,
    act: (id: string) => Promise<unknown>,
  ) => {
    const hook = async (): Promise<void> => {
      const claimed = await sql<{ id: string }[]>`
        SELECT id FROM pgboss.job
        WHERE name = ${queue} AND state = 'active'
          AND (data ->> 'seq')::int = ${seq}
      `;
      const id = claimed[0]?.id;
      if (id === undefined) {
        beforeHandOver = hook;
        return;
      }
      await act(id);
    };
    return hook;
  };
  /** Every completion and send of a hand-over, as the worker saw them. */
  const seen: string[] = [];
  /** Queues whose next hand-over send is refused — a synthetic `null`, as
   * pg-boss answers a key conflict. */
  const refuseNextSend = new Set<string>();
  /** Queues whose next hand-over completion answers what the function makes
   * of pg-boss's real answer. */
  const reshapeNextCompletion = new Map<string, (answer: unknown) => unknown>();
  const shown = (value: unknown) =>
    value === undefined ? 'undefined' : JSON.stringify(value);
  /** The boss the worker is given: pg-boss itself, but for the scripted
   * answers above. */
  const scripted = new Proxy(boss, {
    get(target, property) {
      if (property === 'complete') {
        return async (
          name: string,
          id: string,
          data: object | null,
          options: CompleteOptions,
        ): Promise<unknown> => {
          const real: unknown = await target.complete(name, id, data, options);
          const reshape = reshapeNextCompletion.get(name);
          reshapeNextCompletion.delete(name);
          const answer = reshape === undefined ? real : reshape(real);
          seen.push(`complete:${name}:${id}:${shown(answer)}`);
          return answer;
        };
      }
      if (property === 'send') {
        return async (
          name: string,
          data: object | null,
          options: SendOptions,
        ): Promise<string | null> => {
          if (refuseNextSend.delete(name)) {
            seen.push(`send:${name}:refused`);
            return null;
          }
          const id = await target.send(name, data, options);
          seen.push(`send:${name}:${id ?? 'null'}`);
          return id;
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const seenFor = (id: string | null) =>
    seen.filter((line) => id !== null && line.includes(`:${id}:`));
  const ranOn = (queue: string) =>
    ran.filter((line) => line.startsWith(`${queue}:`)).length;
  /** Take a case's queued successors out of the way (`cancelled`), so the
   * draining worker does not hand them over again under the next case. */
  const settle = async (queue: string) => {
    const queued = (await jobsOf(queue)).filter(
      (row) => row.state === 'created' || row.state === 'retry',
    );
    if (queued.length > 0) {
      await boss.cancel(
        queue,
        queued.map((row) => row.id),
      );
    }
  };
  const describe = (rows: readonly JobRow[]) =>
    rows.map(
      (row) =>
        `${row.state}:${row.key ?? '∅'}:${row.seq ?? '?'}:p${row.priority}:+${Math.round(row.delay)}s${row.message === null ? '' : `:${row.message}`}`,
    );

  try {
    await boss.createQueue(queues.short, { policy: 'short' });
    await boss.createQueue(queues.standard, { policy: 'standard' });
    await boss.createQueue(queues.exclusive, { policy: 'exclusive' });
    await boss.createQueue(queues.stately, { policy: 'stately' });
    // No retries: a claim the hand-over does not end stays where pg-boss's
    // failure path puts it.
    await boss.createQueue(queues.guard, { policy: 'standard', retryLimit: 0 });
    await boss.createQueue(queues.guardExclusive, {
      policy: 'exclusive',
      retryLimit: 0,
    });
    await boss.createQueue(queues.live, { policy: 'short' });
    const runs = (queue: string) => async (payload: unknown) => {
      ran.push(`${queue}:${JSON.stringify(payload)}`);
    };
    await startWorker({
      boss: scripted,
      concurrency: 5,
      taskList: {
        [queues.short]: runs(queues.short),
        [queues.standard]: runs(queues.standard),
        [queues.exclusive]: runs(queues.exclusive),
        [queues.stately]: runs(queues.stately),
        [queues.guard]: runs(queues.guard),
        [queues.guardExclusive]: runs(queues.guardExclusive),
        [queues.live]: runs(queues.live),
      },
      shouldDefer: async () => {
        const hook = beforeHandOver;
        beforeHandOver = undefined;
        await hook?.();
        return draining;
      },
      sql,
    });

    // ---- two distinct keyed jobs of a short queue, drained together ----
    // One insert, so one notify: the worker takes both in one batch.
    await boss.insert(queues.short, [
      { data: { seq: 1 }, singletonKey: `a-${suffix}` },
      { data: { seq: 2 }, singletonKey: `b-${suffix}`, priority: 7 },
    ]);
    const handedOver = await waitFor(async () => {
      const rows = await jobsOf(queues.short);
      return (
        rows.filter((row) => row.state === 'completed').length === 2 &&
        rows.filter((row) => row.state === 'created').length === 2
      );
    });
    const pair = await jobsOf(queues.short);
    const successors = pair.filter((row) => row.state === 'created');
    record(
      'worker drain: two distinct keyed jobs of a short queue drained together both keep a successor — its own key, payload and priority, five seconds out — once both originals are acknowledged',
      handedOver &&
        pair.filter((row) => row.state === 'completed').length === 2 &&
        successors.length === 2 &&
        successors.some(
          (row) =>
            row.key === `a-${suffix}` && row.seq === 1 && row.priority === 0,
        ) &&
        successors.some(
          (row) =>
            row.key === `b-${suffix}` && row.seq === 2 && row.priority === 7,
        ) &&
        successors.every((row) => row.delay >= 4 && row.delay <= 6) &&
        ran.length === 0,
      `jobs=${JSON.stringify(describe(pair))} (want 2 completed originals and 2 created successors keyed a and b, +5s) handler runs=${ran.length} (want 0)`,
    );
    await settle(queues.short);

    // ---- a successor whose key is already queued; a same-key duplicate --
    const keyC = `c-${suffix}`;
    let queuedFirst: string | null = null;
    const queueFirst = async (): Promise<void> => {
      // Only for the claim of seq 3, once the fetch made it active: its key
      // is free then for one queued job, which takes it before the
      // hand-over's successor can.
      const claimed = await sql<{ id: string }[]>`
        SELECT id FROM pgboss.job
        WHERE name = ${queues.short} AND state = 'active'
          AND (data ->> 'seq')::int = 3
      `;
      if (claimed.length === 0) {
        beforeHandOver = queueFirst;
        return;
      }
      queuedFirst = await boss.send(
        queues.short,
        { seq: 30 },
        { singletonKey: keyC, startAfter: 3_600 },
      );
    };
    beforeHandOver = queueFirst;
    await boss.send(queues.short, { seq: 3 }, { singletonKey: keyC });
    const collapsed = await waitFor(async () => {
      const rows = await jobsOf(queues.short);
      return rows.some((row) => row.seq === 3 && row.state === 'completed');
    });
    const withC = (await jobsOf(queues.short)).filter(
      (row) => row.key === keyC,
    );
    // The drained claim's own successor, under any key: none, since the
    // job queued first under its key does the work.
    const extraSuccessors = (await jobsOf(queues.short)).filter(
      (row) => row.seq === 3 && row.state === 'created',
    );
    const dupFirst = await boss.send(
      queues.short,
      { seq: 5 },
      { singletonKey: `e-${suffix}`, startAfter: 3_600 },
    );
    const dupSecond = await boss.send(
      queues.short,
      { seq: 6 },
      { singletonKey: `e-${suffix}`, startAfter: 3_600 },
    );
    record(
      'worker drain: a hand-over whose key finds a job already queued adds no second one — that job does the work — and a same-key duplicate collapses at its send',
      collapsed &&
        queuedFirst !== null &&
        withC.length === 2 &&
        withC.filter((row) => row.state === 'completed').length === 1 &&
        withC.filter((row) => row.state === 'created').length === 1 &&
        withC.find((row) => row.state === 'created')?.seq === 30 &&
        extraSuccessors.length === 0 &&
        dupFirst !== null &&
        dupSecond === null,
      `jobs with key c=${JSON.stringify(describe(withC))} (want the drained original completed and only the job queued before its hand-over, seq 30) other successors of the drained claim=${JSON.stringify(describe(extraSuccessors))} (want none) duplicate send=${dupSecond === null ? 'dropped' : 'queued'} (want dropped)`,
    );
    await settle(queues.short);

    // ---- keyless jobs of a standard queue ------------------------------
    await boss.insert(queues.standard, [
      { data: { seq: 7 } },
      { data: { seq: 8 } },
    ]);
    const keyless = await waitFor(async () => {
      const rows = (await jobsOf(queues.standard)).filter(
        (row) => row.key === null,
      );
      return (
        rows.filter((row) => row.state === 'completed').length === 2 &&
        rows.filter((row) => row.state === 'created').length === 2
      );
    });
    const standardRows = (await jobsOf(queues.standard)).filter(
      (row) => row.key === null,
    );
    record(
      'worker drain: keyless jobs of a standard queue hand over keyless, one successor each, five seconds out',
      keyless &&
        standardRows
          .filter((row) => row.state === 'created')
          .map((row) => row.seq ?? 0)
          .sort((a, b) => a - b)
          .join(',') === '7,8' &&
        standardRows
          .filter((row) => row.state === 'created')
          .every((row) => row.delay >= 4 && row.delay <= 6),
      `keyless jobs=${JSON.stringify(describe(standardRows))} (want 2 completed, 2 created successors seq 7 and 8, +5s)`,
    );
    await settle(queues.standard);

    // ---- an exclusive queue's job ---------------------------------------
    await boss.send(
      queues.exclusive,
      { seq: 9 },
      { singletonKey: `x-${suffix}` },
    );
    const exclusive = await waitFor(async () => {
      const rows = await jobsOf(queues.exclusive);
      return (
        rows.some((row) => row.state === 'completed') &&
        rows.some((row) => row.state === 'created')
      );
    });
    const exclusiveRows = await jobsOf(queues.exclusive);
    record(
      'worker drain: a job of an exclusive queue hands over under its own key — the claim ends first, in the same transaction, so it never refuses its own successor',
      exclusive &&
        exclusiveRows.length === 2 &&
        exclusiveRows.some(
          (row) => row.state === 'completed' && row.key === `x-${suffix}`,
        ) &&
        exclusiveRows.some(
          (row) =>
            row.state === 'created' &&
            row.key === `x-${suffix}` &&
            row.seq === 9,
        ),
      `jobs=${JSON.stringify(describe(exclusiveRows))} (want the original completed and its successor created under key x)`,
    );
    await settle(queues.exclusive);

    // ---- a claim cancelled between its fetch and its hand-over ----------
    const sinceCancel = seen.length;
    beforeHandOver = whenClaimed(queues.short, 11, (id) =>
      boss.cancel(queues.short, id),
    );
    const cancelled = await boss.send(
      queues.short,
      { seq: 11 },
      { singletonKey: `k-${suffix}` },
    );
    const cancelAnswered = await waitFor(
      async () => seenFor(cancelled).length > 0,
    );
    const cancelSuccessor = await waitFor(
      async () =>
        (await jobsOf(queues.short)).some(
          (row) => row.seq === 11 && row.state === 'created',
        ),
      SETTLE_MS,
    );
    const cancelRows = (await jobsOf(queues.short)).filter(
      (row) => row.seq === 11,
    );
    record(
      'worker drain: a claim cancelled between its fetch and its hand-over gets no successor — the completion ends no active claim (affected 0), and the cancellation stands',
      cancelled !== null &&
        cancelAnswered &&
        !cancelSuccessor &&
        cancelRows.length === 1 &&
        cancelRows[0]?.state === 'cancelled' &&
        seenFor(cancelled).some((line) => line.includes('"affected":0')) &&
        !seen.slice(sinceCancel).some((line) => line.startsWith('send:')) &&
        ranOn(queues.short) === 0,
      `jobs=${JSON.stringify(describe(cancelRows))} hand-over=${JSON.stringify(seenFor(cancelled))} (want the original cancelled, its completion answering affected 0, and no successor)`,
    );
    await settle(queues.short);

    // ---- a claim completed elsewhere before its hand-over ---------------
    const sinceComplete = seen.length;
    beforeHandOver = whenClaimed(queues.short, 12, (id) =>
      boss.complete(queues.short, id),
    );
    const completedFirst = await boss.send(
      queues.short,
      { seq: 12 },
      { singletonKey: `m-${suffix}` },
    );
    const completeAnswered = await waitFor(
      async () => seenFor(completedFirst).length > 0,
    );
    const completeSuccessor = await waitFor(
      async () =>
        (await jobsOf(queues.short)).some(
          (row) => row.seq === 12 && row.state === 'created',
        ),
      SETTLE_MS,
    );
    const completedRows = (await jobsOf(queues.short)).filter(
      (row) => row.seq === 12,
    );
    record(
      'worker drain: a claim completed elsewhere before its hand-over gets no successor — its work is done, and the completion answers affected 0',
      completedFirst !== null &&
        completeAnswered &&
        !completeSuccessor &&
        completedRows.length === 1 &&
        completedRows[0]?.state === 'completed' &&
        seenFor(completedFirst).some((line) => line.includes('"affected":0')) &&
        !seen.slice(sinceComplete).some((line) => line.startsWith('send:')) &&
        ranOn(queues.short) === 0,
      `jobs=${JSON.stringify(describe(completedRows))} hand-over=${JSON.stringify(seenFor(completedFirst))} (want the original completed once, its completion answering affected 0, and no successor)`,
    );
    await settle(queues.short);

    // ---- a stately queue's refused successor collapses -------------------
    const keyS = `s-${suffix}`;
    let queuedUnderS: string | null = null;
    beforeHandOver = whenClaimed(queues.stately, 13, async () => {
      queuedUnderS = await boss.send(
        queues.stately,
        { seq: 130 },
        { singletonKey: keyS, startAfter: 3_600 },
      );
    });
    await boss.send(queues.stately, { seq: 13 }, { singletonKey: keyS });
    const statelyEnded = await waitFor(async () =>
      (await jobsOf(queues.stately)).some(
        (row) => row.seq === 13 && row.state === 'completed',
      ),
    );
    const withS = (await jobsOf(queues.stately)).filter(
      (row) => row.key === keyS,
    );
    record(
      'worker drain: on a stately queue a refused successor collapses into the job already queued under its key — the claim ends, and only that job stays queued',
      statelyEnded &&
        queuedUnderS !== null &&
        withS.length === 2 &&
        withS.some((row) => row.seq === 13 && row.state === 'completed') &&
        withS.some((row) => row.seq === 130 && row.state === 'created') &&
        seen.includes(`send:${queues.stately}:null`) &&
        ranOn(queues.stately) === 0,
      `jobs with key s=${JSON.stringify(describe(withS))} sends=${JSON.stringify(seen.filter((line) => line.startsWith(`send:${queues.stately}:`)))} (want the original completed, the send refused, and only the job queued first under the key)`,
    );
    await settle(queues.stately);

    // ---- refusals and an unconfirmed completion roll the hand-over back --
    // Synthetic: pg-boss refuses no successor on these queues, and always
    // counts a completion; the scripted boss answers what it would not.
    const rolledBack = async (
      queue: string,
      seq: number,
      options: SendOptions,
    ) => {
      const id = await boss.send(queue, { seq }, options);
      const ended = await waitFor(async () =>
        (await jobsOf(queue)).some(
          (row) =>
            row.seq === seq &&
            (row.state === 'failed' || row.state === 'completed'),
        ),
      );
      const rows = (await jobsOf(queue)).filter((row) => row.seq === seq);
      return { id, ended, rows, answers: seenFor(id) };
    };
    const failedOnce = (
      rows: readonly JobRow[],
      id: string | null,
      reason: string,
    ) =>
      rows.length === 1 &&
      rows[0]?.id === id &&
      rows[0].state === 'failed' &&
      (rows[0].message ?? '').includes(reason);

    refuseNextSend.add(queues.guard);
    const standardRefusal = await rolledBack(queues.guard, 14, {});
    record(
      'worker drain: a standard queue that refuses the successor (a synthetic null) rolls the hand-over back — the claim is not completed without one; it takes pg-boss’s failure path',
      standardRefusal.ended &&
        failedOnce(
          standardRefusal.rows,
          standardRefusal.id,
          'queued no successor',
        ) &&
        seen.includes(`send:${queues.guard}:refused`) &&
        ranOn(queues.guard) === 0,
      `jobs=${JSON.stringify(describe(standardRefusal.rows))} hand-over=${JSON.stringify(standardRefusal.answers)} (want the claim failed, not completed, with the refusal as its reason, and no successor)`,
    );

    refuseNextSend.add(queues.guardExclusive);
    const exclusiveRefusal = await rolledBack(queues.guardExclusive, 15, {
      singletonKey: `x2-${suffix}`,
    });
    record(
      'worker drain: an exclusive queue that refuses the successor (a synthetic null) rolls the hand-over back — the claim is not completed without one, and no job takes its key',
      exclusiveRefusal.ended &&
        failedOnce(
          exclusiveRefusal.rows,
          exclusiveRefusal.id,
          'queued no successor',
        ) &&
        seen.includes(`send:${queues.guardExclusive}:refused`) &&
        ranOn(queues.guardExclusive) === 0,
      `jobs=${JSON.stringify(describe(exclusiveRefusal.rows))} hand-over=${JSON.stringify(exclusiveRefusal.answers)} (want the claim failed, not completed, with the refusal as its reason, and no successor)`,
    );

    const sinceUnconfirmed = seen.length;
    reshapeNextCompletion.set(queues.guard, (real) =>
      typeof real === 'object' && real !== null
        ? { ...real, affected: 'unconfirmed' }
        : real,
    );
    const unconfirmed = await rolledBack(queues.guard, 16, {});
    record(
      'worker drain: a completion that confirms no claim (a synthetic answer) rolls the hand-over back — the real completion inside it is undone, no successor is sent, and the claim takes pg-boss’s failure path',
      unconfirmed.ended &&
        failedOnce(
          unconfirmed.rows,
          unconfirmed.id,
          'the completion confirmed no claim',
        ) &&
        !seen
          .slice(sinceUnconfirmed)
          .some((line) => line.startsWith('send:')) &&
        ranOn(queues.guard) === 0,
      `jobs=${JSON.stringify(describe(unconfirmed.rows))} hand-over=${JSON.stringify(unconfirmed.answers)} (want the claim failed, not completed, with the unconfirmed completion as its reason, and no successor)`,
    );

    // ---- a worker that is not draining ----------------------------------
    draining = false;
    await boss.send(queues.live, { seq: 10 }, { singletonKey: `l-${suffix}` });
    const processed = await waitFor(async () => {
      const rows = await jobsOf(queues.live);
      return rows.length === 1 && rows[0]?.state === 'completed';
    });
    const liveRows = await jobsOf(queues.live);
    record(
      'worker drain: a worker that is not draining runs the job itself and queues nothing',
      processed &&
        liveRows.length === 1 &&
        ran.some((line) => line.startsWith(`${queues.live}:`)),
      `jobs=${JSON.stringify(describe(liveRows))} handler runs=${JSON.stringify(ran.filter((line) => line.startsWith(`${queues.live}:`)))}`,
    );
  } finally {
    draining = false;
    for (const queue of Object.values(queues)) {
      await boss.offWork(queue, { wait: true }).catch((error: unknown) => {
        console.warn(`[itest] offWork ${queue} failed:`, error);
      });
      await boss.deleteQueue(queue).catch((error: unknown) => {
        console.warn(`[itest] deleteQueue ${queue} failed:`, error);
      });
    }
  }
}
