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

import type {
  CanvasSources,
  ChatAgentOption,
  ChatGenerationView,
  ChatMessageView,
  ChatThreadSummary,
  ComposerCapabilityOption,
  ComposerModelOption,
  ComposerSandboxAgentOption,
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

/**
 * What the composer's model picker offers. The model catalog and sandbox
 * harnesses are file-backed config the providers domain owns, so — like the
 * agent read below — this is an ACTION, not a reactive watch: it resolves the
 * org's models the same way a turn does (the connectors it has an active
 * credential for) plus the shipped harnesses, loading once per org and again
 * per mount. Failures degrade to `unavailable`, so the picker says "not
 * connected" rather than offering a model no configured credential could serve.
 */
export function useComposerModels(organizationId: string): ChatQuery<{
  readonly models: readonly ComposerModelOption[];
  readonly sandboxAgents: readonly ComposerSandboxAgentOption[];
}> {
  const convex = useConvex();
  const [state, setState] = useState<
    ChatQuery<{
      readonly models: readonly ComposerModelOption[];
      readonly sandboxAgents: readonly ComposerSandboxAgentOption[];
    }>
  >({ status: 'loading' });

  useEffect(() => {
    if (!convex || !organizationId) return () => {};
    let cancelled = false;
    setState({ status: 'loading' });
    convex
      .action(api.chat.composer.listComposerModels, { organizationId })
      .then(
        (data) => {
          if (cancelled) return;
          setState({ status: 'ready', data });
        },
        (error: unknown) => {
          if (cancelled) return;
          // Pre-auth or backend failure: report honestly; the picker renders its
          // unavailable state instead of an empty model list.
          console.warn(
            '[chat] could not list composer models for the picker',
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
 * `platform` turns run the direct model lane and need `modelId`; `coding`
 * turns run the harness lane and need `harness`. */
export interface ChatTurnRequest {
  readonly threadId?: string;
  readonly text: string;
  readonly agentKind: 'platform' | 'coding';
  readonly modelId?: string;
  readonly harness?: string;
  readonly sandbox?: boolean;
  readonly agentSlug?: string;
  /** The conversation's capability assembly, stored on a NEW thread. */
  readonly capabilities?: {
    readonly skills: readonly string[];
    readonly connectors: readonly string[];
  };
}

/** A started turn: the thread it runs in (existing or just created), and an
 * outcome that settles when the turn does — a refusal carries its reason. */
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
  /** Stop the thread's in-flight coding turn (cancels the harness exec and
   * settles the turn). A no-op for a thread with no live coding turn. */
  readonly stop: (threadId: string) => Promise<void>;
} {
  const convex = useConvex();

  const stop = useCallback(
    async (threadId: string): Promise<void> => {
      if (!convex) throw new Error('The chat backend is not reachable.');
      await convex.action(api.chat.coding_turn_action.stopCodingTurn, {
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
          kind: request.agentKind === 'coding' ? 'sandbox' : 'direct',
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
        }));
      if (request.agentKind === 'coding') {
        if (request.harness === undefined) {
          throw new Error('A coding turn needs its agent.');
        }
        const outcome = convex.action(
          api.chat.coding_turn_action.startCodingTurn,
          {
            organizationId,
            threadId,
            userText: request.text,
            harness: request.harness,
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
