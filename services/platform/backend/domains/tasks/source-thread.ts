import type { Sql, TransactionSql } from 'postgres';

import { PROJECT_TEAM_IDS_SQL } from '../../core/lib/audience.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import { loadOwnedThread, loadProjectSharedThread } from '../chat/threads.ts';
import type { ProjectAuthContext } from '../projects/service.ts';
import { getLatestAgentRunCardForTask } from './agent-runs.ts';
import { TaskError } from './errors.ts';

/**
 * The chat a task was handed over from (`tasks.source_thread_id`, migration
 * 0144). "Create task from chat" names the conversation's root, and the chat
 * reads back the tasks made from it: a live row per task above its composer,
 * so the person who handed the work over sees it move — the agent working, a
 * run that failed, the files delivered — without looking for it on a board.
 *
 * The link is the person's own claim, so it is held to what they can read: a
 * task names a conversation its creator owns, or one its owner shared with a
 * project the creator can open — the two doors that let them read it — and
 * the chat lists only the tasks the reader can open.
 */

/** Tasks listed per conversation: a hand-over is a handful, not a board. */
const THREAD_TASKS_LIMIT = 10;

/** Refuse a source conversation the person could not read. */
export async function assertTaskSourceThreadReadable(
  db: Sql | TransactionSql,
  args: { organizationId: string; userId: string; threadId: string },
): Promise<void> {
  const owned = await loadOwnedThread(
    db,
    args.organizationId,
    args.userId,
    args.threadId,
  );
  if (owned !== null) return;
  const shared = await loadProjectSharedThread(
    db,
    args.organizationId,
    args.userId,
    args.threadId,
  );
  if (shared !== null) return;
  throw new TaskError(
    'TASK_SOURCE_THREAD_NOT_FOUND',
    'The conversation this task names is not one you can read',
    404,
  );
}

/** A task made from a conversation, as the conversation shows it. */
export interface ThreadTaskRow {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: string;
  assigneeType: string | null;
  assigneeId: string | null;
  /** Files the agent delivered to the task. */
  outputCount: number;
  /** The task's newest agent run, when it has one. */
  run?: {
    status: string;
    failureCode?: string;
    /** A failed run the platform is about to retry by itself. */
    retryPending?: boolean;
    /** Queued while the organization's sandbox slots are full. */
    waitingForCapacity?: boolean;
  };
}

/**
 * The tasks made from one conversation that the reader can open, newest
 * first. The reader must be able to read the conversation too: which work
 * came out of a chat is part of the chat.
 */
export async function listTasksFromThread(
  sql: Sql,
  auth: ProjectAuthContext,
  threadId: string,
): Promise<ThreadTaskRow[]> {
  await assertTaskSourceThreadReadable(sql, {
    organizationId: auth.organizationId,
    userId: auth.userId,
    threadId,
  });
  const rows = await sql<
    (Omit<ThreadTaskRow, 'run'> & { teamIds: string[] | null })[]
  >`
    SELECT t.id, t.project_id AS "projectId", p.name AS "projectName",
           t.title, t.status, t.assignee_type AS "assigneeType",
           t.assignee_id AS "assigneeId",
           CASE WHEN jsonb_typeof(t.outputs) = 'array'
                THEN jsonb_array_length(t.outputs) ELSE 0 END
             AS "outputCount",
           p."teamIds"
    FROM app.tasks t
    JOIN (
      SELECT id, name, ${sql.unsafe(PROJECT_TEAM_IDS_SQL)} AS "teamIds"
      FROM app.projects
      WHERE org_id = ${auth.organizationId} AND archived_at_ms IS NULL
    ) p ON p.id = t.project_id
    WHERE t.org_id = ${auth.organizationId}
      AND t.source_thread_id = ${threadId}
      AND t.archived_at_ms IS NULL
    ORDER BY t.created_at_ms DESC
    LIMIT ${THREAD_TASKS_LIMIT}
  `;
  const readable = rows.filter(
    (row) =>
      checkProjectAccess(
        { teamIds: row.teamIds ?? [] },
        auth.teamIds,
        auth.role,
      ).canRead,
  );
  const tasks: ThreadTaskRow[] = [];
  for (const { teamIds: _teamIds, ...row } of readable) {
    const card =
      row.assigneeType === 'agent'
        ? await getLatestAgentRunCardForTask(sql, auth.organizationId, row.id)
        : null;
    tasks.push({
      ...row,
      ...(card !== null
        ? {
            run: {
              status: card.status,
              ...(card.failureCode !== undefined
                ? { failureCode: card.failureCode }
                : {}),
              ...(card.retryPending === true ? { retryPending: true } : {}),
              ...(card.waitingForCapacity === true
                ? { waitingForCapacity: true }
                : {}),
            },
          }
        : {}),
    });
  }
  return tasks;
}
