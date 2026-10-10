/**
 * The REST machine door (`/api/v1`, see `backend/rest/v1*.ts` and
 * `public/openapi.json`) as an integration drives it: a personal API key as
 * `Authorization: Bearer`, the organization named by `X-Organization-Slug`
 * (a key holder in several organizations must name one on every call).
 *
 * A REST chat turn is asynchronous: the send answers 202 with the reply's
 * id, and the client polls `GET …/generation` (`queued` → `streaming` →
 * `idle`) with `since` set to the text it already holds.
 */

import {
  type ApiClient,
  type ApiResult,
  asNumber,
  asRecord,
  asString,
  mapResult,
  rowsOf,
} from './client.ts';

const enc = encodeURIComponent;

/** The headers that authenticate every REST request of one integration. */
export function restHeaders(
  apiKey: string,
  organizationSlug: string,
): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'x-organization-slug': organizationSlug,
  };
}

export interface RestModel {
  id: string;
  providerSlug: string;
}

/** `GET /api/v1/models` — the models this key may send to. */
export async function restModels(
  api: ApiClient,
): Promise<ApiResult<RestModel[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/v1/models',
    name: 'GET /api/v1/models',
  });
  return mapResult(result, (body) =>
    rowsOf(body, 'models').flatMap((row) => {
      const id = asString(row.id);
      const providerSlug = asString(row.providerSlug);
      return id === undefined || providerSlug === undefined
        ? []
        : [{ id, providerSlug }];
    }),
  );
}

/** `POST /api/v1/threads` → the thread id (201). */
export async function restCreateThread(
  api: ApiClient,
  title: string,
): Promise<ApiResult<string>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/v1/threads',
    json: { title },
    name: 'POST /api/v1/threads',
  });
  return mapResult(result, (body) => asString(asRecord(body)?.id));
}

/** `GET /api/v1/threads?limit=` — the key holder's threads. */
export async function restListThreads(
  api: ApiClient,
  limit = 25,
): Promise<ApiResult<string[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/v1/threads',
    query: { limit },
    name: 'GET /api/v1/threads',
  });
  return mapResult(result, (body) =>
    rowsOf(body, 'page').flatMap((row) => {
      const id = asString(row.id);
      return id === undefined ? [] : [id];
    }),
  );
}

/**
 * `POST /api/v1/threads/:id/messages` → the reply's message id (202). 409
 * means a turn is still running on the thread.
 */
export async function restSendMessage(
  api: ApiClient,
  threadId: string,
  args: { content: string; model: string; providerSlug?: string },
): Promise<ApiResult<string>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: `/api/v1/threads/${enc(threadId)}/messages`,
    json: args,
    name: 'POST /api/v1/threads/:id/messages',
    refusals: [409],
  });
  return mapResult(result, (body) => asString(asRecord(body)?.messageId));
}

export interface GenerationPoll {
  status: 'queued' | 'streaming' | 'idle' | 'unknown';
  /** Total length of the streamed text so far (`textLength`). */
  textLength: number;
  lastStatus: string | undefined;
}

/** `GET /api/v1/threads/:id/generation?since=` — one poll. */
export async function restPollGeneration(
  api: ApiClient,
  threadId: string,
  since: number,
): Promise<ApiResult<GenerationPoll>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: `/api/v1/threads/${enc(threadId)}/generation`,
    query: since > 0 ? { since } : undefined,
    name: 'GET /api/v1/threads/:id/generation',
  });
  return mapResult(result, (body) => {
    const record = asRecord(body);
    const status = asString(record?.status);
    return {
      status:
        status === 'queued' || status === 'streaming' || status === 'idle'
          ? status
          : 'unknown',
      textLength: asNumber(record?.textLength) ?? since,
      lastStatus: asString(record?.lastStatus),
    };
  });
}

/** `GET /api/v1/threads/:id/messages`. */
export function restListMessages(
  api: ApiClient,
  threadId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: `/api/v1/threads/${enc(threadId)}/messages`,
    name: 'GET /api/v1/threads/:id/messages',
  });
}

export interface RestTaskIntake {
  externalSystem: string;
  externalId: string;
  title: string;
  description?: string;
  labels?: string[];
}

/** `POST /api/v1/projects/:id/tasks` — the external-ref intake (an upsert). */
export async function restUpsertTask(
  api: ApiClient,
  projectId: string,
  intake: RestTaskIntake,
): Promise<ApiResult<{ id: string; created: boolean }>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: `/api/v1/projects/${enc(projectId)}/tasks`,
    json: intake,
    name: 'POST /api/v1/projects/:id/tasks',
  });
  return mapResult(result, (body) => {
    const task = asRecord(asRecord(body)?.task);
    const id = asString(task?.id);
    return id === undefined
      ? undefined
      : { id, created: task?.created === true };
  });
}

/** `GET /api/v1/projects/:id/tasks/:taskId`. */
export function restGetTask(
  api: ApiClient,
  projectId: string,
  taskId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: `/api/v1/projects/${enc(projectId)}/tasks/${enc(taskId)}`,
    name: 'GET /api/v1/projects/:id/tasks/:taskId',
    refusals: [404],
  });
}

/** `POST /api/v1/projects/:id/tasks/:taskId/comments`. */
export function restCommentTask(
  api: ApiClient,
  projectId: string,
  taskId: string,
  body: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: `/api/v1/projects/${enc(projectId)}/tasks/${enc(taskId)}/comments`,
    json: { body },
    name: 'POST /api/v1/projects/:id/tasks/:taskId/comments',
    refusals: [404],
  });
}

/** `GET /api/v1/projects/:id/tasks/:taskId/comments`. */
export function restListTaskComments(
  api: ApiClient,
  projectId: string,
  taskId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: `/api/v1/projects/${enc(projectId)}/tasks/${enc(taskId)}/comments`,
    name: 'GET /api/v1/projects/:id/tasks/:taskId/comments',
    refusals: [404],
  });
}

/** `PATCH /api/v1/projects/:id/tasks/:taskId` — archive or restore. */
export function restArchiveTask(
  api: ApiClient,
  projectId: string,
  taskId: string,
  archived: boolean,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'PATCH',
    path: `/api/v1/projects/${enc(projectId)}/tasks/${enc(taskId)}`,
    json: { archived },
    name: 'PATCH /api/v1/projects/:id/tasks/:taskId',
    refusals: [404],
  });
}

/**
 * `POST /api/v1/knowledge/search` → the number of hits. 409 is an
 * organization without an embedding model.
 */
export async function restSearchKnowledge(
  api: ApiClient,
  query: string,
  limit = 10,
): Promise<ApiResult<number>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/v1/knowledge/search',
    json: { query, limit },
    name: 'POST /api/v1/knowledge/search',
    refusals: [409],
  });
  return mapResult(result, (body) => rowsOf(body, 'hits').length);
}
