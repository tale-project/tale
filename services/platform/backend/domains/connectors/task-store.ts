import type { Sql } from 'postgres';

import type { WorkflowTaskStore } from '../../../lib/connectors/natives/index.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import {
  addTaskComment,
  listTaskComments,
  TASK_COMMENT_PAGE_MAX,
} from '../tasks/comments.ts';
import {
  agentUpdateTaskStatusTrusted,
  loadTaskOrThrow,
  TaskError,
} from '../tasks/service.ts';

/** The task natives over the 0.5 tasks domain — trusted writes (the
 * connector door's callers own authorization), the 0.4 platform-store
 * semantics. */
export function pgTaskStore(sql: Sql): WorkflowTaskStore {
  const systemAuth = async (organizationId: string) =>
    getProjectAuthContext(sql, {
      organizationId,
      userId: 'system',
      role: 'owner',
    });
  return {
    async get({ organizationId, taskId }) {
      let task: Awaited<ReturnType<typeof loadTaskOrThrow>>;
      try {
        task = await loadTaskOrThrow(sql, taskId, organizationId);
      } catch (error) {
        // `null` is the contract for ONE outcome — no such task in this org.
        // Everything else (a dropped connection, an exhausted pool, a bug)
        // must surface as the failure it is: a workflow handed a swallowed
        // error would skip real work or tell the user a task is gone when
        // the database merely blinked.
        if (error instanceof TaskError && error.code === 'TASK_NOT_FOUND') {
          return null;
        }
        throw error;
      }
      return {
        taskId: task.id,
        title: task.title,
        status: task.status,
        ...(task.description !== null ? { description: task.description } : {}),
        projectId: task.projectId,
      };
    },
    async updateStatus({ organizationId, taskId, status }) {
      const result = await sql.begin((tx) =>
        agentUpdateTaskStatusTrusted(tx, {
          organizationId,
          actorId: 'workflow',
          taskId,
          status,
        }),
      );
      return result;
    },
    async comment({ organizationId, taskId, body }) {
      const auth = await systemAuth(organizationId);
      const result = await sql.begin((tx) =>
        addTaskComment(tx, auth, {
          taskId,
          body,
          author: { actorType: 'agent', actorId: 'workflow' },
        }),
      );
      return { messageId: result.messageId };
    },
    async listComments({ organizationId, taskId }) {
      const auth = await systemAuth(organizationId);
      // The newest page at the read ceiling: a workflow reads feedback from
      // the tail, and `truncated` tells it when the discussion outgrew one
      // read — never a quietly shortened list.
      const page = await listTaskComments(sql, auth, taskId, {
        limit: TASK_COMMENT_PAGE_MAX,
      });
      return {
        comments: page.comments.map((comment) => ({
          authorType:
            comment.authorType === 'user'
              ? ('user' as const)
              : ('agent' as const),
          authorId: comment.authorId,
          body: comment.body,
          createdAt: comment.createdAt,
        })),
        truncated: page.hasMore,
      };
    },
  };
}
