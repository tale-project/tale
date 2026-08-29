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
 */

import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

import { backendUrl } from '@/app/lib/backend/api-client';
import {
  invalidateChatMessages,
  invalidateChatThreads,
} from '@/app/lib/backend/chat';

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
  source.addEventListener('idle', () => publish(key, IDLE));
  source.addEventListener('progress', (event: MessageEvent<string>) => {
    try {
      const data: unknown = JSON.parse(event.data);
      if (data === null || typeof data !== 'object') return;
      const record = data as {
        messageId?: unknown;
        text?: unknown;
        reasoning?: unknown;
        serverNow?: unknown;
      };
      const messageId =
        typeof record.messageId === 'string' ? record.messageId : undefined;
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
          ...(typeof record.serverNow === 'number'
            ? { serverNow: record.serverNow }
            : {}),
        },
      });
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
