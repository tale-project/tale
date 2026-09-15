import type { Sql, TransactionSql } from 'postgres';

import { emitHintInTx } from '../../realtime/outbox.ts';
import {
  dismissCloudSyncFailureNotifications,
  notifyUser,
} from '../collab/service.ts';
import { findHubFolderByPath } from '../folders/paths.ts';

/**
 * Cloud-sync HEALTH — what a synced folder's owner and readers learn when a
 * sync stops working, and how the page learns that a run changed anything.
 *
 * The engine (`runSyncConfigJobWith`) stamps every run's outcome on the
 * config row; this module owns the three things that used to be missing
 * around that stamp (2026-09-15):
 *
 *  - the FAILURE EPISODE (`error_since_ms`, `failure_notified_at_ms`): a
 *    config that fails is told about ONCE per episode — at once when the
 *    owner's grant is dead (only a new consent fixes it), after the episode
 *    is an hour old for anything else (a vendor blip self-heals on the next
 *    tick, an OAuth-app misconfiguration does not) — and the bell row is
 *    marked read by the run that recovers;
 *  - the LISTING decoration: every hub folder and every directly-picked
 *    synced file carries its config's health, so a broken sync shows as
 *    broken instead of quietly dropping its "(synced)" label (the folder
 *    listing used to decorate `active` configs only);
 *  - the realtime hints: a run that created, refreshed or pruned mirrors
 *    tells the open Documents page, which otherwise sat on its five-minute
 *    cache until a reload.
 */

/** A failure this old with nobody told is worth the owner's attention. */
export const SYNC_FAILURE_NOTIFY_GRACE_MS = 60 * 60 * 1000;

/** The personal-notification type — one row per config per episode. */
export const CLOUD_SYNC_FAILED_NOTIFICATION_TYPE = 'cloud_sync_failed';

/** `last_sync_status` values a failed run stamps. */
export type SyncFailureKind = 'error' | 'needs-reauth';

export interface FailureEpisodeBefore {
  /** First failed run of the open episode, or null when healthy. */
  errorSince: number | null;
  /** When the owner was told about this episode, or null. */
  failureNotifiedAt: number | null;
  /** The previous run's stamp (`success`, `error`, `needs-reauth`, …). */
  lastSyncStatus: string | null;
}

export interface FailureDecision {
  /** The episode's first failure — kept across runs, opened by this one. */
  errorSince: number;
  lastSyncStatus: SyncFailureKind;
  /** Tell the owner now (a first notice, or an escalation to a dead grant). */
  notify: boolean;
}

/**
 * Pure: what a failed run stamps and whether it notifies. The episode opens
 * on the first failure and only a successful run closes it (a re-import
 * reactivating the row keeps it open — the sync is still not working).
 * Once told, the owner hears again only when the cause escalates from a
 * retryable error to a dead grant: that is news (the fix changed), and the
 * unread row is rewritten in place rather than stacked.
 */
export function decideFailureNotification(
  before: FailureEpisodeBefore,
  args: { now: number; needsReauth: boolean },
): FailureDecision {
  const errorSince = before.errorSince ?? args.now;
  const lastSyncStatus: SyncFailureKind = args.needsReauth
    ? 'needs-reauth'
    : 'error';
  const notify =
    before.failureNotifiedAt === null
      ? args.needsReauth ||
        args.now - errorSince >= SYNC_FAILURE_NOTIFY_GRACE_MS
      : args.needsReauth && before.lastSyncStatus !== 'needs-reauth';
  return { errorSince, lastSyncStatus, notify };
}

/** The bell/email body quotes the run's error; keep it a sentence, not a
 * stack. */
const REASON_MAX_CHARS = 200;

export function failureReason(errorMessage: string | null): string {
  const trimmed = (errorMessage ?? '').replace(/\s+/g, ' ').trim();
  if (trimmed === '') return 'unknown error';
  return trimmed.length > REASON_MAX_CHARS
    ? `${trimmed.slice(0, REASON_MAX_CHARS - 1)}…`
    : trimmed;
}

/**
 * The hub folder whose listing shows the synced item's row — the parent of
 * the sync root (a folder config) or of the mirror (a file config). The
 * root listing (no folder) answers null.
 */
export async function resolveSyncItemListingFolderId(
  sql: Sql,
  args: { organizationId: string; itemPath: string | null; itemName: string },
): Promise<string | null> {
  const segments = (args.itemPath || args.itemName)
    .split('/')
    .filter((segment) => segment.trim().length > 0);
  const parentSegments = segments.slice(0, -1);
  if (parentSegments.length === 0) return null;
  return findHubFolderByPath(sql, args.organizationId, parentSegments);
}

/**
 * Tell the config OWNER — the member whose grant the sync runs under, the
 * only person who can reconnect it — that the sync stopped working. The row
 * carries the listing folder so both the bell and the email open the page
 * with the broken row in view.
 */
export async function notifyOwnerOfSyncFailure(
  sql: Sql,
  args: {
    organizationId: string;
    ownerUserId: string;
    configId: string;
    /** Display name of the vendor ('OneDrive' / 'Google Drive'). */
    provider: string;
    itemName: string;
    needsReauth: boolean;
    errorMessage: string | null;
    hubFolderId: string | null;
  },
): Promise<void> {
  await notifyUser(sql, {
    userId: args.ownerUserId,
    organizationId: args.organizationId,
    type: CLOUD_SYNC_FAILED_NOTIFICATION_TYPE,
    titleKey: args.needsReauth ? 'cloudSyncNeedsReauth' : 'cloudSyncFailed',
    bodyKey: args.needsReauth
      ? 'cloudSyncNeedsReauthBody'
      : 'cloudSyncFailedBody',
    params: {
      provider: args.provider,
      itemName: args.itemName,
      reason: failureReason(args.errorMessage),
      syncConfigId: args.configId,
      ...(args.hubFolderId !== null ? { hubFolderId: args.hubFolderId } : {}),
    },
    resourceType: 'sync_config',
    resourceId: args.configId,
    actorType: 'system',
  });
}

/** The run that closes an episode stops the owner's bell ringing. */
export async function settleSyncRecovery(
  sql: Sql,
  args: { organizationId: string; ownerUserId: string; configId: string },
): Promise<void> {
  await dismissCloudSyncFailureNotifications(sql, {
    organizationId: args.organizationId,
    userId: args.ownerUserId,
    configId: args.configId,
  });
}

/**
 * Hints for the open Documents page: `document` when mirrors were created,
 * refreshed or pruned (the hub list refetches), `folder` when the folder
 * rows' decoration moved too — created/reaped sync folders, or a health
 * flip the badge must show. Org-wide, like every listing hint.
 */
export async function emitSyncRunHints(
  db: Sql | TransactionSql,
  args: {
    organizationId: string;
    contentChanged: boolean;
    healthChanged: boolean;
  },
): Promise<void> {
  if (args.contentChanged) {
    await emitHintInTx(db, {
      orgId: args.organizationId,
      entity: 'document',
      entityId: null,
    });
  }
  if (args.contentChanged || args.healthChanged) {
    await emitHintInTx(db, {
      orgId: args.organizationId,
      entity: 'folder',
      entityId: null,
    });
  }
}

// ------------------------------------------------------------ the listing

/** One synced item's health as the listings ship it (both providers). */
export interface SyncHealthView {
  configId: string;
  /** `app.documents.source_provider` value of the engine — what the Source
   * column labels the row with. */
  provider: 'onedrive' | 'google_drive';
  status: 'healthy' | 'failed';
  /** The owner's grant is dead: only reconnecting (or a re-import under
   * another account) resumes the sync. */
  needsReauth: boolean;
  /** Last run, successful or not. */
  lastSyncAt?: number;
  /** First failed run of the open episode. */
  errorSince?: number;
  errorMessage?: string;
  ownerUserId: string;
  ownerName?: string;
}

export interface SyncHealthIndex {
  /** Folder configs by their hub item path — the folder rows' decoration. */
  byPath: Map<string, SyncHealthView>;
  /** Every syncable config by id — the directly-picked file rows'. */
  byConfigId: Map<string, SyncHealthView>;
}

interface SyncHealthRow {
  id: string;
  itemPath: string | null;
  status: 'active' | 'error';
  lastSyncStatus: string | null;
  lastSyncAt: number | null;
  errorSince: number | null;
  errorMessage: string | null;
  ownerUserId: string;
  ownerName: string | null;
  ownerEmail: string | null;
}

const SYNC_HEALTH_TABLES: readonly {
  table: string;
  provider: SyncHealthView['provider'];
}[] = [
  { table: 'app.onedrive_sync_configs', provider: 'onedrive' },
  { table: 'app.google_drive_sync_configs', provider: 'google_drive' },
];

function toSyncHealthView(
  row: SyncHealthRow,
  provider: SyncHealthView['provider'],
): SyncHealthView {
  const ownerName = row.ownerName ?? row.ownerEmail ?? undefined;
  return {
    configId: row.id,
    provider,
    status: row.status === 'error' ? 'failed' : 'healthy',
    needsReauth: row.lastSyncStatus === 'needs-reauth',
    ...(row.lastSyncAt !== null ? { lastSyncAt: row.lastSyncAt } : {}),
    ...(row.errorSince !== null ? { errorSince: row.errorSince } : {}),
    ...(row.errorMessage !== null ? { errorMessage: row.errorMessage } : {}),
    ownerUserId: row.ownerUserId,
    ...(ownerName !== undefined ? { ownerName } : {}),
  };
}

/**
 * Every syncable config of the org (`active` OR `error` — an errored sync
 * is still a sync, and the one the listing must flag), keyed for both row
 * kinds. `inactive` (stopped, cancelled, source deleted) is not synced and
 * decorates nothing, as before.
 */
export async function loadSyncHealthIndex(
  sql: Sql,
  organizationId: string,
): Promise<SyncHealthIndex> {
  const byPath = new Map<string, SyncHealthView>();
  const byConfigId = new Map<string, SyncHealthView>();
  for (const { table, provider } of SYNC_HEALTH_TABLES) {
    const rows = await sql<SyncHealthRow[]>`
      SELECT cfg.id, cfg.item_path AS "itemPath", cfg.status,
             cfg.last_sync_status AS "lastSyncStatus",
             cfg.last_sync_at_ms::float8 AS "lastSyncAt",
             cfg.error_since_ms::float8 AS "errorSince",
             cfg.error_message AS "errorMessage",
             cfg.user_id AS "ownerUserId",
             u."name" AS "ownerName", u."email" AS "ownerEmail"
      FROM ${sql.unsafe(table)} cfg
      LEFT JOIN "user" u ON u."id" = cfg.user_id
      WHERE cfg.org_id = ${organizationId}
        AND cfg.status IN ('active', 'error')
    `;
    for (const row of rows) {
      const view = toSyncHealthView(row, provider);
      byConfigId.set(row.id, view);
      if (row.itemPath !== null && row.itemPath !== '') {
        byPath.set(row.itemPath, view);
      }
    }
  }
  return { byPath, byConfigId };
}
