import type { Sql } from 'postgres';

import type { TurnStore, UsageLedger } from '../../../lib/chat/turn.ts';
import { toJson } from '../../db/sql.ts';

/**
 * The Postgres-backed ports the turn pipeline writes through — the 0.5 twin
 * of `convex/chat/turn_store.ts` with the same contracts: throttled
 * streaming-progress writes (the finalize write carries the authoritative
 * text, so skipped intervals never lose the tail), cancel piggybacked on the
 * progress write, and a generations row whose ABSENCE means idle.
 *
 * Realtime: every progress/finalize/end write NOTIFYs `chat_stream` with the
 * thread id; API pods LISTEN once per process and re-read the row for their
 * subscribed SSE clients (payload-cap-safe, reconnect-safe).
 */

const STREAM_WRITE_INTERVAL_MS = 250;

export const CHAT_STREAM_CHANNEL = 'chat_stream';

async function notifyThread(sql: Sql, threadId: string): Promise<void> {
  await sql.notify(CHAT_STREAM_CHANNEL, threadId);
}

async function appendMessageRow(
  sql: Sql,
  message: {
    organizationId: string;
    threadId: string;
    role: string;
    parts: unknown;
    text?: string;
    model?: string;
    providerSlug?: string;
    usage?: unknown;
    blockedReason?: string;
    error?: string;
    truncation?: { droppedMessages: number };
    status?: string;
  },
): Promise<{ id: string; sequence: number }> {
  const rows = await sql<{ id: string; order: number }[]>`
    INSERT INTO app.messages (
      thread_id, org_id, "order", step_order, role, parts, text, model,
      provider_slug, usage, blocked_reason, truncation, error, status,
      created_at_ms
    )
    SELECT ${message.threadId}, ${message.organizationId},
           coalesce(max("order"), -1) + 1, 0, ${message.role},
           ${message.parts === undefined ? null : sql.json(toJson(message.parts))},
           ${message.text ?? null}, ${message.model ?? null},
           ${message.providerSlug ?? null},
           ${message.usage === undefined ? null : sql.json(toJson(message.usage))},
           ${message.blockedReason ?? null},
           ${message.truncation === undefined ? null : sql.json(toJson(message.truncation))},
           ${message.error ?? null}, ${message.status ?? 'complete'},
           ${Date.now()}
    FROM app.messages WHERE thread_id = ${message.threadId}
    RETURNING id, "order"
  `;
  const row = rows[0];
  if (!row) {
    throw new Error('message insert failed');
  }
  await sql`
    UPDATE app.threads SET updated_at_ms = ${Date.now()}
    WHERE id = ${message.threadId}
  `;
  return { id: row.id, sequence: row.order };
}

/** A turn store over app.messages + app.generations. */
export function createPgTurnStore(sql: Sql): TurnStore {
  let lastStreamWriteAt = 0;
  let lastCancelRequested = false;
  return {
    async appendMessage(message) {
      return appendMessageRow(sql, {
        ...message,
        text: message.parts
          .map((part) => (part.type === 'text' ? part.text : ''))
          .join(''),
      });
    },

    async streamProgress(update) {
      const nowMs = Date.now();
      if (
        update.flush !== true &&
        nowMs - lastStreamWriteAt < STREAM_WRITE_INTERVAL_MS
      ) {
        return { cancelRequested: lastCancelRequested };
      }
      lastStreamWriteAt = nowMs;
      const rows = await sql<{ cancelRequested: boolean }[]>`
        UPDATE app.generations SET
          text = ${update.text},
          reasoning = ${update.reasoning ?? ''},
          message_id = coalesce(${update.messageId ?? null}, message_id),
          heartbeat_at_ms = ${nowMs}, updated_at_ms = ${nowMs}
        WHERE thread_id = ${update.threadId}
          AND org_id = ${update.organizationId}
        RETURNING cancel_requested AS "cancelRequested"
      `;
      lastCancelRequested = rows[0]?.cancelRequested ?? false;
      await notifyThread(sql, update.threadId);
      return { cancelRequested: lastCancelRequested };
    },

    async updateAssistantParts(update) {
      await sql`
        UPDATE app.messages SET parts = ${sql.json(toJson([...update.parts]))}
        WHERE id = ${update.messageId} AND org_id = ${update.organizationId}
      `;
      await notifyThread(sql, update.threadId);
    },

    async finalizeAssistantMessage(message) {
      await sql`
        UPDATE app.messages SET
          text = coalesce(${message.text ?? null}, text),
          reasoning = ${message.reasoning ?? null},
          parts = coalesce(${message.parts === undefined ? null : sql.json(toJson([...message.parts]))}, parts),
          model = coalesce(${message.model ?? null}, model),
          provider_slug = coalesce(${message.providerSlug ?? null}, provider_slug),
          usage = coalesce(${message.usage === undefined ? null : sql.json(toJson(message.usage))}, usage),
          blocked_reason = ${message.blockedReason ?? null},
          error = ${message.error ?? null},
          status = ${message.error !== undefined ? 'failed' : 'complete'}
        WHERE id = ${message.messageId} AND org_id = ${message.organizationId}
      `;
      await notifyThread(sql, message.threadId);
    },

    async beginTurn(setup) {
      let userMessage: { id: string; sequence: number } | undefined;
      if (setup.userParts !== undefined) {
        userMessage = await appendMessageRow(sql, {
          organizationId: setup.organizationId,
          threadId: setup.threadId,
          role: 'user',
          parts: setup.userParts,
          text: setup.userParts
            .map((part) => (part.type === 'text' ? part.text : ''))
            .join(''),
          ...(setup.truncation !== undefined
            ? { truncation: setup.truncation }
            : {}),
        });
      }
      const assistantMessage = await appendMessageRow(sql, {
        organizationId: setup.organizationId,
        threadId: setup.threadId,
        role: 'assistant',
        parts: [],
        status: 'pending',
      });
      const now = Date.now();
      await sql`
        INSERT INTO app.generations (
          thread_id, org_id, message_id, started_at_ms, heartbeat_at_ms,
          updated_at_ms
        ) VALUES (
          ${setup.threadId}, ${setup.organizationId}, ${assistantMessage.id},
          ${now}, ${now}, ${now}
        )
        ON CONFLICT (thread_id) DO UPDATE SET
          message_id = ${assistantMessage.id}, text = '', reasoning = '',
          cancel_requested = false, started_at_ms = ${now},
          heartbeat_at_ms = ${now}, updated_at_ms = ${now}
      `;
      await sql`
        UPDATE app.thread_metadata SET
          generation_status = 'generating', stream_id = ${assistantMessage.id},
          generation_start_ms = ${now}, generation_heartbeat_at_ms = ${now},
          cancelled_at_ms = NULL, cancelled_message_id = NULL
        WHERE thread_id = ${setup.threadId}
      `;
      await notifyThread(sql, setup.threadId);
      return {
        ...(userMessage !== undefined ? { userMessage } : {}),
        assistantMessage,
      };
    },

    async endGeneration(generation) {
      await sql`
        DELETE FROM app.generations
        WHERE thread_id = ${generation.threadId}
          AND org_id = ${generation.organizationId}
      `;
      await sql`
        UPDATE app.thread_metadata SET
          generation_status = 'idle', stream_id = NULL,
          generation_heartbeat_at_ms = NULL
        WHERE thread_id = ${generation.threadId}
      `;
      await notifyThread(sql, generation.threadId);
    },
  };
}

/** The usage ledger over app.usage_events. */
export function createPgUsageLedger(sql: Sql): UsageLedger {
  return {
    async record(entry) {
      await sql`
        INSERT INTO app.usage_events (
          org_id, user_id, agent_slug, model, provider, input_tokens,
          output_tokens, total_tokens, created_at_ms
        ) VALUES (
          ${entry.organizationId}, ${entry.userId}, ${entry.agentSlug ?? null},
          ${entry.model}, ${entry.provider}, ${entry.inputTokens},
          ${entry.outputTokens}, ${entry.totalTokens}, ${Date.now()}
        )
      `;
    },
  };
}
