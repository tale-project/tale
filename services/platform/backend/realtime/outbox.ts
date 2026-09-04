import type { Sql, TransactionSql } from 'postgres';

/**
 * Invalidation-hint outbox — the Tier-2 realtime bus.
 *
 * Writers emit entity-level hints INSIDE the transaction that changes the
 * entity; API pods poll the outbox and fan hints out over SSE; clients map
 * hints to TanStack Query invalidations and refetch through the normal
 * authenticated endpoints. Hints carry identity, never data — payloads stay
 * behind authorization. A hint is org-scoped by default; setting `userId`
 * narrows delivery to that user's connections (badges, per-user views).
 *
 * Deliberately NOT LISTEN/NOTIFY on the write path: a pending NOTIFY takes a
 * global commit lock under concurrent writers. Polling the outbox keeps
 * commits uncontended; delivery latency is bounded by the poll interval.
 *
 * Retention: a hint matters only until every stream has passed it — live
 * tails are a poll behind, a reconnecting browser replays from
 * `Last-Event-ID` within seconds. Delivered rows older than
 * `OUTBOX_RETENTION_MS` are reclaimed lazily by the tailing pods
 * (`reclaimOutbox`, ticked from the `/events` poll loop — no cron), always
 * as a strict id-prefix, so a resumed cursor either proves its replay
 * complete or is told to `resync` (`outboxRetainsCursor`).
 *
 * Schema lives in db/migrations/ (boot-applied).
 */

export interface Hint {
  orgId: string;
  /** NULL/omitted = org-wide; set = delivered only to that user's streams. */
  userId?: string | null;
  entity: string;
  entityId: string | null;
}

export interface OutboxRow {
  /** bigint as string; also the SSE event id (Last-Event-ID cursor). */
  id: string;
  orgId: string;
  entity: string;
  entityId: string | null;
}

/**
 * How long a delivered hint stays replayable. A live stream is never more
 * than one poll behind (300ms; a second on a DB blip; 500 rows a poll), and
 * a browser's EventSource reconnects within seconds — an hour is orders of
 * magnitude above any replay a connected client can need. A client whose
 * `Last-Event-ID` is older than this is told to `resync`, so the horizon is
 * a size knob, never a correctness one.
 */
export const OUTBOX_RETENTION_MS = 60 * 60 * 1000;
/** Rows one DELETE reclaims — bounded so a sweep never holds many locks. */
export const OUTBOX_RECLAIM_BATCH = 500;
/** DELETE rounds one sweep may run before it yields. */
export const OUTBOX_RECLAIM_MAX_BATCHES = 20;
/** How often a process with open streams sweeps. */
export const OUTBOX_RECLAIM_INTERVAL_MS = 60_000;
/** A sweep that spent its whole budget comes back sooner: a backlog drains. */
export const OUTBOX_RECLAIM_CATCH_UP_MS = 1_000;

/** Emit a hint inside the transaction that performs the change it describes. */
export async function emitHintInTx(
  tx: TransactionSql | Sql,
  hint: Hint,
): Promise<void> {
  await tx`
    INSERT INTO app_realtime.outbox (org_id, user_id, entity, entity_id)
    VALUES (${hint.orgId}, ${hint.userId ?? null}, ${hint.entity},
            ${hint.entityId})
  `;
}

/** Newest outbox id, or '0' when empty — the "start at tail" cursor. */
export async function latestOutboxId(sql: Sql): Promise<string> {
  const rows = await sql<{ max: string | null }[]>`
    SELECT max(id)::text AS max FROM app_realtime.outbox
  `;
  return rows[0]?.max ?? '0';
}

/**
 * Hints visible to one (org, user) strictly after the cursor, ascending by
 * id: org-wide hints plus the user's own targeted hints.
 */
export async function readHintsAfter(
  sql: Sql,
  cursor: string,
  options: { orgId: string; userId: string; limit?: number },
): Promise<OutboxRow[]> {
  const limit = options.limit ?? 500;
  const rows = await sql<
    { id: string; org_id: string; entity: string; entity_id: string | null }[]
  >`
    SELECT id::text AS id, org_id, entity, entity_id
    FROM app_realtime.outbox
    WHERE org_id = ${options.orgId}
      AND (user_id IS NULL OR user_id = ${options.userId})
      AND id > ${cursor}::bigint
    ORDER BY id ASC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    id: row.id,
    orgId: row.org_id,
    entity: row.entity,
    entityId: row.entity_id,
  }));
}

/**
 * Whether a resumed client's cursor row is still retained. Reclaim removes a
 * strict id-PREFIX (never a row while an older one stays), so a retained row
 * at or below the cursor proves every row above it is still here and the
 * replay is complete; none left means rows the client never saw may be gone
 * — the stream answers with `resync`.
 */
export async function outboxRetainsCursor(
  sql: Sql,
  cursor: string,
): Promise<boolean> {
  const rows = await sql<{ retained: boolean }[]>`
    SELECT exists(
      SELECT 1 FROM app_realtime.outbox WHERE id <= ${cursor}::bigint
    ) AS retained
  `;
  return rows[0]?.retained ?? false;
}

/**
 * The ids to reclaim out of the OLDEST rows (ascending id): the run of rows
 * older than the cutoff, stopped at the first row that is not. Reclaim must
 * take a strict prefix — an id is assigned at insert but `created_at` at
 * transaction start, so a long transaction can leave an older stamp ABOVE a
 * newer one; deleting it would punch a hole a resuming client's cursor
 * could not see past (`outboxRetainsCursor` reasons on the prefix).
 */
export function reclaimablePrefix(
  rows: readonly { id: string; createdAtMs: number }[],
  cutoffMs: number,
): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.createdAtMs >= cutoffMs) break;
    ids.push(row.id);
  }
  return ids;
}

/**
 * Reclaim delivered hints older than the retention horizon — bounded: at
 * most `maxBatches` rounds of `batch` rows, each round the oldest rows by
 * id, deleted by explicit id (never by range, so a row that commits late
 * with an old id is not swept out from under a reader). Returns how many
 * rows went. Steady state is one bounded index read and no DELETE.
 */
export async function reclaimOutbox(
  sql: Sql,
  options: { cutoffMs?: number; batch?: number; maxBatches?: number } = {},
): Promise<number> {
  const cutoffMs = options.cutoffMs ?? Date.now() - OUTBOX_RETENTION_MS;
  const batch = options.batch ?? OUTBOX_RECLAIM_BATCH;
  const maxBatches = options.maxBatches ?? OUTBOX_RECLAIM_MAX_BATCHES;
  let deleted = 0;
  for (let round = 0; round < maxBatches; round += 1) {
    const oldest = await sql<{ id: string; createdAtMs: number }[]>`
      SELECT id::text AS id,
             (extract(epoch FROM created_at) * 1000)::float8 AS "createdAtMs"
      FROM app_realtime.outbox
      ORDER BY id ASC
      LIMIT ${batch}
    `;
    const victims = reclaimablePrefix(oldest, cutoffMs);
    if (victims.length === 0) break;
    const result = await sql`
      DELETE FROM app_realtime.outbox WHERE id = ANY(${victims}::bigint[])
    `;
    deleted += result.count;
    // The prefix ended inside this batch: nothing older is left.
    if (victims.length < batch) break;
  }
  return deleted;
}

/**
 * The lazy sweep's throttle. A process with streams open ticks this from
 * every poll; it runs the reclaim at most once per interval (sooner while a
 * sweep keeps spending its whole budget, so a backlog after an idle spell
 * drains), never two at once, and never lets a failure out — a stream's own
 * poll must not care whether housekeeping succeeded.
 */
export function createOutboxReclaimer(deps: {
  reclaim: () => Promise<number>;
  intervalMs?: number;
  catchUpMs?: number;
  /** Rows per sweep that mean "still behind" — the sweep's full budget. */
  budget?: number;
  now?: () => number;
}): { tick: () => Promise<void> } {
  const intervalMs = deps.intervalMs ?? OUTBOX_RECLAIM_INTERVAL_MS;
  const catchUpMs = deps.catchUpMs ?? OUTBOX_RECLAIM_CATCH_UP_MS;
  const budget =
    deps.budget ?? OUTBOX_RECLAIM_BATCH * OUTBOX_RECLAIM_MAX_BATCHES;
  const now = deps.now ?? Date.now;
  let dueAt = 0;
  let inFlight = false;
  return {
    async tick(): Promise<void> {
      if (inFlight || now() < dueAt) return;
      inFlight = true;
      try {
        const deleted = await deps.reclaim();
        dueAt = now() + (deleted >= budget ? catchUpMs : intervalMs);
      } catch (error) {
        console.error('[backend] realtime outbox reclaim failed:', error);
        dueAt = now() + intervalMs;
      } finally {
        inFlight = false;
      }
    },
  };
}
