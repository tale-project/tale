import { queryOptions, type QueryClient } from '@tanstack/react-query';

import type { ReturnsOf } from '@/app/lib/backend/contract';

import { BackendApiError, backendFetch, backendUrl } from './api-client';
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

// -------------------------------------------------------------- turn family

/** One thread's messages — the rows already carry the view shape. */
export function chatMessagesQuery(organizationId: string, threadId: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'chat_message', threadId),
    queryFn: ({ signal }) =>
      backendFetch<{ messages: unknown[] }>(
        `/chat/threads/${encodeURIComponent(threadId)}/messages`,
        { signal, orgId: organizationId },
      ).then((body) => body.messages),
  });
}

/** One parked send as the tray renders it (the 0.4 list row). */
export interface DeferredSendView {
  deferredSendId: string;
  userText: string;
  attachments: {
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }[];
  videoJobIds: string[];
  status: 'waiting' | 'claimed';
  createdAt: number;
}

/** The thread's parked sends (the tray above the composer). */
export function deferredSendsQuery(organizationId: string, threadId: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'chat_deferred', threadId),
    queryFn: ({ signal }) =>
      backendFetch<{ sends: DeferredSendView[] }>(
        `/chat/threads/${encodeURIComponent(threadId)}/deferred-sends`,
        { signal, orgId: organizationId },
      ).then((body) => body.sends),
  });
}

/** One video-link job as the chips render it (the 0.4 projection). */
export interface VideoLinkJobView {
  jobId: string;
  sourceUrl: string;
  sourcePlatform: string;
  pastedToken: string;
  videoTitle?: string;
  videoUploader?: string;
  videoDurationSec?: number;
  transcriptSource?: string;
  captionLang?: string;
  displayStatus: string;
  progress?: string;
  errorReasonCode?: string;
  errorMessage?: string;
  attempts?: number;
  storageId?: string;
  fileSize?: number;
  lifecycleStatus?: string;
  uploadedBy: string;
  createdAt: number;
}

/** The thread's video-link jobs (the tray's live-status join). */
export function videoJobsForThreadQuery(
  organizationId: string,
  threadId: string,
) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'video_link', 'thread', threadId),
    queryFn: ({ signal }) =>
      backendFetch<{
        jobs: ReturnsOf<'video_links/queries:listForThread'>;
      }>(`/video-links/thread/${encodeURIComponent(threadId)}`, {
        signal,
        orgId: organizationId,
      }).then((body) => body.jobs),
    refetchInterval: 2000,
  });
}

export interface ChatTurnOutcome {
  status: 'completed' | 'refused';
  reason?: string;
}

/**
 * Run one turn — the call RESOLVES when the turn settles (the 0.4 action
 * contract); the reply streams through the thread's SSE lane meanwhile. A
 * refusal arrives on a non-2xx WITH its reason in the body, so this uses a
 * raw fetch: the shared client's error path would flatten it.
 */
export async function sendChatTurn(
  organizationId: string,
  threadId: string,
  body: {
    text: string;
    modelId?: string;
    modelSelection?: 'auto';
    providerSlug?: string;
    reasoningEffort?: string;
    attachments?: readonly {
      fileId: string;
      fileName: string;
      fileType: string;
      fileSize: number;
    }[];
    resend?: boolean;
  },
): Promise<ChatTurnOutcome> {
  const response = await fetch(
    backendUrl(
      `/chat/threads/${encodeURIComponent(threadId)}/messages`,
      organizationId,
    ),
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (payload !== null && typeof payload === 'object' && 'status' in payload) {
    const record = payload as { status: unknown; reason?: unknown };
    if (record.status === 'completed') return { status: 'completed' };
    if (record.status === 'refused') {
      return {
        status: 'refused',
        ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
      };
    }
  }
  if (!response.ok) {
    throw new BackendApiError(
      response.status,
      `Turn request failed with status ${response.status}`,
    );
  }
  return { status: 'completed' };
}

/** Ask the thread's in-flight turn to stop (a no-op for an idle thread). */
export async function cancelChatGeneration(
  organizationId: string,
  threadId: string,
): Promise<void> {
  await backendFetch(`/chat/threads/${encodeURIComponent(threadId)}/cancel`, {
    method: 'POST',
    body: {},
    orgId: organizationId,
  });
}

export interface EnqueueDeferredSendArgs {
  organizationId: string;
  threadId: string;
  text: string;
  attachments?: readonly {
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }[];
  videoJobIds?: readonly string[];
  modelId?: string;
  modelSelection?: 'auto';
  providerSlug?: string;
  reasoningEffort?: string;
  locale?: string;
}

/** Park a send until its media settle (the server-side watcher fires it). */
export async function enqueueDeferredSendRequest(
  args: EnqueueDeferredSendArgs,
): Promise<{ deferredSendId: string }> {
  const { organizationId, threadId, ...rest } = args;
  return backendFetch<{ deferredSendId: string }>(
    `/chat/threads/${encodeURIComponent(threadId)}/deferred-sends`,
    {
      method: 'POST',
      body: {
        ...rest,
        ...(rest.attachments !== undefined
          ? { attachments: [...rest.attachments] }
          : {}),
        ...(rest.videoJobIds !== undefined
          ? { videoJobIds: [...rest.videoJobIds] }
          : {}),
      },
      orgId: organizationId,
    },
  );
}

export async function cancelDeferredSendRequest(
  organizationId: string,
  deferredSendId: string,
): Promise<boolean> {
  const result = await backendFetch<{ ok: boolean }>(
    `/chat/deferred-sends/${encodeURIComponent(deferredSendId)}/cancel`,
    { method: 'POST', body: {}, orgId: organizationId },
  );
  return result.ok;
}

export interface BoundVideoAttachment {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  pastedToken: string;
  jobId: string;
}

/** Bind the thread's completed video jobs into an outgoing send. */
export async function bindVideoJobsForSend(
  organizationId: string,
  threadId: string,
): Promise<BoundVideoAttachment[]> {
  const result = await backendFetch<{ attachments: BoundVideoAttachment[] }>(
    '/video-links/bind',
    { method: 'POST', body: { threadId }, orgId: organizationId },
  );
  return result.attachments;
}

/** Return video chips to the composer after a refused/failed send. */
export async function unbindVideoJobsRequest(
  organizationId: string,
  jobIds: readonly string[],
): Promise<void> {
  await backendFetch('/video-links/unbind', {
    method: 'POST',
    body: { jobIds: [...jobIds] },
    orgId: organizationId,
  });
}

export async function retryVideoLinkRequest(
  organizationId: string,
  jobId: string,
): Promise<void> {
  await backendFetch(`/video-links/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
    body: {},
    orgId: organizationId,
  });
}

/** Re-answer the trailing user message (the 0.4 `regenerateTurn`): the
 * same turn door with `resend` — nothing is appended. */
export function regenerateChatTurn(
  organizationId: string,
  threadId: string,
  pick: {
    modelId?: string;
    modelSelection?: 'auto';
    providerSlug?: string;
    reasoningEffort?: string;
  },
): Promise<ChatTurnOutcome> {
  return sendChatTurn(organizationId, threadId, {
    text: '',
    resend: true,
    ...pick,
  });
}

/** Nudge the message/deferred reads after a settle or a local write. */
export function invalidateChatMessages(
  queryClient: QueryClient,
  organizationId: string,
  threadId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: backendKey(organizationId, 'chat_message', threadId),
  });
  void queryClient.invalidateQueries({
    queryKey: backendKey(organizationId, 'chat_deferred', threadId),
  });
}

// ------------------------------------------------------------ feedback

/** The caller's ratings across one thread (the 0.4 shape). */
export function threadFeedbackQuery(organizationId: string, threadId: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'chat_feedback', threadId),
    queryFn: ({ signal }) =>
      backendFetch<{
        feedback: {
          messageId: string;
          rating: 'positive' | 'negative';
          comment?: string;
        }[];
      }>(`/feedback/thread/${encodeURIComponent(threadId)}`, {
        signal,
        orgId: organizationId,
      }).then((body) => body.feedback),
  });
}

export async function submitMessageFeedbackRequest(
  organizationId: string,
  body: {
    threadId: string;
    messageId: string;
    rating: 'positive' | 'negative';
    comment?: string;
  },
): Promise<void> {
  await backendFetch('/feedback', {
    method: 'POST',
    body,
    orgId: organizationId,
  });
}

export async function removeMessageFeedbackRequest(
  organizationId: string,
  messageId: string,
): Promise<void> {
  await backendFetch(`/feedback/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
    orgId: organizationId,
  });
}

/** Nudge the thread's rating latch after a local write. */
export function invalidateThreadFeedback(
  queryClient: QueryClient,
  organizationId: string,
  threadId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: backendKey(organizationId, 'chat_feedback', threadId),
  });
}

// ---------------------------------------------------------------- voice

/** The effective "Read replies aloud" state (org veto → thread → user). */
export function voiceModeQuery(organizationId: string, threadId?: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'voice', 'mode', threadId ?? null),
    queryFn: ({ signal }) =>
      backendFetch<{
        enabled: boolean;
        userDefault: boolean;
        source: 'thread' | 'preferences' | 'default' | 'org_policy';
      }>(
        `/tts/voice-mode${threadId !== undefined ? `?threadId=${encodeURIComponent(threadId)}` : ''}`,
        { signal, orgId: organizationId },
      ),
  });
}

/** One message's synthesis chunks — polled while playback is mounted
 * (chunk arrival is the signal; the 0.4 watch pushed, HTTP polls). */
export function voiceChunksQuery(
  organizationId: string,
  messageId: string,
  threadId: string,
) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'voice', 'chunks', messageId),
    queryFn: ({ signal }) =>
      backendFetch<{ chunks: unknown[] }>(
        `/tts/messages/${encodeURIComponent(messageId)}/chunks?threadId=${encodeURIComponent(threadId)}`,
        { signal, orgId: organizationId },
      ).then((body) => body.chunks),
    refetchInterval: 1000,
  });
}

export function synthesizeChunkRequest(request: {
  organizationId: string;
  messageId: string;
  threadId: string;
  index: number;
  text: string;
  locale: string;
}): Promise<ReturnsOf<'tts/synthesize:synthesizeChunk'>> {
  const { organizationId, ...body } = request;
  return backendFetch('/tts/synthesize', {
    method: 'POST',
    body,
    orgId: organizationId,
  });
}

export async function setThreadVoiceOverrideRequest(
  organizationId: string,
  threadId: string,
  override: boolean | null,
): Promise<void> {
  await backendFetch(
    `/tts/threads/${encodeURIComponent(threadId)}/voice-override`,
    { method: 'POST', body: { override }, orgId: organizationId },
  );
}

export async function setUserVoiceOutputRequest(
  organizationId: string,
  enabled: boolean,
): Promise<void> {
  await backendFetch('/tts/voice-output', {
    method: 'POST',
    body: { enabled },
    orgId: organizationId,
  });
}

export function invalidateVoiceMode(
  queryClient: QueryClient,
  organizationId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: backendKey(organizationId, 'voice', 'mode'),
  });
}

/** One-shot dictation transcription (inline bytes, never persisted). */
export async function transcribeDictationRequest(args: {
  organizationId: string;
  audio: ArrayBuffer;
  mimeType: string;
}): Promise<{ text: string }> {
  const bytes = new Uint8Array(args.audio);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return backendFetch<{ text: string }>('/files/dictation', {
    method: 'POST',
    body: { audioBase64: btoa(binary), mimeType: args.mimeType },
    orgId: args.organizationId,
  });
}

// ------------------------------------------------------- chat satellites

/** The caller's memories (pending + approved), the preferences page read. */
export function chatMemoriesQuery(organizationId: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'chat_memory', 'list'),
    queryFn: ({ signal }) =>
      backendFetch<{
        pending: { id: string; content: string }[];
        approved: { id: string; content: string }[];
      }>('/chat/memories', { signal, orgId: organizationId }),
  });
}

/** The caller's per-org preferences row (chat model default, etc.). */
export function myPreferencesQuery(organizationId: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'user_preference', 'mine'),
    queryFn: ({ signal }) =>
      backendFetch<{ preferences: unknown }>('/user-preferences', {
        signal,
        orgId: organizationId,
      }).then((body) => body.preferences),
  });
}

export async function setChatModelPreference(
  organizationId: string,
  modelId: string | undefined,
): Promise<void> {
  await backendFetch('/user-preferences/chat-model', {
    method: 'POST',
    body: modelId !== undefined ? { modelId } : {},
    orgId: organizationId,
  });
}

/** The chat sub-panel's project folders (a projection of the full rows). */
export function chatProjectsQuery(organizationId: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'project', 'chat-panel'),
    queryFn: ({ signal }) =>
      backendFetch<{
        projects: {
          id: string;
          name: string;
          icon?: string | null;
          color?: string | null;
          pinnedAt?: number | null;
        }[];
      }>('/projects', { signal, orgId: organizationId }).then((body) =>
        body.projects.map((row) =>
          Object.assign(
            { _id: row.id, name: row.name },
            row.icon != null ? { icon: row.icon } : {},
            row.color != null ? { color: row.color } : {},
            row.pinnedAt != null ? { pinnedAt: row.pinnedAt } : {},
          ),
        ),
      ),
  });
}

export async function setProjectPinnedRequest(
  organizationId: string,
  projectId: string,
  pinned: boolean,
): Promise<void> {
  await backendFetch(`/projects/${encodeURIComponent(projectId)}/pin`, {
    method: 'POST',
    body: { pinned },
    orgId: organizationId,
  });
}

/** The member-readable legal-hold badge read. */
export function holdTargetsQuery(organizationId: string, targetType: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'legal_hold', 'targets', targetType),
    queryFn: ({ signal }) =>
      backendFetch<{ orgHeld: boolean; targetIds: string[] }>(
        `/legal-holds/targets?targetType=${encodeURIComponent(targetType)}`,
        { signal, orgId: organizationId },
      ),
  });
}

/** The shared-thread snapshot by its token (org-membership + token) —
 * typed off the 0.4 query, the drift-proof way. */
export function sharedThreadQuery(organizationId: string, token: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'chat_thread', 'shared', token),
    queryFn: ({ signal }) =>
      backendFetch<ReturnsOf<'chat/threads:getSharedThread'>>(
        `/chat/threads/shared/${encodeURIComponent(token)}`,
        {
          signal,
          orgId: organizationId,
        },
      ).then(
        (body) => body,
        (error: unknown) => {
          if (error instanceof BackendApiError && error.status === 404) {
            return null;
          }
          throw error;
        },
      ),
  });
}

/** Batch pipeline statuses for staged attachments — polled while any file
 * is still processing (the 0.4 watch pushed; HTTP polls). Typed off the
 * 0.4 query so consumers keep their contract. */
export function fileStatusesQuery(
  organizationId: string,
  storageIds: readonly string[],
) {
  return queryOptions({
    queryKey: backendKey(
      organizationId,
      'file_status',
      [...storageIds].sort().join(','),
    ),
    queryFn: ({ signal }) =>
      backendFetch<{
        statuses: ReturnsOf<'file_metadata/queries:getByStorageIds'>;
      }>('/files/statuses', {
        method: 'POST',
        body: { storageIds: [...storageIds] },
        orgId: organizationId,
        signal,
      }).then((body) => body.statuses),
    refetchInterval: 2000,
  });
}

/** The caller's unbound video jobs (the chat index's chips). */
export function videoJobsUnboundQuery(organizationId: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'video_link', 'unbound'),
    queryFn: ({ signal }) =>
      backendFetch<{
        jobs: ReturnsOf<'video_links/queries:listForUserUnboundChat'>;
      }>('/video-links/unbound', { signal, orgId: organizationId }).then(
        (body) => body.jobs,
      ),
    refetchInterval: 2000,
  });
}

export async function ingestVideoUrlRequest(args: {
  organizationId: string;
  threadId?: string;
  url: string;
  pastedToken: string;
  userLocale?: string;
}): Promise<{ jobId: string }> {
  const { organizationId, ...body } = args;
  return backendFetch<{ jobId: string }>('/video-links/ingest', {
    method: 'POST',
    body,
    orgId: organizationId,
  });
}

export async function cancelVideoLinkRequest(
  organizationId: string,
  jobId: string,
): Promise<void> {
  await backendFetch(`/video-links/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    body: {},
    orgId: organizationId,
  });
}

/** The info dialog's per-message voice spend (0.4 shape; null = none). */
export function messageVoiceUsageQuery(
  organizationId: string,
  messageId: string,
  threadId: string,
) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'voice', 'usage', messageId),
    queryFn: ({ signal }) =>
      backendFetch<ReturnsOf<'tts/queries:getMessageVoiceUsage'> | null>(
        `/tts/messages/${encodeURIComponent(messageId)}/usage?threadId=${encodeURIComponent(threadId)}`,
        { signal, orgId: organizationId },
      ),
  });
}

/** Budget banner: ask the org's admins for more usage credits. */
export async function requestUsageCreditsRequest(
  organizationId: string,
): Promise<boolean> {
  const result = await backendFetch<{ ok: boolean }>(
    `/organizations/${encodeURIComponent(organizationId)}/request-credits`,
    { method: 'POST', body: {} },
  );
  return result.ok;
}

/** Stamp the first-token perceived wait on an assistant row (fire-once). */
export async function reportPerceivedWaitRequest(
  organizationId: string,
  messageId: string,
  perceivedWaitMs: number,
): Promise<void> {
  await backendFetch(
    `/chat/messages/${encodeURIComponent(messageId)}/perceived-wait`,
    { method: 'POST', body: { perceivedWaitMs }, orgId: organizationId },
  );
}

// ---------------------------------------------------------------- questions + arena

/** The pending clarifying question a thread is waiting on (null clears the
 * panel). Keyed under `chat_thread` so thread hints refresh it. */
export function pendingQuestionQuery(organizationId: string, threadId: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'chat_thread', 'question', threadId),
    queryFn: ({ signal }) =>
      backendFetch<{
        question: { requestId: string; set: unknown } | null;
      }>(`/chat/threads/${encodeURIComponent(threadId)}/question`, {
        signal,
        orgId: organizationId,
      }).then((body) => body.question),
  });
}

/** Close a pending question — answered or superseded. Double-submits are
 * server-side no-ops. */
export async function resolveQuestionRequest(
  organizationId: string,
  requestId: string,
  outcome: 'answered' | 'superseded',
): Promise<void> {
  await backendFetch(
    `/chat/questions/${encodeURIComponent(requestId)}/resolve`,
    { method: 'POST', body: { outcome }, orgId: organizationId },
  );
}

/** The live arena pair as seen from either column (null = not in a pair —
 * ABSENCE IS THE SIGNAL, so the read is never session-cached). */
export function arenaPairQuery(organizationId: string, threadId: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'chat_thread', 'arena', threadId),
    queryFn: ({ signal }) =>
      backendFetch<{
        pair: {
          pairId: string;
          threadIdA: string;
          threadIdB: string;
          createdAt: number;
        } | null;
      }>(`/chat/threads/${encodeURIComponent(threadId)}/arena`, {
        signal,
        orgId: organizationId,
      }).then((body) => body.pair),
  });
}

export async function ensureArenaPairRequest(
  organizationId: string,
  threadId: string,
): Promise<{ threadIdB: string } | { refused: string }> {
  return backendFetch<{ threadIdB: string } | { refused: string }>(
    `/chat/threads/${encodeURIComponent(threadId)}/arena/ensure`,
    { method: 'POST', body: {}, orgId: organizationId },
  );
}

export async function settleArenaPairRequest(
  organizationId: string,
  threadId: string,
  verdict?: string,
): Promise<{ continueThreadId: string } | { refused: string }> {
  return backendFetch<{ continueThreadId: string } | { refused: string }>(
    `/chat/threads/${encodeURIComponent(threadId)}/arena/settle`,
    {
      method: 'POST',
      body: verdict !== undefined ? { verdict } : {},
      orgId: organizationId,
    },
  );
}

export async function startArenaTurnRequest(
  organizationId: string,
  threadId: string,
  body: {
    userText: string;
    modelIdA: string;
    modelIdB: string;
    providerSlugA?: string;
    providerSlugB?: string;
    reasoningEffort?: string;
    locale?: string;
  },
): Promise<{
  a: { status: 'completed' | 'refused'; reason?: string };
  b: { status: 'completed' | 'refused'; reason?: string };
}> {
  return backendFetch(
    `/chat/threads/${encodeURIComponent(threadId)}/arena/turn`,
    { method: 'POST', body, orgId: organizationId },
  );
}

/** A thread's share-link status (owner-only; null when unreadable). */
export function threadShareStatusQuery(
  organizationId: string,
  threadId: string,
) {
  return queryOptions({
    queryKey: backendKey(
      organizationId,
      'chat_thread',
      'share-status',
      threadId,
    ),
    queryFn: ({ signal }) =>
      backendFetch<{
        isShared: boolean;
        shareToken: string | null;
        sharedAt: number | null;
        isShareable: boolean;
      }>(`/chat/threads/${encodeURIComponent(threadId)}/share-status`, {
        signal,
        orgId: organizationId,
      }).then(
        (body) => body,
        (error: unknown) => {
          if (error instanceof BackendApiError && error.status === 404) {
            return null;
          }
          throw error;
        },
      ),
  });
}
