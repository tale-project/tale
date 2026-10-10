/**
 * The two event streams a browser tab holds (`app/lib/backend/
 * use-backend-hints.ts`, `app/features/chat/data/thread-stream.ts`):
 *
 * - `GET /events?orgId=` for the whole session: `hint` events
 *   (`{entity, entityId}`) telling the tab which reads to refetch, `resync`
 *   when it fell too far behind, `forbidden` when it lost the org;
 * - `GET /api/app/chat/threads/:id/stream?orgId=` while a thread is on
 *   screen: an immediate `idle` on an idle thread, `progress` whenever the
 *   generation row moves (message id, the text so far), `settled` with the
 *   final message once the turn ends, `heartbeat` on a quiet lane.
 *
 * Both reconnect with `Last-Event-ID` and full jitter (`client/sse.ts`).
 */

import { openEventStream } from '../client/index.ts';
import type { EventStreamHandle, StreamEvent } from '../client/index.ts';
import type { MetricsRegistry } from '../metrics/index.ts';
import { asRecord, asString } from './client.ts';

/** The pieces of a user's connection a stream needs. */
export interface StreamTarget {
  agent: Parameters<typeof openEventStream>[0]['agent'];
  baseUrl: string;
  metrics: MetricsRegistry;
  /** Called on every (re)connect: the cookie may have been refreshed. */
  headers: () => Record<string, string>;
  random?: () => number;
}

function urlOf(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

export interface Hint {
  entity: string;
  entityId: string | null;
}

/** A `hint` event's payload; `null` for anything else. */
export function parseHint(event: StreamEvent): Hint | null {
  if (event.event !== 'hint') return null;
  try {
    const record = asRecord(JSON.parse(event.data));
    const entity = asString(record?.entity);
    if (entity === undefined) return null;
    return { entity, entityId: asString(record?.entityId) ?? null };
  } catch (error) {
    // A malformed hint is the server's bug, not a reason to drop the stream.
    console.warn('[load] unparseable hint event', error);
    return null;
  }
}

export interface OrgEventHandlers {
  onHint: (hint: Hint) => void;
  /** The server asked the tab to refetch everything. */
  onResync?: () => void;
  onOpen?: () => void;
}

/** Hold the organization's hint stream (`sse.events`). */
export function openOrgEvents(
  target: StreamTarget,
  orgId: string,
  handlers: OrgEventHandlers,
): EventStreamHandle {
  return openEventStream({
    agent: target.agent,
    url: urlOf(target.baseUrl, `/events?orgId=${encodeURIComponent(orgId)}`),
    headers: target.headers,
    metrics: target.metrics,
    name: 'sse.events',
    ...(target.random === undefined ? {} : { random: target.random }),
    onOpen: handlers.onOpen,
    onEvent: (event) => {
      if (event.event === 'hint') {
        const hint = parseHint(event);
        if (hint !== null) handlers.onHint(hint);
      } else if (event.event === 'resync') {
        handlers.onResync?.();
      }
    },
  });
}

export type ThreadEvent =
  | { kind: 'idle' }
  | {
      kind: 'progress';
      messageId: string | undefined;
      text: string;
      cancelRequested: boolean;
    }
  | {
      kind: 'settled';
      messageId: string | undefined;
      status: string | undefined;
      failed: boolean;
    }
  | { kind: 'heartbeat' }
  | { kind: 'other'; event: string };

/** A thread-lane event, parsed. A body that does not parse reads `other`. */
export function parseThreadEvent(event: StreamEvent): ThreadEvent {
  switch (event.event) {
    case 'idle':
      return { kind: 'idle' };
    case 'heartbeat':
      return { kind: 'heartbeat' };
    case 'progress':
    case 'settled': {
      let record: Record<string, unknown> | undefined;
      try {
        record = asRecord(JSON.parse(event.data));
      } catch (error) {
        console.warn(`[load] unparseable ${event.event} event`, error);
        return { kind: 'other', event: event.event };
      }
      if (event.event === 'progress') {
        return {
          kind: 'progress',
          messageId: asString(record?.messageId),
          text: typeof record?.text === 'string' ? record.text : '',
          cancelRequested: record?.cancelRequested === true,
        };
      }
      const message = asRecord(record?.message);
      return {
        kind: 'settled',
        messageId: asString(message?.id),
        status: asString(message?.status),
        failed:
          asString(message?.error) !== undefined ||
          asString(message?.blockedReason) !== undefined,
      };
    }
    default:
      return { kind: 'other', event: event.event };
  }
}

/** Hold one thread's progress lane (`sse.thread`). */
export function openThreadStream(
  target: StreamTarget,
  orgId: string,
  threadId: string,
  onEvent: (event: ThreadEvent) => void,
): EventStreamHandle {
  return openEventStream({
    agent: target.agent,
    url: urlOf(
      target.baseUrl,
      `/api/app/chat/threads/${encodeURIComponent(threadId)}/stream?orgId=${encodeURIComponent(orgId)}`,
    ),
    headers: target.headers,
    metrics: target.metrics,
    name: 'sse.thread',
    ...(target.random === undefined ? {} : { random: target.random }),
    onEvent: (event) => onEvent(parseThreadEvent(event)),
  });
}
