import type { SSEStreamingApi } from 'hono/streaming';
import type { Sql } from 'postgres';

import {
  createHeartbeat,
  createStreamWriter,
  type FanoutStream,
  frameEvent,
  jitteredRetryMs,
  type StreamWriter,
} from '../../realtime/sse-fanout.ts';
import {
  type MessageView,
  readLastMessageView,
  readMessageViewsByIds,
} from './message-views.ts';

/**
 * The process-shared watcher behind the per-thread chat progress lane.
 *
 * Every open chat tab used to poll its thread's generation row every 250 ms
 * for as long as the tab stayed open — four queries a second per tab even
 * while nothing ran, a parts read on every tick of a running turn, and a
 * whole-transcript read per tab when the turn settled. The watcher does the
 * same work once per PROCESS: one light read per tick for every watched
 * thread (which generations exist and when they last moved), the full text
 * and parts only for the threads that moved, and the settled row alone —
 * not the transcript — once per settled turn, shared by every tab watching
 * it.
 *
 * What a tab sees is unchanged: an immediate `idle` on an idle thread,
 * `progress` (message id, text, reasoning, cancel flag, parts only when they
 * changed) whenever the generation row moves, `settled` with the final row
 * when it disappears, heartbeats on an idle lane.
 */

/** Watched threads up to which the light read names them; past it, the
 * in-flight generations are few enough to read whole and filter here. */
const NAMED_READ_LIMIT = 500;

export interface GenerationWatchOptions {
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  errorBackoffMs?: number;
  maxPendingWrites?: number;
}

interface GenerationState {
  messageId: string | null;
  text: string;
  reasoning: string;
  cancelRequested: boolean;
  updatedAt: number;
}

interface ThreadWatch {
  readonly threadId: string;
  readonly organizationId: string;
  readonly subscribers: Set<ThreadSubscriber>;
  /** The live generation as last read, or null while the thread is idle. */
  generation: GenerationState | null;
  /** The message id of the turn that ran last; a settle falls back to it. */
  lastMessageId: string | null;
  /** The live parts, serialized: subscribers compare by identity. */
  partsJson: string | null;
  parts: unknown[] | null;
  /** Whether a read has resolved this thread's state at least once. */
  known: boolean;
}

interface ThreadSubscriber extends FanoutStream {
  readonly watch: ThreadWatch;
  writer: StreamWriter;
  /** The newest generation update this tab was shown. */
  lastSeenUpdate: number;
  /** The parts this tab was last sent (identity of `ThreadWatch.partsJson`). */
  lastPartsJson: string | null;
  /** Whether this tab has seen the current turn (owes it a `settled`). */
  generating: boolean;
  finish: () => void;
}

interface LightRow {
  threadId: string;
  orgId: string;
  messageId: string | null;
  updatedAt: number;
}

interface FullRow {
  threadId: string;
  orgId: string;
  messageId: string | null;
  text: string;
  reasoning: string;
  cancelRequested: boolean;
  updatedAt: number;
}

export interface GenerationWatch {
  /** Serve one tab's lane until it ends. The thread's ownership was proved
   * by the caller. */
  attach: (
    stream: SSEStreamingApi,
    target: { organizationId: string; threadId: string },
  ) => Promise<void>;
  /** Threads watched (tests and telemetry). */
  threads: () => number;
}

export function createGenerationWatch(
  sql: Sql,
  options: GenerationWatchOptions,
): GenerationWatch {
  const errorBackoffMs = options.errorBackoffMs ?? 1_000;
  const watches = new Map<string, ThreadWatch>();
  let loopRunning = false;

  const heartbeat = createHeartbeat({
    intervalMs: options.heartbeatIntervalMs,
    streams: function* () {
      for (const watch of watches.values()) {
        for (const subscriber of watch.subscribers) {
          yield { target: subscriber, writer: subscriber.writer };
        }
      }
    },
  });

  function progressFrame(watch: ThreadWatch, withParts: boolean): string {
    const generation = watch.generation;
    return frameEvent({
      event: 'progress',
      data: JSON.stringify({
        messageId: generation?.messageId ?? null,
        text: generation?.text ?? '',
        reasoning: generation?.reasoning ?? '',
        cancelRequested: generation?.cancelRequested ?? false,
        ...(withParts && watch.parts !== null ? { parts: watch.parts } : {}),
        serverNow: Date.now(),
      }),
    });
  }

  /** Bring every tab of a thread up to the thread's current state. */
  function publish(
    watch: ThreadWatch,
    settled: MessageView | null | undefined,
  ): void {
    let shared: string | null = null;
    let sharedWithParts: string | null = null;
    const settledFrame =
      settled === undefined
        ? null
        : frameEvent({
            event: 'settled',
            data: JSON.stringify({ message: settled }),
          });
    for (const subscriber of watch.subscribers) {
      if (subscriber.ended) continue;
      const generation = watch.generation;
      if (generation !== null) {
        if (generation.updatedAt <= subscriber.lastSeenUpdate) continue;
        subscriber.generating = true;
        subscriber.lastSeenUpdate = generation.updatedAt;
        // Parts ride along only when they CHANGED for this tab: a tool
        // result can be large (a RAG page), and text ticks four times a
        // second.
        if (
          watch.partsJson !== null &&
          watch.partsJson !== subscriber.lastPartsJson
        ) {
          subscriber.lastPartsJson = watch.partsJson;
          sharedWithParts ??= progressFrame(watch, true);
          subscriber.writer.write(sharedWithParts);
        } else {
          shared ??= progressFrame(watch, false);
          subscriber.writer.write(shared);
        }
      } else if (subscriber.generating && settledFrame !== null) {
        // The row's absence is the settle signal — ship the final row.
        subscriber.generating = false;
        subscriber.lastSeenUpdate = 0;
        subscriber.lastPartsJson = null;
        subscriber.writer.write(settledFrame);
      }
    }
  }

  async function readLight(threadIds: readonly string[]): Promise<LightRow[]> {
    if (threadIds.length <= NAMED_READ_LIMIT) {
      return sql<LightRow[]>`
        SELECT thread_id AS "threadId", org_id AS "orgId",
               message_id AS "messageId",
               updated_at_ms::float8 AS "updatedAt"
        FROM app.generations
        WHERE thread_id = ANY(${threadIds}::text[])
      `;
    }
    // Many watched threads: the in-flight generations are the smaller set.
    return sql<LightRow[]>`
      SELECT thread_id AS "threadId", org_id AS "orgId",
             message_id AS "messageId",
             updated_at_ms::float8 AS "updatedAt"
      FROM app.generations
    `;
  }

  async function readFull(threadIds: readonly string[]): Promise<FullRow[]> {
    if (threadIds.length === 0) return [];
    return sql<FullRow[]>`
      SELECT thread_id AS "threadId", org_id AS "orgId",
             message_id AS "messageId", text, reasoning,
             cancel_requested AS "cancelRequested",
             updated_at_ms::float8 AS "updatedAt"
      FROM app.generations
      WHERE thread_id = ANY(${threadIds}::text[])
    `;
  }

  async function readParts(
    pairs: readonly { organizationId: string; messageId: string }[],
  ): Promise<Map<string, unknown[]>> {
    if (pairs.length === 0) return new Map();
    const ids = pairs.map((pair) => pair.messageId);
    const orgIds = pairs.map((pair) => pair.organizationId);
    const rows = await sql<{ id: string; parts: unknown }[]>`
      SELECT id, parts FROM app.messages
      WHERE (id, org_id) IN (
        SELECT * FROM unnest(${ids}::text[], ${orgIds}::text[])
      )
    `;
    const out = new Map<string, unknown[]>();
    for (const row of rows) {
      if (Array.isArray(row.parts)) out.set(row.id, row.parts);
    }
    return out;
  }

  /** One pass over every watched thread. */
  async function poll(): Promise<void> {
    const threadIds = [...watches.keys()];
    if (threadIds.length === 0) return;
    const light = new Map<string, LightRow>();
    for (const row of await readLight(threadIds)) {
      const watch = watches.get(row.threadId);
      if (watch !== undefined && watch.organizationId === row.orgId) {
        light.set(row.threadId, row);
      }
    }
    const moved: string[] = [];
    const settledWatches: ThreadWatch[] = [];
    for (const watch of watches.values()) {
      const row = light.get(watch.threadId);
      if (row !== undefined) {
        if (
          watch.generation === null ||
          row.updatedAt > watch.generation.updatedAt
        ) {
          moved.push(watch.threadId);
        }
      } else if (watch.generation !== null) {
        settledWatches.push(watch);
      } else if (!watch.known) {
        watch.known = true;
      }
    }

    const full = await readFull(moved);
    const partsWanted: { organizationId: string; messageId: string }[] = [];
    const refreshed: ThreadWatch[] = [];
    for (const row of full) {
      const watch = watches.get(row.threadId);
      if (watch === undefined || watch.organizationId !== row.orgId) continue;
      watch.known = true;
      watch.generation = {
        messageId: row.messageId ?? watch.lastMessageId,
        text: row.text,
        reasoning: row.reasoning,
        cancelRequested: row.cancelRequested,
        updatedAt: row.updatedAt,
      };
      if (row.messageId !== null) {
        watch.lastMessageId = row.messageId;
        partsWanted.push({
          organizationId: watch.organizationId,
          messageId: row.messageId,
        });
      }
      refreshed.push(watch);
    }
    const parts = await readParts(partsWanted);
    for (const watch of refreshed) {
      const live =
        watch.generation?.messageId != null
          ? parts.get(watch.generation.messageId)
          : undefined;
      if (live !== undefined) {
        const serialized = JSON.stringify(live);
        if (serialized !== watch.partsJson) {
          watch.partsJson = serialized;
          watch.parts = live;
        }
      }
      publish(watch, undefined);
    }

    if (settledWatches.length > 0) {
      const named = settledWatches
        .filter((watch) => watch.lastMessageId !== null)
        .map((watch) => ({
          organizationId: watch.organizationId,
          messageId: watch.lastMessageId ?? '',
        }));
      const views = await readMessageViewsByIds(sql, named);
      for (const watch of settledWatches) {
        let message: MessageView | null =
          watch.lastMessageId !== null
            ? (views.get(watch.lastMessageId) ?? null)
            : null;
        message ??= await readLastMessageView(
          sql,
          watch.organizationId,
          watch.threadId,
        );
        watch.generation = null;
        watch.partsJson = null;
        watch.parts = null;
        publish(watch, message);
      }
    }
  }

  function schedule(delayMs: number): void {
    setTimeout(() => {
      void loop();
    }, delayMs);
  }

  async function loop(): Promise<void> {
    if (watches.size === 0) {
      loopRunning = false;
      heartbeat.stop();
      return;
    }
    try {
      await poll();
    } catch (error) {
      console.error('[chat] stream poll failed, backing off:', error);
      schedule(errorBackoffMs);
      return;
    }
    schedule(options.pollIntervalMs);
  }

  function ensureLoop(): void {
    heartbeat.start();
    if (loopRunning) return;
    loopRunning = true;
    schedule(options.pollIntervalMs);
  }

  /** The thread's state for a tab that just arrived: one read, the same
   * one the per-tab lane made, so an idle thread answers `idle` at once. */
  async function prime(watch: ThreadWatch): Promise<void> {
    const rows = await readFull([watch.threadId]);
    const row = rows.find(
      (candidate) => candidate.orgId === watch.organizationId,
    );
    watch.known = true;
    if (row === undefined) {
      watch.generation = null;
      return;
    }
    watch.generation = {
      messageId: row.messageId ?? watch.lastMessageId,
      text: row.text,
      reasoning: row.reasoning,
      cancelRequested: row.cancelRequested,
      updatedAt: row.updatedAt,
    };
    if (row.messageId !== null) {
      watch.lastMessageId = row.messageId;
      const parts = await readParts([
        { organizationId: watch.organizationId, messageId: row.messageId },
      ]);
      const live = parts.get(row.messageId);
      if (live !== undefined) {
        watch.partsJson = JSON.stringify(live);
        watch.parts = live;
      }
    }
  }

  return {
    threads: () => watches.size,
    attach(stream, target) {
      return new Promise<void>((resolve) => {
        if (stream.aborted) {
          resolve();
          return;
        }
        let watch = watches.get(target.threadId);
        const fresh = watch === undefined;
        if (watch === undefined) {
          watch = {
            threadId: target.threadId,
            organizationId: target.organizationId,
            subscribers: new Set(),
            generation: null,
            lastMessageId: null,
            partsJson: null,
            parts: null,
            known: false,
          };
          watches.set(target.threadId, watch);
        }
        const owned = watch;
        // The writer needs the lane's shared state and the subscriber needs
        // the writer: build the state first, then extend it in place so both
        // hold the same object.
        const state: FanoutStream = {
          stream,
          lastWriteAt: Date.now(),
          ended: false,
        };
        const end = (): void => {
          if (state.ended) return;
          state.ended = true;
          owned.subscribers.delete(subscriber);
          if (owned.subscribers.size === 0) watches.delete(owned.threadId);
          subscriber.finish();
        };
        const writer = createStreamWriter(state, {
          maxPendingWrites: options.maxPendingWrites,
          onOverflow: () => {
            console.warn(
              '[chat] a progress lane stopped reading; ending it so it reconnects',
            );
            end();
            stream.abort();
          },
        });
        const subscriber: ThreadSubscriber = Object.assign(state, {
          watch: owned,
          lastSeenUpdate: 0,
          lastPartsJson: null,
          generating: false,
          writer,
          finish: () => {
            void writer.flushed().then(() => resolve());
          },
        });
        stream.onAbort(end);
        owned.subscribers.add(subscriber);
        ensureLoop();

        const greet = (): void => {
          if (subscriber.ended) return;
          // Spread the browsers' native reconnects after a deploy.
          const retry = `retry: ${jitteredRetryMs()}\n\n`;
          if (owned.generation === null) {
            // Resolve the tab's initial state IMMEDIATELY: an idle thread
            // must not wait a heartbeat interval to learn nothing is running
            // (the send affordance keys off this).
            subscriber.writer.write(
              retry + frameEvent({ event: 'idle', data: '' }),
            );
            return;
          }
          subscriber.writer.write(retry);
          publish(owned, undefined);
        };
        if (fresh || !owned.known) {
          prime(owned).then(greet, (error: unknown) => {
            console.warn('[chat] stream initial probe failed:', error);
            subscriber.writer.write(`retry: ${jitteredRetryMs()}\n\n`);
          });
        } else {
          greet();
        }
      });
    },
  };
}
