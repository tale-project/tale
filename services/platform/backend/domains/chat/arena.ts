import type { Sql, TransactionSql } from 'postgres';

import {
  arenaFeedbackMessageId,
  ratingForVerdict,
  type ArenaVerdict,
} from '../../../lib/shared/arena.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { toJson } from '../../db/sql.ts';
import { loadOwnedThread } from './threads.ts';

/**
 * Arena Mode on pg — the 0.4 `chat/arena.ts` twins. The pair is two ordinary
 * thread rows: column A is the conversation the user was in, column B a
 * hidden copy of its history; both carry the `arena` marker on
 * `thread_metadata` while the pair is live. Settling CHOOSES the surviving
 * thread — no message row ever moves — and a verdict records itself as a
 * fresh `message_feedback` row in the analytics contract shape (synthetic
 * `arena:` message id + `metadata.{arenaVerdict, modelA, modelB}`).
 *
 * B ties into A's lineage (`branch_root_id`) for the trash cascade but never
 * `branch_parent_id`, so the branch navigator never surfaces the hidden
 * column as an edit sibling.
 */

/** Bound on the history copied into column B — enough conversation for a
 * fair comparison without an unbounded copy of a huge thread. */
const ARENA_COPY_MAX_MESSAGES = 200;
const ARENA_COPY_MAX_CHARS = 480_000;

interface ArenaState {
  pairId: string;
  role: 'a' | 'b';
  partnerThreadId: string;
  createdAt: number;
}

function readArena(value: unknown): ArenaState | null {
  if (!isRecord(value)) return null;
  const { pairId, role, partnerThreadId, createdAt } = value;
  if (
    typeof pairId !== 'string' ||
    (role !== 'a' && role !== 'b') ||
    typeof partnerThreadId !== 'string' ||
    typeof createdAt !== 'number'
  ) {
    return null;
  }
  return { pairId, role, partnerThreadId, createdAt };
}

async function arenaStateOf(
  sql: Sql | TransactionSql,
  organizationId: string,
  threadId: string,
): Promise<ArenaState | null> {
  const rows = await sql<{ arena: unknown }[]>`
    SELECT arena FROM app.thread_metadata
    WHERE thread_id = ${threadId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  return readArena(rows[0]?.arena);
}

/** The at-most-one-turn gate — a generation row exists exactly while a turn
 * is in flight (the same fact the send route reads). */
export async function hasLiveGeneration(
  sql: Sql | TransactionSql,
  organizationId: string,
  threadId: string,
): Promise<boolean> {
  const rows = await sql<{ one: number }[]>`
    SELECT 1 AS one FROM app.generations
    WHERE org_id = ${organizationId} AND thread_id = ${threadId}
    LIMIT 1
  `;
  return rows.length > 0;
}

/** The newest assistant reply's model in a thread, for verdict attribution. */
async function newestAssistantModel(
  sql: Sql | TransactionSql,
  threadId: string,
): Promise<string | null> {
  const rows = await sql<{ model: string }[]>`
    SELECT model FROM app.messages
    WHERE thread_id = ${threadId} AND role = 'assistant' AND model IS NOT NULL
    ORDER BY "order" DESC, step_order DESC
    LIMIT 1
  `;
  return rows[0]?.model ?? null;
}

function mintPairId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export type EnsureArenaResult =
  | { threadIdB: string }
  | { refused: 'not_found' | 'sandbox' | 'shared' | 'archived' | 'busy' };

/**
 * Create (or return) the pair for a conversation — idempotent, with the 0.4
 * structural refusals (sandbox threads, shared conversations, archived,
 * mid-generation). Column B copies A's bounded history so the comparison
 * starts from shared context; the title is copied so title generation never
 * fires on the hidden side.
 */
export async function ensureArenaPair(
  sql: Sql,
  args: { organizationId: string; userId: string; threadId: string },
): Promise<EnsureArenaResult> {
  const thread = await loadOwnedThread(
    sql,
    args.organizationId,
    args.userId,
    args.threadId,
  );
  if (thread === null) return { refused: 'not_found' };

  const arena = await arenaStateOf(sql, args.organizationId, thread.id);
  if (arena !== null) {
    const partnerArena = await arenaStateOf(
      sql,
      args.organizationId,
      arena.partnerThreadId,
    );
    if (partnerArena?.pairId === arena.pairId) {
      return {
        threadIdB: arena.role === 'a' ? arena.partnerThreadId : thread.id,
      };
    }
    // Half-open pair (partner purged): heal by clearing and re-pairing.
    await sql`
      UPDATE app.thread_metadata SET arena = NULL
      WHERE thread_id = ${thread.id} AND org_id = ${args.organizationId}
    `;
  }

  if (thread.kind === 'sandbox') return { refused: 'sandbox' };
  if (thread.isShared === true || thread.sharedWithProject === true) {
    return { refused: 'shared' };
  }
  if (thread.archived) return { refused: 'archived' };
  if (await hasLiveGeneration(sql, args.organizationId, thread.id)) {
    return { refused: 'busy' };
  }

  const now = Date.now();
  const pairId = mintPairId();
  const threadIdB = await sql.begin(async (tx) => {
    // B ties into A's lineage for the trash cascade but deliberately owns no
    // project/share/voice state — the pair reads as ONE conversation and
    // every outward-facing property stays on A.
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.threads (org_id, user_id, title, kind, created_at_ms,
                               updated_at_ms)
      VALUES (${args.organizationId}, ${args.userId}, ${thread.title},
              ${thread.kind}, ${now}, ${now})
      RETURNING id
    `;
    const idB = inserted[0]?.id;
    if (idB === undefined) throw new Error('arena thread insert failed');
    await tx`
      INSERT INTO app.thread_metadata (
        thread_id, org_id, user_id, chat_type, status, agent_slug,
        capabilities, hidden, branch_root_id, archived, created_at_ms
      ) VALUES (
        ${idB}, ${args.organizationId}, ${args.userId}, ${thread.kind},
        'active', ${thread.agentSlug},
        ${thread.capabilities === null ? null : tx.json(toJson(thread.capabilities))},
        true, ${thread.branchRootId ?? thread.id}, false, ${now}
      )
    `;

    // Copy the history newest-first up to the bound, then insert
    // oldest-first with orders re-based at 0. The model-facing notice row
    // (English on purpose) tells column B's model what it is missing.
    const recent = await tx<
      {
        role: string;
        parts: unknown;
        text: string | null;
        model: string | null;
        providerSlug: string | null;
        usage: unknown;
        blockedReason: string | null;
        error: string | null;
        order: number;
      }[]
    >`
      SELECT role, parts, text, model, provider_slug AS "providerSlug",
             usage, blocked_reason AS "blockedReason", error, "order"
      FROM app.messages
      WHERE thread_id = ${thread.id}
      ORDER BY "order" DESC, step_order DESC
      LIMIT ${ARENA_COPY_MAX_MESSAGES}
    `;
    let recentChars = 0;
    let keep = recent.length;
    for (let i = 0; i < recent.length; i++) {
      recentChars += JSON.stringify(recent[i]?.parts ?? null).length;
      if (recentChars >= ARENA_COPY_MAX_CHARS) {
        keep = i + 1;
        break;
      }
    }
    const history = recent.slice(0, keep).toReversed();
    const omitted = history[0]?.order ?? 0;
    let sequence = 0;
    if (omitted > 0) {
      await tx`
        INSERT INTO app.messages (
          thread_id, org_id, "order", step_order, role, parts, status,
          created_at_ms
        ) VALUES (
          ${idB}, ${args.organizationId}, 0, 0, 'system',
          ${tx.json(toJson([{ type: 'text', text: `[${omitted} earlier message${omitted === 1 ? '' : 's'} were not copied into this comparison.]` }]))},
          'complete', ${now}
        )
      `;
      sequence = 1;
    }
    for (const message of history) {
      await tx`
        INSERT INTO app.messages (
          thread_id, org_id, "order", step_order, role, parts, text, model,
          provider_slug, usage, blocked_reason, error, status, created_at_ms
        ) VALUES (
          ${idB}, ${args.organizationId}, ${sequence}, 0, ${message.role},
          ${message.parts === null ? null : tx.json(toJson(message.parts))},
          ${message.text}, ${message.model}, ${message.providerSlug},
          ${message.usage === null ? null : tx.json(toJson(message.usage))},
          ${message.blockedReason}, ${message.error}, 'complete', ${now}
        )
      `;
      sequence += 1;
    }

    const stampPair = async (
      threadId: string,
      role: 'a' | 'b',
      partnerThreadId: string,
    ): Promise<void> => {
      await tx`
        UPDATE app.thread_metadata
        SET arena = ${tx.json(toJson({ pairId, role, partnerThreadId, createdAt: now }))}
        WHERE thread_id = ${threadId} AND org_id = ${args.organizationId}
      `;
    };
    await stampPair(thread.id, 'a', idB);
    await stampPair(idB, 'b', thread.id);
    return idB;
  });

  return { threadIdB };
}

export interface ArenaPairView {
  pairId: string;
  threadIdA: string;
  threadIdB: string;
  createdAt: number;
}

/** The live pair as seen from either column — null when the thread is not
 * in a pair or the pair is half-open (ABSENCE IS THE SIGNAL: a settled pair
 * collapses the split view on every subscribed tab). */
export async function getArenaPair(
  sql: Sql,
  args: { organizationId: string; userId: string; threadId: string },
): Promise<ArenaPairView | null> {
  const thread = await loadOwnedThread(
    sql,
    args.organizationId,
    args.userId,
    args.threadId,
  );
  if (thread === null) return null;
  const arena = await arenaStateOf(sql, args.organizationId, thread.id);
  if (arena === null) return null;

  const partnerRows = await sql<{ arena: unknown; status: string }[]>`
    SELECT arena, status FROM app.thread_metadata
    WHERE thread_id = ${arena.partnerThreadId}
      AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  const partner = partnerRows[0];
  const partnerArena = readArena(partner?.arena);
  if (
    partner === undefined ||
    partner.status !== 'active' ||
    partnerArena?.pairId !== arena.pairId
  ) {
    return null;
  }

  return arena.role === 'a'
    ? {
        pairId: arena.pairId,
        threadIdA: thread.id,
        threadIdB: arena.partnerThreadId,
        createdAt: arena.createdAt,
      }
    : {
        pairId: arena.pairId,
        threadIdA: arena.partnerThreadId,
        threadIdB: thread.id,
        createdAt: arena.createdAt,
      };
}

export type SettleArenaResult =
  | { continueThreadId: string }
  | { refused: 'not_found' | 'busy' };

/**
 * Settle the pair. The verdict picks the surviving thread (`b_better` → B,
 * everything else → A; no verdict = plain exit → A). The loser goes
 * hidden + archived with its marker cleared; a winning B graduates to a
 * standalone visible conversation. A verdict also records itself as a fresh
 * `message_feedback` row in the SAME transaction.
 */
export async function settleArenaPair(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    threadId: string;
    verdict?: ArenaVerdict;
  },
): Promise<SettleArenaResult> {
  const thread = await loadOwnedThread(
    sql,
    args.organizationId,
    args.userId,
    args.threadId,
  );
  if (thread === null) return { refused: 'not_found' };
  const arena = await arenaStateOf(sql, args.organizationId, thread.id);
  if (arena === null) return { refused: 'not_found' };

  const partnerArena = await arenaStateOf(
    sql,
    args.organizationId,
    arena.partnerThreadId,
  );
  if (partnerArena?.pairId !== arena.pairId) {
    // Half-open pair: clear the marker so the surface recovers.
    await sql`
      UPDATE app.thread_metadata SET arena = NULL
      WHERE thread_id = ${thread.id} AND org_id = ${args.organizationId}
    `;
    return { refused: 'not_found' };
  }

  const idA = arena.role === 'a' ? thread.id : arena.partnerThreadId;
  const idB = arena.role === 'a' ? arena.partnerThreadId : thread.id;

  // A verdict about answers mid-flight would rate an unfinished reply.
  if (
    (await hasLiveGeneration(sql, args.organizationId, idA)) ||
    (await hasLiveGeneration(sql, args.organizationId, idB))
  ) {
    return { refused: 'busy' };
  }

  const winnerId = args.verdict === 'b_better' ? idB : idA;
  const loserId = winnerId === idA ? idB : idA;

  await sql.begin(async (tx) => {
    await tx`
      UPDATE app.thread_metadata
      SET arena = NULL, hidden = true, archived = true
      WHERE thread_id = ${loserId} AND org_id = ${args.organizationId}
    `;
    if (winnerId === idB) {
      // B graduates to a standalone visible conversation. The losing A stays
      // a hidden root until retention reaps it.
      await tx`
        UPDATE app.thread_metadata
        SET arena = NULL, hidden = NULL, branch_root_id = NULL
        WHERE thread_id = ${idB} AND org_id = ${args.organizationId}
      `;
    } else {
      await tx`
        UPDATE app.thread_metadata SET arena = NULL
        WHERE thread_id = ${idA} AND org_id = ${args.organizationId}
      `;
    }

    if (args.verdict !== undefined) {
      const modelA = await newestAssistantModel(tx, idA);
      const modelB = await newestAssistantModel(tx, idB);
      // Attribution needs both sides to have answered; an aborted pair
      // settles without a data point.
      if (modelA !== null && modelB !== null) {
        await tx`
          INSERT INTO app.message_feedback (
            org_id, thread_id, message_id, user_id, rating, metadata,
            created_at_ms
          ) VALUES (
            ${args.organizationId}, ${idA},
            ${arenaFeedbackMessageId(modelA, modelB)}, ${args.userId},
            ${ratingForVerdict(args.verdict)},
            ${tx.json(toJson({ arenaVerdict: args.verdict, modelA, modelB }))},
            ${Date.now()}
          )
        `;
      }
    }
  });

  return { continueThreadId: winnerId };
}
