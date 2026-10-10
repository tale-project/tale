import type { Sql } from 'postgres';

import { TASK_COMMENT_MAX } from '../../core/tasks/helpers.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import type { ProjectAuthContext } from '../projects/service.ts';
import { addTaskComment } from '../tasks/comments.ts';
import { answerAsk } from './store.ts';

/**
 * A machine door answers the question a run asked a person — the REST API
 * (`POST …/runs/{runId}/asks/{askId}`) and a coding agent over MCP
 * (`answer_run_ask`). The door has already decided that the caller may: the
 * run is one it can see, and a project run's project is one it may edit.
 *
 * Recording the answer enqueues the run's resume in the same transaction
 * (`answerAsk`); the answer is audited as the person who gave it, and then
 * mirrored onto the run's task as their comment, the way the app's task
 * panel does it, so the thread shows who decided what. The mirror is best
 * effort: the answer and its resume are recorded already, so a comment that
 * cannot land (the person cannot read the task's project) only warns.
 */
export async function answerRunAskAs(
  sql: Sql,
  args: {
    organizationId: string;
    run: { id: string; name: string };
    askId: string;
    answer: string;
    /** What the ask records as who answered: a member's id, or
     * `api-key:<userId>` for a caller answering as itself. */
    answeredBy: string;
    /** The person the answer is recorded for — the audit row's actor and the
     * mirrored comment's author. */
    author: ProjectAuthContext;
    /** Facts of the door the audit row keeps beside the answer. Inside an
     * MCP tool call the request channel adds the door itself. */
    auditMetadata?: Record<string, unknown>;
  },
): Promise<{ runId: string; askId: string; taskId: string | null }> {
  const { organizationId, run, askId, author } = args;
  const answered = await answerAsk(sql, {
    organizationId,
    askId,
    runId: run.id,
    answer: args.answer,
    answeredBy: args.answeredBy,
  });
  await sql.begin(async (tx) => {
    await createAuditLog(tx, {
      organizationId,
      actorId: author.userId,
      ...(author.email !== undefined ? { actorEmail: author.email } : {}),
      actorType: 'user',
      action: 'automation.ask_answered',
      category: 'data',
      resourceType: 'automation_run',
      resourceId: run.id,
      resourceName: run.name,
      newState: { askId, answeredBy: args.answeredBy },
      metadata: {
        askId,
        ...args.auditMetadata,
        ...(answered.taskId !== null ? { taskId: answered.taskId } : {}),
      },
      status: 'success',
    });
  });
  if (answered.taskId !== null) {
    const taskId = answered.taskId;
    try {
      await sql.begin(async (tx) => {
        // The ask accepts twice what a comment holds; the mirror keeps the
        // head, the answer itself is stored whole on the ask.
        await addTaskComment(tx, author, {
          taskId,
          body: args.answer.slice(0, TASK_COMMENT_MAX),
        });
      });
    } catch (error) {
      console.warn('[automations] ask answer comment mirror failed', {
        runId: run.id,
        askId,
        error: String(error),
      });
    }
  }
  return { runId: run.id, askId, taskId: answered.taskId };
}
