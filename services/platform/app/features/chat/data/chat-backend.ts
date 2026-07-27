'use client';

/**
 * THE SEAM between the chat surface and its Convex functions.
 *
 * Each read this surface needs is declared here once, in the shape the screen
 * consumes. Live reads — threads, messages, the live generation, and memories
 * — subscribe to `api.chat.*` and stream updates in real time. File-backed
 * config reads — the composer's models and the agent picker — go through their
 * domain's aggregator ACTION (models, harnesses, and agents live in the config
 * tree, which only a `'use node'` action may read) and resolve on mount. The
 * one WRITE the surface performs, sending a turn, lives here too
 * (`useChatSend`). The one read whose backend is not built yet, the Canvas,
 * reports `unavailable` rather than inventing rows, so a component renders an
 * honest "not connected" state instead of a session that does not exist.
 *
 * Subscriptions go through the Convex client directly (`useConvex` +
 * `useSyncExternalStore`) rather than the app's `useConvexQuery` wrapper. The
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

import { useConvex } from 'convex/react';
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from 'convex/server';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import type {
  CanvasSources,
  ChatAgentOption,
  ChatGenerationView,
  ChatMessageView,
  ChatProjectSummary,
  ChatThreadSummary,
  ComposerCapabilityOption,
} from '../types';
import {
  readStoredComposerCatalog,
  storeComposerCatalog,
  type ComposerCatalog,
} from './composer-catalog-store';

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
function useChatQuery<Ref extends FunctionReference<'query'>>(
  fnRef: Ref,
  args: FunctionArgs<Ref> | 'skip',
  options?: { readonly cache?: boolean },
): ChatQuery<FunctionReturnType<Ref>> {
  const convex = useConvex();
  const skip = args === 'skip';
  // Key the subscription by the function's NAME and the JSON of its args —
  // never by object identity. `api.x.y.z` builds a fresh FunctionReference on
  // every property access and callers build args inline, so identity-keyed
  // deps would tear down and rebuild the watch on every render. A fresh watch
  // answers `undefined` until its first result lands, so identity keying
  // oscillates the surface between loading and ready many times a second — a
  // self-sustaining, visible flicker.
  const fnKey = getFunctionName(fnRef);
  const argsKey = skip ? 'skip' : JSON.stringify(args);

  const watch = useMemo(
    () => (convex && !skip ? convex.watchQuery(fnRef, args) : undefined),
    // `fnRef` and `args` are intentionally tracked by their stable keys
    // (`fnKey`, `argsKey`) — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convex, fnKey, argsKey, skip],
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => watch?.onUpdate(onStoreChange) ?? (() => {}),
    [watch],
  );

  // The last error already reported, so a persistent pre-auth error is logged
  // once rather than on every render `useSyncExternalStore` triggers.
  const reportedError = useRef<string | undefined>(undefined);
  const getSnapshot = useCallback((): FunctionReturnType<Ref> | undefined => {
    if (!watch) return undefined;
    try {
      const result = watch.localQueryResult();
      reportedError.current = undefined;
      return result;
    } catch (error) {
      // A query can be in an error state during the brief pre-auth window;
      // read it as "not yet" so the surface holds rather than crashing, and it
      // re-runs once auth lands.
      const message = error instanceof Error ? error.message : String(error);
      if (reportedError.current !== message) {
        reportedError.current = message;
        console.warn('[chat] query is not readable yet', message);
      }
      return undefined;
    }
  }, [watch]);

  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Render-phase cache maintenance, mirroring useCachedPaginatedQuery: the
  // write is idempotent, and the value must be current for this render's own
  // read below. `getSnapshot` stays a pure view of the live watch — the
  // substitution happens here, in the return path only.
  const cacheable = options?.cache !== false && !skip && convex !== undefined;
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only this hook writes the cache, under the same (function, args) key it reads, so the entry is this query's own return type
    value = liveResultCache.get(cacheKey) as
      | FunctionReturnType<Ref>
      | undefined;
  }

  // One stable object per answer: while a remount serves the cached value its
  // identity holds across renders, exactly like a live result's would.
  const result = useMemo<ChatQuery<FunctionReturnType<Ref>>>(
    () =>
      value === undefined
        ? { status: 'loading' }
        : { status: 'ready', data: value },
    [value],
  );

  if (!convex) return UNAVAILABLE;
  return result;
}

/** The thread list in the chat sub-panel. */
export function useChatThreads(
  organizationId: string,
): ChatQuery<readonly ChatThreadSummary[]> {
  return useChatQuery(api.chat.threads.listThreads, { organizationId });
}

/**
 * The project folders the chat sub-panel files threads under. The projects
 * feature owns the table; this read reduces its rows to what a folder row
 * renders, through the same degrade-to-unavailable seam as every chat read.
 */
export function useChatProjects(
  organizationId: string,
): ChatQuery<readonly ChatProjectSummary[]> {
  const projects = useChatQuery(api.projects.queries.listProjects, {
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
export function useProjectPin(): {
  readonly available: boolean;
  readonly setPinned: (projectId: string, pinned: boolean) => Promise<void>;
} {
  const convex = useConvex();

  const setPinned = useCallback(
    async (projectId: string, pinned: boolean): Promise<void> => {
      if (!convex) throw new Error('The chat backend is not reachable.');
      await convex.mutation(api.projects.mutations.setProjectPinned, {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the id round-trips through the seam's string view model; its origin is the projects table
        projectId: projectId as Id<'projects'>,
        pinned,
      });
    },
    [convex],
  );

  return { available: convex !== undefined, setPinned };
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
  return useChatQuery(
    api.governance.legal_hold_queries.listActiveHoldTargetIds,
    {
      organizationId,
      targetType: 'thread',
    },
  );
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
    api.chat.threads.listArchivedThreads,
    options.enabled
      ? {
          organizationId,
          ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
        }
      : 'skip',
  );
}

/** One thread's messages, in `sequence` order. */
export function useChatMessages(
  organizationId: string,
  threadId: string | undefined,
): ChatQuery<readonly ChatMessageView[]> {
  return useChatQuery(
    api.chat.messages.listMessages,
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
    api.chat.branches.listThreadBranches,
    rootThreadId ? { organizationId, rootThreadId } : 'skip',
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
    api.feedback.queries.listThreadFeedback,
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
  return useChatQuery(
    api.chat.generations.getGeneration,
    threadId ? { organizationId, threadId } : 'skip',
    // Never served from the session cache: a turn that settled while the
    // surface was unmounted deleted its row, so replaying the last answer
    // would flash a "still streaming" state for a turn that is over.
    { cache: false },
  );
}

/** Per-harness health for the composer's circuit-breaker hint. Reactive, so a
 * harness that starts failing (or recovers) updates the picker live. */
export function useHarnessHealth(organizationId: string): ChatQuery<
  ReadonlyArray<{
    harness: string;
    recentTotal: number;
    recentFailures: number;
    degraded: boolean;
  }>
> {
  return useChatQuery(api.sandbox.session_queries_public.getHarnessHealth, {
    organizationId,
  });
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
  const convex = useConvex();
  const [state, setState] = useState<ChatQuery<ComposerCatalog>>(() => {
    const cached = recallComposerCatalog(organizationId);
    return cached ? { status: 'ready', data: cached } : { status: 'loading' };
  });

  useEffect(() => {
    if (!convex || !organizationId) return () => {};
    let cancelled = false;
    const cached = recallComposerCatalog(organizationId);
    setState(
      cached ? { status: 'ready', data: cached } : { status: 'loading' },
    );
    convex
      .action(api.chat.composer.listComposerModels, { organizationId })
      .then(
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
  }, [convex, organizationId]);

  if (!convex) return UNAVAILABLE;
  return state;
}

/**
 * The last agent roster each org answered with, kept for the session — same
 * contract as the composer catalog cache above, for the same reason: a
 * remount must not blank the picker for the round-trip its refresh takes.
 */
const chatAgentsCache = new Map<string, readonly ChatAgentOption[]>();

/**
 * The slim agents the agent picker lists. Agent configurations are FILES, so
 * this read is an ACTION (no reactive watch); a remount serves the org's last
 * answer and refreshes in the background, so roster edits reflect on the next
 * chat mount without the picker emptying while they load. Failures degrade to
 * `unavailable` — the picker says "not connected" rather than showing agents
 * that cannot be selected — unless a previous answer exists, which then keeps
 * serving.
 */
export function useChatAgents(
  organizationId: string,
): ChatQuery<readonly ChatAgentOption[]> {
  const convex = useConvex();
  const [state, setState] = useState<ChatQuery<readonly ChatAgentOption[]>>(
    () => {
      const cached = chatAgentsCache.get(organizationId);
      return cached ? { status: 'ready', data: cached } : { status: 'loading' };
    },
  );

  useEffect(() => {
    if (!convex || !organizationId) return () => {};
    let cancelled = false;
    const cached = chatAgentsCache.get(organizationId);
    setState(
      cached ? { status: 'ready', data: cached } : { status: 'loading' },
    );
    convex.action(api.agents.actions.listAgents, { organizationId }).then(
      (listing) => {
        if (cancelled) return;
        const data = listing.agents.map((agent) => ({
          slug: agent.slug,
          label: agent.displayName,
          ...(agent.description !== undefined
            ? { description: agent.description }
            : {}),
        }));
        chatAgentsCache.set(organizationId, data);
        setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (cancelled) return;
        // Pre-auth or backend failure: report honestly; the picker renders
        // its unavailable state instead of an empty roster. A stale roster,
        // when one exists, beats blanking a working picker.
        console.warn('[chat] could not list agents for the picker', error);
        if (!chatAgentsCache.has(organizationId)) {
          setState(UNAVAILABLE);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [convex, organizationId]);

  if (!convex) return UNAVAILABLE;
  return state;
}

interface ComposerCapabilityCatalog {
  readonly skills: readonly ComposerCapabilityOption[];
  readonly connectors: readonly ComposerCapabilityOption[];
}

/**
 * The last capability catalog each org answered with, kept for the session —
 * same contract as the model catalog cache above: a remount serves it and
 * refreshes in the background instead of emptying the Skills/Connectors
 * menus for a round-trip on every navigation.
 */
const composerCapabilitiesCache = new Map<string, ComposerCapabilityCatalog>();

/**
 * Drop an org's cached capability catalog so the next composer mount
 * refetches it. The skill library calls this after every save, upload or
 * delete — a freshly created skill must show up in the equip menu without a
 * full reload.
 */
export function invalidateComposerCapabilitiesCache(
  organizationId: string,
): void {
  composerCapabilitiesCache.delete(organizationId);
}

/**
 * What a conversation can equip an agent with: the org's skills and its
 * enabled connectors. File- and credential-backed like the model listing, so
 * — same style — an aggregator ACTION resolved on mount, degrading to
 * `unavailable` instead of offering picks nothing could serve — unless a
 * previous answer exists, which then keeps serving.
 */
export function useComposerCapabilities(
  organizationId: string,
): ChatQuery<ComposerCapabilityCatalog> {
  const convex = useConvex();
  const [state, setState] = useState<ChatQuery<ComposerCapabilityCatalog>>(
    () => {
      const cached = composerCapabilitiesCache.get(organizationId);
      return cached ? { status: 'ready', data: cached } : { status: 'loading' };
    },
  );

  useEffect(() => {
    if (!convex || !organizationId) return () => {};
    let cancelled = false;
    const cached = composerCapabilitiesCache.get(organizationId);
    setState(
      cached ? { status: 'ready', data: cached } : { status: 'loading' },
    );
    convex
      .action(api.chat.composer.listComposerCapabilities, { organizationId })
      .then(
        (data) => {
          if (cancelled) return;
          composerCapabilitiesCache.set(organizationId, data);
          setState({ status: 'ready', data });
        },
        (error: unknown) => {
          if (cancelled) return;
          // A stale catalog, when one exists, beats emptying working menus.
          console.warn(
            '[chat] could not list capabilities for the composer',
            error,
          );
          if (!composerCapabilitiesCache.has(organizationId)) {
            setState(UNAVAILABLE);
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [convex, organizationId]);

  if (!convex) return UNAVAILABLE;
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
  readonly save: (modelId: string) => void;
} {
  const convex = useConvex();
  const row = useChatQuery(api.user_preferences.queries.getMyPreferences, {
    organizationId,
  });

  const save = useCallback(
    (modelId: string) => {
      if (!convex) return;
      convex
        .mutation(api.user_preferences.mutations.setChatModel, {
          organizationId,
          modelId,
        })
        .catch((error: unknown) => {
          console.warn('[chat] could not save the model pick', error);
        });
    },
    [convex, organizationId],
  );

  const preference: ChatQuery<string | undefined> =
    row.status === 'ready'
      ? { status: 'ready', data: row.data?.chatModelId ?? undefined }
      : row;

  return { preference, save };
}

/** What a turn needs from the composer. Omitting `threadId` means "start a
 * new thread for this turn" — the handle carries the id that was created.
 * `platform` turns run the direct model lane and need `modelId`; `external`
 * turns run the harness lane and need `harness`, plus the `modelId` the
 * managed harness runs on (absent falls back to the org's first
 * directly-served model, server-side). */
export interface ChatTurnRequest {
  readonly threadId?: string;
  readonly text: string;
  readonly agentKind: 'platform' | 'external';
  readonly modelId?: string;
  readonly providerSlug?: string;
  readonly harness?: string;
  readonly sandbox?: boolean;
  readonly agentSlug?: string;
  /** The conversation's capability assembly, stored on a NEW thread. */
  readonly capabilities?: {
    readonly skills: readonly string[];
    readonly connectors: readonly string[];
  };
  /** The project a NEW thread starts in (the project's "New chat" flow). */
  readonly projectId?: string;
}

/** A started turn: the thread it runs in (existing or just created), and an
 * outcome promise — a refusal carries its reason. The direct lane settles it
 * when the turn completes; the external lane settles it when the turn is
 * ACCEPTED (the kick is thin by contract — a browser-held action does not
 * survive a websocket reconnect, so nothing long may ride on this promise)
 * and the reply itself arrives through the messages/generations
 * subscriptions. */
export interface ChatTurnHandle {
  readonly threadId: string;
  readonly outcome: Promise<{
    status: 'completed' | 'refused';
    reason?: string;
  }>;
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
  /** Stop the thread's in-flight external turn (cancels the harness exec and
   * settles the turn). A no-op for a thread with no live external turn. */
  readonly stop: (threadId: string) => Promise<void>;
} {
  const convex = useConvex();

  const stop = useCallback(
    async (threadId: string): Promise<void> => {
      if (!convex) throw new Error('The chat backend is not reachable.');
      await convex.action(api.chat.external_turn_action.stopExternalTurn, {
        organizationId,
        threadId,
      });
    },
    [convex, organizationId],
  );

  const start = useCallback(
    async (request: ChatTurnRequest): Promise<ChatTurnHandle> => {
      if (!convex) throw new Error('The chat backend is not reachable.');
      const threadId =
        request.threadId ??
        (await convex.mutation(api.chat.threads.createThread, {
          organizationId,
          kind: request.agentKind === 'external' ? 'sandbox' : 'direct',
          ...(request.agentSlug !== undefined
            ? { agentSlug: request.agentSlug }
            : {}),
          ...(request.harness !== undefined
            ? { harness: request.harness }
            : {}),
          ...(request.capabilities !== undefined
            ? {
                capabilities: {
                  skills: [...request.capabilities.skills],
                  connectors: [...request.capabilities.connectors],
                },
              }
            : {}),
          ...(request.projectId !== undefined
            ? { projectId: request.projectId }
            : {}),
        }));
      if (request.agentKind === 'external') {
        if (request.harness === undefined) {
          throw new Error('An external turn needs its agent.');
        }
        const outcome = convex.action(
          api.chat.external_turn_action.startExternalTurn,
          {
            organizationId,
            threadId,
            userText: request.text,
            harness: request.harness,
            ...(request.modelId !== undefined
              ? { modelId: request.modelId }
              : {}),
            ...(request.providerSlug !== undefined
              ? { providerSlug: request.providerSlug }
              : {}),
          },
        );
        return { threadId, outcome };
      }
      if (request.modelId === undefined) {
        throw new Error('A platform turn needs its model.');
      }
      const outcome = convex.action(api.chat.turn_action.startTurn, {
        organizationId,
        threadId,
        userText: request.text,
        modelId: request.modelId,
        ...(request.providerSlug !== undefined
          ? { providerSlug: request.providerSlug }
          : {}),
        sandbox: request.sandbox ?? false,
        ...(request.agentSlug !== undefined
          ? { agentSlug: request.agentSlug }
          : {}),
      });
      return { threadId, outcome };
    },
    [convex, organizationId],
  );

  return { available: convex !== undefined, start, stop };
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
  const convex = useConvex();

  const move = useCallback(
    async (threadId: string, projectId: string | null): Promise<boolean> => {
      if (!convex) throw new Error('The chat backend is not reachable.');
      return await convex.mutation(api.chat.threads.moveThreadToProject, {
        organizationId,
        threadId,
        projectId,
      });
    },
    [convex, organizationId],
  );

  return { available: convex !== undefined, move };
}

/**
 * Persist the conversation's capability assembly (the composer's Skills /
 * Connectors picks) on its thread, so a toggle holds for every turn that
 * follows — not merely the message it was made for. Fire-and-forget like the
 * model preference: a lost write costs one re-toggle, never a blocked send.
 * `available` mirrors the reads for a provider-less render.
 */
export function useThreadCapabilities(organizationId: string): {
  readonly available: boolean;
  readonly save: (
    threadId: string,
    capabilities: {
      readonly skills: readonly string[];
      readonly connectors: readonly string[];
    },
  ) => void;
} {
  const convex = useConvex();

  const save = useCallback(
    (
      threadId: string,
      capabilities: {
        readonly skills: readonly string[];
        readonly connectors: readonly string[];
      },
    ) => {
      if (!convex) return;
      convex
        .mutation(api.chat.threads.setThreadCapabilities, {
          organizationId,
          threadId,
          capabilities: {
            skills: [...capabilities.skills],
            connectors: [...capabilities.connectors],
          },
        })
        .then(
          (owned) => {
            if (!owned) {
              console.warn(
                '[chat] capability save skipped: the thread is not the caller’s',
              );
            }
          },
          (error: unknown) => {
            console.warn('[chat] could not save the capability picks', error);
          },
        );
    },
    [convex, organizationId],
  );

  return { available: convex !== undefined, save };
}

/**
 * Everything the Canvas panel reads about the open thread. The Canvas reflects
 * a sandbox session — a separate subsystem — so this reports `unavailable`
 * until that backend exists rather than rendering a panel with nothing behind
 * its tabs.
 */
export function useCanvasSources(
  _organizationId: string,
  _threadId: string | undefined,
): ChatQuery<CanvasSources> {
  return UNAVAILABLE;
}

/**
 * The memories the preferences page reviews. `pending` are proposals the model
 * made via `memory.save`; `approved` are the ones the user accepted.
 */
export function useChatMemories(organizationId: string): ChatQuery<{
  readonly pending: readonly { id: string; content: string }[];
  readonly approved: readonly { id: string; content: string }[];
}> {
  return useChatQuery(api.chat.memories.listMemories, { organizationId });
}
