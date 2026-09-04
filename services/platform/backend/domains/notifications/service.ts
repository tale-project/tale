import type { Sql, TransactionSql } from 'postgres';

import { NOTIFICATION_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import { isAdminRole } from '../../auth/membership.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';

/**
 * Notifications — org-audience rows (the admin/security bell), ported to the
 * 0.4 contract: one row per org event; `security` category is visible to
 * admins only; per-user read state lives in `app.notification_reads`
 * (0.4's `readBy` array, normalized). Every write runs inside the caller's
 * serializable transaction and emits an org-wide hint in that transaction.
 *
 * Ledger note: the 0.4 external dispatch lane (Slack mirror of `security`
 * rows via `dispatchNotificationAction`) lands with the connectors domain.
 */

export const NOTIFICATION_CATEGORIES = ['security', 'system'] as const;
export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'critical'] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

/** `security` notifications are admin-only; everything else is org-wide. */
export function canSeeNotification(
  role: string | null | undefined,
  category: NotificationCategory,
): boolean {
  return category !== 'security' || isAdminRole(role ?? '');
}

export interface WriteNotificationArgs {
  organizationIds: string[];
  category: NotificationCategory;
  severity: NotificationSeverity;
  /** i18n key within the `notifications` namespace (no prefix stored). */
  titleKey: string;
  bodyKey: string;
  params?: Record<string, unknown>;
  subjectUserId?: string;
  link?: Record<string, unknown>;
  /**
   * Durable idempotency key, unique per org — derive from the triggering
   * entity, never mint per attempt; a duplicate delivery becomes a no-op.
   */
  dedupeKey?: string;
}

export async function writeNotificationForOrgs(
  tx: TransactionSql,
  args: WriteNotificationArgs,
): Promise<void> {
  const now = Date.now();
  for (const organizationId of args.organizationIds) {
    const inserted = await tx`
      INSERT INTO app.notifications (
        org_id, category, severity, title_key, body_key, params,
        subject_user_id, link, dedupe_key, created_at_ms
      ) VALUES (
        ${organizationId}, ${args.category}, ${args.severity},
        ${args.titleKey}, ${args.bodyKey},
        ${args.params === undefined ? null : tx.json(toJson(args.params))},
        ${args.subjectUserId ?? null},
        ${args.link === undefined ? null : tx.json(toJson(args.link))},
        ${args.dedupeKey ?? null}, ${now}
      )
      ON CONFLICT (org_id, dedupe_key) WHERE dedupe_key IS NOT NULL
      DO NOTHING
    `;
    if (inserted.count > 0) {
      await emitHintInTx(tx, {
        orgId: organizationId,
        entity: NOTIFICATION_HINT_ENTITY,
        entityId: null,
      });
    }
  }
}

export interface NotificationItem {
  id: string;
  organizationId: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  titleKey: string;
  bodyKey: string;
  params: Record<string, unknown> | null;
  link: Record<string, unknown> | null;
  createdAt: number;
  read: boolean;
}

interface NotificationRow {
  id: string;
  organizationId: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  titleKey: string;
  bodyKey: string;
  params: Record<string, unknown> | null;
  link: Record<string, unknown> | null;
  createdAt: number;
  readAt: string | null;
}

export interface NotificationScope {
  orgId: string;
  userId: string;
  /** The caller's org role — drives `security` visibility. */
  role: string;
}

/**
 * Newest-first keyset page of the org's notifications visible to the
 * caller's role, each decorated with the caller's `read` flag.
 */
export async function listNotifications(
  sql: Sql,
  scope: NotificationScope,
  options: {
    cursor?: { createdAt: number; id: string } | null;
    limit?: number;
  } = {},
): Promise<{
  items: NotificationItem[];
  nextCursor: { createdAt: number; id: string } | null;
}> {
  const limit = Math.min(options.limit ?? 50, 200);
  const cursor = options.cursor ?? null;
  const seesSecurity = canSeeNotification(scope.role, 'security');

  const rows = await sql<NotificationRow[]>`
    SELECT n.id, n.org_id AS "organizationId", n.category, n.severity,
           n.title_key AS "titleKey", n.body_key AS "bodyKey", n.params,
           n.link, n.created_at_ms::float8 AS "createdAt",
           r.read_at::text AS "readAt"
    FROM app.notifications n
    LEFT JOIN app.notification_reads r
      ON r.notification_id = n.id AND r.user_id = ${scope.userId}
    WHERE n.org_id = ${scope.orgId}
      AND (${seesSecurity} OR n.category <> 'security')
      AND (${cursor?.createdAt ?? null}::bigint IS NULL
        OR n.created_at_ms < ${cursor?.createdAt ?? null}
        OR (n.created_at_ms = ${cursor?.createdAt ?? null} AND n.id < ${cursor?.id ?? null}))
    ORDER BY n.created_at_ms DESC, n.id DESC
    LIMIT ${limit + 1}
  `;

  const page = rows.slice(0, limit).map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    category: row.category,
    severity: row.severity,
    titleKey: row.titleKey,
    bodyKey: row.bodyKey,
    params: row.params,
    link: row.link,
    createdAt: row.createdAt,
    read: row.readAt !== null,
  }));
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor:
      rows.length > limit && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
}

/** Count of visible notifications the caller has not dismissed. */
export async function unreadCount(
  sql: Sql,
  scope: NotificationScope,
): Promise<number> {
  const seesSecurity = canSeeNotification(scope.role, 'security');
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM app.notifications n
    WHERE n.org_id = ${scope.orgId}
      AND (${seesSecurity} OR n.category <> 'security')
      AND NOT EXISTS (
        SELECT 1 FROM app.notification_reads r
        WHERE r.notification_id = n.id AND r.user_id = ${scope.userId}
      )
  `;
  return Number(rows[0]?.count ?? '0');
}

/** Dismiss one notification for the caller; no-op when already read. */
export async function markRead(
  tx: TransactionSql,
  scope: NotificationScope,
  notificationId: string,
): Promise<void> {
  const inserted = await tx`
    INSERT INTO app.notification_reads (notification_id, user_id)
    SELECT n.id, ${scope.userId} FROM app.notifications n
    WHERE n.id = ${notificationId} AND n.org_id = ${scope.orgId}
    ON CONFLICT (notification_id, user_id) DO NOTHING
  `;
  if (inserted.count > 0) {
    await emitHintInTx(tx, {
      orgId: scope.orgId,
      userId: scope.userId,
      entity: NOTIFICATION_HINT_ENTITY,
      entityId: notificationId,
    });
  }
}

/** Dismiss every notification currently visible to the caller. */
export async function markAllRead(
  tx: TransactionSql,
  scope: NotificationScope,
): Promise<void> {
  const seesSecurity = canSeeNotification(scope.role, 'security');
  const inserted = await tx`
    INSERT INTO app.notification_reads (notification_id, user_id)
    SELECT n.id, ${scope.userId} FROM app.notifications n
    WHERE n.org_id = ${scope.orgId}
      AND (${seesSecurity} OR n.category <> 'security')
    ON CONFLICT (notification_id, user_id) DO NOTHING
  `;
  if (inserted.count > 0) {
    await emitHintInTx(tx, {
      orgId: scope.orgId,
      userId: scope.userId,
      entity: NOTIFICATION_HINT_ENTITY,
      entityId: null,
    });
  }
}
