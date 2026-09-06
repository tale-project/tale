import type { Sql } from 'postgres';

import {
  estimateCostCents,
  ThreadBusyError,
  type TurnStore,
  type UsageLedger,
  type UsageLedgerEntry,
} from '../../../lib/chat/turn.ts';
import { getProviderCatalog } from '../../core/lib/providers/catalog_fetch.ts';
import { resolveProvidersForOrg } from '../../core/lib/providers/org_providers.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { incrementUsageLedger } from '../governance/service.ts';
import { MESSAGE_SLOT_ATTEMPTS } from '../threads/store.ts';

/**
 * The Postgres-backed ports the turn pipeline writes through — the 0.5 twin
 * of `convex/chat/turn_store.ts` with the same contracts: throttled
 * streaming-progress writes (the finalize write carries the authoritative
 * text, so skipped intervals never lose the tail), cancel piggybacked on the
 * progress write, and a generations row whose ABSENCE means idle.
 *
 * Realtime rides the rows themselves: the per-thread progress lane
 * (`routes.ts` `/threads/:id/stream`) polls the generation row at this
 * store's write throttle, so no LISTEN/NOTIFY hub exists — a push could not
 * beat the throttle, and a listener would add a connection without adding
 * freshness.
 */

const STREAM_WRITE_INTERVAL_MS = 250;

export async function appendMessageRow(
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
  // The slot is UNIQUE: two turns appending to one thread at once both read
  // the same max, and the one the index refuses re-claims the next slot on
  // a fresh statement instead of tying the winner's ordering.
  let row: { id: string; order: number } | undefined;
  for (
    let attempt = 0;
    row === undefined && attempt < MESSAGE_SLOT_ATTEMPTS;
    attempt += 1
  ) {
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
      ON CONFLICT (thread_id, "order", step_order) DO NOTHING
      RETURNING id, "order"
    `;
    row = rows[0];
  }
  if (!row) {
    throw new Error(
      `message insert failed: no free slot after ${MESSAGE_SLOT_ATTEMPTS} attempts`,
    );
  }
  // A turn just wrote to the thread; keep its list ordering fresh. An
  // assistant row also stamps the unread watermark; activity on a hidden
  // branch surfaces on its ROOT — the row the sidebar shows for the lineage.
  const now = Date.now();
  await sql`
    UPDATE app.threads SET updated_at_ms = ${now}
    WHERE id = ${message.threadId}
  `;
  const meta = await sql<
    { branchRootId: string | null; chatType: string; userId: string }[]
  >`
    SELECT branch_root_id AS "branchRootId", chat_type AS "chatType",
           user_id AS "userId"
    FROM app.thread_metadata WHERE thread_id = ${message.threadId}
    LIMIT 1
  `;
  if (message.role === 'assistant') {
    await sql`
      UPDATE app.thread_metadata SET last_reply_at_ms = ${now}
      WHERE thread_id = ${message.threadId}
    `;
  }
  const rootId = meta[0]?.branchRootId ?? null;
  if (rootId !== null) {
    await sql`
      UPDATE app.threads SET updated_at_ms = ${now} WHERE id = ${rootId}
    `;
    if (message.role === 'assistant') {
      await sql`
        UPDATE app.thread_metadata SET last_reply_at_ms = ${now}
        WHERE thread_id = ${rootId}
      `;
    }
  }
  // The thread's first user message names the conversation: fire the AI
  // title generation exactly once — for the opening user message of an
  // untitled thread (a branch copy or an explicitly titled thread keeps
  // what it has).
  if (message.role === 'user' && row.order === 0 && meta[0] !== undefined) {
    const firstMessage = (message.text ?? '').trim();
    if (firstMessage.length > 0) {
      const untitled = await sql<{ id: string }[]>`
        SELECT id FROM app.threads
        WHERE id = ${message.threadId} AND title IS NULL
        LIMIT 1
      `;
      if (untitled.length > 0) {
        await addJobInTx(sql, 'chat.generate_title', {
          organizationId: message.organizationId,
          threadId: message.threadId,
          userId: meta[0].userId,
          firstMessage,
        });
      }
    }
  }
  return { id: row.id, sequence: row.order };
}

/**
 * The failure-shaped finalize: no `text` means "keep whatever the throttled
 * streaming writes persisted" (the pipeline's contract) — but in Postgres the
 * streamed text and reasoning live on the GENERATION row, which the same
 * turn's `endGeneration` deletes a moment later. Copy the streamed tail onto
 * the message first, in one transaction with the failure stamp: the text
 * column, the reasoning column (the pipeline passes none on failure), and a
 * trailing text part, because the client renders parts. A tool-round
 * boundary resets the generation text BEFORE the round's text lands on the
 * parts, so a non-empty generation text is always an unsettled tail — never
 * a duplicate of a part already stored.
 */
async function finalizeWithStreamedTail(
  sql: Sql,
  message: Parameters<TurnStore['finalizeAssistantMessage']>[0],
): Promise<void> {
  await sql.begin(async (tx) => {
    const generation = await tx<{ text: string; reasoning: string | null }[]>`
      SELECT text, reasoning FROM app.generations
      WHERE thread_id = ${message.threadId} AND org_id = ${message.organizationId}
      LIMIT 1
    `;
    const streamedText = generation[0]?.text ?? '';
    const streamedReasoning = generation[0]?.reasoning ?? '';
    let parts: unknown[] | null = null;
    if (streamedText.length > 0) {
      const stored = await tx<{ parts: unknown }[]>`
        SELECT parts FROM app.messages
        WHERE id = ${message.messageId} AND org_id = ${message.organizationId}
        LIMIT 1
      `;
      const existing = Array.isArray(stored[0]?.parts) ? stored[0].parts : [];
      const last: unknown = existing.at(-1);
      const alreadyStored =
        typeof last === 'object' &&
        last !== null &&
        'type' in last &&
        last.type === 'text' &&
        'text' in last &&
        last.text === streamedText;
      parts = alreadyStored
        ? null
        : [...existing, { type: 'text', text: streamedText }];
    }
    await tx`
      UPDATE app.messages SET
        text = coalesce(nullif(${streamedText}, ''), text),
        reasoning = coalesce(
          ${message.reasoning ?? null}, nullif(${streamedReasoning}, ''), reasoning
        ),
        parts = coalesce(${parts === null ? null : tx.json(toJson(parts))}, parts),
        model = coalesce(${message.model ?? null}, model),
        provider_slug = coalesce(${message.providerSlug ?? null}, provider_slug),
        usage = coalesce(${message.usage === undefined ? null : tx.json(toJson(message.usage))}, usage),
        blocked_reason = ${message.blockedReason ?? null},
        error = ${message.error ?? null},
        status = ${message.error !== undefined ? 'failed' : 'complete'}
      WHERE id = ${message.messageId} AND org_id = ${message.organizationId}
    `;
  });
}

/**
 * Decorate a turn store so a deferred send's row dies the moment the turn
 * persists the user message — the turn-open write, when it carries the user
 * parts. Until that write the row is the parked message's only
 * representation (the tray above the composer); from it on the thread shows
 * the bubble, and a row that survived to the action's terminal settle would
 * double-display the message for the whole generation. A settle failure is
 * logged, never fatal — the terminal settle in the action retries it.
 * (Re-homed from the retired `core/chat/turn_store.ts`: the PG store is its
 * only consumer.)
 */
function settleDeferredSendOnUserAppend(
  store: TurnStore,
  settle: () => Promise<void>,
): TurnStore {
  return {
    ...store,
    async beginTurn(setup) {
      const opened = await store.beginTurn(setup);
      if (setup.userParts !== undefined) {
        try {
          await settle();
        } catch (error) {
          console.warn('Deferred send settle at user append failed:', error);
        }
      }
      return opened;
    },
  };
}

/** A turn store over app.messages + app.generations. With
 * `onUserMessageAppended` the store is decorated to run it the moment
 * `beginTurn` persisted the user row — the deferred-send lane settles its
 * tray row there (the 0.4 `settleDeferredSendOnUserAppend` wiring). */
export function createPgTurnStore(
  sql: Sql,
  options: { onUserMessageAppended?: () => Promise<void> } = {},
): TurnStore {
  const store = pgTurnStore(sql);
  return options.onUserMessageAppended !== undefined
    ? settleDeferredSendOnUserAppend(store, options.onUserMessageAppended)
    : store;
}

function pgTurnStore(sql: Sql): TurnStore {
  let lastStreamWriteAt = 0;
  let lastCancelRequested = false;
  return {
    async appendMessage(message) {
      const appended = await appendMessageRow(sql, {
        ...message,
        text: message.parts
          .map((part) => (part.type === 'text' ? part.text : ''))
          .join(''),
      });
      return appended;
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
      return { cancelRequested: lastCancelRequested };
    },

    async updateAssistantParts(update) {
      await sql`
        UPDATE app.messages SET parts = ${sql.json(toJson([...update.parts]))}
        WHERE id = ${update.messageId} AND org_id = ${update.organizationId}
      `;
      // A tool step is turn PROGRESS, and the progress lane watches the
      // generation row's clock — without this bump the stream sees nothing
      // move and the trace stays invisible until the turn settles. Text
      // ticks already bump it; parts wrote silently.
      await sql`
        UPDATE app.generations
        SET heartbeat_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
        WHERE thread_id = ${update.threadId}
          AND org_id = ${update.organizationId}
      `;
    },

    async finalizeAssistantMessage(message) {
      if (message.text === undefined) {
        await finalizeWithStreamedTail(sql, message);
        return;
      }
      await sql`
        UPDATE app.messages SET
          text = coalesce(${message.text}, text),
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
    },

    async beginTurn(setup) {
      // ONE transaction, per the contract: the user row, the placeholder,
      // and the generation row commit together or not at all — a crash
      // between them used to leave a question with no reply, or a 'pending'
      // bubble no watchdog would ever fail (the watchdog keys on the
      // generation row, which did not exist yet).
      const opened = await sql.begin(async (tx) => {
        let userMessage: { id: string; sequence: number } | undefined;
        if (setup.userParts !== undefined) {
          userMessage = await appendMessageRow(tx, {
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
        const assistantMessage = await appendMessageRow(tx, {
          organizationId: setup.organizationId,
          threadId: setup.threadId,
          role: 'assistant',
          parts: [],
          status: 'pending',
        });
        const now = Date.now();
        // The claim. The row's existence is the at-most-one-turn fact every
        // lane reads; a conflict means another turn holds the thread, and
        // rebinding its row (the old DO UPDATE) let two racing sends stream
        // into one row and delete it from under each other. DO NOTHING plus
        // the throw rolls the whole open back — the loser leaves no trace.
        const claimed = await tx<{ threadId: string }[]>`
          INSERT INTO app.generations (
            thread_id, org_id, message_id, started_at_ms, heartbeat_at_ms,
            updated_at_ms
          ) VALUES (
            ${setup.threadId}, ${setup.organizationId}, ${assistantMessage.id},
            ${now}, ${now}, ${now}
          )
          ON CONFLICT (thread_id) DO NOTHING
          RETURNING thread_id AS "threadId"
        `;
        if (claimed.length === 0) throw new ThreadBusyError(setup.threadId);
        await tx`
          UPDATE app.thread_metadata SET
            generation_status = 'generating', stream_id = ${assistantMessage.id},
            generation_start_ms = ${now}, generation_heartbeat_at_ms = ${now},
            cancelled_at_ms = NULL, cancelled_message_id = NULL
          WHERE thread_id = ${setup.threadId}
        `;
        return {
          ...(userMessage !== undefined ? { userMessage } : {}),
          assistantMessage,
        };
      });
      return opened;
    },

    async endGeneration(generation) {
      await sql.begin(async (tx) => {
        await tx`
          DELETE FROM app.generations
          WHERE thread_id = ${generation.threadId}
            AND org_id = ${generation.organizationId}
        `;
        await tx`
          UPDATE app.thread_metadata SET
            generation_status = 'idle', stream_id = NULL,
            generation_heartbeat_at_ms = NULL
          WHERE thread_id = ${generation.threadId}
        `;
        // A settled turn leaves no 'pending' placeholder: the finalize write
        // precedes this on every path (completed, refused, cancelled, paused,
        // failed), so a row still pending here is one whose finalize itself
        // failed — and with the generation row gone, nothing else would ever
        // mark it. The claim above makes this turn's placeholder the only
        // pending row the thread can hold.
        await tx`
          UPDATE app.messages SET status = 'failed',
            error = coalesce(error, 'the turn ended before its reply settled')
          WHERE thread_id = ${generation.threadId}
            AND org_id = ${generation.organizationId}
            AND status = 'pending'
        `;
      });
    },
  };
}

/**
 * The turn's cost in cents, from the serving connector's catalog `pricing`
 * through the ONE cost formula the pipeline also stamps on the message
 * (`estimateCostCents`). A model the catalog does not price books 0 — an
 * honest under-count, never a fabricated rate — and a failed lookup logs
 * and books 0 rather than losing the token row.
 */
export async function estimateTurnCostCents(
  sql: Sql,
  entry: Pick<
    UsageLedgerEntry,
    'organizationId' | 'provider' | 'model' | 'inputTokens' | 'outputTokens'
  >,
): Promise<number> {
  try {
    const orgSlug = await resolveOrgSlug(sql, entry.organizationId);
    if (orgSlug === null) return 0;
    const connector = resolveProvidersForOrg(orgSlug).find(
      (candidate) => candidate.name === entry.provider,
    );
    if (connector === undefined) return 0;
    const pricing = (await getProviderCatalog(connector)).find(
      (candidate) => candidate.id === entry.model,
    )?.pricing;
    return estimateCostCents(entry.inputTokens, entry.outputTokens, pricing);
  } catch (error) {
    console.warn(
      `[usage-ledger] could not price ${entry.provider}/${entry.model} (booking 0):`,
      error instanceof Error ? error.message : error,
    );
    return 0;
  }
}

/** The usage ledger: the fine-grained event row plus the governance
 * period-bucket aggregates (both best-effort together — one write). */
export function createPgUsageLedger(sql: Sql): UsageLedger {
  return {
    async record(entry) {
      const now = Date.now();
      // Priced at booking: the read side (the usage dashboard, the cost
      // budgets, the budget-status gate) sums THIS column — nothing joins a
      // price in later, so a 0 here is model spend that never existed.
      const costEstimateCents = await estimateTurnCostCents(sql, entry);
      await sql`
        INSERT INTO app.usage_events (
          org_id, user_id, agent_slug, model, provider, input_tokens,
          output_tokens, total_tokens, created_at_ms
        ) VALUES (
          ${entry.organizationId}, ${entry.userId}, ${entry.agentSlug ?? null},
          ${entry.model}, ${entry.provider}, ${entry.inputTokens},
          ${entry.outputTokens}, ${entry.totalTokens}, ${now}
        )
      `;
      await incrementUsageLedger(sql, {
        organizationId: entry.organizationId,
        userId: entry.userId,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        costEstimateCents,
        timestamp: now,
        ...(entry.agentSlug !== undefined
          ? { agentSlug: entry.agentSlug }
          : {}),
        model: entry.model,
        provider: entry.provider,
      });
    },
  };
}

/**
 * Record a turn that died before producing anything — the REST turn job's
 * failure lane: the caller must SEE why their accepted message never got a
 * reply, so the error lands as an assistant row in the conversation.
 */
export async function appendAssistantErrorMessage(
  sql: Sql,
  args: {
    organizationId: string;
    threadId: string;
    model?: string;
    error: string;
  },
): Promise<void> {
  await appendMessageRow(sql, {
    organizationId: args.organizationId,
    threadId: args.threadId,
    role: 'assistant',
    parts: [],
    ...(args.model !== undefined ? { model: args.model } : {}),
    error: args.error,
  });
}
