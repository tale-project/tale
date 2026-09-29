/**
 * Tasks vertical over the 0.5 backend — the board core's adapter rows.
 * Response types are DERIVED from the 0.4 function signatures
 * (`FunctionReturnType`), and every pg wire row is projected to the 0.4 doc
 * shape in exactly one place here (`id` → `_id`, null → omitted-optional).
 */

import { isEpochMs } from '@tale/shared/schemas/epoch-ms';
import { taskExternalIssueSchema } from '@tale/shared/schemas/task-external-issue';
import type { QueryClient } from '@tanstack/react-query';

import type { ItemOf, PageItemOf, ReturnsOf } from '@/app/lib/backend/contract';
import type { TaskStatusWriteResult } from '@/app/lib/backend/contract/tasks';
import { parseTaskRepeat } from '@/lib/shared/task-repeat';

import type {
  AdapterContext,
  PaginatedAdapter,
  ReadAdapter,
  WriteAdapter,
} from './adapters';
import { backendFetch, BackendApiError } from './api-client';
import {
  backendEntityPrefix,
  backendKey,
  type BackendQueryKey,
} from './query-keys';

// ---------------------------------------------------------------------------
// Wire rows + 0.4-shape projections
// ---------------------------------------------------------------------------

type TasksByProjectResult = ReturnsOf<'tasks/queries:listTasksByProject'>;
type TaskItem = TasksByProjectResult['tasks'][number];
type GetTaskResult = ReturnsOf<'tasks/queries:getTask'>;
type TaskLabelItem = ItemOf<'tasks/queries:listTaskLabels'>;
type TaskDependenciesResult = ReturnsOf<'tasks/queries:listTaskDependencies'>;
type ProjectDependencyEdge = ItemOf<'tasks/queries:listProjectDependencies'>;
type TaskDiscussionComment = PageItemOf<'tasks/queries:listTaskDiscussion'>;
type TaskActivityItem = ItemOf<'tasks/queries:listTaskActivity'>;
type ProjectTaskMetricsResult =
  ReturnsOf<'tasks/queries:getProjectTaskMetrics'>;

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
  externalIssue?: unknown;
  threadId: string | null;
  discussionThreadId: string | null;
  sourceDiscussionThreadId: string | null;
  startDate: number | null;
  startNotifiedAt: number | null;
  dueDate: number | null;
  /** The stored repeat rule, as written — validated on the way in below. */
  repeat: unknown;
  repeatNextTaskId: string | null;
  /** Whether the task has continued its series — true still once that
   * next task is deleted, when the pointer above is cleared. */
  repeatContinued: boolean;
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
  const externalIssue = taskExternalIssueSchema.safeParse(row.externalIssue);
  // A rule that no longer validates (a zone the runtime dropped) reads as
  // none, so the board never renders a series it cannot describe.
  const repeat = parseTaskRepeat(row.repeat);
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
    ...(externalIssue.success ? { externalIssue: externalIssue.data } : {}),
    ...(row.threadId !== null ? { threadId: row.threadId } : {}),
    ...(row.discussionThreadId !== null
      ? { discussionThreadId: row.discussionThreadId }
      : {}),
    ...(row.sourceDiscussionThreadId !== null
      ? { sourceDiscussionThreadId: row.sourceDiscussionThreadId }
      : {}),
    // A start or due date stored before the doors held it to the epoch
    // bound can be a number no `Date` holds: it reads as none, so the card
    // and the date picker never format an invalid date.
    ...(isEpochMs(row.startDate) ? { startDate: row.startDate } : {}),
    ...(row.startNotifiedAt !== null
      ? { startNotifiedAt: row.startNotifiedAt }
      : {}),
    ...(isEpochMs(row.dueDate) ? { dueDate: row.dueDate } : {}),
    ...(repeat !== null ? { repeat } : {}),
    ...(typeof row.repeatNextTaskId === 'string'
      ? { repeatNextTaskId: row.repeatNextTaskId }
      : {}),
    ...(row.repeatContinued ? { repeatContinued: true } : {}),
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
  canCreate: boolean;
}

function boardView(body: BoardWire): TasksByProjectResult {
  return {
    tasks: body.tasks.map(taskView),
    truncated: body.truncated,
    canEdit: body.canEdit,
    canCreate: body.canCreate,
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

/**
 * The key every read of one board starts with, whatever its filters: a
 * project's board, or the all-projects board. A board that keeps its rows
 * while another search of it loads matches on this, so it never shows
 * another board's rows.
 */
export function taskBoardScope(
  orgId: string,
  projectId?: string,
): BackendQueryKey {
  return projectId === undefined
    ? backendKey(orgId, 'task', 'across-projects')
    : backendKey(orgId, 'task', 'by-project', projectId);
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
  const reviewerId = typeof args.reviewerId === 'string' ? args.reviewerId : '';
  const externalSystem =
    typeof args.externalSystem === 'string' ? args.externalSystem : '';
  // The toolbar's search is a board filter: the server matches it with the
  // others before the board's cap, so the rows ARE the search result.
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const params = new URLSearchParams({
    includeArchived: String(includeArchived),
    ...(status.length > 0 ? { status } : {}),
    ...(statuses.length > 0 ? { statuses: statuses.join(',') } : {}),
    ...(assigneeId.length > 0 ? { assigneeId } : {}),
    ...(reviewerId.length > 0 ? { reviewerId } : {}),
    ...(externalSystem.length > 0 ? { externalSystem } : {}),
    ...(query.length > 0 ? { q: query } : {}),
  });
  return {
    search: params.toString(),
    key: [
      includeArchived,
      status,
      statuses.join(','),
      assigneeId,
      reviewerId,
      externalSystem,
      query,
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
      queryKey: [...taskBoardScope(orgId, projectId), ...filters.key],
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
      queryKey: [...taskBoardScope(orgId), ...filters.key],
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
          canCreate: boolean;
          canComment: boolean;
          ancestors?: NonNullable<GetTaskResult>['ancestors'];
        }>(`/tasks/${encodeURIComponent(taskId)}`, { orgId }).then(
          (body): GetTaskResult => ({
            task: taskView(body.task),
            canEdit: body.canEdit,
            canCreate: body.canCreate,
            canComment: body.canComment,
            ancestors: body.ancestors ?? [],
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
  'tasks/queries:getProjectTaskMetrics': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const projectId = args.projectId;
    if (orgId === undefined || typeof projectId !== 'string') return null;
    const periodDays =
      typeof args.periodDays === 'number' ? args.periodDays : 30;
    // Keyed under `task`: every task hint (a move, a settle, a comment)
    // refreshes the figures the way it refreshes the board.
    return {
      queryKey: backendKey(
        orgId,
        'task',
        'metrics',
        projectId,
        String(periodDays),
      ),
      queryFn: () =>
        backendFetch<ProjectTaskMetricsResult>(
          `/tasks/metrics/by-project/${encodeURIComponent(projectId)}?periodDays=${periodDays}`,
          { orgId },
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
  'tasks/search:searchTasks': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const query = typeof args.query === 'string' ? args.query : '';
    if (orgId === undefined) return null;
    const projectId =
      typeof args.projectId === 'string' ? args.projectId : undefined;
    const params = new URLSearchParams({
      q: query,
      ...(projectId !== undefined ? { projectId } : {}),
    });
    return {
      queryKey: backendKey(orgId, 'task', 'search', projectId ?? '', query),
      queryFn: () =>
        backendFetch<{ results: unknown[] }>(
          `/tasks/search?${params.toString()}`,
          { orgId },
        ).then((body) => body.results),
    };
  },
  'tasks/queries:mentionTriggerPreview': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const slugs = Array.isArray(args.slugs)
      ? args.slugs.filter((slug): slug is string => typeof slug === 'string')
      : [];
    const taskId = typeof args.taskId === 'string' ? args.taskId : undefined;
    const projectId =
      typeof args.projectId === 'string' ? args.projectId : undefined;
    if (taskId === undefined && projectId === undefined) return null;
    const params = new URLSearchParams({
      slugs: slugs.join(','),
      ...(taskId !== undefined ? { taskId } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
    });
    return {
      queryKey: backendKey(
        orgId,
        'task',
        'mention-preview',
        taskId ?? projectId ?? '',
        slugs.join(','),
      ),
      queryFn: () =>
        backendFetch<{ previews: unknown[] }>(
          `/tasks/mention-preview?${params.toString()}`,
          { orgId },
        ).then((body) => body.previews),
    };
  },
  'tasks/queries:getLatestTaskAgentRunForTask': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const taskId = args.taskId;
    if (orgId === undefined || typeof taskId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'latest-run', taskId),
      queryFn: () =>
        backendFetch<{ run: unknown }>(
          `/tasks/${encodeURIComponent(taskId)}/agent-runs/latest`,
          { orgId },
        ).then((body) => body.run),
      // The run card follows a LIVE run through queued → running → settled,
      // and the run-lifecycle writes emit no task hint — poll while the
      // task modal holds the card open (the WS lane pushed; the HTTP lane
      // asks).
      refetchInterval: 2000,
    };
  },
  'tasks/queries:getTaskAgentRunSandboxOp': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const runId = args.runId;
    if (orgId === undefined || typeof runId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'run-sandbox-op', runId),
      queryFn: () =>
        backendFetch<{ op: unknown }>(
          `/tasks/agent-runs/${encodeURIComponent(runId)}/sandbox-op`,
          { orgId },
        ).then((body) => body.op),
      // The live transcript follows a LIVE turn: poll while the details
      // dialog is open (the WS lane pushed; the HTTP lane asks) — the twin
      // of the automation agent-node op read above.
      refetchInterval: 2000,
    };
  },
  'automations/queries:getLiveRunForTask': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const taskId = args.taskId;
    if (orgId === undefined || typeof taskId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'live-automation-run', taskId),
      queryFn: () =>
        backendFetch<{ run: unknown }>(
          `/tasks/${encodeURIComponent(taskId)}/live-automation-run`,
          { orgId },
        ).then((body) => body.run),
    };
  },
  'automations/queries:getLatestRunForTask': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const taskId = args.taskId;
    if (orgId === undefined || typeof taskId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'latest-automation-run', taskId),
      queryFn: () =>
        backendFetch<{ run: unknown }>(
          `/tasks/${encodeURIComponent(taskId)}/latest-automation-run`,
          { orgId },
        ).then((body) => body.run),
    };
  },
  'automations/queries:listAutomations': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const projectId =
      typeof args.projectId === 'string' ? args.projectId : undefined;
    const includeProjectBound = args.includeProjectBound === true;
    const params = new URLSearchParams({
      ...(projectId !== undefined ? { projectId } : {}),
      ...(includeProjectBound ? { includeProjectBound: 'true' } : {}),
    });
    return {
      queryKey: backendKey(
        orgId,
        'automation',
        'listing',
        projectId ?? '',
        includeProjectBound,
      ),
      queryFn: () =>
        backendFetch<{ automations: unknown[] }>(
          `/automations/listing?${params.toString()}`,
          { orgId },
        ).then((body) => body.automations),
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
// Paginated adapters
// ---------------------------------------------------------------------------

/** One comment as the backend answers it (nulls for the absent optionals). */
interface TaskDiscussionCommentWire {
  messageId: string;
  authorType: string;
  authorId: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  mentions: { type: string; id: string }[] | null;
  bodyByLocale: Record<string, string> | null;
}

function toTaskDiscussionComment(
  wire: TaskDiscussionCommentWire,
): TaskDiscussionComment {
  const view: Record<string, unknown> = {
    messageId: wire.messageId,
    authorType: wire.authorType,
    authorId: wire.authorId,
    body: wire.body,
    createdAt: wire.createdAt,
    ...(wire.editedAt !== null ? { editedAt: wire.editedAt } : {}),
    ...(wire.mentions !== null ? { mentions: wire.mentions } : {}),
    ...(wire.bodyByLocale !== null ? { bodyByLocale: wire.bodyByLocale } : {}),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one fetch-boundary projection to the 0.4 shape
  return view as unknown as TaskDiscussionComment;
}

export const taskPaginatedAdapters: Record<string, PaginatedAdapter> = {
  /** The discussion walks NEWEST-first: page one is the latest comments,
   * `continueCursor` reads the ones before them — so a busy task's freshest
   * comment is always on screen and no fixed window hides the rest. */
  'tasks/queries:listTaskDiscussion': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const taskId = args.taskId;
    if (orgId === undefined || typeof taskId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'task', 'discussion', taskId),
      fetchPage: (cursor, numItems) => {
        const query = new URLSearchParams({ numItems: String(numItems) });
        if (cursor !== null) query.set('cursor', cursor);
        return backendFetch<{
          page: TaskDiscussionCommentWire[];
          isDone: boolean;
          continueCursor: string;
        }>(
          `/tasks/${encodeURIComponent(taskId)}/comments?${query.toString()}`,
          { orgId },
        ).then((body) => ({
          page: body.page.map(toTaskDiscussionComment),
          isDone: body.isDone,
          continueCursor: body.continueCursor,
        }));
      },
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

/** POST a task verb under `/tasks/:taskId/<verb>`, body = args minus ids.
 *  `project` shapes the answer; without one the verb answers `null`. */
function taskVerb(
  verb: string,
  project: (body: unknown) => unknown = () => null,
): (args: Record<string, unknown>, ctx: AdapterContext) => Promise<unknown> {
  return async (args, ctx) => {
    const orgId = requireOrg(args, ctx);
    const taskId = requireString(args, 'taskId');
    const { organizationId: _org, taskId: _task, ...body } = args;
    const answer = await backendFetch<unknown>(
      `/tasks/${encodeURIComponent(taskId)}/${verb}`,
      { method: 'POST', body, orgId },
    );
    return project(answer);
  };
}

/** "Stop repeating" answers whether the untouched next task was taken
 *  back; anything but an explicit `true` reads as kept. */
function stopRepeatView(body: unknown): { removedNextTask: boolean } {
  const removed =
    typeof body === 'object' &&
    body !== null &&
    'removedNextTask' in body &&
    body.removedNextTask === true;
  return { removedNextTask: removed };
}

/** The status and move routes' answer, read field by field. */
interface StatusWriteWire {
  nextTask?: { id?: unknown; number?: unknown; dueDate?: unknown } | null;
}

/** A status change or move answers the next copy of a repeating task when
 *  that write closed one; nulls become absent fields, as on every task. */
function statusWriteView(body: unknown): TaskStatusWriteResult {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fetch boundary: every field is checked below
  const next = (body as StatusWriteWire | null | undefined)?.nextTask;
  if (typeof next?.id !== 'string') return {};
  return {
    nextTask: {
      id: next.id,
      ...(typeof next.number === 'number' ? { number: next.number } : {}),
      ...(isEpochMs(next.dueDate) ? { dueDate: next.dueDate } : {}),
    },
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
    run: taskVerb('status', statusWriteView),
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:assignTask': {
    run: taskVerb('assign'),
    invalidate: taskWriteInvalidate,
  },
  'tasks/mutations:moveTask': {
    run: taskVerb('move', statusWriteView),
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
  'tasks/mutations:stopTaskRepeat': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const taskId = requireString(args, 'taskId');
      const answer = await backendFetch<unknown>(
        `/tasks/${encodeURIComponent(taskId)}/repeat/stop`,
        { method: 'POST', body: {}, orgId },
      );
      return stopRepeatView(answer);
    },
    // The next task this may take back answers 404 once it is gone, so its
    // reads are left out here — refetching them would log a failed request
    // each; the caller refreshes them when the answer says the task stayed.
    // Every other task read refreshes.
    invalidate: (client, args, ctx) => {
      const orgId = orgOf(args, ctx);
      if (orgId === undefined) return;
      const nextTaskId = args.nextTaskId;
      void client.invalidateQueries({
        queryKey: backendEntityPrefix(orgId, 'task'),
        predicate: (query) =>
          typeof nextTaskId !== 'string' ||
          !query.queryKey.includes(nextTaskId),
      });
    },
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
    // The deleted task's own reads can only answer 404 now, and the dialog
    // showing them closes as soon as the delete lands: refetching them would
    // log one failed request per read. Every other task read refreshes.
    invalidate: (client, args, ctx) => {
      const orgId = orgOf(args, ctx);
      if (orgId === undefined) return;
      const taskId = args.taskId;
      void client.invalidateQueries({
        queryKey: backendEntityPrefix(orgId, 'task'),
        predicate: (query) =>
          typeof taskId !== 'string' || !query.queryKey.includes(taskId),
      });
    },
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
  'tasks/mutations:startTaskAgentRun': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const taskId = requireString(args, 'taskId');
      return backendFetch<{ started: boolean; reason?: string }>(
        `/tasks/${encodeURIComponent(taskId)}/agent-runs/start`,
        { method: 'POST', body: {}, orgId },
      );
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/public_actions:startTaskWorkflow': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const taskId = requireString(args, 'taskId');
      return backendFetch(
        `/tasks/${encodeURIComponent(taskId)}/workflow/start`,
        {
          method: 'POST',
          body: { workflowSlug: args.workflowSlug },
          orgId,
        },
      );
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/public_actions:cancelTaskWorkflow': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const taskId = requireString(args, 'taskId');
      // The column a person moved the card to, and where in it, rides the
      // stop; without one the task parks at Cancelled.
      const { organizationId: _org, taskId: _task, ...body } = args;
      return backendFetch(
        `/tasks/${encodeURIComponent(taskId)}/workflow/cancel`,
        { method: 'POST', body, orgId },
      );
    },
    invalidate: taskWriteInvalidate,
  },
  'tasks/public_actions:createTaskFromExternalIssue': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const { organizationId: _org, ...body } = args;
      return backendFetch('/tasks/from-external-issue', {
        method: 'POST',
        body,
        orgId,
      });
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
};
