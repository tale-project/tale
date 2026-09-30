import type { TransactionSql } from 'postgres';

import type { TaskCommentBodies } from '../../../lib/shared/schemas/task-comment.ts';
import { saveAgentFileMetadata } from './agent-file-metadata.ts';
import { settleAgentRunInTx, type SettleAgentRunArgs } from './agent-runs.ts';
import { addTaskComment, queuedOnTask } from './comments.ts';
import {
  agentRecordTaskOutputsTrusted,
  agentUpdateTaskStatusTrusted,
} from './service.ts';

export interface CompleteAgentRunArgs extends SettleAgentRunArgs {
  organizationId: string;
  taskId: string;
  agentId: string;
  execId: string;
  body?: string;
  noticeByLocale?: TaskCommentBodies;
  files: Parameters<typeof agentRecordTaskOutputsTrusted>[1]['files'];
}

/** Completion and cancellation elect on the same locked run. The result
 * comment, deliverables, review request and terminal stamp commit together. */
export async function completeAgentRunInTx(
  tx: TransactionSql,
  args: CompleteAgentRunArgs,
): Promise<boolean> {
  if (args.body === undefined && args.noticeByLocale === undefined) {
    throw new Error(
      'A completed agent run must carry a report or a translated notice',
    );
  }
  return queuedOnTask(tx, args.taskId, async () => {
    // Status/drag and retirement cancel the run before writing the task.
    // Take the run first too, or a status writer can hold it while waiting
    // for our task row and we wait for its run row.
    const live = await tx<{ id: string; inPlace: boolean }[]>`
      SELECT id, in_place AS "inPlace" FROM app.project_agent_runs
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND task_id = ${args.taskId} AND agent_id = ${args.agentId}
        AND exec_id = ${args.execId} AND status IN ('queued', 'running')
      FOR UPDATE
    `;
    const run = live[0];
    if (run === undefined) return false;
    const tasks = await tx<{ id: string }[]>`
      SELECT id FROM app.tasks
      WHERE id = ${args.taskId} AND org_id = ${args.organizationId}
      FOR UPDATE
    `;
    if (tasks.length === 0) return false;
    for (const file of args.files) {
      await saveAgentFileMetadata(tx, {
        organizationId: args.organizationId,
        storageId: file.fileId,
        fileName: file.fileName,
        contentType: file.fileType,
        size: file.fileSize,
        source: 'task-output',
      });
    }
    await agentRecordTaskOutputsTrusted(tx, args);
    const auth = {
      organizationId: args.organizationId,
      userId: args.agentId,
      role: 'admin' as const,
      teamIds: [],
    };
    let messageId: string | undefined;
    if (args.body !== undefined) {
      ({ messageId } = await addTaskComment(tx, auth, {
        taskId: args.taskId,
        body: args.body,
        author: { actorType: 'agent', actorId: args.agentId },
      }));
    }
    if (args.noticeByLocale !== undefined) {
      const notice = await addTaskComment(tx, auth, {
        taskId: args.taskId,
        body: args.noticeByLocale.en,
        bodyByLocale: args.noticeByLocale,
        author: { actorType: 'agent', actorId: 'system' },
      });
      messageId ??= notice.messageId;
    }
    // A run started in place (a standing role's occurrence) leaves the card
    // where it is and asks nobody to review: the intent its start recorded,
    // not the card's column, decides. Every other run parks its result at
    // In review for a person.
    if (!run.inPlace) {
      await agentUpdateTaskStatusTrusted(tx, {
        organizationId: args.organizationId,
        actorId: args.agentId,
        taskId: args.taskId,
        status: 'in_review',
        review: { runId: args.runId },
      });
    }
    return settleAgentRunInTx(tx, {
      ...args,
      ...(messageId !== undefined ? { resultMessageId: messageId } : {}),
    });
  });
}
