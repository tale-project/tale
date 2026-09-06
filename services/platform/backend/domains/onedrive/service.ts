import type { Sql, TransactionSql } from 'postgres';

import {
  isRagIndexableFile,
  resolveFileType,
} from '../../../lib/shared/file-types.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { extractExtension } from '../../core/documents/extract_extension.ts';
import { sourceFromProvider } from '../../core/file_metadata/source_from_provider.ts';
import { getFileMetadata } from '../../core/onedrive/get_file_metadata.ts';
import { importFiles } from '../../core/onedrive/import_files.ts';
import type { FileItem } from '../../core/onedrive/list_folder_contents.ts';
import { listFolderContents } from '../../core/onedrive/list_folder_contents.ts';
import {
  buildSyncImportItems,
  selectDocumentsToPrune,
  type SyncedDocumentRef,
} from '../../core/onedrive/reconcile_folder_sync.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { resolveCloudAccessToken } from '../cloud_import/service.ts';
import { MAX_UPLOAD_BYTES, readBodyBounded } from '../files/bounded-body.ts';
import { putOrgBlobBytes } from '../files/service.ts';
import {
  buildHubFolderPath,
  findHubFolderByPath,
  getOrCreateHubFolderPath,
  reapEmptyAncestorFolders,
} from '../folders/paths.ts';
import { markRagQueued, syncRagDocumentScope } from '../knowledge/service.ts';
import { assertNotHeld, LegalHoldError } from '../legal_holds/service.ts';
import { purgeDocument } from '../retention/service.ts';

/**
 * OneDrive Knowledge sync — the 0.5 twin of `convex/onedrive`: the
 * browse/import surface reuses the PURE 0.4 pipeline (`importFiles` with a
 * pg dependency object, the Graph fetch modules verbatim), and the ongoing
 * sync runs as a native pg-boss engine (`onedrive.sync_scan` cron →
 * one `onedrive.sync_config` job per active config) — the 0.4 automation
 * pack that used to drive it was retired with the automation rebuild.
 *
 * Tokens are GRANT-ONLY: the explicit per-user Documents grant (inc 64).
 * The 0.4 fallback to the Better Auth Microsoft login account is gone — SSO
 * sign-in deliberately never carries Graph file scopes, so that lane could
 * only ever hand the engine a token Graph answers with 403. Agents never
 * reach these.
 *
 * Like the 0.4 tree (google_drive imports onedrive's prune/reconcile
 * helpers), this module is also the home of the PROVIDER-GENERIC engine:
 * everything below is parameterized over a {@link SyncProviderAdapter}, and
 * `domains/google_drive` binds a second adapter to the same machinery.
 */

export class SyncConfigError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404;

  constructor(code: string, message: string, status: 400 | 403 | 404 = 400) {
    super(message);
    this.name = 'SyncConfigError';
    this.code = code;
    this.status = status;
  }
}

// --------------------------------------------------------------- config rows

export interface SyncConfigRow {
  id: string;
  organizationId: string;
  userId: string;
  itemType: 'file' | 'folder';
  itemId: string;
  itemName: string;
  itemPath: string | null;
  targetBucket: string;
  storagePrefix: string | null;
  teamId: string | null;
  status: 'active' | 'inactive' | 'error';
  lastSyncAt: number | null;
  lastSyncStatus: string | null;
  errorMessage: string | null;
}

const CONFIG_COLUMNS = `
  id, org_id AS "organizationId", user_id AS "userId",
  item_type AS "itemType", item_id AS "itemId", item_name AS "itemName",
  item_path AS "itemPath", target_bucket AS "targetBucket",
  storage_prefix AS "storagePrefix", team_id AS "teamId", status,
  last_sync_at_ms::float8 AS "lastSyncAt",
  last_sync_status AS "lastSyncStatus", error_message AS "errorMessage"
`;

/** The provider seam the generic sync engine runs over. Fetchers are the
 * reused 0.4 modules; table/provider names come from a CLOSED constant set
 * (never user input — they land in SQL via `unsafe`). */
export interface SyncProviderAdapter {
  /** Log tag + error copy ('OneDrive' / 'Google Drive'). */
  displayName: string;
  /** `app.documents.source_provider` value this engine owns. */
  sourceProvider: string;
  /** Schema-qualified sync-config table. */
  configTable: string;
  /** Per-config job + its dedup key prefix. */
  configJobName: 'onedrive.sync_config' | 'google_drive.sync_config';
  singletonPrefix: string;
  /** Legacy metadata keys that may carry the external item id. */
  metadataItemIdKeys: readonly string[];
  resolveToken(
    sql: Sql,
    args: { organizationId: string; userId: string },
  ): Promise<GraphTokenResult>;
  listFolderContents(args: {
    itemId: string;
    token: string;
    recursive: boolean;
  }): Promise<{ success: boolean; files?: FileItem[]; error?: string }>;
  getFileMetadata(
    itemId: string,
    token: string,
    siteId?: string,
    driveId?: string,
  ): Promise<{
    success: boolean;
    data?: {
      hash?: string;
      mimeType?: string;
      size?: number;
      modifiedAt?: number;
    };
    notFound?: boolean;
    error?: string;
  }>;
  /** Vendor download URL for one item (the import deps' fetch target). */
  buildDownloadUrl(args: {
    itemId: string;
    siteId?: string;
    driveId?: string;
  }): string;
  /** Run the provider's REUSED 0.4 import pipeline with pg deps. */
  runImport(
    sql: Sql,
    args: {
      items: SyncImportItem[];
      organizationId: string;
      importType: 'one-time' | 'sync';
      teamId?: string;
      token: string;
      userId: string;
    },
  ): Promise<SyncImportOutcome>;
}

/** Structural superset of both providers' 0.4 `ImportItem` shapes. */
export interface SyncImportItem {
  id: string;
  name: string;
  size: number;
  relativePath?: string;
  isDirectlySelected?: boolean;
  selectedParentId?: string;
  selectedParentName?: string;
  selectedParentPath?: string;
  siteId?: string;
  driveId?: string;
  sourceType?: 'onedrive' | 'sharepoint';
}

/** Structural projection of both providers' 0.4 `ImportFilesResult`. */
export interface SyncImportOutcome {
  success: boolean;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  results: {
    fileId: string;
    fileName: string;
    status: 'success' | 'skipped' | 'error';
    documentId?: string;
    error?: string;
  }[];
}

export async function getSyncConfigRow(
  db: Sql | TransactionSql,
  table: string,
  configId: string,
): Promise<SyncConfigRow | null> {
  const rows = await db<SyncConfigRow[]>`
    SELECT ${db.unsafe(CONFIG_COLUMNS)} FROM ${db.unsafe(table)}
    WHERE id = ${configId} LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Create-or-reactivate the sync config for a selected item (the 0.4
 * `create*SyncConfig`): one config per (org, source item); an
 * inactive/error row is reactivated in place with the fresh selection. A
 * reactivation starts a fresh run lifecycle — the previous one's marker is
 * cleared so the first job claims at once (a 'running' left by a cancelled
 * run would otherwise hold the claim fence for the stale window). A live
 * row keeps its marker: re-selecting an item whose sync is in flight must
 * not admit a second concurrent run.
 */
export async function upsertSyncConfigRow(
  db: Sql | TransactionSql,
  table: string,
  args: {
    organizationId: string;
    userId: string;
    itemType: 'file' | 'folder';
    itemId: string;
    itemName: string;
    itemPath?: string;
    targetBucket: string;
    storagePrefix?: string;
    teamId?: string;
  },
): Promise<string | null> {
  const now = Date.now();
  const rows = await db<{ id: string }[]>`
    INSERT INTO ${db.unsafe(table)} (
      org_id, user_id, item_type, item_id, item_name, item_path,
      target_bucket, storage_prefix, team_id, status, created_at_ms,
      updated_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.userId}, ${args.itemType},
      ${args.itemId}, ${args.itemName}, ${args.itemPath ?? null},
      ${args.targetBucket}, ${args.storagePrefix ?? null},
      ${args.teamId ?? null}, 'active', ${now}, ${now}
    )
    ON CONFLICT (org_id, item_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      item_name = EXCLUDED.item_name,
      item_path = EXCLUDED.item_path,
      target_bucket = EXCLUDED.target_bucket,
      storage_prefix = EXCLUDED.storage_prefix,
      team_id = EXCLUDED.team_id,
      status = 'active',
      error_message = NULL,
      last_sync_status = CASE
        WHEN status = 'inactive' THEN NULL ELSE last_sync_status END,
      updated_at_ms = ${now}
    RETURNING id
  `;
  return rows[0]?.id ?? null;
}

/**
 * The run marker a deactivation leaves behind. A cancel that lands while a
 * run is in flight refuses that run's final stamp (see
 * `updateSyncConfigStatusRow`), so without this the row kept
 * `last_sync_status = 'running'` forever — the listing showed a running
 * inactive config, and a reactivation sat behind the claim fence until the
 * stamp was 30 minutes stale. The heartbeat is gated on 'running', so the
 * in-flight run also stops renewing a claim it no longer holds.
 */
const SETTLE_RUN_MARKER_ON_DEACTIVATE = `
  last_sync_status = CASE
    WHEN last_sync_status = 'running' THEN 'cancelled' ELSE last_sync_status END
`;

/**
 * Patch a config's run outcome (the 0.4 `updateSyncConfig` twin). A status
 * write never touches an `inactive` row — a cancel landing while a sync is
 * in flight must not be resurrected by that run's final stamp.
 */
export async function updateSyncConfigStatusRow(
  db: Sql | TransactionSql,
  table: string,
  args: {
    configId: string;
    /** Caller's org — when set, a config in another tenant is not touched. */
    organizationId?: string;
    status?: 'active' | 'inactive' | 'error';
    lastSyncAt?: number;
    lastSyncStatus?: string;
    errorMessage?: string | null;
  },
): Promise<void> {
  await db`
    UPDATE ${db.unsafe(table)} SET
      status = ${args.status !== undefined ? args.status : db.unsafe('status')},
      last_sync_at_ms = ${args.lastSyncAt !== undefined ? args.lastSyncAt : db.unsafe('last_sync_at_ms')},
      last_sync_status = ${args.lastSyncStatus !== undefined ? args.lastSyncStatus : db.unsafe('last_sync_status')},
      error_message = ${args.errorMessage !== undefined ? args.errorMessage : db.unsafe('error_message')},
      updated_at_ms = ${Date.now()}
    WHERE id = ${args.configId}
      AND (${args.organizationId ?? null}::text IS NULL
           OR org_id = ${args.organizationId ?? null})
      AND (${args.status ?? null}::text IS NULL OR status <> 'inactive')
  `;
}

/**
 * Stop a sync without touching the already-imported documents; re-running
 * "Sync import" on the same item reactivates the config.
 */
export async function cancelSyncConfigRow(
  db: Sql | TransactionSql,
  table: string,
  organizationId: string,
  configId: string,
): Promise<void> {
  const rows = await db<{ id: string }[]>`
    UPDATE ${db.unsafe(table)} SET
      status = 'inactive', updated_at_ms = ${Date.now()},
      ${db.unsafe(SETTLE_RUN_MARKER_ON_DEACTIVATE)}
    WHERE id = ${configId} AND org_id = ${organizationId}
    RETURNING id
  `;
  if (rows.length === 0) {
    throw new SyncConfigError(
      'SYNC_CONFIG_NOT_FOUND',
      'Sync config not found',
      404,
    );
  }
}

/** Both providers' config tables — the cross-provider hooks sweep all of
 * them, the 0.4 `deactivate_sync_configs.ts` posture. */
const ALL_SYNC_CONFIG_TABLES = [
  'app.onedrive_sync_configs',
  'app.google_drive_sync_configs',
] as const;

/**
 * Deleting a synced hub folder means "stop syncing it" — deactivate every
 * active config (any provider) whose synced tree lives at or below the
 * given hub path, or the next sync run resurrects the folder just removed.
 */
export async function deactivateSyncConfigsForPath(
  db: Sql | TransactionSql,
  organizationId: string,
  folderPath: string,
): Promise<number> {
  let deactivated = 0;
  for (const table of ALL_SYNC_CONFIG_TABLES) {
    const rows = await db<{ id: string }[]>`
      UPDATE ${db.unsafe(table)} SET
        status = 'inactive', updated_at_ms = ${Date.now()},
        ${db.unsafe(SETTLE_RUN_MARKER_ON_DEACTIVATE)}
      WHERE org_id = ${organizationId} AND status = 'active'
        AND (coalesce(item_path, '') = ${folderPath}
             OR coalesce(item_path, '') LIKE ${folderPath + '/%'})
      RETURNING id
    `;
    deactivated += rows.length;
  }
  return deactivated;
}

/**
 * Trashing a directly-selected single-file synced document means "stop
 * syncing it" — otherwise the next scheduled run refreshes the mirror the
 * user just removed. Only a directly-selected single-file config maps 1:1
 * to a document; folder-member docs carry the FOLDER's config id and are
 * left alone. No-op for manual uploads. Covers both providers' tables (the
 * 0.4 `stopSyncForDeletedDocument`, hooked at the 0.5 trash lane).
 */
export async function stopSyncForTrashedDocument(
  db: Sql | TransactionSql,
  document: { organizationId: string; metadata: unknown },
): Promise<boolean> {
  const meta = isRecord(document.metadata) ? document.metadata : {};
  if (
    meta.sourceMode !== 'auto' ||
    meta.isDirectlySelected !== true ||
    typeof meta.syncConfigId !== 'string'
  ) {
    return false;
  }
  for (const table of ALL_SYNC_CONFIG_TABLES) {
    const rows = await db<{ id: string }[]>`
      UPDATE ${db.unsafe(table)} SET
        status = 'inactive', updated_at_ms = ${Date.now()},
        ${db.unsafe(SETTLE_RUN_MARKER_ON_DEACTIVATE)}
      WHERE id = ${meta.syncConfigId} AND org_id = ${document.organizationId}
        AND status <> 'inactive'
      RETURNING id
    `;
    if (rows.length > 0) return true;
  }
  return false;
}

// ------------------------------------------------------------------- tokens

export type GraphTokenResult =
  | { success: true; token: string }
  | { success: false; error: string };

/**
 * Resolve a Microsoft Graph token for Knowledge OneDrive/SharePoint from the
 * user's cloud-import grant. Only a missing/dead grant is fixed by
 * reconnecting; a vendor outage or a deployment misconfiguration is named
 * as itself so the sync error reads true. Agents must not call this.
 */
export async function resolveGraphTokenForUser(
  sql: Sql,
  args: { organizationId: string; userId: string },
): Promise<GraphTokenResult> {
  const cloud = await resolveCloudAccessToken(sql, {
    organizationId: args.organizationId,
    userId: args.userId,
    provider: 'onedrive',
  });
  if (cloud.success) return { success: true, token: cloud.accessToken };
  if (cloud.needsReauth !== true) return { success: false, error: cloud.error };
  return {
    success: false,
    error:
      'OneDrive is not authorized for importing. Connect Microsoft 365 from Documents.',
  };
}

// -------------------------------------------------------------- import deps

interface DocumentSyncRow {
  id: string;
  externalItemId: string | null;
  fileRef: string | null;
  folderId: string | null;
  projectId: string | null;
  historyFiles: string[];
  contentHash: string | null;
  metadata: Record<string, unknown> | null;
}

const DOC_SYNC_COLUMNS = `
  id, external_item_id AS "externalItemId", file_ref AS "fileRef",
  folder_id AS "folderId", project_id AS "projectId",
  history_files AS "historyFiles",
  content_hash AS "contentHash", metadata
`;

/** How long one vendor download may take, headers to last byte — generous
 * for a 512 MB file on a slow link, finite for a stalled one. */
const VENDOR_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

async function fetchVendorContentToStorage(
  sql: Sql,
  adapter: SyncProviderAdapter,
  args: {
    organizationId: string;
    itemId: string;
    token: string;
    siteId?: string;
    driveId?: string;
  },
): Promise<{
  success: boolean;
  storageId?: string;
  mimeType?: string;
  size?: number;
  error?: string;
}> {
  const url = adapter.buildDownloadUrl(args);
  try {
    // A hung vendor download must not park a sync worker forever.
    const download = await fetch(url, {
      headers: { Authorization: `Bearer ${args.token}` },
      signal: AbortSignal.timeout(VENDOR_DOWNLOAD_TIMEOUT_MS),
    });
    if (!download.ok) {
      const errorText = await download.text();
      return {
        success: false,
        error: `Failed to download file: ${download.status} ${errorText}`,
      };
    }
    const mimeType =
      download.headers.get('content-type') || 'application/octet-stream';
    // Buffered (the blob store signs whole bodies), but never unbounded: the
    // declared length is refused before a byte is read and the received
    // bytes abort at the cap — `putOrgBlobBytes` re-checks the same ceiling,
    // it just can no longer be the FIRST check a multi-GB file meets.
    const bytes = await readBodyBounded(download, MAX_UPLOAD_BYTES);
    const ref = await putOrgBlobBytes(sql, args.organizationId, {
      bytes,
      contentType: mimeType,
    });
    return {
      success: true,
      storageId: ref,
      mimeType,
      size: bytes.byteLength,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/** Queue RAG indexing for a hub document's current blob — the 0.4
 * `scheduleHubDocumentRagIndexing` gates over the pg file row. */
async function scheduleDocumentRagIndexing(
  sql: Sql,
  documentId: string,
): Promise<boolean> {
  const docs = await sql<
    { fileRef: string | null; title: string | null; mimeType: string | null }[]
  >`
    SELECT file_ref AS "fileRef", title, mime_type AS "mimeType"
    FROM app.documents WHERE id = ${documentId} LIMIT 1
  `;
  const doc = docs[0];
  if (!doc?.fileRef) return false;
  const files = await sql<
    {
      id: string;
      fileName: string;
      contentType: string;
      threadId: string | null;
      skipRagIndexing: boolean | null;
      ragStatus: string | null;
    }[]
  >`
    SELECT id, file_name AS "fileName", content_type AS "contentType",
           thread_id AS "threadId", skip_rag_indexing AS "skipRagIndexing",
           rag_status AS "ragStatus"
    FROM app.file_metadata
    WHERE storage_ref = ${doc.fileRef}
    LIMIT 1
  `;
  const file = files[0];
  if (!file) return false;
  if (file.threadId !== null || file.skipRagIndexing === true) return false;
  if (
    file.ragStatus === 'completed' ||
    file.ragStatus === 'running' ||
    file.ragStatus === 'queued'
  ) {
    return false;
  }
  const fileName = doc.title ?? file.fileName;
  const contentType = resolveFileType(
    fileName,
    doc.mimeType ?? file.contentType,
  );
  if (!isRagIndexableFile(fileName, contentType)) return false;
  await sql.begin(async (tx) => {
    await markRagQueued(tx, file.id);
    await addJobInTx(tx, 'rag.index_file', { fileId: file.id });
  });
  return true;
}

/** The structural dep object both providers' REUSED pipelines accept —
 * wide-typed params (a `sourceProvider: string` impl satisfies each
 * pipeline's narrower literal union under parameter contravariance). */
export interface PgSyncImportDeps {
  getFileMetadata: (
    itemId: string,
    token: string,
    siteId?: string,
    driveId?: string,
  ) => Promise<{
    success: boolean;
    data?: {
      hash?: string;
      mimeType?: string;
      size?: number;
      modifiedAt?: number;
    };
    error?: string;
  }>;
  downloadToStorage: (args: {
    itemId: string;
    token: string;
    siteId?: string;
    driveId?: string;
  }) => Promise<{
    success: boolean;
    storageId?: never;
    mimeType?: string;
    size?: number;
    error?: string;
  }>;
  findDocumentByExternalId: (args: {
    organizationId: string;
    externalItemId: string;
  }) => Promise<{
    _id: never;
    contentHash?: string;
    metadata?: Record<string, unknown> | null;
  } | null>;
  createDocument: (args: {
    organizationId: string;
    title: string;
    fileId: string;
    mimeType?: string;
    sourceProvider: string;
    externalItemId: string;
    contentHash?: string;
    teamId?: string;
    metadata?: Record<string, unknown>;
    createdBy?: string;
    folderId?: string;
  }) => Promise<never>;
  updateDocument: (args: {
    documentId: string;
    title: string;
    fileId: string;
    mimeType?: string;
    sourceProvider: string;
    externalItemId: string;
    contentHash?: string;
    teamId?: string;
    metadata?: Record<string, unknown>;
    folderId?: string;
  }) => Promise<void>;
  getOrCreateFolderPath: (
    organizationId: string,
    pathSegments: string[],
    createdBy?: string,
    teamId?: string,
  ) => Promise<never>;
  saveFileMetadata: (
    storageId: string,
    fileName: string,
    contentType: string,
    size: number,
    documentId: string,
  ) => Promise<void>;
  linkDocumentToFile: (storageId: string, documentId: string) => Promise<void>;
  scheduleHubDocumentRagIndexing: (documentId: string) => Promise<void>;
  bindDocumentToSync: (args: {
    documentId: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  upsertSyncConfig: (
    target: {
      itemType: 'file' | 'folder';
      itemId: string;
      itemName: string;
      itemPath?: string;
    } & {
      organizationId: string;
      userId: string;
      teamId?: string;
      targetBucket: string;
      storagePrefix?: string;
    },
  ) => Promise<string | null>;
}

/**
 * Refresh a synced document with a freshly landed blob — the 0.4
 * `updateDocument` internal mutation. Whenever the blob actually changes,
 * the previous one joins `history_files` (an addressable, erasable history
 * rather than a hard drop) and its corpus chunks are released. This is
 * keyed on the REF, never on the content hash: a vendor file without a
 * hash (Graph omits `file.hashes` for some item types, Drive omits
 * `md5Checksum` for non-binary items) used to swap `file_ref` with no
 * bookkeeping at all — one stranded blob, file row and duplicate chunk set
 * per scan, reclaimed by nothing, not even the document's delete.
 */
async function updateDocumentRow(
  sql: Sql,
  organizationId: string,
  updateArgs: {
    documentId: string;
    title: string;
    fileId: string;
    mimeType?: string;
    sourceProvider: string;
    externalItemId: string;
    contentHash?: string;
    teamId?: string;
    metadata?: Record<string, unknown>;
    folderId?: string;
  },
): Promise<void> {
  const documentId = updateArgs.documentId;
  const rows = await sql<DocumentSyncRow[]>`
    SELECT ${sql.unsafe(DOC_SYNC_COLUMNS)} FROM app.documents
    WHERE id = ${documentId} LIMIT 1
  `;
  const doc = rows[0];
  if (!doc) throw new Error('Document not found');
  // `projectId`/`teamId` are mutually exclusive (the 0.4 invariant) —
  // refuse rather than team-stamp a doc someone attached to a project.
  if (updateArgs.teamId !== undefined && doc.projectId !== null) {
    throw new Error('A project document cannot be assigned to a team');
  }

  const newFileRef = updateArgs.fileId;
  const oldFileRef = doc.fileRef;
  const blobReplaced = oldFileRef !== null && oldFileRef !== newFileRef;
  let historyFiles = doc.historyFiles;
  if (oldFileRef !== null && blobReplaced) {
    if (!historyFiles.includes(oldFileRef)) {
      historyFiles = [...historyFiles, oldFileRef];
    }
  }
  // 0.4 patch semantics: an UNDEFINED field stays as it is — a sync
  // must not strip a user's manual folder move, team assignment, or the
  // stored hash just because the pipeline had nothing to say about it.
  const folderId =
    updateArgs.folderId !== undefined ? updateArgs.folderId : null;
  const folderPath =
    folderId !== null
      ? await buildHubFolderPath(sql, organizationId, folderId)
      : null;

  await sql`
    UPDATE app.documents SET
      title = ${updateArgs.title},
      file_ref = ${newFileRef},
      mime_type = ${updateArgs.mimeType ?? null},
      extension = ${extractExtension(updateArgs.title) ?? null},
      source_provider = ${updateArgs.sourceProvider},
      external_item_id = ${updateArgs.externalItemId},
      content_hash = ${updateArgs.contentHash !== undefined ? updateArgs.contentHash : sql.unsafe('content_hash')},
      team_id = ${updateArgs.teamId !== undefined ? updateArgs.teamId : sql.unsafe('team_id')},
      team_tags = ${updateArgs.teamId !== undefined ? [updateArgs.teamId] : sql.unsafe('team_tags')},
      metadata = ${updateArgs.metadata !== undefined ? sql.json(toJson(updateArgs.metadata)) : sql.unsafe('metadata')},
      folder_id = ${updateArgs.folderId !== undefined ? folderId : sql.unsafe('folder_id')},
      folder_path = ${updateArgs.folderId !== undefined ? folderPath : sql.unsafe('folder_path')},
      history_files = ${historyFiles},
      updated_at_ms = ${Date.now()}
    WHERE id = ${documentId}
  `;
  // A re-filed document keeps its embeddings but moves in the corpus
  // FILTER (folder-scoped search matches the stamped path) — re-stamp.
  // A replaced blob re-indexes via the schedule dep and stamps itself.
  if (updateArgs.folderId !== undefined && !blobReplaced) {
    await syncRagDocumentScope(sql, organizationId, documentId);
  }

  // The replaced blob's corpus chunks are keyed by the OLD ref — release
  // them through the shared refcounted seam (the 0.4
  // `reindexDocumentInRag` old-entry purge, made durable: a swallowed
  // failure used to strand the stale rows forever). The ref sits in
  // `history_files` now, so the job de-indexes the corpus and keeps the
  // bytes; the new blob indexes via the schedule dep.
  if (oldFileRef !== null && blobReplaced) {
    await sql.begin(async (tx) => {
      await addJobInTx(tx, 'knowledge.release_refs', {
        organizationId,
        refs: [oldFileRef],
      });
    });
  }
}

/**
 * The pg dependency object for the REUSED 0.4 `importFiles` pipelines —
 * direct SQL twins of the 0.4 internal mutations, provider-parameterized.
 * System lane: the route gates membership; the sync engine runs under the
 * config owner.
 */
export function createSyncImportDeps(
  sql: Sql,
  adapter: SyncProviderAdapter,
  organizationId: string,
): PgSyncImportDeps {
  return {
    getFileMetadata: (itemId, token, siteId, driveId) =>
      adapter.getFileMetadata(itemId, token, siteId, driveId),
    downloadToStorage: (streamArgs) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg blob refs stand in for the reused pipeline's BlobRef brand
      fetchVendorContentToStorage(sql, adapter, {
        ...streamArgs,
        organizationId,
      }) as never,
    findDocumentByExternalId: async (findArgs) => {
      // Deliberately NO lifecycle filter (0.4 contract): a trashed row with
      // the same external id must update in place, or the next sweep would
      // resurrect the document the user just trashed as a duplicate.
      const rows = await sql<
        {
          id: string;
          contentHash: string | null;
          metadata: Record<string, unknown> | null;
        }[]
      >`
        SELECT id, content_hash AS "contentHash", metadata FROM app.documents
        WHERE org_id = ${findArgs.organizationId}
          AND external_item_id = ${findArgs.externalItemId}
        ORDER BY created_at_ms ASC
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg ids stand in for the reused pipeline's Convex Id<'documents'> brand
        _id: row.id as never,
        ...(row.contentHash !== null ? { contentHash: row.contentHash } : {}),
        metadata: row.metadata,
      };
    },
    createDocument: async (createArgs) => {
      const now = Date.now();
      const folderId =
        createArgs.folderId !== undefined ? createArgs.folderId : null;
      const folderPath =
        folderId !== null
          ? await buildHubFolderPath(sql, createArgs.organizationId, folderId)
          : null;
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO app.documents (
          org_id, title, file_ref, mime_type, extension, source_provider,
          external_item_id, content_hash, team_id, team_tags, metadata,
          created_by, folder_id, folder_path, created_at_ms, updated_at_ms
        ) VALUES (
          ${createArgs.organizationId}, ${createArgs.title},
          ${createArgs.fileId}, ${createArgs.mimeType ?? null},
          ${extractExtension(createArgs.title) ?? null},
          ${createArgs.sourceProvider}, ${createArgs.externalItemId},
          ${createArgs.contentHash ?? null}, ${createArgs.teamId ?? null},
          ${createArgs.teamId ? [createArgs.teamId] : []},
          ${createArgs.metadata === undefined ? null : sql.json(toJson(createArgs.metadata))},
          ${createArgs.createdBy ?? null}, ${folderId}, ${folderPath},
          ${now}, ${now}
        )
        ON CONFLICT (org_id, external_item_id)
          WHERE external_item_id IS NOT NULL
          DO NOTHING
        RETURNING id
      `;
      let id = inserted[0]?.id;
      if (id === undefined) {
        // Lost a race with a concurrent sync of the same item (an
        // overlapping run, a second config over the same folder): the key
        // is unique in the schema (0073), so the row exists now. Refresh it
        // with THIS run's blob through the update lane — the winner's blob
        // joins the history and releases its corpus rows — rather than
        // hand the id back over a blob the document never references
        // (the pipeline's file row would then point at a document whose
        // file_ref is a different blob, and the bytes leaked for good).
        const existing = await sql<{ id: string }[]>`
          SELECT id FROM app.documents
          WHERE org_id = ${createArgs.organizationId}
            AND external_item_id = ${createArgs.externalItemId}
          ORDER BY created_at_ms ASC
          LIMIT 1
        `;
        id = existing[0]?.id;
        if (id !== undefined) {
          await updateDocumentRow(sql, organizationId, {
            documentId: id,
            title: createArgs.title,
            fileId: createArgs.fileId,
            ...(createArgs.mimeType !== undefined
              ? { mimeType: createArgs.mimeType }
              : {}),
            sourceProvider: createArgs.sourceProvider,
            externalItemId: createArgs.externalItemId,
            ...(createArgs.contentHash !== undefined
              ? { contentHash: createArgs.contentHash }
              : {}),
            ...(createArgs.teamId !== undefined
              ? { teamId: createArgs.teamId }
              : {}),
            ...(createArgs.metadata !== undefined
              ? { metadata: createArgs.metadata }
              : {}),
            ...(createArgs.folderId !== undefined
              ? { folderId: createArgs.folderId }
              : {}),
          });
        }
      }
      if (!id) throw new Error('Document insert failed');
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg ids stand in for the reused pipeline's Convex Id<'documents'> brand
      return id as never;
    },
    updateDocument: (updateArgs) =>
      updateDocumentRow(sql, organizationId, updateArgs),
    getOrCreateFolderPath: async (orgId, pathSegments, createdBy, teamId) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg ids stand in for the reused pipeline's Convex Id<'folders'> brand
      (await getOrCreateHubFolderPath(sql, {
        organizationId: orgId,
        pathSegments,
        ...(createdBy !== undefined ? { createdBy } : {}),
        ...(teamId !== undefined ? { teamId } : {}),
      })) as never,
    saveFileMetadata: async (
      storageId,
      fileName,
      contentType,
      size,
      documentId,
    ) => {
      const ref = storageId;
      const existing = await sql<{ id: string }[]>`
        SELECT id FROM app.file_metadata
        WHERE org_id = ${organizationId} AND storage_ref = ${ref}
        LIMIT 1
      `;
      if (existing[0]) {
        await sql`
          UPDATE app.file_metadata SET
            file_name = ${fileName}, content_type = ${contentType},
            size = ${size}, document_id = ${documentId}
          WHERE id = ${existing[0].id}
        `;
        return;
      }
      await sql`
        INSERT INTO app.file_metadata (
          org_id, storage_ref, file_name, content_type, size, source,
          document_id, created_at_ms
        ) VALUES (
          ${organizationId}, ${ref}, ${fileName}, ${contentType}, ${size},
          'user', ${documentId}, ${Date.now()}
        )
      `;
    },
    linkDocumentToFile: async (storageId, documentId) => {
      const docs = await sql<{ sourceProvider: string | null }[]>`
        SELECT source_provider AS "sourceProvider" FROM app.documents
        WHERE id = ${documentId} LIMIT 1
      `;
      const source = sourceFromProvider(docs[0]?.sourceProvider ?? undefined);
      await sql`
        UPDATE app.file_metadata SET
          document_id = ${documentId},
          source = ${source !== undefined ? source : sql.unsafe('source')}
        WHERE org_id = ${organizationId}
          AND storage_ref = ${storageId}
      `;
    },
    scheduleHubDocumentRagIndexing: async (documentId) => {
      await scheduleDocumentRagIndexing(sql, documentId);
    },
    // A metadata MERGE, never a replace: the document's content, hash, and
    // every other key stay; only the sync binding lands.
    bindDocumentToSync: async ({ documentId, metadata }) => {
      await sql`
        UPDATE app.documents SET
          metadata = COALESCE(metadata, '{}'::jsonb)
            || ${sql.json(toJson(metadata))}::jsonb,
          updated_at_ms = ${Date.now()}
        WHERE id = ${documentId} AND org_id = ${organizationId}
      `;
    },
    upsertSyncConfig: async (target) =>
      upsertSyncConfigRow(sql, adapter.configTable, target),
  };
}

// -------------------------------------------------------------------- prune

/**
 * Delete synced mirrors whose source files are gone — the 0.4
 * `scheduleSyncedDocumentDeletes` semantics, inline: per ref the row is
 * RE-READ and snapshot-verified (externalItemId / fileRef) so an
 * interleaving re-upload aborts the stale delete; a legal hold skips the
 * doc (warn) without failing the sync; a blob-bearing doc goes through the
 * corpus-purging hard delete, a metadata-only doc deletes directly; emptied
 * ancestor folders are reaped up to (never including) the sync root.
 */
export async function pruneSyncedDocuments(
  sql: Sql,
  args: {
    organizationId: string;
    refs: SyncedDocumentRef[];
    cleanupAncestorsUpTo?: string;
  },
): Promise<number> {
  if (args.refs.length === 0) return 0;
  const orgSlug = await resolveOrgSlug(sql, args.organizationId);
  let deleted = 0;
  for (const ref of args.refs) {
    const rows = await sql<(DocumentSyncRow & { createdBy: string | null })[]>`
      SELECT ${sql.unsafe(DOC_SYNC_COLUMNS)}, created_by AS "createdBy"
      FROM app.documents
      WHERE id = ${ref.documentId} AND org_id = ${args.organizationId}
      LIMIT 1
    `;
    const doc = rows[0];
    if (!doc) continue;
    if (
      ref.externalItemId !== undefined &&
      doc.externalItemId !== ref.externalItemId
    ) {
      console.warn(
        `[sync] aborting stale prune for ${ref.documentId}: externalItemId re-bound`,
      );
      continue;
    }
    if (ref.fileId !== undefined && doc.fileRef !== ref.fileId) {
      console.warn(
        `[sync] aborting stale prune for ${ref.documentId}: fileRef re-bound`,
      );
      continue;
    }
    try {
      await assertNotHeld(
        sql,
        args.organizationId,
        'document',
        doc.id,
        undefined,
        doc.createdBy ?? undefined,
      );
    } catch (error) {
      if (error instanceof LegalHoldError) {
        console.warn(
          `[sync] prune skipped for held document ${doc.id}: ${error.message}`,
        );
        continue;
      }
      throw error;
    }

    if (doc.fileRef !== null) {
      await purgeDocument(sql, orgSlug, {
        id: doc.id,
        fileRef: doc.fileRef,
        organizationId: args.organizationId,
        historyFiles: doc.historyFiles,
      });
    } else {
      await sql.begin(async (tx) => {
        await tx`
          DELETE FROM app.file_metadata WHERE document_id = ${doc.id}
        `;
        await tx`DELETE FROM app.documents WHERE id = ${doc.id}`;
      });
    }
    deleted++;

    if (args.cleanupAncestorsUpTo !== undefined && doc.folderId !== null) {
      await reapEmptyAncestorFolders(sql, {
        organizationId: args.organizationId,
        startFolderId: doc.folderId,
        stopAtFolderId: args.cleanupAncestorsUpTo,
      });
    }
  }
  return deleted;
}

// --------------------------------------------------------------- reconcile

export interface ReconcileResult {
  created: number;
  skipped: number;
  deleted: number;
  errorsCount: number;
  /** The synced item itself is gone at the source (a definitive 404, or a
   *  trashed Drive item) — its mirror is removed and the config should
   *  deactivate. */
  sourceDeleted?: boolean;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Every org document imported from this provider, as prune candidates. */
async function listProviderDocumentRefs(
  sql: Sql,
  adapter: SyncProviderAdapter,
  organizationId: string,
): Promise<SyncedDocumentRef[]> {
  const refs: SyncedDocumentRef[] = [];
  let after = '';
  for (;;) {
    const rows = await sql<DocumentSyncRow[]>`
      SELECT ${sql.unsafe(DOC_SYNC_COLUMNS)} FROM app.documents
      WHERE org_id = ${organizationId}
        AND source_provider = ${adapter.sourceProvider}
        AND id > ${after}
      ORDER BY id ASC
      LIMIT 200
    `;
    for (const doc of rows) {
      const meta = metadataRecord(doc.metadata);
      let fallbackId: string | undefined;
      for (const key of adapter.metadataItemIdKeys) {
        const value = meta[key];
        if (typeof value === 'string') {
          fallbackId = value;
          break;
        }
      }
      const externalItemId = doc.externalItemId ?? fallbackId;
      refs.push({
        documentId: doc.id,
        ...(externalItemId !== undefined ? { externalItemId } : {}),
        ...(typeof meta.syncConfigId === 'string'
          ? { syncConfigId: meta.syncConfigId }
          : {}),
        ...(typeof meta.sourceMode === 'string'
          ? { sourceMode: meta.sourceMode }
          : {}),
        ...(doc.fileRef !== null ? { fileId: doc.fileRef } : {}),
      });
    }
    const last = rows[rows.length - 1];
    if (rows.length < 200 || !last) break;
    after = last.id;
  }
  return refs;
}

/** Sync a folder config: shared import pipeline + prune of departed files. */
export async function reconcileFolderWith(
  sql: Sql,
  adapter: SyncProviderAdapter,
  args: {
    organizationId: string;
    configId: string;
    itemId: string;
    itemName: string;
    itemPath?: string;
    userId: string;
    teamId?: string;
    files: FileItem[];
    token: string;
  },
): Promise<ReconcileResult> {
  const items = buildSyncImportItems(
    {
      configId: args.configId,
      itemId: args.itemId,
      itemName: args.itemName,
      ...(args.itemPath !== undefined ? { itemPath: args.itemPath } : {}),
    },
    args.files,
  );
  const importResult = await adapter.runImport(sql, {
    items,
    organizationId: args.organizationId,
    importType: 'sync',
    ...(args.teamId !== undefined ? { teamId: args.teamId } : {}),
    token: args.token,
    userId: args.userId,
  });

  const deleted = await pruneDepartedFolderDocuments(sql, adapter, {
    organizationId: args.organizationId,
    configId: args.configId,
    itemName: args.itemName,
    ...(args.itemPath !== undefined ? { itemPath: args.itemPath } : {}),
    currentItemIds: new Set(args.files.map((f) => f.id)),
  });

  return {
    created: importResult.successCount,
    skipped: importResult.skippedCount,
    deleted,
    errorsCount: importResult.results.filter((r) => r.status === 'error')
      .length,
  };
}

/**
 * Delete the mirrors a folder config owns whose source files are not in
 * `currentItemIds` — every one of them when the folder itself is gone.
 * Each prune reaps the now-empty subfolders it leaves behind, stopping at —
 * never deleting — the sync root (an emptied folder and a deleted one leave
 * the same empty root behind; the user removes it).
 */
async function pruneDepartedFolderDocuments(
  sql: Sql,
  adapter: SyncProviderAdapter,
  args: {
    organizationId: string;
    configId: string;
    itemName: string;
    itemPath?: string;
    currentItemIds: ReadonlySet<string>;
  },
): Promise<number> {
  const existingDocs = await listProviderDocumentRefs(
    sql,
    adapter,
    args.organizationId,
  );
  const toPrune = selectDocumentsToPrune(
    args.configId,
    args.currentItemIds,
    existingDocs,
  );
  const refById = new Map(existingDocs.map((doc) => [doc.documentId, doc]));
  const refsToPrune = toPrune
    .map((documentId) => refById.get(documentId))
    .filter((ref): ref is SyncedDocumentRef => ref !== undefined);

  const rootSegments = (args.itemPath || args.itemName)
    .split('/')
    .filter((s) => s.trim().length > 0);
  const cleanupAncestorsUpTo =
    refsToPrune.length > 0 && rootSegments.length > 0
      ? ((await findHubFolderByPath(sql, args.organizationId, rootSegments)) ??
        undefined)
      : undefined;

  return pruneSyncedDocuments(sql, {
    organizationId: args.organizationId,
    refs: refsToPrune,
    ...(cleanupAncestorsUpTo !== undefined ? { cleanupAncestorsUpTo } : {}),
  });
}

/** Every auto-synced document a single-file config owns for its file. */
async function collectOwnedSingleFileRefs(
  sql: Sql,
  args: { organizationId: string; configId: string; itemId: string },
): Promise<SyncedDocumentRef[]> {
  const rows = await sql<DocumentSyncRow[]>`
    SELECT ${sql.unsafe(DOC_SYNC_COLUMNS)} FROM app.documents
    WHERE org_id = ${args.organizationId}
      AND external_item_id = ${args.itemId}
  `;
  const owned: SyncedDocumentRef[] = [];
  for (const doc of rows) {
    const meta = metadataRecord(doc.metadata);
    if (meta.syncConfigId !== args.configId || meta.sourceMode !== 'auto') {
      continue;
    }
    const ref: SyncedDocumentRef = { documentId: doc.id };
    if (doc.externalItemId !== null) ref.externalItemId = doc.externalItemId;
    if (doc.fileRef !== null) ref.fileId = doc.fileRef;
    owned.push(ref);
  }
  return owned;
}

/**
 * Sync a single-file config through the shared pipeline (dedup by external
 * id → update in place), collapse duplicate rows a prior no-dedup run
 * created, and — on a definitive 404 at the source — remove the mirror.
 */
export async function reconcileSingleFileWith(
  sql: Sql,
  adapter: SyncProviderAdapter,
  args: {
    organizationId: string;
    configId: string;
    itemId: string;
    itemName: string;
    itemPath?: string;
    userId: string;
    teamId?: string;
    token: string;
  },
): Promise<ReconcileResult> {
  const item: SyncImportItem = {
    id: args.itemId,
    name: args.itemName,
    size: 0,
    relativePath: args.itemPath ?? args.itemName,
    isDirectlySelected: true,
  };
  const importResult = await adapter.runImport(sql, {
    items: [item],
    organizationId: args.organizationId,
    importType: 'sync',
    ...(args.teamId !== undefined ? { teamId: args.teamId } : {}),
    token: args.token,
    userId: args.userId,
  });

  const primary = importResult.results[0];
  const canonicalId = primary?.documentId;

  if (canonicalId === undefined) {
    // Only a definitive 404 (source deleted/trashed) removes the mirror — a
    // transient / permission / throttle failure keeps the doc and errors
    // the config (a move keeps the item id, so this 404 means truly gone).
    const meta = await adapter.getFileMetadata(args.itemId, args.token);
    if (!meta.success && meta.notFound) {
      const owned = await collectOwnedSingleFileRefs(sql, args);
      const deleted = await pruneSyncedDocuments(sql, {
        organizationId: args.organizationId,
        refs: owned,
      });
      return {
        created: 0,
        skipped: 0,
        deleted,
        errorsCount: 0,
        sourceDeleted: true,
      };
    }
    throw new Error(
      primary?.error ?? `Failed to sync file from ${adapter.displayName}`,
    );
  }

  const strays = (await collectOwnedSingleFileRefs(sql, args)).filter(
    (ref) => ref.documentId !== canonicalId,
  );
  const deleted = await pruneSyncedDocuments(sql, {
    organizationId: args.organizationId,
    refs: strays,
  });

  return {
    created: importResult.successCount,
    skipped: importResult.skippedCount,
    deleted,
    errorsCount: importResult.results.filter((r) => r.status === 'error')
      .length,
  };
}

/**
 * Sync one config end to end: resolve the owner's token, then reconcile
 * the folder (recursive listing that THROWS on a truncated page walk — a
 * short read must fail the sync, never prune) or the single file. Throws
 * on hard failure so the caller marks the config `error`.
 *
 * A folder whose listing fails or comes back empty is probed at the source
 * before anything else happens: a definitive not-found (deleted, or a
 * trashed Drive folder — which lists empty rather than failing) removes
 * the mirrors and reports `sourceDeleted`, the single-file terminal path.
 * Without the probe a deleted folder never reached a terminal state — the
 * listing 404 stamped `error`, and the scan re-enqueued it every tick for
 * the lifetime of the org.
 */
export async function syncOneConfigWith(
  sql: Sql,
  adapter: SyncProviderAdapter,
  config: SyncConfigRow,
): Promise<ReconcileResult> {
  const token = await adapter.resolveToken(sql, {
    organizationId: config.organizationId,
    userId: config.userId,
  });
  if (!token.success) {
    throw new Error(
      `No valid ${adapter.displayName} token for the config owner: ${token.error}`,
    );
  }

  if (config.itemType === 'folder') {
    const listed = await adapter.listFolderContents({
      itemId: config.itemId,
      token: token.token,
      recursive: true,
    });
    const files = listed.files ?? [];
    if (!listed.success || files.length === 0) {
      const probe = await adapter.getFileMetadata(config.itemId, token.token);
      if (!probe.success && probe.notFound === true) {
        const deleted = await pruneDepartedFolderDocuments(sql, adapter, {
          organizationId: config.organizationId,
          configId: config.id,
          itemName: config.itemName,
          ...(config.itemPath !== null ? { itemPath: config.itemPath } : {}),
          currentItemIds: new Set<string>(),
        });
        return {
          created: 0,
          skipped: 0,
          deleted,
          errorsCount: 0,
          sourceDeleted: true,
        };
      }
      if (!listed.success) {
        throw new Error(listed.error ?? 'Failed to list folder contents');
      }
    }
    return reconcileFolderWith(sql, adapter, {
      organizationId: config.organizationId,
      configId: config.id,
      itemId: config.itemId,
      itemName: config.itemName,
      ...(config.itemPath !== null ? { itemPath: config.itemPath } : {}),
      userId: config.userId,
      ...(config.teamId !== null ? { teamId: config.teamId } : {}),
      files,
      token: token.token,
    });
  }

  return reconcileSingleFileWith(sql, adapter, {
    organizationId: config.organizationId,
    configId: config.id,
    itemId: config.itemId,
    itemName: config.itemName,
    ...(config.itemPath !== null ? { itemPath: config.itemPath } : {}),
    userId: config.userId,
    ...(config.teamId !== null ? { teamId: config.teamId } : {}),
    token: token.token,
  });
}

// ------------------------------------------------------------------- engine

/** A run older than this may be re-claimed (crashed worker recovery). */
export const SYNC_CLAIM_STALE_MS = 30 * 60 * 1000;
/** A live run refreshes its claim this often — well inside the stale window,
 * so only a run whose process died (no heartbeat) ever reads as stale. */
export const SYNC_CLAIM_HEARTBEAT_MS = 5 * 60 * 1000;

/** Refresh a live run's claim stamp; a no-op once the run has stamped its
 * outcome (the row is no longer 'running'). */
async function renewSyncClaim(
  sql: Sql,
  table: string,
  payload: { organizationId: string; configId: string },
): Promise<void> {
  await sql`
    UPDATE ${sql.unsafe(table)} SET updated_at_ms = ${Date.now()}
    WHERE id = ${payload.configId} AND org_id = ${payload.organizationId}
      AND last_sync_status = 'running'
  `;
}

/** Configs per scan page — how many sit in memory at once, not how many
 * the platform syncs. */
const SYNC_SCAN_PAGE_SIZE = 1000;

/**
 * Cron scan: one per-config job per syncable config. `error` configs are
 * retried too (a transient vendor failure must not silently end a sync
 * forever — the 0.4 active-only listing predates this engine); `inactive`
 * is the only terminal state (cancel, source deleted, folder removed).
 *
 * The scan WALKS every syncable config (keyset pages in id order, the
 * trigger scanner's idiom) rather than taking the first N: a bare
 * `LIMIT 1000 ORDER BY created_at_ms` handed every config past the
 * thousandth to never — the newest syncs sat `active` with no job, no
 * error and no log. The per-config `singletonKey` keeps a config that is
 * still queued from being enqueued twice, so a complete walk costs one
 * no-op enqueue per busy config and nothing else.
 */
export async function runSyncScanWith(
  sql: Sql,
  adapter: SyncProviderAdapter,
  options: { pageSize?: number } = {},
): Promise<number> {
  const pageSize = options.pageSize ?? SYNC_SCAN_PAGE_SIZE;
  let enqueued = 0;
  let cursor: string | null = null;
  for (;;) {
    const page: SyncScanRow[] = await sql<SyncScanRow[]>`
      SELECT id, org_id AS "organizationId" FROM ${sql.unsafe(adapter.configTable)}
      WHERE status IN ('active', 'error')
        AND (${cursor}::text IS NULL OR id > ${cursor})
      ORDER BY id
      LIMIT ${pageSize}
    `;
    for (const row of page) {
      await addJobInTx(
        sql,
        adapter.configJobName,
        { organizationId: row.organizationId, configId: row.id },
        { singletonKey: `${adapter.singletonPrefix}${row.id}` },
      );
      enqueued += 1;
    }
    if (page.length < pageSize) break;
    const last: SyncScanRow | undefined = page.at(-1);
    if (last === undefined) break;
    cursor = last.id;
  }
  return enqueued;
}

interface SyncScanRow {
  id: string;
  organizationId: string;
}

/**
 * One per-config sync job: claim, reconcile, stamp the outcome. The claim is
 * kept fresh by a heartbeat for as long as the run is alive, so the stale
 * window below only ever re-admits a run whose worker actually died.
 */
export async function runSyncConfigJobWith(
  sql: Sql,
  adapter: SyncProviderAdapter,
  payload: { organizationId: string; configId: string },
  opts: { heartbeatMs?: number } = {},
): Promise<void> {
  // Claim fence: a second job for the same config no-ops while a fresh run
  // is in flight; a stale 'running' stamp (crashed worker) is reclaimable.
  const claimed = await sql<{ id: string }[]>`
    UPDATE ${sql.unsafe(adapter.configTable)} SET
      last_sync_status = 'running', updated_at_ms = ${Date.now()}
    WHERE id = ${payload.configId} AND org_id = ${payload.organizationId}
      AND status IN ('active', 'error')
      AND (last_sync_status IS DISTINCT FROM 'running'
           OR updated_at_ms < ${Date.now() - SYNC_CLAIM_STALE_MS})
    RETURNING id
  `;
  if (claimed.length === 0) return;
  const config = await getSyncConfigRow(
    sql,
    adapter.configTable,
    payload.configId,
  );
  if (!config) return;

  // Heartbeat: the fence treats a 'running' stamp older than
  // SYNC_CLAIM_STALE_MS as a crashed worker. Nothing used to refresh the
  // stamp during a run, so a folder sync that merely took longer than that
  // (large folder, slow tenant) was re-claimed by the next cron tick and ran
  // twice concurrently — racing createDocument into duplicate documents.
  const heartbeat = setInterval(() => {
    renewSyncClaim(sql, adapter.configTable, payload).catch(
      (error: unknown) => {
        console.warn(
          `[${adapter.displayName} sync] claim heartbeat failed for config ${payload.configId}:`,
          error instanceof Error ? error.message : error,
        );
      },
    );
  }, opts.heartbeatMs ?? SYNC_CLAIM_HEARTBEAT_MS);
  heartbeat.unref();

  try {
    const result = await syncOneConfigWith(sql, adapter, config);
    if (result.sourceDeleted === true) {
      await updateSyncConfigStatusRow(sql, adapter.configTable, {
        configId: config.id,
        organizationId: config.organizationId,
        status: 'inactive',
        lastSyncAt: Date.now(),
        lastSyncStatus: 'source-deleted',
        errorMessage: null,
      });
      return;
    }
    await updateSyncConfigStatusRow(sql, adapter.configTable, {
      configId: config.id,
      organizationId: config.organizationId,
      status: 'active',
      lastSyncAt: Date.now(),
      lastSyncStatus:
        result.errorsCount > 0
          ? `partial: ${result.errorsCount} file(s) failed`
          : 'success',
      errorMessage: null,
    });
  } catch (error) {
    await updateSyncConfigStatusRow(sql, adapter.configTable, {
      configId: config.id,
      organizationId: config.organizationId,
      status: 'error',
      lastSyncAt: Date.now(),
      lastSyncStatus: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearInterval(heartbeat);
  }
}

// ---------------------------------------------------- the OneDrive binding

const ONEDRIVE_CONFIG_TABLE = 'app.onedrive_sync_configs';

export const ONEDRIVE_SYNC_ADAPTER: SyncProviderAdapter = {
  displayName: 'OneDrive',
  sourceProvider: 'onedrive',
  configTable: ONEDRIVE_CONFIG_TABLE,
  configJobName: 'onedrive.sync_config',
  singletonPrefix: 'onedrive-sync-',
  metadataItemIdKeys: ['oneDriveItemId', 'oneDriveId'],
  resolveToken: (sql, args) => resolveGraphTokenForUser(sql, args),
  listFolderContents: (args) => listFolderContents(args),
  getFileMetadata: (itemId, token, siteId, driveId) =>
    getFileMetadata(itemId, token, siteId, driveId),
  buildDownloadUrl: (args) =>
    args.siteId && args.driveId
      ? `https://graph.microsoft.com/v1.0/sites/${args.siteId}/drives/${args.driveId}/items/${args.itemId}/content`
      : `https://graph.microsoft.com/v1.0/me/drive/items/${args.itemId}/content`,
  runImport: (sql, args) =>
    importFiles(
      args,
      createSyncImportDeps(sql, ONEDRIVE_SYNC_ADAPTER, args.organizationId),
    ),
};

/** The pg dependency object for the OneDrive import route. */
export function createPgImportDeps(
  sql: Sql,
  organizationId: string,
): PgSyncImportDeps {
  return createSyncImportDeps(sql, ONEDRIVE_SYNC_ADAPTER, organizationId);
}

export async function cancelSyncConfig(
  db: Sql | TransactionSql,
  organizationId: string,
  configId: string,
): Promise<void> {
  await cancelSyncConfigRow(
    db,
    ONEDRIVE_CONFIG_TABLE,
    organizationId,
    configId,
  );
}

export async function runOneDriveSyncScan(sql: Sql): Promise<number> {
  return runSyncScanWith(sql, ONEDRIVE_SYNC_ADAPTER);
}

export async function runOneDriveSyncConfigJob(
  sql: Sql,
  payload: { organizationId: string; configId: string },
): Promise<void> {
  await runSyncConfigJobWith(sql, ONEDRIVE_SYNC_ADAPTER, payload);
}
