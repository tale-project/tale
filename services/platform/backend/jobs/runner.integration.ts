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
 * - a worker that is not draining runs the job and queues nothing.
 *
 * Throwaway queues of this lane, worked by a worker of this lane alone and
 * deleted with their jobs at the end: no real queue and no other lane's job
 * is touched. */
import { randomUUID } from 'node:crypto';

import type { PgBoss } from 'pg-boss';
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
}

const WAIT_MS = 20_000;

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
             extract(epoch FROM start_after - created_on)::float8 AS delay
      FROM pgboss.job WHERE name = ${queue}
      ORDER BY created_on, id
    `;
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
        `${row.state}:${row.key ?? '∅'}:${row.seq ?? '?'}:p${row.priority}:+${Math.round(row.delay)}s`,
    );

  try {
    await boss.createQueue(queues.short, { policy: 'short' });
    await boss.createQueue(queues.standard, { policy: 'standard' });
    await boss.createQueue(queues.exclusive, { policy: 'exclusive' });
    await boss.createQueue(queues.live, { policy: 'short' });
    const runs = (queue: string) => async (payload: unknown) => {
      ran.push(`${queue}:${JSON.stringify(payload)}`);
    };
    await startWorker({
      boss,
      concurrency: 5,
      taskList: {
        [queues.short]: runs(queues.short),
        [queues.standard]: runs(queues.standard),
        [queues.exclusive]: runs(queues.exclusive),
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
