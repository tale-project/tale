import {
  markRetryQueueKey,
  RETRY_QUEUE_LOCK_CLASS,
  transactSerializable,
} from '@tale/shared/db/serializable';
import { taskExternalIssueSchema } from '@tale/shared/schemas/task-external-issue';
import type { Sql, TransactionSql } from 'postgres';

import type { ConnectorCaller } from '../../../lib/connectors/dispatcher.ts';
import type { WorkflowTaskStore } from '../../../lib/connectors/natives/index.ts';
import type { WorkflowIssueInput } from '../../../lib/connectors/natives/platform-tasks.ts';
import { parseRunStarter } from '../../../lib/shared/run-starter.ts';
import { authorizeActorRun } from '../automations/dispatch-store.ts';
import { getRun, resolveRunProject } from '../automations/store.ts';
import {
  assertWritable,
  getProjectAuthContext,
  loadProjectOrThrow,
} from '../projects/service.ts';
import {
  addTaskComment,
  listTaskComments,
  TASK_COMMENT_PAGE_MAX,
} from '../tasks/comments.ts';
import { upsertTaskByExternalRef } from '../tasks/external-ref.ts';
import {
  agentUpdateTaskStatusTrusted,
  loadTaskOrThrow,
  TaskError,
} from '../tasks/service.ts';

function issueImportQueueKey(
  organizationId: string,
  projectId: string,
): string {
  return `task-issue-import:${organizationId}:${projectId}`;
}

async function lockIssueImportQueue(
  tx: TransactionSql,
  key: string,
): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(${RETRY_QUEUE_LOCK_CLASS}, hashtext(${key}))`;
}

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
  const authorizeProject = async (
    tx: TransactionSql,
    organizationId: string,
    projectId: string,
    caller: ConnectorCaller,
  ) => {
    const project = await loadProjectOrThrow(tx, projectId);
    if (
      project.organizationId !== organizationId ||
      project.archivedAt !== null
    ) {
      throw new TaskError('PROJECT_NOT_FOUND', 'Project not found', 404);
    }
    if (caller.kind === 'workflow') {
      const run = await getRun(tx, organizationId, caller.runId);
      if (!run || (run.projectId !== null && run.projectId !== projectId)) {
        throw new TaskError('PROJECT_NOT_FOUND', 'Project not found', 404);
      }
      await resolveRunProject(tx, {
        organizationId,
        name: run.name,
        projectId: projectId,
      });
      // An org-wide run's input is not a grant to every private project.
      // Keep the initiating person's current write access at the write
      // boundary, just as a direct connector call does.
      const starter = parseRunStarter(run.startedBy);
      if (starter.kind === 'user' || starter.kind === 'api-key') {
        const auth = await authorizeActorRun(
          tx,
          organizationId,
          starter.userId,
          'membership',
        );
        assertWritable(project, auth);
      } else if (starter.kind !== 'trigger') {
        throw new TaskError('PROJECT_NOT_FOUND', 'Project not found', 404);
      }
    } else if (caller.kind === 'user') {
      const auth = await authorizeActorRun(
        tx,
        organizationId,
        caller.userId,
        'membership',
      );
      assertWritable(project, auth);
    }
  };
  const persistIssue = async (
    tx: TransactionSql,
    organizationId: string,
    caller: ConnectorCaller,
    projectId: string,
    issue: WorkflowIssueInput,
  ) =>
    upsertTaskByExternalRef(tx, {
      ...issue,
      organizationId,
      projectId,
      actorId: caller.kind === 'user' ? caller.userId : 'workflow',
      ...(caller.kind === 'user' ? { creatorType: 'user' as const } : {}),
      dedupeScope: 'project',
      descriptionMode: 'preserve',
    });
  return {
    async upsertIssues({ organizationId, caller, projectId, issues }) {
      const queueKey = issueImportQueueKey(organizationId, projectId);
      return transactSerializable(sql, async (tx) => {
        try {
          // Overlapping imports touch the same source and project rows. A
          // transaction lock alone cannot refresh a serializable snapshot;
          // mark conflicts so the shared retry queue takes this lock before
          // opening the retry's snapshot, ahead of any inner audit locks.
          await lockIssueImportQueue(tx, queueKey);
          await authorizeProject(tx, organizationId, projectId, caller);
          const ordered = issues
            .map((issue, index) => ({ issue, index }))
            .sort((left, right) =>
              `${left.issue.externalSystem}:${left.issue.externalIssue?.id ?? left.issue.externalId}`.localeCompare(
                `${right.issue.externalSystem}:${right.issue.externalIssue?.id ?? right.issue.externalId}`,
              ),
            );
          const results = [];
          for (const { issue, index } of ordered) {
            const result = await persistIssue(
              tx,
              organizationId,
              caller,
              projectId,
              issue,
            );
            results.push({ index, value: { ...result, title: issue.title } });
          }
          return results
            .sort((left, right) => left.index - right.index)
            .map((result) => result.value);
        } catch (error) {
          throw markRetryQueueKey(error, queueKey);
        }
      });
    },

    async listExternalIssues({
      organizationId,
      caller,
      projectId,
      externalSystem,
      repositoryId,
      sourceOrigin,
      sourceProjectId,
      limit,
      legacyPrefixes,
    }) {
      return sql.begin(async (tx) => {
        // Selection now writes its own attempt clock. Share the batch queue
        // so refresh bookkeeping and source upserts never lock a project's
        // task rows in opposite orders.
        await lockIssueImportQueue(
          tx,
          issueImportQueueKey(organizationId, projectId),
        );
        await authorizeProject(tx, organizationId, projectId, caller);
        const rows = await tx<
          { taskId: string; externalId: string; externalIssue: unknown }[]
        >`
          SELECT id AS "taskId", external_id AS "externalId", external_issue AS "externalIssue"
          FROM app.tasks
          WHERE org_id = ${organizationId} AND project_id = ${projectId}
            AND external_system = ${externalSystem} AND ( (external_issue IS NOT NULL
            AND ${repositoryId === undefined ? tx`TRUE` : tx`external_issue->>'repositoryId' = ${String(repositoryId)}`}
            AND ${sourceProjectId === undefined ? tx`TRUE` : tx`external_issue->>'sourceProjectId' = ${sourceProjectId}`}
            AND ${sourceOrigin === undefined ? tx`TRUE` : tx`split_part(external_source_id, '#', 1) = ${sourceOrigin}`})
              OR (external_issue IS NULL AND EXISTS (
                SELECT 1 FROM unnest(${legacyPrefixes ?? []}::text[]) AS prefix
                WHERE CASE WHEN ${externalSystem} = 'github'
                  THEN starts_with(lower(external_id), lower(prefix))
                  ELSE starts_with(external_id, prefix) END
              )) )
          ORDER BY GREATEST(
            COALESCE(external_issue_refresh_attempted_at_ms, 0),
            COALESCE((external_issue->>'syncedAt')::bigint, 0)
          ) ASC, id ASC
          LIMIT ${limit + 1}
        `;
        const selected = rows.slice(0, limit);
        if (selected.length > 0) {
          // This records a scheduling attempt, not a successful source read.
          // Missing legacy rows and failed reads must rotate behind unchecked
          // rows without inventing a snapshot or changing local task activity.
          // Move behind the project's entire effective queue, including
          // clocks ahead of this replica after a wall-clock rollback. A
          // per-row increment alone can leave a legacy row ahead forever.
          await tx`
            UPDATE app.tasks SET external_issue_refresh_attempted_at_ms = GREATEST(
              COALESCE(external_issue_refresh_attempted_at_ms, 0) + 1,
              ${Date.now()}, queue.next_clock
            )
            FROM (
              SELECT COALESCE(MAX(GREATEST(
                COALESCE(external_issue_refresh_attempted_at_ms, 0),
                COALESCE((external_issue->>'syncedAt')::bigint, 0)
              )), 0) + 1 AS next_clock
              FROM app.tasks WHERE org_id = ${organizationId} AND project_id = ${projectId}
            ) AS queue
            WHERE app.tasks.org_id = ${organizationId} AND app.tasks.project_id = ${projectId}
              AND app.tasks.id IN ${tx(selected.map((row) => row.taskId))}
          `;
        }
        return {
          issues: selected.map((row) => ({
            taskId: row.taskId,
            externalId: row.externalId,
            externalIssue:
              row.externalIssue === null
                ? null
                : taskExternalIssueSchema.parse(row.externalIssue),
          })),
          hasMore: rows.length > limit,
        };
      });
    },
    async upsert({ organizationId, caller, ...input }) {
      return sql.begin(async (tx) => {
        await authorizeProject(tx, organizationId, input.projectId, caller);
        return persistIssue(tx, organizationId, caller, input.projectId, input);
      });
    },
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
        ...(task.externalSystem != null
          ? { externalSystem: task.externalSystem }
          : {}),
        ...(task.externalId != null ? { externalId: task.externalId } : {}),
        ...(task.externalUrl != null ? { externalUrl: task.externalUrl } : {}),
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
    async comment({ organizationId, taskId, body, bodyByLocale }) {
      const auth = await systemAuth(organizationId);
      const result = await sql.begin((tx) =>
        addTaskComment(tx, auth, {
          taskId,
          body,
          ...(bodyByLocale !== undefined ? { bodyByLocale } : {}),
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
          ...(comment.bodyByLocale != null
            ? { bodyByLocale: comment.bodyByLocale }
            : {}),
          createdAt: comment.createdAt,
        })),
        truncated: page.hasMore,
      };
    },
  };
}
