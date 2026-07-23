'use client';

/**
 * THE SEAM between the chat surface and its Convex functions.
 *
 * Each read this surface needs is declared here once, in the shape the screen
 * consumes, and bound to a live Convex query. The reads that HAVE a backend —
 * threads, messages, the live generation, and memories — subscribe to
 * `api.chat.*` and stream updates in real time. The reads whose backend is not
 * built yet report `unavailable` rather than inventing rows, so a component
 * renders an honest "not connected" state instead of a conversation that does
 * not exist.
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
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

import { api } from '@/convex/_generated/api';

import type {
  CanvasSources,
  ChatAgentOption,
  ChatGenerationView,
  ChatMessageView,
  ChatThreadSummary,
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
  // Key the subscription by the JSON of its args so a structurally-equal args
  // object does not tear down and rebuild the watch every render.
  const argsKey = skip ? 'skip' : JSON.stringify(args);

  const watch = useMemo(
    () => (convex && !skip ? convex.watchQuery(fnRef, args) : undefined),
    // `args` is intentionally tracked by its JSON key (`argsKey`) so a
    // structurally-equal object does not tear down and rebuild the subscription
    // on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convex, fnRef, argsKey, skip],
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
 * harness listings are owned by the providers domain, not the chat backend, so
 * this reports `unavailable` until that seam is bound here rather than
 * fabricating a picker with no models behind it.
 */
export function useComposerModels(_organizationId: string): ChatQuery<{
  readonly models: readonly ComposerModelOption[];
  readonly sandboxAgents: readonly ComposerSandboxAgentOption[];
}> {
  return UNAVAILABLE;
}

/**
 * The slim agents the agent picker lists. Agent configurations are file-backed
 * and served by the agents domain; until that listing is bound through this
 * seam, the picker reports `unavailable` rather than showing agents that
 * cannot be selected.
 */
export function useChatAgents(
  _organizationId: string,
): ChatQuery<readonly ChatAgentOption[]> {
  return UNAVAILABLE;
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
