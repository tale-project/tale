import { queryOptions, type QueryClient } from '@tanstack/react-query';

import { BackendApiError, backendFetch } from './api-client';
import { backendEntityPrefix, backendKey } from './query-keys';

/**
 * The chat THREAD family off the 0.5 backend — the first chat family to
 * leave the Convex websocket. Reads are `queryOptions` the seam's engine
 * (`useChatQuery`'s HTTP lane) consumes; writes are plain fetch functions
 * the action hooks call. Everything keys under
 * `['backend', orgId, 'chat_thread', …]`, the prefix the route layer's
 * user-targeted hints invalidate — so another tab's rename/archive/trash
 * reflects here within a hint round-trip, and the writer's own tab
 * invalidates the same prefix locally for instant truth.
 *
 * The backend rows carry `null` where the seam's view types use
 * optional-absent, so every read projects null → omitted ONCE, here.
 */

/** The wire row `GET /chat/threads*` answers (inc 30's 0.4 twin). */
interface ThreadSummaryWire {
  id: string;
  title: string | null;
  kind: string;
  agentSlug: string | null;
  harness: string | null;
  capabilities: unknown;
  reasoningEffort: string | null;
  projectId: string | null;
  sharedWithProject: boolean | null;
  archived: boolean;
  pinnedAt: number | null;
  lastReplyAt: number | null;
  lastReadAt: number | null;
  isShared: boolean | null;
  createdAt: number;
  updatedAt: number;
  generating: boolean;
  viewerIsOwner: boolean;
}

/** Null → optional-absent, the shape the chat view model was typed on. */
function projectThreadSummary(row: ThreadSummaryWire): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    archived: row.archived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    generating: row.generating,
    viewerIsOwner: row.viewerIsOwner,
    ...(row.title !== null ? { title: row.title } : {}),
    ...(row.agentSlug !== null ? { agentSlug: row.agentSlug } : {}),
    ...(row.harness !== null ? { harness: row.harness } : {}),
    ...(row.capabilities !== null && row.capabilities !== undefined
      ? { capabilities: row.capabilities }
      : {}),
    ...(row.reasoningEffort !== null
      ? { reasoningEffort: row.reasoningEffort }
      : {}),
    ...(row.projectId !== null ? { projectId: row.projectId } : {}),
    ...(row.sharedWithProject !== null
      ? { sharedWithProject: row.sharedWithProject }
      : {}),
    ...(row.pinnedAt !== null ? { pinnedAt: row.pinnedAt } : {}),
    ...(row.lastReplyAt !== null ? { lastReplyAt: row.lastReplyAt } : {}),
    ...(row.lastReadAt !== null ? { lastReadAt: row.lastReadAt } : {}),
    ...(row.isShared !== null ? { isShared: row.isShared } : {}),
  };
}

/** The caller's active thread list (pinned floated, newest first). */
export function chatThreadsQuery(organizationId: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'chat_thread', 'list'),
    queryFn: ({ signal }) =>
      backendFetch<{ threads: ThreadSummaryWire[] }>('/chat/threads', {
        signal,
        orgId: organizationId,
      }).then((body) => body.threads.map(projectThreadSummary)),
  });
}

/** One page of the caller's archived threads. */
export function archivedThreadsQuery(organizationId: string, cursor?: number) {
  return queryOptions({
    queryKey: backendKey(
      organizationId,
      'chat_thread',
      'archived',
      cursor ?? null,
    ),
    queryFn: ({ signal }) =>
      backendFetch<{ rows: ThreadSummaryWire[]; nextCursor: number | null }>(
        `/chat/threads/archived${cursor !== undefined ? `?cursor=${cursor}` : ''}`,
        { signal, orgId: organizationId },
      ).then((body) => ({
        rows: body.rows.map(projectThreadSummary),
        nextCursor: body.nextCursor,
      })),
  });
}

/** One thread's summary — null when it does not exist (or is not readable). */
export function chatThreadQuery(organizationId: string, threadId: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'chat_thread', 'summary', threadId),
    queryFn: ({ signal }) =>
      backendFetch<{ thread: ThreadSummaryWire }>(
        `/chat/threads/${encodeURIComponent(threadId)}/summary`,
        { signal, orgId: organizationId },
      ).then(
        (body) => projectThreadSummary(body.thread),
        (error: unknown) => {
          if (error instanceof BackendApiError && error.status === 404) {
            return null;
          }
          throw error;
        },
      ),
  });
}

/** A root's branch lineage + the stored selection map. */
export function threadBranchesQuery(
  organizationId: string,
  rootThreadId: string,
) {
  return queryOptions({
    queryKey: backendKey(
      organizationId,
      'chat_thread',
      'branches',
      rootThreadId,
    ),
    queryFn: ({ signal }) =>
      backendFetch<unknown>(
        `/chat/threads/${encodeURIComponent(rootThreadId)}/branches`,
        { signal, orgId: organizationId },
      ),
  });
}

/** The bounded palette search over the caller's chats. */
export function chatSearchQuery(organizationId: string, query: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'chat_thread', 'search', query),
    queryFn: ({ signal }) =>
      backendFetch<{ results: unknown[] }>(
        `/chat/threads/search?q=${encodeURIComponent(query)}`,
        { signal, orgId: organizationId },
      ).then((body) => body.results),
  });
}

// ---------------------------------------------------------------- writes

export interface CreateChatThreadArgs {
  organizationId: string;
  kind?: string;
  title?: string;
  agentSlug?: string;
  harness?: string;
  capabilities?: unknown;
  projectId?: string;
  reasoningEffort?: string;
}

export async function createChatThread(
  args: CreateChatThreadArgs,
): Promise<string> {
  const { organizationId, ...body } = args;
  const created = await backendFetch<{ id: string }>('/chat/threads', {
    method: 'POST',
    body,
    orgId: organizationId,
  });
  return created.id;
}

async function threadVerb(
  organizationId: string,
  threadId: string,
  verb: string,
  body: unknown,
): Promise<boolean> {
  const result = await backendFetch<{ ok: boolean }>(
    `/chat/threads/${encodeURIComponent(threadId)}/${verb}`,
    { method: 'POST', body, orgId: organizationId },
  );
  return result.ok;
}

export function renameChatThread(
  organizationId: string,
  threadId: string,
  title: string,
): Promise<boolean> {
  return threadVerb(organizationId, threadId, 'rename', { title });
}

export function setChatThreadPinned(
  organizationId: string,
  threadId: string,
  pinned: boolean,
): Promise<boolean> {
  return threadVerb(organizationId, threadId, 'pin', { pinned });
}

export function setChatThreadArchived(
  organizationId: string,
  threadId: string,
  archived: boolean,
): Promise<boolean> {
  return threadVerb(organizationId, threadId, 'archive', { archived });
}

export function markChatThreadRead(
  organizationId: string,
  threadId: string,
  read = true,
): Promise<boolean> {
  return threadVerb(organizationId, threadId, 'read', { read });
}

export function trashChatThread(
  organizationId: string,
  threadId: string,
): Promise<boolean> {
  return threadVerb(organizationId, threadId, 'trash', {});
}

export function restoreChatThread(
  organizationId: string,
  threadId: string,
): Promise<boolean> {
  return threadVerb(organizationId, threadId, 'restore', {});
}

export function moveChatThreadToProject(
  organizationId: string,
  threadId: string,
  projectId: string | null,
): Promise<boolean> {
  return threadVerb(organizationId, threadId, 'project', { projectId });
}

export function setChatThreadCapabilities(
  organizationId: string,
  threadId: string,
  capabilities: unknown,
): Promise<boolean> {
  return threadVerb(organizationId, threadId, 'capabilities', capabilities);
}

export function setChatThreadReasoningEffort(
  organizationId: string,
  threadId: string,
  reasoningEffort: string | undefined,
): Promise<boolean> {
  return threadVerb(
    organizationId,
    threadId,
    'reasoning-effort',
    reasoningEffort !== undefined ? { reasoningEffort } : {},
  );
}

export function setChatThreadSharedWithProject(
  organizationId: string,
  threadId: string,
  shared: boolean,
): Promise<boolean> {
  return threadVerb(organizationId, threadId, 'share-project', { shared });
}

export function shareChatThread(
  organizationId: string,
  threadId: string,
): Promise<{ shareToken: string }> {
  return backendFetch<{ shareToken: string }>(
    `/chat/threads/${encodeURIComponent(threadId)}/share`,
    { method: 'POST', body: {}, orgId: organizationId },
  );
}

export function unshareChatThread(
  organizationId: string,
  threadId: string,
): Promise<boolean> {
  return threadVerb(organizationId, threadId, 'unshare', {});
}

export async function branchChatThread(
  organizationId: string,
  threadId: string,
  fromMessageId: string,
  title?: string,
): Promise<string> {
  const created = await backendFetch<{ id: string }>(
    `/chat/threads/${encodeURIComponent(threadId)}/branch`,
    {
      method: 'POST',
      body: { fromMessageId, ...(title !== undefined ? { title } : {}) },
      orgId: organizationId,
    },
  );
  return created.id;
}

export async function branchChatThreadForEdit(
  organizationId: string,
  threadId: string,
  editedMessageId: string,
): Promise<string> {
  const created = await backendFetch<{ id: string }>(
    `/chat/threads/${encodeURIComponent(threadId)}/branch-edit`,
    { method: 'POST', body: { editedMessageId }, orgId: organizationId },
  );
  return created.id;
}

export async function branchChatThreadForRegenerate(
  organizationId: string,
  threadId: string,
  assistantMessageId: string,
): Promise<string> {
  const created = await backendFetch<{ id: string }>(
    `/chat/threads/${encodeURIComponent(threadId)}/branch-regenerate`,
    { method: 'POST', body: { assistantMessageId }, orgId: organizationId },
  );
  return created.id;
}

export function setChatBranchSelection(
  organizationId: string,
  threadId: string,
  forkKey: string,
  selectedThreadId: string,
): Promise<boolean> {
  return threadVerb(organizationId, threadId, 'branch-selection', {
    forkKey,
    selectedThreadId,
  });
}

/** Nudge every thread-family read in this org after a local write — the
 * same prefix the route layer's hints invalidate from other tabs. */
export function invalidateChatThreads(
  queryClient: QueryClient,
  organizationId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: backendEntityPrefix(organizationId, 'chat_thread'),
  });
}
