/** Native pg-boss completion evidence. Only this lane's throwaway queue and
 * owned jobs are touched; the production trigger scan stays unscheduled by
 * the integration harness. The reader is the actual telemetry query. */
import { randomUUID } from 'node:crypto';

import type { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { readSuccessfulScanCompletion } from '../telemetry.ts';
import { startWorker } from './runner.ts';
import type { BackendTaskList } from './task-list.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

export async function checkTaskCompletionEvidence(
  sql: Sql,
  boss: PgBoss,
  record: Recorder,
): Promise<void> {
  const queue = `itest.scan_completion_${randomUUID().slice(0, 8)}`;
  const input = z.object({
    kind: z.enum(['success', 'failure', 'cancel', 'expire']),
  });
  let draining = true;
  let expiredSignal = false;
  const taskList: BackendTaskList = {
    [queue]: async (payload, context) => {
      const { kind } = input.parse(payload);
      if (kind === 'failure') throw new Error('isolated scan failure');
      if (kind === 'cancel') {
        if (!context?.jobId) throw new Error('claim identity missing');
        await boss.cancel(queue, context.jobId);
      }
      if (kind === 'expire') {
        // pg-boss's real one-second budget aborts the attempt, even when a
        // handler returns a result after that signal. Bound the fixture too.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expiredSignal = context?.signal.aborted === true;
      }
      return { output: { triggerScanCompleted: true } };
    },
  };
  const start = () =>
    startWorker({
      boss,
      taskList,
      concurrency: 1,
      sql,
      shouldDefer: async () => draining,
    });
  const rows = () => sql<
    { id: string; state: string; marker: boolean | null }[]
  >`
    SELECT id, state::text AS state,
           output -> 'triggerScanCompleted' = 'true'::jsonb AS marker
    FROM pgboss.job WHERE name = ${queue}
  `;
  async function settled(id: string | null): Promise<boolean> {
    if (id === null) return false;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const row = (await rows()).find((entry) => entry.id === id);
      if (row && ['completed', 'cancelled', 'failed'].includes(row.state))
        return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }
  try {
    await boss.createQueue(queue, { retryLimit: 0, expireInSeconds: 1 });
    await start();
    const handedOver = await boss.send(queue, { kind: 'success' });
    const handedOverSettled = await settled(handedOver);
    // The drain transaction committed its delayed successor before the
    // original's completed row is visible. Cancel only this lane's successor.
    const successors = (await rows()).filter((row) => row.state === 'created');
    if (successors.length)
      await boss.cancel(
        queue,
        successors.map((row) => row.id),
      );
    record(
      'scan evidence: a completed drain handover is not an executed scan',
      handedOverSettled &&
        successors.length === 1 &&
        (await readSuccessfulScanCompletion(sql, queue)) === 0 &&
        (await rows()).every((row) => row.marker !== true),
      'native handover completed, queued successor cancelled; no successful marker',
    );
    draining = false;
    for (const kind of ['failure', 'cancel', 'expire'] as const) {
      const id = await boss.send(queue, { kind });
      const ended = await settled(id);
      // Expiry is acknowledged before the late handler returns; observe that
      // return too before testing that it cannot change the stored evidence.
      if (kind === 'expire')
        await new Promise((resolve) => setTimeout(resolve, 700));
      record(
        `scan evidence: ${kind} cannot certify successful execution`,
        ended &&
          (kind !== 'expire' || expiredSignal) &&
          (await readSuccessfulScanCompletion(sql, queue)) === 0 &&
          (await rows()).every((row) => row.marker !== true),
        `settled=${ended}, expired signal=${expiredSignal}`,
      );
    }
    const first = await boss.send(queue, { kind: 'success' });
    const firstSettled = await settled(first);
    const before = await readSuccessfulScanCompletion(sql, queue);
    await boss.offWork(queue, { wait: true });
    await start();
    const afterRestart = await readSuccessfulScanCompletion(sql, queue);
    const failure = await boss.send(queue, { kind: 'failure' });
    const failureSettled = await settled(failure);
    const afterFailure = await readSuccessfulScanCompletion(sql, queue);
    const recovery = await boss.send(queue, { kind: 'success' });
    const recoverySettled = await settled(recovery);
    const recovered = await readSuccessfulScanCompletion(sql, queue);
    record(
      'scan evidence: successful completion survives worker restart, failure cannot refresh it, and actual recovery advances it',
      firstSettled &&
        failureSettled &&
        recoverySettled &&
        before > 0 &&
        afterRestart === before &&
        afterFailure === before &&
        recovered > before,
      `first=${before}, restarted=${afterRestart}, failed=${afterFailure}, recovered=${recovered}`,
    );
  } finally {
    await boss.offWork(queue, { wait: true });
    await boss.deleteQueue(queue);
  }
}
