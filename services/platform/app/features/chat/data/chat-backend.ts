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
  ComposerModelOption,
  ComposerExternalAgentOption,
} from '../types';

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
 * Subscribe to a chat query through the live Convex client. Returns
 * `unavailable` when there is no client in context (so a provider-less render
 * never throws), `loading` while the subscription has no result, and `ready`
 * with the result once it arrives. Passing `'skip'` holds the subscription
 * closed — for a read that has no argument to run on yet, like a thread view
 * with no thread selected.
 */
function useChatQuery<Ref extends FunctionReference<'query'>>(
  fnRef: Ref,
  args: FunctionArgs<Ref> | 'skip',
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

  if (!convex) return UNAVAILABLE;
  if (data === undefined) return { status: 'loading' };
  return { status: 'ready', data };
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

interface ComposerCatalog {
  readonly models: readonly ComposerModelOption[];
  readonly externalAgents: readonly ComposerExternalAgentOption[];
}

/**
 * The last catalog each org answered with, kept for the session. A remount
 * starts from this answer and refreshes in the background instead of dropping
 * back to `loading` — the loading gap is what flipped the chat index between
 * its welcome and the provider-setup notice on every navigation.
 */
const composerCatalogCache = new Map<string, ComposerCatalog>();

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
    const cached = composerCatalogCache.get(organizationId);
    return cached ? { status: 'ready', data: cached } : { status: 'loading' };
  });

  useEffect(() => {
    if (!convex || !organizationId) return () => {};
    let cancelled = false;
    const cached = composerCatalogCache.get(organizationId);
    setState(
      cached ? { status: 'ready', data: cached } : { status: 'loading' },
    );
    convex
      .action(api.chat.composer.listComposerModels, { organizationId })
      .then(
        (data) => {
          if (cancelled) return;
          composerCatalogCache.set(organizationId, data);
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
 * The slim agents the agent picker lists. Agent configurations are FILES, so
 * this read is an ACTION (no reactive watch); it loads once per org and again
 * per mount, which is the freshness a picker needs. Failures degrade to
 * `unavailable` — the picker says "not connected" rather than showing agents
 * that cannot be selected. Roster edits reflect on the next chat mount.
 */
export function useChatAgents(
  organizationId: string,
): ChatQuery<readonly ChatAgentOption[]> {
  const convex = useConvex();
  const [state, setState] = useState<ChatQuery<readonly ChatAgentOption[]>>({
    status: 'loading',
  });

  useEffect(() => {
    if (!convex || !organizationId) return () => {};
    let cancelled = false;
    setState({ status: 'loading' });
    convex.action(api.agents.actions.listAgents, { organizationId }).then(
      (listing) => {
        if (cancelled) return;
        setState({
          status: 'ready',
          data: listing.agents.map((agent) => ({
            slug: agent.slug,
            label: agent.displayName,
            ...(agent.description !== undefined
              ? { description: agent.description }
              : {}),
          })),
        });
      },
      (error: unknown) => {
        if (cancelled) return;
        // Pre-auth or backend failure: report honestly; the picker renders
        // its unavailable state instead of an empty roster.
        console.warn('[chat] could not list agents for the picker', error);
        setState(UNAVAILABLE);
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
 * What a conversation can equip an agent with: the org's skills and its
 * enabled connectors. File- and credential-backed like the model listing, so
 * — same style — an aggregator ACTION resolved on mount, degrading to
 * `unavailable` instead of offering picks nothing could serve.
 */
export function useComposerCapabilities(organizationId: string): ChatQuery<{
  readonly skills: readonly ComposerCapabilityOption[];
  readonly connectors: readonly ComposerCapabilityOption[];
}> {
  const convex = useConvex();
  const [state, setState] = useState<
    ChatQuery<{
      readonly skills: readonly ComposerCapabilityOption[];
      readonly connectors: readonly ComposerCapabilityOption[];
    }>
  >({ status: 'loading' });

  useEffect(() => {
    if (!convex || !organizationId) return () => {};
    let cancelled = false;
    setState({ status: 'loading' });
    convex
      .action(api.chat.composer.listComposerCapabilities, { organizationId })
      .then(
        (data) => {
          if (cancelled) return;
          setState({ status: 'ready', data });
        },
        (error: unknown) => {
          if (cancelled) return;
          console.warn(
            '[chat] could not list capabilities for the composer',
            error,
          );
          setState(UNAVAILABLE);
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
