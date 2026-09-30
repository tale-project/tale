import type { TransactionSql } from 'postgres';

import { runStarterUserId } from '../../../lib/shared/run-starter.ts';
import {
  dismissAgentRunFailedNotifications,
  notifyAgentRunFailed,
} from '../collab/service.ts';
import { markAutoRetryRetired } from './kick-plan.ts';

/**
 * The bell for a project-agent run that failed for good.
 *
 * A failed run keeps its task at In progress — failure is the run's state,
 * not the task's — so nothing on the board moves when the agent gives up,
 * and the person who started it has usually left the task by then. The
 * doors that make a failure FINAL call {@link announceAgentRunFailed} in the
 * transaction that decides it: the failed mark of a failure no retry follows
 * (`failAgentRunFromTurn`), the watchdogs' fail (`failAgentRun`), and the
 * retry job when it will not start the retry after all
 * ({@link retireAutoRetry}). A failure an automatic retry picks up is
 * announced by none of them: the retry is the answer.
 *
 * The next start on the task withdraws the unread rows
 * ({@link withdrawAgentRunFailedNotices}, from `kickAgentRun`).
 */
export async function announceAgentRunFailed(
  tx: TransactionSql,
  args: { organizationId: string; runId: string },
): Promise<void> {
  const rows = await tx<
    {
      taskId: string;
      projectId: string;
      title: string;
      archived: boolean;
      agentId: string;
      startedBy: string;
      failureCode: string | null;
    }[]
  >`
    SELECT r.task_id AS "taskId", t.project_id AS "projectId", t.title,
           t.archived_at_ms IS NOT NULL AS archived,
           r.agent_id AS "agentId", r.started_by AS "startedBy",
           r.failure_code AS "failureCode"
    FROM app.project_agent_runs r
    JOIN app.tasks t ON t.id = r.task_id AND t.org_id = r.org_id
    WHERE r.id = ${args.runId} AND r.org_id = ${args.organizationId}
      AND r.status = 'failed'
    LIMIT 1
  `;
  const run = rows[0];
  // An archived task is nobody's open work: its run's end needs no bell.
  if (run === undefined || run.archived) return;
  await notifyAgentRunFailed(tx, {
    task: {
      id: run.taskId,
      organizationId: args.organizationId,
      projectId: run.projectId,
      title: run.title,
    },
    agentId: run.agentId,
    starterUserId: runStarterUserId(run.startedBy),
    failureCode: run.failureCode,
  });
}

/**
 * The retry job will not start a failed run's automatic retry: its budget is
 * spent, the agent is gone, the starter may no longer work the task, or the
 * task's automated starts are paused. The run is marked retired, so every
 * later delivery of the retry stands down and the run card reads the failure
 * as final — without the mark the card kept reading "about to be retried"
 * for a retry nothing would start. The first call to retire it tells the
 * people the run answers to, unless `announce` is off: a refusal that only
 * follows someone else's decision (the project archived or gone) needs no
 * bell.
 */
export async function retireAutoRetry(
  tx: TransactionSql,
  args: {
    organizationId: string;
    taskId: string;
    runId: string;
    announce: boolean;
  },
): Promise<void> {
  const retired = await markAutoRetryRetired(tx, {
    organizationId: args.organizationId,
    taskId: args.taskId,
    failedRunId: args.runId,
  });
  if (retired && args.announce) {
    await announceAgentRunFailed(tx, {
      organizationId: args.organizationId,
      runId: args.runId,
    });
  }
}

/** A new run started on the task: its unread failed-run rows are answered. */
export async function withdrawAgentRunFailedNotices(
  tx: TransactionSql,
  args: { organizationId: string; taskId: string },
): Promise<void> {
  await dismissAgentRunFailedNotifications(tx, args);
}
