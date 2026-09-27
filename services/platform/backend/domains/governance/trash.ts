import type { Sql, TransactionSql } from 'postgres';

import {
  TRASH_LISTED_RESOURCE_TYPES,
  type TrashListedResourceType,
} from '../../core/governance/soft_delete.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { restoreContact } from '../contacts/service.ts';

/**
 * The admin Trash surface (the 0.4 `listTrashedRows`/`restoreSoftDeletedRow`
 * pair): soft-deleted rows across the lifecycle-bearing tables, newest
 * status-change first, walked type by type with a composite keyset cursor;
 * restore flips one row back to live (documents et al → lifecycle NULL,
 * chat threads → status 'active', their hidden lineage with them).
 *
 * Only `TRASH_LISTED_RESOURCE_TYPES` have a source here; a type without a
 * pg trash stop (automation runs since migration 0083, workflow
 * executions, the usage ledger) is deleted outright and is neither listed
 * nor offered as a filter.
 */

export class TrashError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404;

  constructor(code: string, message: string, status: 400 | 403 | 404 = 400) {
    super(message);
    this.name = 'TrashError';
    this.code = code;
    this.status = status;
  }
}

interface TrashSource {
  /** app-schema table. */
  table: string;
  idColumn: string;
  statusColumn: string;
  /** SQL expression for the display name (aliased over `t`). */
  displayExpr: string;
  /** SQL expression for the owner user id (aliased over `t`). */
  ownerExpr: string;
  createdColumn: string;
  /** Extra listing predicate (aliased over `t`) — rows the surface must not
   * show as records of their own. */
  listPredicate?: string;
  /** Live value written back on restore. */
  restoreValue: string | null;
  /** Outbox entity a restore invalidates. */
  hintEntity: string;
}

const TRASH_SOURCES: Record<TrashListedResourceType, TrashSource> = {
  document: {
    table: 'documents',
    idColumn: 'id',
    statusColumn: 'lifecycle_status',
    displayExpr: 't.title',
    ownerExpr: 't.created_by',
    createdColumn: 'created_at_ms',
    restoreValue: null,
    hintEntity: 'document',
  },
  fileMetadata: {
    table: 'file_metadata',
    idColumn: 'id',
    statusColumn: 'lifecycle_status',
    displayExpr: 't.file_name',
    ownerExpr: 't.uploaded_by',
    createdColumn: 'created_at_ms',
    restoreValue: null,
    hintEntity: 'document',
  },
  contact: {
    table: 'contacts',
    idColumn: 'id',
    statusColumn: 'lifecycle_status',
    displayExpr: 't.name',
    ownerExpr: 'NULL',
    createdColumn: 'created_at_ms',
    restoreValue: null,
    hintEntity: 'contact',
  },
  externalConversation: {
    table: 'conversations',
    idColumn: 'id',
    statusColumn: 'lifecycle_status',
    displayExpr: 't.subject',
    ownerExpr: 'NULL',
    createdColumn: 'created_at_ms',
    restoreValue: null,
    hintEntity: 'conversation',
  },
  messageFeedback: {
    table: 'message_feedback',
    idColumn: 'id',
    statusColumn: 'lifecycle_status',
    displayExpr: 'NULL',
    ownerExpr: 't.user_id',
    createdColumn: 'created_at_ms',
    restoreValue: null,
    hintEntity: 'message_feedback',
  },
  chatThread: {
    table: 'thread_metadata',
    idColumn: 'thread_id',
    statusColumn: 'status',
    // The title lives on `app.threads`; `thread_metadata.title` exists but
    // nothing writes it, so the page used to fall back to the thread id
    // (2026-09-26 evaluation, E-20/G-15).
    displayExpr:
      '(SELECT th.title FROM app.threads th WHERE th.id = t.thread_id)',
    ownerExpr: 't.user_id',
    createdColumn: 'status_changed_at_ms',
    // A hidden row is a branch sibling (an edit tail, an arena column) that
    // travels with its root: it is restored with the root, never listed as
    // a record of its own.
    listPredicate: 't.hidden IS NOT true',
    restoreValue: 'active',
    hintEntity: 'chat_thread',
  },
};

const TYPE_ORDER: readonly string[] = [...TRASH_LISTED_RESOURCE_TYPES].sort();

function isListedType(type: string): type is TrashListedResourceType {
  return TYPE_ORDER.includes(type);
}

export interface TrashRow {
  resourceType: string;
  id: string;
  status: 'trashed' | 'expired';
  statusChangedAt: number | null;
  createdAt: number;
  displayName: string | null;
  ownerId: string | null;
  ownerName: string | null;
}

export interface TrashCursor {
  resourceType: string;
  statusChangedAt: number;
  id: string;
}

interface TrashSourceRow {
  id: string;
  status: string;
  statusChangedAt: number | null;
  createdAt: number;
  displayName: string | null;
  ownerId: string | null;
}

async function pageForType(
  sql: Sql,
  organizationId: string,
  resourceType: string,
  after: { statusChangedAt: number; id: string } | null,
  limit: number,
): Promise<TrashRow[]> {
  if (!isListedType(resourceType)) return [];
  const source = TRASH_SOURCES[resourceType];
  const rows = await sql<TrashSourceRow[]>`
    SELECT t.${sql.unsafe(source.idColumn)} AS id,
           t.${sql.unsafe(source.statusColumn)} AS status,
           t.status_changed_at_ms::float8 AS "statusChangedAt",
           t.${sql.unsafe(source.createdColumn)}::float8 AS "createdAt",
           ${sql.unsafe(source.displayExpr)} AS "displayName",
           ${sql.unsafe(source.ownerExpr)} AS "ownerId"
    FROM app.${sql.unsafe(source.table)} t
    WHERE t.org_id = ${organizationId}
      AND t.${sql.unsafe(source.statusColumn)} IN ('trashed', 'expired')
      AND ${sql.unsafe(source.listPredicate ?? 'true')}
      AND (${after === null}
        OR (coalesce(t.status_changed_at_ms, 0), t.${sql.unsafe(source.idColumn)})
          < (${after?.statusChangedAt ?? 0}, ${after?.id ?? ''}))
    ORDER BY coalesce(t.status_changed_at_ms, 0) DESC,
             t.${sql.unsafe(source.idColumn)} DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    resourceType,
    id: row.id,
    status: row.status === 'expired' ? 'expired' : 'trashed',
    statusChangedAt: row.statusChangedAt,
    createdAt: row.createdAt,
    displayName: row.displayName,
    ownerId: row.ownerId,
    ownerName: null,
  }));
}

/** Newest-first per type, types in stable order, composite keyset cursor. */
export async function listTrashedRows(
  sql: Sql,
  organizationId: string,
  args: {
    resourceTypes?: string[];
    cursor?: TrashCursor | null;
    limit?: number;
  } = {},
): Promise<{ rows: TrashRow[]; nextCursor: TrashCursor | null }> {
  const limit = Math.min(Math.max(1, args.limit ?? 50), 200);
  const types = (
    args.resourceTypes && args.resourceTypes.length > 0
      ? args.resourceTypes.filter((type) => TYPE_ORDER.includes(type))
      : TYPE_ORDER
  ).toSorted();
  const cursor = args.cursor ?? null;
  const rows: TrashRow[] = [];
  for (const type of types) {
    if (rows.length >= limit + 1) break;
    if (cursor !== null && type < cursor.resourceType) continue;
    const after =
      cursor !== null && cursor.resourceType === type
        ? { statusChangedAt: cursor.statusChangedAt, id: cursor.id }
        : null;
    rows.push(
      ...(await pageForType(
        sql,
        organizationId,
        type,
        after,
        limit + 1 - rows.length,
      )),
    );
  }
  // Owner display names in one read.
  const ownerIds = [
    ...new Set(
      rows
        .map((row) => row.ownerId)
        .filter((id): id is string => id !== null && id !== ''),
    ),
  ];
  if (ownerIds.length > 0) {
    const users = await sql<{ id: string; name: string | null }[]>`
      SELECT "id", "name" FROM "user" WHERE "id" = ANY(${ownerIds})
    `;
    const byId = new Map(users.map((user) => [user.id, user.name] as const));
    for (const row of rows) {
      if (row.ownerId !== null) row.ownerName = byId.get(row.ownerId) ?? null;
    }
  }
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor:
      rows.length > limit && last !== undefined
        ? {
            resourceType: last.resourceType,
            statusChangedAt: last.statusChangedAt ?? 0,
            id: last.id,
          }
        : null,
  };
}

/** Restore one soft-deleted row to live; audited, hint-emitting. */
export async function restoreSoftDeletedRow(
  tx: TransactionSql,
  auth: { organizationId: string; userId: string; email?: string },
  args: { resourceType: string; id: string },
): Promise<void> {
  if (!isListedType(args.resourceType)) {
    throw new TrashError(
      'RESOURCE_TYPE_UNSUPPORTED',
      `No restore lane for ${args.resourceType}`,
    );
  }
  const source = TRASH_SOURCES[args.resourceType];
  // A contact restores through the directory's own door, which re-runs the
  // create's uniqueness rule: the generic row flip used to mint a live twin
  // of a contact whose email or external id another contact had since taken
  // (2026-09-14 evaluation, h6). Its refusals (`ContactError`) surface as
  // the door's own.
  if (args.resourceType === 'contact') {
    const outcome = await restoreContact(
      tx,
      {
        organizationId: auth.organizationId,
        userId: auth.userId,
        ...(auth.email !== undefined ? { email: auth.email } : {}),
        role: 'admin',
      },
      args.id,
    );
    if (outcome === 'live') {
      throw new TrashError('ROW_NOT_FOUND', 'Nothing to restore', 404);
    }
    return;
  }
  const restored = await tx<{ id: string }[]>`
    UPDATE app.${tx.unsafe(source.table)} SET
      ${tx.unsafe(source.statusColumn)} = ${source.restoreValue},
      status_changed_at_ms = ${Date.now()}
    WHERE org_id = ${auth.organizationId}
      AND ${tx.unsafe(source.idColumn)} = ${args.id}
      AND ${tx.unsafe(source.statusColumn)} IN ('trashed', 'expired')
    RETURNING ${tx.unsafe(source.idColumn)} AS id
  `;
  if (!restored[0]) {
    throw new TrashError('ROW_NOT_FOUND', 'Nothing to restore', 404);
  }
  // A chat's lineage travels together, as the owner's own delete and
  // restore move it: the hidden siblings (edit tails) trashed with the root
  // come back with it, so the branch navigator has its versions again.
  if (args.resourceType === 'chatThread') {
    await tx`
      UPDATE app.thread_metadata SET
        status = 'active', status_changed_at_ms = ${Date.now()}
      WHERE org_id = ${auth.organizationId}
        AND branch_root_id = ${args.id}
        AND status IN ('trashed', 'expired')
    `;
  }
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
    actorType: 'user',
    action: `${args.resourceType}.restored_from_trash`,
    category: 'data',
    resourceType: args.resourceType,
    resourceId: args.id,
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: args.resourceType === 'chatThread' ? 'chat_thread' : 'document',
    entityId: args.id,
  });
}
