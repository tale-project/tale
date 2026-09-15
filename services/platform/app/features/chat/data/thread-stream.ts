'use client';

/**
 * The per-thread SSE lane off the 0.5 backend — the migrated twin of the
 * `getGeneration` + `getGenerationText` websocket watches. One EventSource
 * per (org, thread) with subscriber counting; the store's snapshot carries
 * BOTH the generation status view and the in-flight streamed text, exactly
 * the two channels `useThreadView` splits them into.
 *
 * Protocol (`GET /chat/threads/:id/stream`): an immediate `idle` when
 * nothing runs; `progress` whenever the generation row moves (messageId +
 * text + reasoning at the store's write throttle); `settled` with the final
 * message when the row disappears — at which point the store nudges the
 * message/thread reads so the transcript swaps to the durable row.
 *
 * The store also nudges the message and tray reads when a turn OPENS (the
 * first `progress` over an idle lane): the turn-open write persisted the
 * user message and settled any parked (deferred) send, and only this tab's
 * own direct send has an optimistic bubble to cover the gap — a send the
 * backend fired once its attachments were ready, a REST caller's, or another
 * tab's would otherwise show no user bubble and a "Queued" tray row for the
 * whole generation. An `idle` over a streaming lane is a reconnect that
 * missed `settled`, and nudges the same reads.
 */

import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

import { backendUrl } from '@/app/lib/backend/api-client';
import {
  invalidateChatMessages,
  invalidateChatThreads,
} from '@/app/lib/backend/chat';
import type { MessagePart } from '@/lib/chat/types';

export interface ThreadStreamGeneration {
  readonly status:
    | 'queued'
    | 'streaming'
    | 'waiting-approval'
    | 'waiting-input';
  readonly waitingOn?: string;
  readonly messageId?: string;
}

export interface ThreadStreamText {
  readonly messageId?: string;
  readonly text: string;
  readonly reasoning?: string;
  /**
   * The assistant row's parts as they stand mid-turn — how a tool call shows
   * up WHILE it runs instead of all at once when the turn settles. Sent only
   * when they changed (a large tool result must not be resent on every text
   * tick), so an event without them means "unchanged", not "none": the last
   * value is carried forward here rather than clearing the trace.
   */
  readonly parts?: readonly MessagePart[];
  /** The backend clock at emit — feeds the thinking timer's offset. */
  readonly serverNow?: number;
}

interface ThreadStreamState {
  /** `undefined` while the lane resolves; `null` when the thread is idle. */
  readonly generation: ThreadStreamGeneration | null | undefined;
  /** The in-flight streamed text, while a turn writes. */
  readonly generationText: ThreadStreamText | null | undefined;
}

const RESOLVING: ThreadStreamState = {
  generation: undefined,
  generationText: undefined,
};
const IDLE: ThreadStreamState = { generation: null, generationText: null };

interface StreamEntry {
  source: EventSource;
  state: ThreadStreamState;
  listeners: Set<() => void>;
}

const streams = new Map<string, StreamEntry>();

function streamPath(organizationId: string, threadId: string): string {
  return backendUrl(
    `/chat/threads/${encodeURIComponent(threadId)}/stream`,
    organizationId,
  );
}

/** A lane with a turn on it — `null` is idle, `undefined` still resolving. */
function isStreaming(state: ThreadStreamState | undefined): boolean {
  return state?.generation !== null && state?.generation !== undefined;
}

function publish(key: string, state: ThreadStreamState): void {
  const entry = streams.get(key);
  if (!entry) return;
  entry.state = state;
  for (const listener of entry.listeners) listener();
}

function openStream(
  key: string,
  organizationId: string,
  threadId: string,
  queryClient: QueryClient,
): StreamEntry {
  const source = new EventSource(streamPath(organizationId, threadId), {
    withCredentials: true,
  });
  const entry: StreamEntry = {
    source,
    state: RESOLVING,
    listeners: new Set(),
  };
  source.addEventListener('idle', () => {
    // `idle` is the open-time probe, so one arriving over a streaming lane
    // is a reconnect that found the turn over: `settled` went by while the
    // lane was down. Nudge the reads the way settle would have.
    const wasStreaming = isStreaming(streams.get(key)?.state);
    publish(key, IDLE);
    if (wasStreaming) {
      invalidateChatMessages(queryClient, organizationId, threadId);
      invalidateChatThreads(queryClient, organizationId);
    }
  });
  source.addEventListener('progress', (event: MessageEvent<string>) => {
    try {
      const data: unknown = JSON.parse(event.data);
      if (data === null || typeof data !== 'object') return;
      const previous = streams.get(key)?.state;
      const record = data as {
        messageId?: unknown;
        text?: unknown;
        reasoning?: unknown;
        parts?: unknown;
        serverNow?: unknown;
      };
      const messageId =
        typeof record.messageId === 'string' ? record.messageId : undefined;
      // Absent parts mean unchanged, so carry the last ones forward — a
      // text tick must not blank the trace the previous event painted.
      const carried = previous?.generationText ?? undefined;
      const parts = Array.isArray(record.parts)
        ? (record.parts as readonly MessagePart[])
        : carried?.messageId === messageId
          ? carried?.parts
          : undefined;
      publish(key, {
        generation: {
          status: 'streaming',
          ...(messageId !== undefined ? { messageId } : {}),
        },
        generationText: {
          ...(messageId !== undefined ? { messageId } : {}),
          text: typeof record.text === 'string' ? record.text : '',
          ...(typeof record.reasoning === 'string' && record.reasoning !== ''
            ? { reasoning: record.reasoning }
            : {}),
          ...(parts !== undefined ? { parts } : {}),
          ...(typeof record.serverNow === 'number'
            ? { serverNow: record.serverNow }
            : {}),
        },
      });
      // The turn just opened: the durable rows carry its user message and a
      // parked send's tray row is already settled — swap both in NOW, not
      // at settle (see the module doc). A reconnect mid-turn lands here over
      // a streaming lane and nudges nothing.
      if (!isStreaming(previous)) {
        invalidateChatMessages(queryClient, organizationId, threadId);
      }
    } catch (error) {
      console.warn('[chat-stream] unparseable progress event:', error);
    }
  });
  source.addEventListener('settled', () => {
    publish(key, IDLE);
    // The durable rows now carry the reply — swap the transcript over and
    // let the list re-rank by recency.
    invalidateChatMessages(queryClient, organizationId, threadId);
    invalidateChatThreads(queryClient, organizationId);
  });
  source.addEventListener('error', () => {
    // The browser reconnects on its own; hold the last state meanwhile.
  });
  return entry;
}

/**
 * Subscribe to one thread's live-turn lane. Returns the generation status
 * view and the streamed text — `undefined` while the lane resolves, `null`
 * when the thread is idle.
 */
export function useThreadStream(
  organizationId: string,
  threadId: string | undefined,
  queryClient: QueryClient,
): ThreadStreamState {
  const key = threadId !== undefined ? `${organizationId}:${threadId}` : '';

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (key === '' || threadId === undefined) return () => undefined;
      let entry = streams.get(key);
      if (!entry) {
        entry = openStream(key, organizationId, threadId, queryClient);
        streams.set(key, entry);
      }
      entry.listeners.add(onStoreChange);
      return () => {
        const current = streams.get(key);
        if (!current) return;
        current.listeners.delete(onStoreChange);
        if (current.listeners.size === 0) {
          current.source.close();
          streams.delete(key);
        }
      };
    },
    [key, organizationId, threadId, queryClient],
  );

  const getSnapshot = useCallback(
    (): ThreadStreamState => streams.get(key)?.state ?? RESOLVING,
    [key],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
