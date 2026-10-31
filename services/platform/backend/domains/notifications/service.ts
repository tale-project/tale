import type { Sql, TransactionSql } from 'postgres';

import { NOTIFICATION_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import { isAdminRole } from '../../auth/membership.ts';
import type { OrgNotificationLink } from '../../core/notifications/org_notification_link.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';

/**
 * Notifications — org-audience rows (the admin/security bell), ported to the
 * 0.4 contract: one row per org event; `security` category is visible to
 * admins only. Per-user read state is a watermark per category in
 * `app.notification_read_watermarks` (Read all moves it, 0228) plus the
 * notifications above it read one by one in `app.notification_reads` (0.4's
 * `readBy` array, normalized). Every write runs inside the caller's
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
function canSeeNotification(
  role: string | null | undefined,
  category: NotificationCategory,
): boolean {
  return category !== 'security' || isAdminRole(role ?? '');
}

/** The categories a role sees in the bell, and so the ones it can mark. */
function visibleCategories(
  role: string | null | undefined,
): NotificationCategory[] {
  return NOTIFICATION_CATEGORIES.filter((category) =>
    canSeeNotification(role, category),
  );
}

/**
 * How long Read all leaves to a notification written before it whose
 * transaction has not committed yet. A writer stamps `created_at_ms` before
 * it commits, so a notification stamped 12:00:00.100 can commit after one
 * stamped 12:00:00.200: a watermark at the newest committed notification
 * would cover the first one, which the person never saw. Read all therefore
 * moves the watermark only to the newest notification older than this
 * window and marks the visible ones after it one by one. A writer that holds
 * its transaction open longer than this after stamping can still be covered.
 */
export const READ_ALL_SETTLE_MS = 5 * 60_000;

/**
 * A person's watermark in one category: the newest notification of that
 * category they have read up to, in the bell's order.
 */
export interface ReadWatermark {
  category: NotificationCategory;
  ms: number;
  id: string;
}

/**
 * Where the unread count's scan of the organization's notifications may
 * start: the oldest watermark of the categories the person can see. Nothing
 * before it can be unread. While one of those categories has no watermark
 * yet, everything of it is unread and the scan starts at the beginning (0).
 */
export function unreadScanFloor(
  watermarks: readonly ReadWatermark[],
  categories: readonly NotificationCategory[],
): number {
  let floor: number | null = null;
  for (const category of categories) {
    const watermark = watermarks.find((mark) => mark.category === category);
    if (watermark === undefined) return 0;
    floor = floor === null ? watermark.ms : Math.min(floor, watermark.ms);
  }
  return floor ?? 0;
}

async function readWatermarks(
  sql: Sql,
  scope: NotificationScope,
): Promise<ReadWatermark[]> {
  return sql<ReadWatermark[]>`
    SELECT category, read_up_to_ms::float8 AS ms, read_up_to_id AS id
    FROM app.notification_read_watermarks
    WHERE org_id = ${scope.orgId} AND user_id = ${scope.userId}
  `;
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
  link?: OrgNotificationLink;
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
  read: boolean;
}

export interface NotificationScope {
  orgId: string;
  userId: string;
  /** The caller's org role — drives `security` visibility. */
  role: string;
}

/**
 * Newest-first keyset page of the org's notifications visible to the
 * caller's role, each decorated with the caller's `read` flag: read one by
 * one, or at or under the caller's watermark for its category.
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
           (r.notification_id IS NOT NULL
             OR (m.read_up_to_ms IS NOT NULL
               AND (n.created_at_ms, n.id) <= (m.read_up_to_ms, m.read_up_to_id)))
             AS "read"
    FROM app.notifications n
    LEFT JOIN app.notification_reads r
      ON r.notification_id = n.id AND r.user_id = ${scope.userId}
    LEFT JOIN app.notification_read_watermarks m
      ON m.org_id = n.org_id AND m.user_id = ${scope.userId}
     AND m.category = n.category
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
    read: row.read,
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

/**
 * Count of visible notifications the caller has not dismissed: those after
 * the caller's watermark for their category, less the ones read one by one.
 * The scan starts at the oldest of those watermarks, so it reads what came
 * after the caller's last Read all, not the organization's whole history.
 */
export async function unreadCount(
  sql: Sql,
  scope: NotificationScope,
): Promise<number> {
  const seesSecurity = canSeeNotification(scope.role, 'security');
  const floor = unreadScanFloor(
    await readWatermarks(sql, scope),
    visibleCategories(scope.role),
  );
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM app.notifications n
    LEFT JOIN app.notification_read_watermarks m
      ON m.org_id = n.org_id AND m.user_id = ${scope.userId}
     AND m.category = n.category
    WHERE n.org_id = ${scope.orgId}
      AND n.created_at_ms >= ${floor}
      AND (${seesSecurity} OR n.category <> 'security')
      AND (m.read_up_to_ms IS NULL
        OR (n.created_at_ms, n.id) > (m.read_up_to_ms, m.read_up_to_id))
      AND NOT EXISTS (
        SELECT 1 FROM app.notification_reads r
        WHERE r.notification_id = n.id AND r.user_id = ${scope.userId}
      )
  `;
  return Number(rows[0]?.count ?? '0');
}

/**
 * Dismiss one notification for the caller; no-op when already read (one by
 * one or under the watermark) and for a notification the caller's role
 * cannot see.
 */
export async function markRead(
  tx: TransactionSql,
  scope: NotificationScope,
  notificationId: string,
): Promise<void> {
  const seesSecurity = canSeeNotification(scope.role, 'security');
  const inserted = await tx`
    INSERT INTO app.notification_reads (notification_id, user_id)
    SELECT n.id, ${scope.userId} FROM app.notifications n
    WHERE n.id = ${notificationId} AND n.org_id = ${scope.orgId}
      AND (${seesSecurity} OR n.category <> 'security')
      AND NOT EXISTS (
        SELECT 1 FROM app.notification_read_watermarks m
        WHERE m.org_id = n.org_id AND m.user_id = ${scope.userId}
          AND m.category = n.category
          AND (n.created_at_ms, n.id) <= (m.read_up_to_ms, m.read_up_to_id)
      )
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

/**
 * Dismiss every notification currently visible to the caller. The
 * watermark of each category the caller can see moves to the newest visible
 * notification older than {@link READ_ALL_SETTLE_MS}, the visible ones after
 * it are marked one by one, and the caller's read rows the watermark now
 * covers are dropped. Its cost is the window's notifications and the
 * caller's own read rows, not the organization's history.
 */
export async function markAllRead(
  tx: TransactionSql,
  scope: NotificationScope,
  now: number = Date.now(),
): Promise<void> {
  const seesSecurity = canSeeNotification(scope.role, 'security');
  const categories = visibleCategories(scope.role);
  const windowStart = now - READ_ALL_SETTLE_MS;
  const [settled] = await tx<{ ms: number; id: string }[]>`
    SELECT n.created_at_ms::float8 AS ms, n.id
    FROM app.notifications n
    WHERE n.org_id = ${scope.orgId}
      AND (${seesSecurity} OR n.category <> 'security')
      AND n.created_at_ms < ${windowStart}
    ORDER BY n.created_at_ms DESC, n.id DESC
    LIMIT 1
  `;
  let changed = 0;
  if (settled !== undefined) {
    // Forward only: a watermark already past this one stays where it is.
    const moved = await tx`
      INSERT INTO app.notification_read_watermarks AS m (
        org_id, user_id, category, read_up_to_ms, read_up_to_id, updated_at_ms
      )
      SELECT ${scope.orgId}, ${scope.userId}, category,
             ${settled.ms}::bigint, ${settled.id}, ${now}::bigint
      FROM unnest(${categories}::text[]) AS category
      ON CONFLICT (org_id, user_id, category) DO UPDATE
        SET read_up_to_ms = excluded.read_up_to_ms,
            read_up_to_id = excluded.read_up_to_id,
            updated_at_ms = excluded.updated_at_ms
        WHERE (excluded.read_up_to_ms, excluded.read_up_to_id)
          > (m.read_up_to_ms, m.read_up_to_id)
    `;
    changed += moved.count;
    // Rows the watermarks cover now are redundant: only the caller's own,
    // in the categories the caller can see, each of whose watermarks now
    // sits at or past this one, moved or already ahead.
    await tx`
      DELETE FROM app.notification_reads r
      USING app.notifications n
      WHERE r.user_id = ${scope.userId}
        AND n.id = r.notification_id
        AND n.org_id = ${scope.orgId}
        AND n.category = ANY(${categories}::text[])
        AND (n.created_at_ms, n.id) <= (${settled.ms}::bigint, ${settled.id})
    `;
  }
  // Everything newer than the settled one was stamped inside the window:
  // the committed ones are marked one by one, and one still in flight stays
  // unread.
  const inserted = await tx`
    INSERT INTO app.notification_reads (notification_id, user_id)
    SELECT n.id, ${scope.userId} FROM app.notifications n
    WHERE n.org_id = ${scope.orgId}
      AND (${seesSecurity} OR n.category <> 'security')
      AND n.created_at_ms >= ${windowStart}
    ON CONFLICT (notification_id, user_id) DO NOTHING
  `;
  changed += inserted.count;
  if (changed > 0) {
    await emitHintInTx(tx, {
      orgId: scope.orgId,
      userId: scope.userId,
      entity: NOTIFICATION_HINT_ENTITY,
      entityId: null,
    });
  }
}
