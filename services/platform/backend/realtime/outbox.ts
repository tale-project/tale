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
