'use client';

/**
 * THE SEAM between the chat surface and its Convex functions.
 *
 * Each read this surface needs is declared here once, in the shape the screen
 * consumes. Live reads — threads, messages, the live generation, and memories
 * — subscribe to `api.chat.*` and stream updates in real time. The composer's
 * model catalog goes through the providers domain's aggregator ACTION (models
 * live in the config tree, which only a `'use node'` action may read) and
 * resolves on mount. The writes the surface performs — sending a turn,
 * stopping one — live here too (`useChatSend`). There is deliberately no
 * agent, harness, skill, or connector read: the chat page offers model
 * selection only (the Chat·Task·Automation boundary model).
 *
 * Subscriptions go through the Convex client directly (`useConvex` +
 * `useSyncExternalStore`) rather than the app's `useBackendQuery` wrapper. The
 * wrapper reads the auth and query-client contexts, which a component rendered
 * outside the provider tree does not have; `useConvex()` returns `undefined`
 * there instead of throwing, so the surface degrades to `unavailable` in that
 * case rather than crashing. Every hook still calls the exact same hooks in the
 * same order on every render — the status is decided from values, never by
 * calling a hook conditionally.
 *
 * Reads keep their last answer for the session and refresh it live, so a
 * remounted surface repaints content instead of flashing its loading state —
 * the live generation alone opts out, because its absence IS its signal.
 */

import {
  keepPreviousData,
  QueryClient,
  QueryClientContext,
  useQuery,
} from '@tanstack/react-query';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { backendFetch } from '@/app/lib/backend/api-client';
import {
  fileStatusesQuery,
  chatMemoriesQuery,
  myPreferencesQuery,
  chatProjectsQuery,
  holdTargetsQuery,
  setProjectPinnedRequest,
  setChatModelPreference,
  voiceModeQuery,
  threadFeedbackQuery,
  archivedThreadsQuery,
  bindVideoJobsForSend,
  cancelChatGeneration,
  chatMessagesQuery,
  chatSearchQuery,
  chatThreadQuery,
  chatThreadsQuery,
  createChatThread,
  enqueueDeferredSendRequest,
  invalidateChatMessages,
  invalidateChatThreads,
  moveChatThreadToProject,
  sendChatTurn,
  setChatThreadReasoningEffort,
  threadBranchesQuery,
  unbindVideoJobsRequest,
  pendingQuestionQuery,
  arenaPairQuery,
  resolveQuestionRequest,
  threadShareStatusQuery,
} from '@/app/lib/backend/chat';
import type { ArgsOf, QueryName, ReturnsOf } from '@/app/lib/backend/contract';
import { backendEntityPrefix } from '@/app/lib/backend/query-keys';
import type { ReasoningEffort } from '@/lib/chat/effort';
import type { QuestionSet } from '@/lib/shared/schemas/questions';
import { isRecord } from '@/lib/utils/type-utils';

import type {
  ChatGenerationView,
  ChatMessageUsage,
  ChatMessageView,
  ChatProjectSummary,
  ChatThreadSummary,
} from '../types';
import {
  readStoredComposerCatalog,
  storeComposerCatalog,
  type ComposerCatalog,
} from './composer-catalog-store';
import { useThreadStream } from './thread-stream';

/**
 * Every read through this seam reports whether the backend answered. `ready`
 * carries data; `loading` is a subscribed query that has not resolved yet;
 * `unavailable` means the chat client is not reachable (rendered outside the
 * provider tree) or the capability has no backend, and the caller must say so
 * rather than render an empty success state.
 */
export type ChatQuery<T> =
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' };

const UNAVAILABLE = { status: 'unavailable' } as const;
/** A read the caller deliberately withheld — holding, not broken. */
const LOADING = { status: 'loading' } as const;

/**
 * The last answer each live read served, keyed like the watches themselves
 * (function name + args), kept for the session. A watch is torn down on
 * unmount and the client then drops its local result, so without this every
 * remount of the surface answers `undefined` for one round-trip — the
 * skeleton/spinner flash on every navigation into chat. A remount starts from
 * the cached answer and the fresh watch's own result replaces it as soon as
 * it lands. Skipped reads never touch the cache, and a read whose ABSENCE is
 * a signal (the live generation) opts out — stale content is fine, a stale
 * signal is not. Capped with delete+set recency, like the paginated cache.
 */
const MAX_LIVE_RESULT_CACHE_ENTRIES = 50;
const liveResultCache = new Map<string, unknown>();

/**
 * Subscribe to a chat query through the live Convex client. Returns
 * `unavailable` when there is no client in context (so a provider-less render
 * never throws), `loading` while the subscription has no result, and `ready`
 * with the result once it arrives — or, on a remount, with the last answer
 * this session already served for the same (function, args), refreshed by the
 * live watch within a round-trip. Passing `'skip'` holds the subscription
 * closed — for a read that has no argument to run on yet, like a thread view
 * with no thread selected.
 */
/**
 * The reads whose family has MIGRATED to the 0.5 backend, keyed by the 0.4
 * function name `useChatQuery` already keys its watches on. An adapted read
 * runs over HTTP (react-query + the org hint stream) instead of a Convex
 * watch; everything else keeps its websocket subscription until its family
 * migrates. The client-side twin of the backend's name-keyed ctx shim.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- the seam's callers type the result via FunctionReturnType; the table is the untyped boundary
type HttpReadOptions = { queryKey: readonly unknown[]; queryFn?: any };
const HTTP_READS: Record<
  string,
  (args: Record<string, unknown>) => HttpReadOptions
> = {
  'chat/threads:listThreads': (args) =>
    chatThreadsQuery(String(args.organizationId)),
  'chat/threads:listArchivedThreads': (args) =>
    archivedThreadsQuery(
      String(args.organizationId),
      typeof args.cursor === 'number' ? args.cursor : undefined,
    ),
  'chat/threads:getThread': (args) =>
    chatThreadQuery(String(args.organizationId), String(args.threadId)),
  'chat/branches:listThreadBranches': (args) =>
    threadBranchesQuery(String(args.organizationId), String(args.rootThreadId)),
  'chat/search:searchChats': (args) =>
    chatSearchQuery(String(args.organizationId), String(args.query)),
  'chat/threads:getThreadShareStatus': (args) =>
    threadShareStatusQuery(String(args.organizationId), String(args.threadId)),
  'chat/questions:getPendingQuestion': (args) =>
    pendingQuestionQuery(String(args.organizationId), String(args.threadId)),
  'chat/arena:getArenaPair': (args) =>
    arenaPairQuery(String(args.organizationId), String(args.threadId)),
  'chat/messages:listMessages': (args) =>
    chatMessagesQuery(String(args.organizationId), String(args.threadId)),
  'feedback/queries:listThreadFeedback': (args) =>
    threadFeedbackQuery(String(args.organizationId), String(args.threadId)),
  'tts/queries:getVoiceModeEffective': (args) =>
    voiceModeQuery(
      String(args.organizationId),
      typeof args.threadId === 'string' ? args.threadId : undefined,
    ),
  'chat/memories:listMemories': (args) =>
    chatMemoriesQuery(String(args.organizationId)),
  'user_preferences/queries:getMyPreferences': (args) =>
    myPreferencesQuery(String(args.organizationId)),
  'projects/queries:listProjects': (args) =>
    chatProjectsQuery(String(args.organizationId)),
  'governance/legal_hold_queries:listActiveHoldTargetIds': (args) =>
    holdTargetsQuery(String(args.organizationId), String(args.targetType)),
  'file_metadata/queries:getByStorageIds': (args) => ({
    // One-shot here (source cards); the staging hooks poll via their own
    // useQuery with the refetchInterval kept.
    ...fileStatusesQuery(
      String(args.organizationId),
      Array.isArray(args.storageIds)
        ? args.storageIds.filter((id): id is string => typeof id === 'string')
        : [],
    ),
    refetchInterval: false as const,
  }),
};

/** Provider-less renders (the seam's degrade case) still get a working
 * HTTP lane through a module-level client — better than `unavailable`. */
const fallbackChatQueryClient = new QueryClient();

/** The query client the seam's HTTP lane actually uses in this render —
 * the context one, or the module fallback for provider-less renders. The
 * action hooks invalidate through THIS so they always hit the same cache
 * the reads populate. */
export function useChatQueryClient(): QueryClient {
  return useContext(QueryClientContext) ?? fallbackChatQueryClient;
}

export function useChatQuery<Name extends QueryName>(
  name: Name,
  args: ArgsOf<Name> | 'skip',
  options?: { readonly cache?: boolean },
): ChatQuery<ReturnsOf<Name>> {
  const skip = args === 'skip';
  // Key the read by NAME + the JSON of its args, never by object identity:
  // callers build args inline, so identity-keyed deps would rebuild the query
  // on every render and oscillate the surface between loading and ready.
  const fnKey = name;
  const argsKey = skip ? 'skip' : JSON.stringify(args);

  // The HTTP lane: adapted families fetch the backend; the options are
  // rebuilt only when the (function, args) identity changes.
  const httpOptions = useMemo(() => {
    if (skip) return undefined;
    const adapt = HTTP_READS[fnKey];
    return adapt?.(args);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- args tracked by argsKey (see the watch memo's rationale)
  }, [fnKey, argsKey, skip]);
  const contextQueryClient = useContext(QueryClientContext);
  const httpQuery = useQuery(
    {
      queryKey: httpOptions?.queryKey ?? ['backend', 'chat-http', 'disabled'],
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- the adapter table is the untyped boundary
      queryFn: httpOptions?.queryFn ?? (async () => null),
      enabled: httpOptions !== undefined,
      placeholderData: keepPreviousData,
    },
    contextQueryClient ?? fallbackChatQueryClient,
  );

  // Every chat read is an HTTP row now; a name with no row has no server
  // left, so the surface degrades to `unavailable` rather than waiting on an
  // answer that will never arrive.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the HTTP row and this name's contract entry are keyed alike, so the row's projection IS this return shape
  const data = httpQuery.data as ReturnsOf<Name> | undefined;

  // Render-phase cache maintenance, mirroring useCachedPaginatedQuery: the
  // write is idempotent, and the value must be current for this render's own
  // read below.
  const cacheable = options?.cache !== false && !skip;
  const cacheKey = `${fnKey}:${argsKey}`;
  if (cacheable && data !== undefined) {
    liveResultCache.delete(cacheKey);
    liveResultCache.set(cacheKey, data);
    if (liveResultCache.size > MAX_LIVE_RESULT_CACHE_ENTRIES) {
      const oldestKey = liveResultCache.keys().next().value;
      if (oldestKey !== undefined) liveResultCache.delete(oldestKey);
    }
  }

  let value = data;
  if (value === undefined && cacheable) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only this hook writes the cache, under the same (name, args) key it reads, so the entry is this read's own return type
    value = liveResultCache.get(cacheKey) as ReturnsOf<Name> | undefined;
  }

  // One stable object per answer: while a remount serves the cached value its
  // identity holds across renders, exactly like a live result's would.
  const result = useMemo<ChatQuery<ReturnsOf<Name>>>(
    () =>
      value === undefined
        ? { status: 'loading' }
        : { status: 'ready', data: value },
    [value],
  );

  // A SKIPPED read is holding, not broken: the caller has nothing to ask for
  // yet (no thread selected), so it must read as `loading` exactly as it did
  // on the subscription lane. Only a ref with no row at all is unavailable.
  if (skip) return LOADING;
  if (httpOptions === undefined) return UNAVAILABLE;
  // A hard error (after the cache fallback above) degrades to `unavailable`,
  // exactly as a missing client used to.
  if (value === undefined && httpQuery.isError) return UNAVAILABLE;
  return result;
}

/** The thread list in the chat sub-panel. */
export function useChatThreads(
  organizationId: string,
): ChatQuery<readonly ChatThreadSummary[]> {
  return useChatQuery('chat/threads:listThreads', { organizationId });
}

/**
 * The project folders the chat sub-panel files threads under. The projects
 * feature owns the table; this read reduces its rows to what a folder row
 * renders, through the same degrade-to-unavailable seam as every chat read.
 */
export function useChatProjects(
  organizationId: string,
): ChatQuery<readonly ChatProjectSummary[]> {
  const projects = useChatQuery('projects/queries:listProjects', {
    organizationId,
  });
  return useMemo(() => {
    if (projects.status !== 'ready') return projects;
    return {
      status: 'ready',
      data: projects.data.map((project) => ({
        id: project._id,
        name: project.name,
        ...(project.icon !== undefined ? { icon: project.icon } : {}),
        ...(project.color !== undefined ? { color: project.color } : {}),
        ...(project.pinnedAt !== undefined
          ? { pinnedAt: project.pinnedAt }
          : {}),
      })),
    };
  }, [projects]);
}

/**
 * Pin or unpin a project folder in the sub-panel. Routed through the seam —
 * not the projects feature's react-query hooks — so a provider-less render
 * degrades to `available: false` instead of throwing.
 */
export function useProjectPin(organizationId: string): {
  readonly available: boolean;
  readonly setPinned: (projectId: string, pinned: boolean) => Promise<void>;
} {
  const queryClient = useChatQueryClient();

  const setPinned = useCallback(
    async (projectId: string, pinned: boolean): Promise<void> => {
      await setProjectPinnedRequest(organizationId, projectId, pinned);
      void queryClient.invalidateQueries({
        queryKey: chatProjectsQuery(organizationId).queryKey,
      });
    },
    [queryClient, organizationId],
  );

  return { available: true, setPinned };
}

/**
 * The org's legal-hold coverage for threads, in ONE bulk read for the whole
 * panel: the org-wide flag plus every held thread id (direct holds and the
 * custodian cascade). Rows render their held state from this set — never a
 * per-row subscription.
 */
export function useThreadHolds(organizationId: string): ChatQuery<{
  readonly orgHeld: boolean;
  readonly targetIds: readonly string[];
}> {
  return useChatQuery('governance/legal_hold_queries:listActiveHoldTargetIds', {
    organizationId,
    targetType: 'thread',
  });
}

/** One page of the archived list. */
export interface ArchivedThreadsPage {
  readonly rows: readonly ChatThreadSummary[];
  /** The cursor of the next page, or null at the end. */
  readonly nextCursor: number | null;
}

/**
 * One page of the caller's archived threads. Gated on the section being
 * expanded (`'skip'` while collapsed), so a closed archive costs the panel
 * nothing; each loaded page keeps its own live watch, so an unarchive
 * reflects everywhere without refetch plumbing.
 */
export function useArchivedThreads(
  organizationId: string,
  options: { enabled: boolean; cursor?: number },
): ChatQuery<ArchivedThreadsPage> {
  return useChatQuery(
    'chat/threads:listArchivedThreads',
    options.enabled
      ? {
          organizationId,
          ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
        }
      : 'skip',
  );
}

/**
 * The two turn lanes stamp cost in different units — the direct pipeline
 * writes `costEstimateCents`, the external (harness) lane `costEstimateUsd`
 * — so the seam normalizes to cents ONCE, here, and the view model only ever
 * knows cents. Rounded to 4 decimals (the old ledger's `roundCents`
 * precision): float artifacts die, sub-cent turns keep their value instead
 * of flattening to $0.00. Everything else in the blob passes through as the
 * pipeline stamped it.
 */
function normalizeMessageUsage(raw: unknown): ChatMessageUsage | undefined {
  if (!isRecord(raw)) return undefined;
  const usd = raw.costEstimateUsd;
  const normalized =
    typeof raw.costEstimateCents !== 'number' && typeof usd === 'number'
      ? { ...raw, costEstimateCents: Math.round(usd * 1_000_000) / 10_000 }
      : raw;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the blob is `v.any()` server-side; every ChatMessageUsage field is optional and the dialog re-checks each one before rendering it
  return normalized;
}

/** One thread's messages, in `sequence` order, with the usage blob
 * normalized for the view model. */
export function useChatMessages(
  organizationId: string,
  threadId: string | undefined,
): ChatQuery<readonly ChatMessageView[]> {
  const rows = useChatQuery(
    'chat/messages:listMessages',
    threadId ? { organizationId, threadId } : 'skip',
  );
  return useMemo(() => {
    if (rows.status !== 'ready') return rows;
    return {
      status: 'ready' as const,
      data: rows.data.map((row): ChatMessageView => {
        // The RAW usage never reaches the view — it rides the wire as
        // free-form JSON and only the normalized shape is renderable.
        const { usage: rawUsage, ...rest } = row;
        const usage = normalizeMessageUsage(rawUsage);
        return { ...rest, ...(usage !== undefined ? { usage } : {}) };
      }),
    };
  }, [rows]);
}

/**
 * The effective "Read replies aloud" state — org veto → thread override →
 * user default. `threadId` optional so the chat index resolves the checkbox
 * too. Never session-cached: a veto or a toggle from another tab must not
 * replay stale.
 */
export function useVoiceMode(
  organizationId: string,
  threadId: string | undefined,
): ChatQuery<{
  enabled: boolean;
  userDefault: boolean;
  source: 'thread' | 'preferences' | 'default' | 'org_policy';
}> {
  return useChatQuery(
    'tts/queries:getVoiceModeEffective',
    threadId !== undefined ? { organizationId, threadId } : { organizationId },
    { cache: false },
  );
}

/**
 * One thread's summary by id — unlike the list (which only carries the
 * caller's own rows), this also answers for a project-shared conversation
 * the caller may read, with `viewerIsOwner: false`.
 */
export function useChatThread(
  organizationId: string,
  threadId: string | undefined,
): ChatQuery<ChatThreadSummary | null> {
  return useChatQuery(
    'chat/threads:getThread',
    threadId ? { organizationId, threadId } : 'skip',
  );
}

/**
 * A root's branch lineage — the edit/regenerate siblings plus the root's
 * stored selection map — in one watch. The chat surface resolves which leaf
 * to render from this (see `lib/branch-selection.ts`).
 */
export function useThreadBranches(
  organizationId: string,
  rootThreadId: string | undefined,
): ChatQuery<{
  branches: ReadonlyArray<{
    id: string;
    parentId: string;
    forkSequence: number;
    createdAt: number;
  }>;
  selections: string | null;
}> {
  return useChatQuery(
    'chat/branches:listThreadBranches',
    rootThreadId ? { organizationId, rootThreadId } : 'skip',
  );
}

/**
 * The live arena pair for a conversation, from either column. Null when no
 * pair is active — ABSENCE IS THE SIGNAL (a settled pair must collapse the
 * split view immediately), so this never touches the session cache.
 */
export function useArenaPair(
  organizationId: string,
  threadId: string | undefined,
): ChatQuery<{
  pairId: string;
  threadIdA: string;
  threadIdB: string;
  createdAt: number;
} | null> {
  return useChatQuery(
    'chat/arena:getArenaPair',
    threadId ? { organizationId, threadId } : 'skip',
    { cache: false },
  );
}

/**
 * The caller's ratings across the open conversation — ONE watch for the
 * whole transcript; the toolbar latches each message's thumbs from this.
 * Never session-cached: a rating the user just removed in another tab must
 * not replay as still-set (absence is the signal).
 */
export function useThreadFeedback(
  organizationId: string,
  threadId: string | undefined,
): ChatQuery<
  ReadonlyArray<{
    messageId: string;
    rating: 'positive' | 'negative';
    comment?: string;
  }>
> {
  return useChatQuery(
    'feedback/queries:listThreadFeedback',
    threadId ? { organizationId, threadId } : 'skip',
    { cache: false },
  );
}

/**
 * The live generation for a thread. A `ready` result with `null` data means
 * the thread is idle — the `generations` row is deleted when a turn settles,
 * so its absence is the settled signal.
 */
export function useChatGeneration(
  organizationId: string,
  threadId: string | undefined,
): ChatQuery<ChatGenerationView | null> {
  // The migrated lane: the per-thread SSE stream answers both the status
  // view and the streamed text; absence (an `idle` event) IS the signal, so
  // nothing here is ever session-cached.
  const stream = useThreadStream(
    organizationId,
    threadId,
    useChatQueryClient(),
  );
  if (threadId === undefined || stream.generation === undefined) {
    return { status: 'loading' };
  }
  return { status: 'ready', data: stream.generation };
}

/** The in-flight streamed text (the 0.4 `getGenerationText` twin) — rides
 * the same SSE lane as the status view above. */
export function useChatGenerationText(
  organizationId: string,
  threadId: string | undefined,
): ChatQuery<{
  messageId?: string;
  text: string;
  reasoning?: string;
  serverNow?: number;
} | null> {
  const stream = useThreadStream(
    organizationId,
    threadId,
    useChatQueryClient(),
  );
  if (threadId === undefined || stream.generationText === undefined) {
    return { status: 'loading' };
  }
  return { status: 'ready', data: stream.generationText };
}

/**
 * The last catalog each org answered with, kept for the session. A remount
 * starts from this answer and refreshes in the background instead of dropping
 * back to `loading` — the loading gap is what flipped the chat index between
 * its welcome and the provider-setup notice on every navigation. Backed by
 * the device store below, so a RELOAD starts warm too.
 */
const composerCatalogCache = new Map<string, ComposerCatalog>();

/**
 * The org's last catalog: this session's answer when there is one, else the
 * device store's (promoted into the session cache so the read happens once).
 */
function recallComposerCatalog(
  organizationId: string,
): ComposerCatalog | undefined {
  const cached = composerCatalogCache.get(organizationId);
  if (cached) return cached;
  const stored = readStoredComposerCatalog(organizationId);
  if (!stored) return undefined;
  composerCatalogCache.set(organizationId, stored);
  return stored;
}

/**
 * What the composer's model picker offers. The model catalog and sandbox
 * harnesses are file-backed config the providers domain owns, so — like the
 * agent read below — this is an ACTION, not a reactive watch: it resolves the
 * org's models the same way a turn does (the connectors it has an active
 * credential for) plus the shipped harnesses, loading once per org and again
 * per mount. Failures degrade to `unavailable`, so the picker says "not
 * connected" rather than offering a model no configured credential could
 * serve — unless a previous answer exists, which then keeps serving (a
 * transient refresh failure must not blank a working composer).
 */
export function useComposerModels(
  organizationId: string,
): ChatQuery<ComposerCatalog> {
  const [state, setState] = useState<ChatQuery<ComposerCatalog>>(() => {
    const cached = recallComposerCatalog(organizationId);
    return cached ? { status: 'ready', data: cached } : { status: 'loading' };
  });

  useEffect(() => {
    if (!organizationId) return () => {};
    let cancelled = false;
    const cached = recallComposerCatalog(organizationId);
    setState(
      cached ? { status: 'ready', data: cached } : { status: 'loading' },
    );
    backendFetch<ComposerCatalog>('/chat/composer/models', {
      orgId: organizationId,
    }).then(
      (data) => {
        if (cancelled) return;
        composerCatalogCache.set(organizationId, data);
        storeComposerCatalog(organizationId, data);
        setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (cancelled) return;
        // Pre-auth or backend failure: report honestly; the picker renders
        // its unavailable state instead of an empty model list. A stale
        // answer, when one exists, beats flipping a working surface.
        console.warn(
          '[chat] could not list composer models for the picker',
          error,
        );
        if (!composerCatalogCache.has(organizationId)) {
          setState(UNAVAILABLE);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return state;
}

/**
 * The user's sticky model pick for this org — a live read plus the save that
 * makes a pick sticky. The read is `undefined` data while the user has never
 * picked; `save` fires and forgets (a lost write costs one re-pick, never a
 * blocked send). Only EXPLICIT picks are saved; default seeding never writes.
 */
export function useChatModelPreference(organizationId: string): {
  readonly preference: ChatQuery<string | undefined>;
  /** Absent `modelId` clears the sticky pick — how choosing Auto forgets
   * the previously pinned model (an absent preference reads as Auto). */
  readonly save: (modelId: string | undefined) => void;
} {
  const row = useChatQuery('user_preferences/queries:getMyPreferences', {
    organizationId,
  });

  const save = useCallback(
    (modelId: string | undefined) => {
      setChatModelPreference(organizationId, modelId).catch(
        (error: unknown) => {
          console.warn('[chat] could not save the model pick', error);
        },
      );
    },
    [organizationId],
  );

  const preference: ChatQuery<string | undefined> =
    row.status === 'ready'
      ? { status: 'ready', data: row.data?.chatModelId ?? undefined }
      : row;

  return { preference, save };
}

/** One uploaded file riding a send — the narrow projection the turn action
 * validates and persists (the composer's richer attachment state keeps
 * preview URLs and dedup identity to itself). */
export interface ChatTurnAttachment {
  /** Blob reference: a Convex `_storage` id or an `s3:` ref. */
  readonly fileId: string;
  readonly fileName: string;
  readonly fileType: string;
  readonly fileSize: number;
}

/** What a turn needs from the composer. Omitting `threadId` means "start a
 * new thread for this turn" — the handle carries the id that was created.
 * Every chat turn runs the direct model lane and names its model — a
 * concrete `modelId`, or `modelSelection: 'auto'` (exactly one). */
export interface ChatTurnRequest {
  readonly threadId?: string;
  readonly text: string;
  /** Files staged in the composer for this send. */
  readonly attachments?: readonly ChatTurnAttachment[];
  readonly modelId?: string;
  readonly modelSelection?: 'auto';
  readonly providerSlug?: string;
  /** The reasoning-effort pick riding this turn. */
  readonly reasoningEffort?: ReasoningEffort;
  /** The project a NEW thread starts in (the project's "New chat" flow). */
  readonly projectId?: string;
  /** Bind this conversation's completed video-link jobs into the send: their
   * transcript payloads join `attachments` and their pasted URLs leave the
   * outgoing text. The handle reports the bound job ids for rollback. */
  readonly bindVideoJobs?: boolean;
}

/** A started turn: the thread it runs in (existing or just created), and an
 * outcome promise — a refusal carries its reason. The turn settles it when
 * it completes; the reply itself arrives through the messages/generations
 * subscriptions. */
export interface ChatTurnHandle {
  readonly threadId: string;
  /** Video jobs `bindVideoJobs` attached to this send — a refusal rollback
   * passes them to `unbindVideoJobs` so the chips return to the composer. */
  readonly boundVideoJobIds: readonly string[];
  readonly outcome: Promise<{
    status: 'completed' | 'refused';
    reason?: string;
    /** The refusal is on the thread's record (user row + blocked reply) —
     * the composer must not restore the text. Absent: nothing landed. */
    persisted?: boolean;
  }>;
}

/** A send parked while its attachments still process (`deferredSends`): the
 * watcher fires the turn server-side when everything is ready. */
export interface ChatDeferredSendRequest {
  readonly threadId?: string;
  readonly text: string;
  readonly attachments?: readonly ChatTurnAttachment[];
  /** Unbound video-link jobs to claim into the parked send. */
  readonly videoJobIds?: readonly string[];
  /** Exactly one of `modelId` and `modelSelection` — a parked Auto stays a
   * MODE and resolves at turn start, after its media settled. */
  readonly modelId?: string;
  readonly modelSelection?: 'auto';
  readonly providerSlug?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly projectId?: string;
  readonly locale?: string;
}

/**
 * THE WRITE SEAM: start a turn. Creates the thread first when the composer
 * sends from the index, then fires `chat.turn_action.startTurn` WITHOUT
 * awaiting it — the conversation itself streams into the `messages` and
 * `generations` subscriptions above, so the caller only needs the thread id
 * (to navigate) and the outcome promise (to surface a refusal).
 * `available` is false in a provider-less render, mirroring the reads.
 */
export function useChatSend(organizationId: string): {
  readonly available: boolean;
  readonly start: (request: ChatTurnRequest) => Promise<ChatTurnHandle>;
  /** Park a send until its attachments finish processing — the server-side
   * watcher starts the turn; the caller only navigates. */
  readonly defer: (
    request: ChatDeferredSendRequest,
  ) => Promise<{ threadId: string }>;
  /** Return video chips to the composer after a refused/failed send. */
  readonly unbindVideoJobs: (jobIds: readonly string[]) => Promise<void>;
  /** Ask the thread's in-flight turn to stop. The turn reads the flag on its
   * next streaming write, aborts the model call, and settles the message
   * with what streamed. A no-op for an idle thread. */
  readonly stop: (threadId: string) => Promise<void>;
} {
  const queryClient = useChatQueryClient();

  const stop = useCallback(
    async (threadId: string): Promise<void> => {
      await cancelChatGeneration(organizationId, threadId);
    },
    [organizationId],
  );

  const start = useCallback(
    async (request: ChatTurnRequest): Promise<ChatTurnHandle> => {
      const threadId =
        request.threadId ??
        (await createChatThread({
          organizationId,
          kind: 'direct',
          ...(request.projectId !== undefined
            ? { projectId: request.projectId }
            : {}),
          ...(request.reasoningEffort !== undefined
            ? { reasoningEffort: request.reasoningEffort }
            : {}),
        }));
      // Completed video links join the send here — after the thread exists
      // (a welcome-page paste has pre-thread rows the bind adopts), before
      // the turn fires. Their transcripts ride as attachments; the pasted
      // URLs leave the outgoing text so the model never sees both.
      let userText = request.text;
      const attachments: ChatTurnAttachment[] = [
        ...(request.attachments ?? []),
      ];
      const boundVideoJobIds: string[] = [];
      if (request.bindVideoJobs === true) {
        const bound = await bindVideoJobsForSend(organizationId, threadId);
        for (const payload of bound) {
          attachments.push({
            fileId: payload.fileId,
            fileName: payload.fileName,
            fileType: payload.fileType,
            fileSize: payload.fileSize,
          });
          userText = userText.replace(payload.pastedToken, '').trim();
          boundVideoJobIds.push(payload.jobId);
        }
      }
      // The call resolves when the turn settles; the reply streams through
      // the thread's SSE lane meanwhile. The settle also nudges the message
      // and thread reads — the transcript swaps to the durable rows even if
      // the stream missed a beat.
      const outcome = sendChatTurn(organizationId, threadId, {
        text: userText,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(request.modelId !== undefined ? { modelId: request.modelId } : {}),
        ...(request.modelSelection !== undefined
          ? { modelSelection: request.modelSelection }
          : {}),
        ...(request.providerSlug !== undefined
          ? { providerSlug: request.providerSlug }
          : {}),
        ...(request.reasoningEffort !== undefined
          ? { reasoningEffort: request.reasoningEffort }
          : {}),
      }).finally(() => {
        invalidateChatMessages(queryClient, organizationId, threadId);
        invalidateChatThreads(queryClient, organizationId);
      });
      return { threadId, boundVideoJobIds, outcome };
    },
    [queryClient, organizationId],
  );

  const defer = useCallback(
    async (request: ChatDeferredSendRequest): Promise<{ threadId: string }> => {
      const threadId =
        request.threadId ??
        (await createChatThread({
          organizationId,
          kind: 'direct',
          ...(request.projectId !== undefined
            ? { projectId: request.projectId }
            : {}),
          ...(request.reasoningEffort !== undefined
            ? { reasoningEffort: request.reasoningEffort }
            : {}),
        }));
      await enqueueDeferredSendRequest({
        organizationId,
        threadId,
        text: request.text,
        ...(request.attachments !== undefined && request.attachments.length > 0
          ? { attachments: [...request.attachments] }
          : {}),
        ...(request.videoJobIds !== undefined && request.videoJobIds.length > 0
          ? { videoJobIds: [...request.videoJobIds] }
          : {}),
        ...(request.modelId !== undefined ? { modelId: request.modelId } : {}),
        ...(request.modelSelection !== undefined
          ? { modelSelection: request.modelSelection }
          : {}),
        ...(request.providerSlug !== undefined
          ? { providerSlug: request.providerSlug }
          : {}),
        ...(request.reasoningEffort !== undefined
          ? { reasoningEffort: request.reasoningEffort }
          : {}),
        ...(request.locale !== undefined ? { locale: request.locale } : {}),
      });
      invalidateChatMessages(queryClient, organizationId, threadId);
      return { threadId };
    },
    [queryClient, organizationId],
  );

  const unbindVideoJobs = useCallback(
    async (jobIds: readonly string[]): Promise<void> => {
      if (jobIds.length === 0) return;
      await unbindVideoJobsRequest(organizationId, jobIds);
    },
    [organizationId],
  );

  return {
    available: true,
    start,
    defer,
    unbindVideoJobs,
    stop,
  };
}

/**
 * The clarifying question a thread is waiting on, if any.
 *
 * The turn SETTLES when the assistant asks (a pausing tool ends it), so there
 * is no generation row to read this off — the pending set lives on an
 * `approvals` row and this is the watch that surfaces it. `null` once it is
 * answered or superseded, which is what clears the panel.
 */
export function usePendingQuestion(
  organizationId: string,
  threadId: string | undefined,
): ChatQuery<{ requestId: string; set: QuestionSet } | null> {
  return useChatQuery(
    'chat/questions:getPendingQuestion',
    threadId ? { organizationId, threadId } : 'skip',
  );
}

/**
 * Close a pending question — `answered` when the person filled it in,
 * `superseded` when they said something else instead. Superseding is what
 * keeps a typed message from deadlocking on an unanswered question: the
 * person always wins. A double-submit is a no-op server-side, so a slow
 * network costs nothing.
 */
export function useResolveQuestion(organizationId: string): {
  readonly available: boolean;
  readonly resolve: (
    requestId: string,
    outcome: 'answered' | 'superseded',
  ) => Promise<void>;
} {
  const queryClient = useChatQueryClient();

  const resolve = useCallback(
    async (
      requestId: string,
      outcome: 'answered' | 'superseded',
    ): Promise<void> => {
      await resolveQuestionRequest(organizationId, requestId, outcome);
      // The panel clears from this read — nudge it without waiting for the
      // hint round-trip.
      void queryClient.invalidateQueries({
        queryKey: backendEntityPrefix(organizationId, 'chat_thread'),
      });
    },
    [organizationId, queryClient],
  );

  return { available: true, resolve };
}

/**
 * File a thread under a project (or take it back out with `null`) — the write
 * behind the sub-panel's drag-and-drop. Resolves `false` for a thread that is
 * not the caller's; `available` mirrors the reads for a provider-less render.
 */
export function useThreadProjectMove(organizationId: string): {
  readonly available: boolean;
  readonly move: (
    threadId: string,
    projectId: string | null,
  ) => Promise<boolean>;
} {
  const queryClient = useChatQueryClient();
  const move = useCallback(
    async (threadId: string, projectId: string | null): Promise<boolean> => {
      const ok = await moveChatThreadToProject(
        organizationId,
        threadId,
        projectId,
      );
      if (ok) invalidateChatThreads(queryClient, organizationId);
      return ok;
    },
    [queryClient, organizationId],
  );

  return { available: true, move };
}

/**
 * Persist the conversation's reasoning-effort pick on its thread, so the
 * level holds for every turn that follows — `null` clears the override and
 * the thread falls back to the default sampling. Fire-and-forget like the
 * capability picks: a lost write costs one re-pick, never a blocked send.
 * `available` mirrors the reads for a provider-less render.
 */
export function useThreadReasoningEffort(organizationId: string): {
  readonly available: boolean;
  readonly save: (threadId: string, effort: ReasoningEffort | null) => void;
} {
  const save = useCallback(
    (threadId: string, effort: ReasoningEffort | null) => {
      setChatThreadReasoningEffort(
        organizationId,
        threadId,
        // An absent arg clears the stored pick server-side.
        effort ?? undefined,
      ).then(
        (owned) => {
          if (!owned) {
            console.warn(
              '[chat] effort save skipped: the thread is not the caller’s',
            );
          }
        },
        (error: unknown) => {
          console.warn('[chat] could not save the effort pick', error);
        },
      );
    },
    [organizationId],
  );

  return { available: true, save };
}

/**
 * The memories the preferences page reviews. `pending` are proposals the model
 * made via `memory.save`; `approved` are the ones the user accepted.
 */
export function useChatMemories(organizationId: string): ChatQuery<{
  readonly pending: readonly { id: string; content: string }[];
  readonly approved: readonly { id: string; content: string }[];
}> {
  return useChatQuery('chat/memories:listMemories', { organizationId });
}
