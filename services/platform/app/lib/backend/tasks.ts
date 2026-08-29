/**
 * Tasks vertical over the 0.5 backend — the board core's adapter rows.
 * Response types are DERIVED from the 0.4 function signatures
 * (`FunctionReturnType`), and every pg wire row is projected to the 0.4 doc
 * shape in exactly one place here (`id` → `_id`, null → omitted-optional).
 */

import type { QueryClient } from '@tanstack/react-query';
import type { FunctionReturnType } from 'convex/server';

import type { api } from '@/convex/_generated/api';

import { backendFetch, BackendApiError } from './api-client';
import type {
  AdapterContext,
  ReadAdapter,
  WriteAdapter,
} from './convex-adapters';
import { backendEntityPrefix, backendKey } from './query-keys';

// ---------------------------------------------------------------------------
// Wire rows + 0.4-shape projections
// ---------------------------------------------------------------------------

type TasksByProjectResult = FunctionReturnType<
  typeof api.tasks.queries.listTasksByProject
>;
type TaskItem = TasksByProjectResult['tasks'][number];
type GetTaskResult = FunctionReturnType<typeof api.tasks.queries.getTask>;
type TaskLabelItem = FunctionReturnType<
  typeof api.tasks.queries.listTaskLabels
>[number];
type TaskDependenciesResult = FunctionReturnType<
  typeof api.tasks.queries.listTaskDependencies
>;
type ProjectDependencyEdge = FunctionReturnType<
  typeof api.tasks.queries.listProjectDependencies
>[number];
type TaskDiscussionResult = FunctionReturnType<
  typeof api.tasks.queries.getTaskDiscussion
>;
type TaskActivityItem = FunctionReturnType<
  typeof api.tasks.queries.listTaskActivity
>[number];

/** One task as the backend answers it (decorated: labels + folder facts). */
interface TaskWire {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  description: string | null;
  attachments: unknown;
  outputs: unknown;
  number: number | null;
  status: string;
  priority: string | null;
  labelIds: string[];
  labels: { id: string; name: string; color: string }[];
  assigneeType: string | null;
  assigneeId: string | null;
  reviewerUserId: string | null;
  parentTaskId: string | null;
  commentCount: number;
  rank: string;
  externalSystem: string | null;
  externalId: string | null;
  externalUrl: string | null;
  threadId: string | null;
  discussionThreadId: string | null;
  sourceDiscussionThreadId: string | null;
  startDate: number | null;
  startNotifiedAt: number | null;
  dueDate: number | null;
  slaLevel: number | null;
  slaLevelAt: number | null;
  statusChangedAt: number | null;
  totalCostCents: number | null;
  agentRunCount: number;
  lastAgentRunAt: number | null;
  claimedAt: number | null;
  completedAt: number | null;
  createdBy: string;
  createdByType: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  folderExists: boolean;
  hasFiles: boolean;
  projectKey?: string;
}

function taskView(row: TaskWire): TaskItem {
  const view: Record<string, unknown> = {
    _id: row.id,
    _creationTime: row.createdAt,
    organizationId: row.organizationId,
    projectId: row.projectId,
    title: row.title,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.attachments !== null && row.attachments !== undefined
      ? { attachments: row.attachments }
      : {}),
    ...(row.outputs !== null && row.outputs !== undefined
      ? { outputs: row.outputs }
      : {}),
    ...(row.number !== null ? { number: row.number } : {}),
    status: row.status,
    ...(row.priority !== null ? { priority: row.priority } : {}),
    labels: row.labels,
    labelIds: row.labelIds,
    ...(row.assigneeType !== null ? { assigneeType: row.assigneeType } : {}),
    ...(row.assigneeId !== null ? { assigneeId: row.assigneeId } : {}),
    ...(row.reviewerUserId !== null
      ? { reviewerUserId: row.reviewerUserId }
      : {}),
    ...(row.parentTaskId !== null ? { parentTaskId: row.parentTaskId } : {}),
    commentCount: row.commentCount,
    rank: row.rank,
    ...(row.externalSystem !== null
      ? { externalSystem: row.externalSystem }
      : {}),
    ...(row.externalId !== null ? { externalId: row.externalId } : {}),
    ...(row.externalUrl !== null ? { externalUrl: row.externalUrl } : {}),
    ...(row.threadId !== null ? { threadId: row.threadId } : {}),
    ...(row.discussionThreadId !== null
      ? { discussionThreadId: row.discussionThreadId }
      : {}),
    ...(row.sourceDiscussionThreadId !== null
      ? { sourceDiscussionThreadId: row.sourceDiscussionThreadId }
      : {}),
    ...(row.startDate !== null ? { startDate: row.startDate } : {}),
    ...(row.startNotifiedAt !== null
      ? { startNotifiedAt: row.startNotifiedAt }
      : {}),
    ...(row.dueDate !== null ? { dueDate: row.dueDate } : {}),
    ...(row.slaLevel !== null ? { slaLevel: row.slaLevel } : {}),
    ...(row.slaLevelAt !== null ? { slaLevelAt: row.slaLevelAt } : {}),
    ...(row.statusChangedAt !== null
      ? { statusChangedAt: row.statusChangedAt }
      : {}),
    ...(row.totalCostCents !== null
      ? { totalCostCents: row.totalCostCents }
      : {}),
    agentRunCount: row.agentRunCount,
    ...(row.lastAgentRunAt !== null
      ? { lastAgentRunAt: row.lastAgentRunAt }
      : {}),
    ...(row.claimedAt !== null ? { claimedAt: row.claimedAt } : {}),
    ...(row.completedAt !== null ? { completedAt: row.completedAt } : {}),
    createdBy: row.createdBy,
    createdByType: row.createdByType,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.archivedAt !== null ? { archivedAt: row.archivedAt } : {}),
    folderExists: row.folderExists,
    hasFiles: row.hasFiles,
    ...(row.projectKey !== undefined ? { projectKey: row.projectKey } : {}),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one fetch-boundary projection to the 0.4 shape
  return view as TaskItem;
}

interface BoardWire {
  tasks: TaskWire[];
  truncated: boolean;
  canEdit: boolean;
}

function boardView(body: BoardWire): TasksByProjectResult {
  return {
    tasks: body.tasks.map(taskView),
    truncated: body.truncated,
    canEdit: body.canEdit,
  };
}

// ---------------------------------------------------------------------------
// Read adapters
// ---------------------------------------------------------------------------

function orgOf(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string | undefined {
  const fromArgs = args.organizationId;
  if (typeof fromArgs === 'string' && fromArgs.length > 0) return fromArgs;
  return ctx.organizationId;
}

/** The shared board filter set → query-string + a stable key suffix. */
function boardFilterParams(args: Record<string, unknown>): {
  search: string;
  key: readonly unknown[];
} {
  const includeArchived = args.includeArchived === true;
  const status = typeof args.status === 'string' ? args.status : '';
  const statuses = Array.isArray(args.statuses)
    ? args.statuses.filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : [];
  const assigneeId = typeof args.assigneeId === 'string' ? args.assigneeId : '';
  const externalSystem =
    typeof args.externalSystem === 'string' ? args.externalSystem : '';
  const params = new URLSearchParams({
    includeArchived: String(includeArchived),
    ...(status.length > 0 ? { status } : {}),
    ...(statuses.length > 0 ? { statuses: statuses.join(',') } : {}),
    ...(assigneeId.length > 0 ? { assigneeId } : {}),
    ...(externalSystem.length > 0 ? { externalSystem } : {}),
  });
  return {
    search: params.toString(),
    key: [
      includeArchived,
      status,
      statuses.join(','),
      assigneeId,
      externalSystem,
    ],
  };
}

export const taskReadAdapters: Record<string, ReadAdapter> = {
  'tasks/queries:listTasksByProject': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const projectId = args.projectId;
    if (orgId === undefined || typeof projectId !== 'string') return null;
    const filters = boardFilterParams(args);
    return {
      queryKey: backendKey(
        orgId,
        'task',
        'by-project',
        projectId,
        ...filters.key,
      ),
      queryFn: () =>
        backendFetch<BoardWire>(
          `/tasks/by-project/${encodeURIComponent(projectId)}?${filters.search}`,
          { orgId },
        ).then(boardView),
    };
  },
  'tasks/queries:listTasksForAccessibleProjects': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const filters = boardFilterParams(args);
    return {
      queryKey: backendKey(orgId, 'task', 'across-projects', ...filters.key),
      queryFn: () =>
        backendFetch<BoardWire>(`/tasks?${filters.search}`, { orgId }).then(
          boardView,
        ),
    };
  },
  'tasks/queries:getTask': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const taskId = args.taskId;
    if (orgId === undefined || typeof taskId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'detail', taskId),
      queryFn: () =>
        backendFetch<{
          task: TaskWire;
          canEdit: boolean;
          canClaim: boolean;
          canComment: boolean;
        }>(`/tasks/${encodeURIComponent(taskId)}`, { orgId }).then(
          (body): GetTaskResult => ({
            task: taskView(body.task),
            canEdit: body.canEdit,
            canClaim: body.canClaim,
            canComment: body.canComment,
          }),
          (error: unknown): GetTaskResult => {
            // 0.4 answers null for a missing task — never an error state.
            if (error instanceof BackendApiError && error.status === 404) {
              return null;
            }
            throw error;
          },
        ),
    };
  },
  'tasks/queries:listSubtasks': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const taskId = args.taskId;
    if (orgId === undefined || typeof taskId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'subtasks', taskId),
      queryFn: () =>
        backendFetch<{ subtasks: TaskWire[] }>(
          `/tasks/${encodeURIComponent(taskId)}/subtasks`,
          { orgId },
        ).then((body): TaskItem[] => body.subtasks.map(taskView)),
    };
  },
  'tasks/queries:listTaskLabels': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const projectId = args.projectId;
    if (orgId === undefined || typeof projectId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'labels', projectId),
      queryFn: () =>
        backendFetch<{
          labels: { id: string; name: string; color: string | null }[];
        }>(`/tasks/labels/${encodeURIComponent(projectId)}`, { orgId }).then(
          (body): TaskLabelItem[] =>
            body.labels.map((row) => {
              const view: Record<string, unknown> = {
                _id: row.id,
                name: row.name,
                color: row.color ?? '',
              };
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one fetch-boundary projection to the 0.4 shape
              return view as TaskLabelItem;
            }),
        ),
    };
  },
  'tasks/queries:listTaskDependencies': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const taskId = args.taskId;
    if (orgId === undefined || typeof taskId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'dependencies', taskId),
      queryFn: () =>
        backendFetch<{ blockedBy: TaskWire[]; blocks: TaskWire[] }>(
          `/tasks/${encodeURIComponent(taskId)}/dependencies`,
          { orgId },
        ).then((body): TaskDependenciesResult => ({
          blockedBy: body.blockedBy.map(taskView),
          blocks: body.blocks.map(taskView),
        })),
    };
  },
  'tasks/queries:listProjectDependencies': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const projectId = args.projectId;
    if (orgId === undefined || typeof projectId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'project-dependencies', projectId),
      queryFn: () =>
        backendFetch<{ edges: ProjectDependencyEdge[] }>(
          `/tasks/dependencies/by-project/${encodeURIComponent(projectId)}`,
          { orgId },
        ).then((body) => body.edges),
    };
  },
  'tasks/queries:getTaskDiscussion': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const taskId = args.taskId;
    if (orgId === undefined || typeof taskId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'discussion', taskId),
      queryFn: () =>
        backendFetch<{
          threadId: string | null;
          messages: {
            messageId: string;
            authorType: string;
            authorId: string;
            body: string;
            createdAt: number;
            editedAt: number | null;
            mentions: { type: string; id: string }[] | null;
            bodyByLocale: Record<string, string> | null;
          }[];
        }>(`/tasks/${encodeURIComponent(taskId)}/comments`, { orgId }).then(
          (body): TaskDiscussionResult => ({
            threadId: body.threadId,
            messages: body.messages.map((message) => {
              const view: Record<string, unknown> = {
                messageId: message.messageId,
                authorType: message.authorType,
                authorId: message.authorId,
                body: message.body,
                createdAt: message.createdAt,
                ...(message.editedAt !== null
                  ? { editedAt: message.editedAt }
                  : {}),
                ...(message.mentions !== null
                  ? { mentions: message.mentions }
                  : {}),
                ...(message.bodyByLocale !== null
                  ? { bodyByLocale: message.bodyByLocale }
                  : {}),
              };
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one fetch-boundary projection to the 0.4 shape
              return view as unknown as TaskDiscussionResult['messages'][number];
            }),
          }),
        ),
    };
  },
  'tasks/queries:getTaskOpsIndicators': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const projectId = args.projectId;
    if (orgId === undefined || typeof projectId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'ops-indicators', projectId),
      queryFn: () =>
        backendFetch(
          `/tasks/ops-indicators/by-project/${encodeURIComponent(projectId)}`,
          { orgId },
        ),
    };
  },
  'tasks/queries:getTaskOpsIndicatorsForAccessibleProjects': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'task', 'ops-indicators-across'),
      queryFn: () => backendFetch('/tasks/ops-indicators', { orgId }),
    };
  },
  'tasks/queries:getPendingTaskReview': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const taskId = args.taskId;
    if (orgId === undefined || typeof taskId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'pending-review', taskId),
      queryFn: () =>
        backendFetch<{
          review: {
            approvalId: string;
            requestedFor: string | null;
            agentSlug: string | null;
            createdAt: number;
          } | null;
        }>(`/tasks/${encodeURIComponent(taskId)}/review`, { orgId }).then(
          (body) => {
            if (body.review === null) return null;
            return {
              approvalId: body.review.approvalId,
              ...(body.review.agentSlug !== null
                ? { agentSlug: body.review.agentSlug }
                : {}),
              ...(body.review.requestedFor !== null
                ? { requestedFor: body.review.requestedFor }
                : {}),
              requestedAt: body.review.createdAt,
            };
          },
        ),
    };
  },
  'tasks/queries:listTaskAgentRuns': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const taskId = args.taskId;
    if (orgId === undefined || typeof taskId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'agent-runs', taskId),
      queryFn: () =>
        backendFetch<{
          runs: {
            id: string;
            agentId: string;
            status: string;
            error: string | null;
            trigger: string | null;
            startedAt: number;
            launchedAt: number | null;
            settledAt: number | null;
          }[];
        }>(`/tasks/${encodeURIComponent(taskId)}/agent-runs`, { orgId }).then(
          (body) =>
            body.runs.map((run) => ({
              runId: run.id,
              agentSlug: run.agentId,
              trigger: run.trigger ?? 'manual',
              status: run.status,
              ...(run.error !== null ? { error: run.error } : {}),
              startedAt: run.startedAt,
              ...(run.launchedAt !== null && run.settledAt !== null
                ? { durationMs: run.settledAt - run.launchedAt }
                : {}),
              // Per-run cost is not recorded on the pg run row (the task's
              // totalCostCents aggregates) — 0 keeps the cost chip hidden.
              costCents: 0,
            })),
        ),
    };
  },
  'collab/subscriptions:isSubscribedToTask': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const taskId = args.taskId;
    if (orgId === undefined || typeof taskId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'subscription', taskId),
      queryFn: () =>
        backendFetch<{ subscribed: boolean; muted: boolean }>(
          `/collab/tasks/${encodeURIComponent(taskId)}/subscription`,
          { orgId },
        ),
    };
  },
  'tasks/queries:listTaskActivity': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const taskId = args.taskId;
    if (orgId === undefined || typeof taskId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'activity', taskId),
      queryFn: () =>
        backendFetch<{
          activity: {
            id: string;
            organizationId: string;
            taskId: string;
            projectId: string;
            actorType: string;
            actorId: string;
            action: string;
            fromValue: string | null;
            toValue: string | null;
            createdAt: number;
          }[];
        }>(`/tasks/${encodeURIComponent(taskId)}/activity`, { orgId }).then(
          (body): TaskActivityItem[] =>
            body.activity.map((row) => {
              const view: Record<string, unknown> = {
                _id: row.id,
                _creationTime: row.createdAt,
                organizationId: row.organizationId,
                taskId: row.taskId,
                projectId: row.projectId,
                actorType: row.actorType,
                actorId: row.actorId,
                action: row.action,
                ...(row.fromValue !== null ? { fromValue: row.fromValue } : {}),
                ...(row.toValue !== null ? { toValue: row.toValue } : {}),
                createdAt: row.createdAt,
              };
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one fetch-boundary projection to the 0.4 shape
              return view as TaskActivityItem;
            }),
        ),
    };
  },
};

// ---------------------------------------------------------------------------
// Write adapters
// ---------------------------------------------------------------------------

function invalidateTasks(client: QueryClient, orgId: string): void {
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'task'),
  });
}

const taskWriteInvalidate = (
  client: QueryClient,
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void => {
  const orgId = orgOf(args, ctx);
  if (orgId !== undefined) invalidateTasks(client, orgId);
};

function requireOrg(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) {
    throw new Error('No active organization for this write');
  }
  return orgId;
}

function requireString(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${field}`);
  }
  return value;
}

/** POST a task verb under `/tasks/:taskId/<verb>`, body = args minus ids. */
function taskVerb(
  verb: string,
): (args: Record<string, unknown>, ctx: AdapterContext) => Promise<unknown> {
  return async (args, ctx) => {
    const orgId = requireOrg(args, ctx);
    const taskId = requireString(args, 'taskId');
    const { organizationId: _org, taskId: _task, ...body } = args;
    await backendFetch(`/tasks/${encodeURIComponent(taskId)}/${verb}`, {
      method: 'POST',
      body,
      orgId,
    });
    return null;
  };
}

export const taskWriteAdapters: Record<string, WriteAdapter> = {
  'tasks/mutations:createTask': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const { organizationId: _org, ...body } = args;
      const created = await backendFetch<{ taskId: string }>('/tasks', {
        method: 'POST',
        body,
        orgId,
      });
      return created.taskId;
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:updateTask': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const taskId = requireString(args, 'taskId');
      const { taskId: _task, ...body } = args;
      await backendFetch(`/tasks/${encodeURIComponent(taskId)}`, {
        method: 'POST',
        body,
        orgId,
      });
      return null;
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:updateTaskStatus': {
    run: taskVerb('status'),
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:assignTask': {
    run: taskVerb('assign'),
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:claimTask': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const taskId = requireString(args, 'taskId');
      return backendFetch<{ claimed: boolean; reason?: string }>(
        `/tasks/${encodeURIComponent(taskId)}/claim`,
        { method: 'POST', body: {}, orgId },
      );
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:moveTask': {
    run: taskVerb('move'),
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:archiveTask': {
    run: taskVerb('archive'),
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:restoreTask': {
    run: taskVerb('restore'),
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:deleteTask': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const taskId = requireString(args, 'taskId');
      return backendFetch<{ deletedChildCount: number }>(
        `/tasks/${encodeURIComponent(taskId)}`,
        { method: 'DELETE', orgId },
      );
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:addTaskComment': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const taskId = requireString(args, 'taskId');
      return backendFetch<{
        messageId: string;
        threadId: string;
        unresolvedMentionTokens: string[];
      }>(`/tasks/${encodeURIComponent(taskId)}/comments`, {
        method: 'POST',
        body: { body: args.body },
        orgId,
      });
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:editTaskDiscussionMessage': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const messageId = requireString(args, 'messageId');
      await backendFetch(`/tasks/comments/${encodeURIComponent(messageId)}`, {
        method: 'POST',
        body: { body: args.body },
        orgId,
      });
      return null;
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:deleteTaskDiscussionMessage': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const messageId = requireString(args, 'messageId');
      await backendFetch(`/tasks/comments/${encodeURIComponent(messageId)}`, {
        method: 'DELETE',
        orgId,
      });
      return null;
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:addTaskDependency': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      await backendFetch('/tasks/dependencies', {
        method: 'POST',
        body: {
          blockerTaskId: args.blockerTaskId,
          blockedTaskId: args.blockedTaskId,
        },
        orgId,
      });
      return null;
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:removeTaskDependency': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      await backendFetch('/tasks/dependencies', {
        method: 'DELETE',
        body: {
          blockerTaskId: args.blockerTaskId,
          blockedTaskId: args.blockedTaskId,
        },
        orgId,
      });
      return null;
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:createTaskLabel': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const created = await backendFetch<{ labelId: string }>('/tasks/labels', {
        method: 'POST',
        body: { projectId: args.projectId, name: args.name },
        orgId,
      });
      return created.labelId;
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:updateTaskLabel': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const labelId = requireString(args, 'labelId');
      await backendFetch(
        `/tasks/labels/${encodeURIComponent(labelId)}/rename`,
        { method: 'POST', body: { name: args.name }, orgId },
      );
      return null;
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:deleteTaskLabel': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const labelId = requireString(args, 'labelId');
      const detach = args.detach === true ? '?detach=true' : '';
      await backendFetch(
        `/tasks/labels/${encodeURIComponent(labelId)}${detach}`,
        { method: 'DELETE', orgId },
      );
      return null;
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:ensureDefaultTaskLabels': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      await backendFetch('/tasks/labels/ensure-defaults', {
        method: 'POST',
        body: { projectId: args.projectId },
        orgId,
      });
      return null;
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/review_mutations:setTaskReviewer': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const taskId = requireString(args, 'taskId');
      await backendFetch(`/tasks/${encodeURIComponent(taskId)}`, {
        method: 'POST',
        body: {
          reviewerUserId:
            typeof args.reviewerUserId === 'string'
              ? args.reviewerUserId
              : null,
        },
        orgId,
      });
      return null;
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:cancelTaskAgentRun': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const taskId = requireString(args, 'taskId');
      await backendFetch(
        `/tasks/${encodeURIComponent(taskId)}/agent-runs/cancel-live`,
        { method: 'POST', body: {}, orgId },
      );
      return null;
    },
    invalidate: taskWriteInvalidate,
  },
  'collab/subscriptions:subscribeToTask': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const taskId = requireString(args, 'taskId');
      await backendFetch(
        `/collab/tasks/${encodeURIComponent(taskId)}/subscription`,
        { method: 'POST', body: { subscribed: true }, orgId },
      );
      return null;
    },
    invalidate: taskWriteInvalidate,
  },
  'collab/subscriptions:unsubscribeFromTask': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const taskId = requireString(args, 'taskId');
      await backendFetch(
        `/collab/tasks/${encodeURIComponent(taskId)}/subscription`,
        { method: 'POST', body: { subscribed: false }, orgId },
      );
      return null;
    },
    invalidate: taskWriteInvalidate,
  },
  'collab/subscriptions:setTaskMuted': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const taskId = requireString(args, 'taskId');
      await backendFetch(
        `/collab/tasks/${encodeURIComponent(taskId)}/subscription`,
        { method: 'POST', body: { muted: args.muted === true }, orgId },
      );
      return null;
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:saveBoardView': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const { organizationId: _org, ...body } = args;
      const saved = await backendFetch<{ viewId: string }>(
        '/tasks/board-views',
        { method: 'POST', body, orgId },
      );
      return saved.viewId;
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:deleteBoardView': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const viewId = requireString(args, 'viewId');
      await backendFetch(`/tasks/board-views/${encodeURIComponent(viewId)}`, {
        method: 'DELETE',
        orgId,
      });
      return null;
    },
    invalidate: taskWriteInvalidate,
  },
};
