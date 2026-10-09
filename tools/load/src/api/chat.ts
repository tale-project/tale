/**
 * The chat surface (`/api/app/chat`, see `backend/domains/chat/routes.ts`
 * and the SPA's `app/lib/backend/chat.ts`). A thread belongs to its user;
 * every route takes the organization as `?orgId=`.
 *
 * The send is the 0.4 action contract: the POST is held open for the whole
 * turn and answers `{status: 'completed'}` or `{status: 'refused', reason,
 * persisted}` once it settles, while the reply streams over the thread's
 * own SSE lane (`realtime.ts`).
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

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'extra' | 'max';

export interface ThreadRow {
  id: string;
  title: string | undefined;
  pinned: boolean;
  generating: boolean;
  lastReplyAt: number | undefined;
  lastReadAt: number | undefined;
}

function threadRows(rows: Record<string, unknown>[]): ThreadRow[] {
  return rows.flatMap((row) => {
    const id = asString(row.id);
    if (id === undefined) return [];
    return [
      {
        id,
        title: asString(row.title),
        pinned: asNumber(row.pinnedAt) !== undefined,
        generating: row.generating === true,
        lastReplyAt: asNumber(row.lastReplyAt),
        lastReadAt: asNumber(row.lastReadAt),
      },
    ];
  });
}

/** `GET /api/app/chat/threads?orgId=` — the panel's list. */
export async function listThreads(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<ThreadRow[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/chat/threads',
    query: orgQuery(orgId),
    name: 'GET /api/app/chat/threads',
  });
  return mapResult(result, (body) => threadRows(rowsOf(body, 'threads')));
}

/** `GET /api/app/chat/threads/search?q=&orgId=`. */
export function searchThreads(
  api: ApiClient,
  orgId: string,
  query: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/chat/threads/search',
    query: orgQuery(orgId, { q: query }),
    name: 'GET /api/app/chat/threads/search',
  });
}

export interface CreateThreadArgs {
  title?: string;
  projectId?: string;
  reasoningEffort?: ReasoningEffort;
}

/** `POST /api/app/chat/threads` → the new thread's id. */
export async function createThread(
  api: ApiClient,
  orgId: string,
  args: CreateThreadArgs,
): Promise<ApiResult<string>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/app/chat/threads',
    query: orgQuery(orgId),
    json: args,
    name: 'POST /api/app/chat/threads',
  });
  return mapResult(result, (body) => asString(asRecord(body)?.id));
}

export interface SendArgs {
  text: string;
  modelId: string;
  providerSlug: string;
  reasoningEffort?: ReasoningEffort;
  locale?: string;
}

export interface TurnOutcome {
  status: 'completed' | 'refused';
  reason: string | undefined;
  code: string | undefined;
  persisted: boolean;
}

/**
 * `POST /api/app/chat/threads/:id/messages` — held open until the turn
 * settles. Refusals the composer shows rather than errors: 409 (a turn is
 * already running), 429 (a budget cap, with `Retry-After`), 503 (the backend
 * is draining for a deploy); each carries the same `{status: 'refused'}`
 * body as a 200 refusal.
 */
export async function sendMessage(
  api: ApiClient,
  orgId: string,
  threadId: string,
  args: SendArgs,
  timeoutMs: number,
): Promise<ApiResult<TurnOutcome>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: `/api/app/chat/threads/${enc(threadId)}/messages`,
    query: orgQuery(orgId),
    json: args,
    name: 'POST /api/app/chat/threads/:id/messages',
    refusals: [409, 503],
    timeoutMs,
  });
  const parsed = asRecord(result.response?.json());
  const outcome: TurnOutcome | undefined =
    parsed !== undefined &&
    (parsed.status === 'completed' || parsed.status === 'refused')
      ? {
          status: parsed.status,
          reason: asString(parsed.reason),
          code: asString(parsed.code),
          persisted: parsed.persisted === true,
        }
      : undefined;
  return { ...result, body: outcome };
}

/** `POST /api/app/chat/messages/:id/perceived-wait` — the client's TTFT stamp. */
export function reportPerceivedWait(
  api: ApiClient,
  orgId: string,
  messageId: string,
  perceivedWaitMs: number,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: `/api/app/chat/messages/${enc(messageId)}/perceived-wait`,
    query: orgQuery(orgId),
    json: {
      perceivedWaitMs: Math.min(
        600_000,
        Math.max(1, Math.round(perceivedWaitMs)),
      ),
    },
    name: 'POST /api/app/chat/messages/:id/perceived-wait',
  });
}

export interface MessageRow {
  id: string;
  role: string;
  text: string;
  status: string | undefined;
}

function textOfParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  let text = '';
  for (const part of parts) {
    const value = asString(asRecord(part)?.text);
    if (value !== undefined) text += text === '' ? value : `\n${value}`;
  }
  return text;
}

/** `GET /api/app/chat/threads/:id/messages?orgId=` — the transcript. */
export async function listMessages(
  api: ApiClient,
  orgId: string,
  threadId: string,
): Promise<ApiResult<MessageRow[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: `/api/app/chat/threads/${enc(threadId)}/messages`,
    query: orgQuery(orgId),
    name: 'GET /api/app/chat/threads/:id/messages',
    refusals: [404],
  });
  return mapResult(result, (body) =>
    rowsOf(body, 'messages').flatMap((row) => {
      const id = asString(row.id);
      const role = asString(row.role);
      return id === undefined || role === undefined
        ? []
        : [
            {
              id,
              role,
              text: textOfParts(row.parts),
              status: asString(row.status),
            },
          ];
    }),
  );
}

/** A thread verb answering `{ok}`: rename, pin, read, trash, archive. */
async function threadVerb(
  api: ApiClient,
  orgId: string,
  threadId: string,
  verb: 'rename' | 'pin' | 'read' | 'trash' | 'archive' | 'reasoning-effort',
  body: unknown,
): Promise<ApiResult<boolean>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: `/api/app/chat/threads/${enc(threadId)}/${verb}`,
    query: orgQuery(orgId),
    json: body,
    name: `POST /api/app/chat/threads/:id/${verb}`,
    refusals: [404, 409],
  });
  return mapResult(result, (value) => asRecord(value)?.ok === true);
}

export function renameThread(
  api: ApiClient,
  orgId: string,
  threadId: string,
  title: string,
): Promise<ApiResult<boolean>> {
  return threadVerb(api, orgId, threadId, 'rename', { title });
}

export function pinThread(
  api: ApiClient,
  orgId: string,
  threadId: string,
  pinned: boolean,
): Promise<ApiResult<boolean>> {
  return threadVerb(api, orgId, threadId, 'pin', { pinned });
}

export function markThreadRead(
  api: ApiClient,
  orgId: string,
  threadId: string,
): Promise<ApiResult<boolean>> {
  return threadVerb(api, orgId, threadId, 'read', {});
}

/** Answers `ok: false` (not an error) while a turn is still running. */
export function trashThread(
  api: ApiClient,
  orgId: string,
  threadId: string,
): Promise<ApiResult<boolean>> {
  return threadVerb(api, orgId, threadId, 'trash', {});
}

export function setThreadReasoningEffort(
  api: ApiClient,
  orgId: string,
  threadId: string,
  reasoningEffort: ReasoningEffort,
): Promise<ApiResult<boolean>> {
  return threadVerb(api, orgId, threadId, 'reasoning-effort', {
    reasoningEffort,
  });
}

/** `POST /api/app/chat/threads/:id/cancel` → whether a turn was running. */
export async function cancelTurn(
  api: ApiClient,
  orgId: string,
  threadId: string,
): Promise<ApiResult<boolean>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: `/api/app/chat/threads/${enc(threadId)}/cancel`,
    query: orgQuery(orgId),
    json: {},
    name: 'POST /api/app/chat/threads/:id/cancel',
    refusals: [404],
  });
  return mapResult(result, (body) => asRecord(body)?.cancelled === true);
}
