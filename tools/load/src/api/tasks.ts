/**
 * The task board (`/api/app/tasks`, see `backend/domains/tasks/routes.ts`
 * and the SPA's `app/lib/backend/tasks.ts`). Board reads use the SPA's own
 * filter string (`includeArchived`, `summary=true`, then the filters).
 *
 * Who may do what: any reader of a project creates tasks in it and works
 * their own; editors and up work every task. A refusal for someone else's
 * task is a 403 the board would never have offered — accepted here as a
 * refusal so a user acting on a stale board does not count an error.
 */

import {
  type ApiClient,
  type ApiResult,
  asNumber,
  asRecord,
  asString,
  mapResult,
  orgQuery,
  rowsOf,
} from './client.ts';

const enc = encodeURIComponent;

export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The statuses Home lists as "my open work". */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
];

export type TaskPriority = 'p0' | 'p1' | 'p2' | 'p3';

export interface TaskRow {
  id: string;
  projectId: string | undefined;
  title: string | undefined;
  status: string | undefined;
  assigneeId: string | undefined;
  createdBy: string | undefined;
  updatedAt: number | undefined;
}

function taskRows(body: unknown): TaskRow[] {
  return rowsOf(body, 'tasks').flatMap((row) => {
    const id = asString(row.id) ?? asString(row._id);
    if (id === undefined) return [];
    return [
      {
        id,
        projectId: asString(row.projectId),
        title: asString(row.title),
        status: asString(row.status),
        assigneeId: asString(row.assigneeId),
        createdBy: asString(row.createdBy) ?? asString(row.creatorId),
        updatedAt: asNumber(row.updatedAt),
      },
    ];
  });
}

export interface BoardFilters {
  status?: TaskStatus;
  statuses?: readonly TaskStatus[];
  assigneeId?: string;
  reviewerId?: string;
  query?: string;
}

/** The SPA's board filter string, in its parameter order. */
export function boardQuery(
  orgId: string,
  filters: BoardFilters,
): Record<string, string> {
  const query: Record<string, string> = {
    includeArchived: 'false',
    summary: 'true',
  };
  if (filters.status !== undefined) query.status = filters.status;
  if (filters.statuses !== undefined && filters.statuses.length > 0) {
    query.statuses = filters.statuses.join(',');
  }
  if (filters.assigneeId !== undefined) query.assigneeId = filters.assigneeId;
  if (filters.reviewerId !== undefined) query.reviewerId = filters.reviewerId;
  if (filters.query !== undefined && filters.query.trim() !== '') {
    query.q = filters.query.trim();
  }
  query.orgId = orgId;
  return query;
}

/** `GET /api/app/tasks?…` — the all-projects board (and Home's two reads). */
export async function listTasksAcrossProjects(
  api: ApiClient,
  orgId: string,
  filters: BoardFilters,
): Promise<ApiResult<TaskRow[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/tasks',
    query: boardQuery(orgId, filters),
    name: 'GET /api/app/tasks',
  });
  return mapResult(result, taskRows);
}

/** `GET /api/app/tasks/by-project/:projectId?…` — one project's board. */
export async function listProjectBoard(
  api: ApiClient,
  orgId: string,
  projectId: string,
  filters: BoardFilters = {},
): Promise<ApiResult<TaskRow[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: `/api/app/tasks/by-project/${enc(projectId)}`,
    query: boardQuery(orgId, filters),
    name: 'GET /api/app/tasks/by-project/:projectId',
    refusals: [403, 404],
  });
  return mapResult(result, taskRows);
}

export interface CreateTaskArgs {
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  assigneeType?: 'user';
  assigneeId?: string;
  dueDate?: number;
  startDate?: number;
}

/** `POST /api/app/tasks` → the new task's id (rate limited per user). */
export async function createTask(
  api: ApiClient,
  orgId: string,
  args: CreateTaskArgs,
): Promise<ApiResult<string>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/app/tasks',
    query: orgQuery(orgId),
    json: args,
    name: 'POST /api/app/tasks',
    refusals: [403],
  });
  return mapResult(result, (body) => asString(asRecord(body)?.taskId));
}

/** `GET /api/app/tasks/:taskId?orgId=` → the task and the caller's rights. */
export async function getTask(
  api: ApiClient,
  orgId: string,
  taskId: string,
): Promise<ApiResult<{ canEdit: boolean; canComment: boolean }>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: `/api/app/tasks/${enc(taskId)}`,
    query: orgQuery(orgId),
    name: 'GET /api/app/tasks/:taskId',
    refusals: [403, 404],
  });
  return mapResult(result, (body) => {
    const record = asRecord(body);
    return {
      canEdit: record?.canEdit === true,
      canComment: record?.canComment === true,
    };
  });
}

/** `GET /api/app/tasks/:taskId/comments?numItems=&orgId=`. */
export function listTaskComments(
  api: ApiClient,
  orgId: string,
  taskId: string,
  numItems = 20,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: `/api/app/tasks/${enc(taskId)}/comments`,
    query: orgQuery(orgId, { numItems }),
    name: 'GET /api/app/tasks/:taskId/comments',
    refusals: [403, 404],
  });
}

/** `GET /api/app/tasks/:taskId/activity?orgId=`. */
export function taskActivity(
  api: ApiClient,
  orgId: string,
  taskId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: `/api/app/tasks/${enc(taskId)}/activity`,
    query: orgQuery(orgId),
    name: 'GET /api/app/tasks/:taskId/activity',
    refusals: [403, 404],
  });
}

/** `POST /api/app/tasks/:taskId/comments` (rate limited per user). */
export function commentOnTask(
  api: ApiClient,
  orgId: string,
  taskId: string,
  body: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: `/api/app/tasks/${enc(taskId)}/comments`,
    query: orgQuery(orgId),
    json: { body },
    name: 'POST /api/app/tasks/:taskId/comments',
    refusals: [403, 404],
  });
}

/** `POST /api/app/tasks/:taskId/move` — a drag to another column. */
export function moveTask(
  api: ApiClient,
  orgId: string,
  taskId: string,
  status: TaskStatus,
  placement: { beforeTaskId?: string; afterTaskId?: string } = {},
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: `/api/app/tasks/${enc(taskId)}/move`,
    query: orgQuery(orgId),
    json: { status, ...placement },
    name: 'POST /api/app/tasks/:taskId/move',
    refusals: [403, 404, 409],
  });
}

/** `POST /api/app/tasks/:taskId/status` — the status menu. */
export function setTaskStatus(
  api: ApiClient,
  orgId: string,
  taskId: string,
  status: TaskStatus,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: `/api/app/tasks/${enc(taskId)}/status`,
    query: orgQuery(orgId),
    json: { status },
    name: 'POST /api/app/tasks/:taskId/status',
    refusals: [403, 404, 409],
  });
}

/** `POST /api/app/tasks/:taskId/assign` — assign to a person. */
export function assignTask(
  api: ApiClient,
  orgId: string,
  taskId: string,
  userId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: `/api/app/tasks/${enc(taskId)}/assign`,
    query: orgQuery(orgId),
    json: { assigneeType: 'user', assigneeId: userId },
    name: 'POST /api/app/tasks/:taskId/assign',
    refusals: [403, 404],
  });
}

export interface UpdateTaskArgs {
  title?: string;
  description?: string | null;
  priority?: TaskPriority | null;
  dueDate?: number | null;
  labels?: string[];
}

/** `POST /api/app/tasks/:taskId` — the detail panel's field edits. */
export function updateTask(
  api: ApiClient,
  orgId: string,
  taskId: string,
  args: UpdateTaskArgs,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: `/api/app/tasks/${enc(taskId)}`,
    query: orgQuery(orgId),
    json: args,
    name: 'POST /api/app/tasks/:taskId',
    refusals: [403, 404],
  });
}
