import type { TransactionSql } from 'postgres';

import { addJobInTx } from '../../jobs/enqueue.ts';

/** How many pending handoffs one run's end asks for; the watchdog's sweep
 * (`sweepMentionHandoffs`) takes up any beyond. */
const MENTION_HANDOFFS_PER_RUN_END = 50;

/**
 * Asks for one pending handoff by mention to be looked at again
 * (`mention-handoffs.ts`): one waiting job per handoff (`singletonKey`), so
 * a burst of run ends asks once; the job re-decides everything under the
 * task's comment queue.
 */
export async function requestMentionHandoffInTx(
  tx: TransactionSql,
  args: { organizationId: string; taskId: string; handoffId: string },
): Promise<void> {
  await addJobInTx(
    tx,
    'task.mention_handoff',
    {
      organizationId: args.organizationId,
      taskId: args.taskId,
      handoffId: args.handoffId,
    },
    { singletonKey: `mention-handoff:${args.handoffId}` },
  );
}

/**
 * The handoffs a run's end may let start: the ones it wrote, the ones on
 * its task (it held that task), the ones naming its agent (it held a review
 * context of that agent) and the ones of its agent (an armed retry of the
 * writing run ends this way too). Each is asked for once; a handoff that
 * still has to wait stays, and the next run end or the task-agent watchdog
 * asks again. Pending handoffs are few (one per task and named agent, gone
 * once decided), so the read stays small.
 */
export async function enqueueMentionHandoffsForRunInTx(
  tx: TransactionSql,
  args: { organizationId: string; runId: string },
): Promise<void> {
  const handoffs = await tx<{ id: string; taskId: string }[]>`
    SELECT h.id, h.task_id AS "taskId"
    FROM app.project_agent_runs r
    JOIN app.task_mention_handoffs h ON h.org_id = r.org_id
      AND (h.author_run_id = r.id OR h.task_id = r.task_id
        OR h.agent_id = r.agent_id OR h.author_agent_id = r.agent_id)
    WHERE r.id = ${args.runId} AND r.org_id = ${args.organizationId}
    ORDER BY h.created_at_ms
    LIMIT ${MENTION_HANDOFFS_PER_RUN_END}
  `;
  for (const handoff of handoffs) {
    await requestMentionHandoffInTx(tx, {
      organizationId: args.organizationId,
      taskId: handoff.taskId,
      handoffId: handoff.id,
    });
  }
}
