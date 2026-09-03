import type { Sql, TransactionSql } from 'postgres';

import {
  isRagIndexableFile,
  resolveFileType,
} from '../../../lib/shared/file-types.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import {
  pickMicrosoftAccount,
  type MicrosoftAccountCandidate,
} from '../../core/accounts/microsoft_account.ts';
import { extractExtension } from '../../core/documents/extract_extension.ts';
import { extractTenantId } from '../../core/enterprise_sso/entra_id/constants.ts';
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
import { refreshToken as refreshMicrosoftLoginToken } from '../../core/onedrive/refresh_token.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import {
  isCloudImportProvider,
  resolveCloudAccessToken,
} from '../cloud_import/service.ts';
import { putOrgBlobBytes } from '../files/service.ts';
import {
  buildHubFolderPath,
  findHubFolderByPath,
  getOrCreateHubFolderPath,
  reapEmptyAncestorFolders,
} from '../folders/paths.ts';
import { markRagQueued } from '../knowledge/service.ts';
import { assertNotHeld, LegalHoldError } from '../legal_holds/service.ts';
import { purgeDocument } from '../retention/service.ts';
import { readSsoSecrets, resolveSignInConfig } from '../sso/config.ts';

/**
 * OneDrive Knowledge sync — the 0.5 twin of `convex/onedrive`: the
 * browse/import surface reuses the PURE 0.4 pipeline (`importFiles` with a
 * pg dependency object, the Graph fetch modules verbatim), and the ongoing
 * sync runs as a native pg-boss engine (`onedrive.sync_scan` cron →
 * one `onedrive.sync_config` job per active config) — the 0.4 automation
 * pack that used to drive it was retired with the automation rebuild.
 *
 * Tokens resolve cloud-import grant FIRST (the explicit Documents grant from
 * inc 64), then the Better Auth Microsoft login account (legacy / SSO
 * shortcut) — the 0.4 `withMicrosoftToken` order. Agents never reach these.
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
    data?: { hash?: string; mimeType?: string; size?: number };
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

export async function listActiveSyncConfigRows(
  db: Sql | TransactionSql,
  table: string,
  organizationId: string,
): Promise<SyncConfigRow[]> {
  return db<SyncConfigRow[]>`
    SELECT ${db.unsafe(CONFIG_COLUMNS)} FROM ${db.unsafe(table)}
    WHERE org_id = ${organizationId} AND status = 'active'
    ORDER BY created_at_ms ASC
  `;
}

/**
 * Create-or-reactivate the sync config for a selected item (the 0.4
 * `create*SyncConfig`): one config per (org, source item); an
 * inactive/error row is reactivated in place with the fresh selection.
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
      updated_at_ms = ${now}
    RETURNING id
  `;
  return rows[0]?.id ?? null;
}

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
      status = 'inactive', updated_at_ms = ${Date.now()}
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
        status = 'inactive', updated_at_ms = ${Date.now()}
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
        status = 'inactive', updated_at_ms = ${Date.now()}
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

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

interface LoginAccountRow extends MicrosoftAccountCandidate {
  id: string;
  providerId: string;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAtDate: Date | null;
  refreshTokenExpiresAtDate: Date | null;
  updatedAt: number;
}

/**
 * Client credentials for refreshing a login-account Graph token (the 0.4
 * `resolveMicrosoftRefreshCredentials`): an `entra-id` row was issued by the
 * org's own SSO app registration — use that connection's client id/secret
 * and issuer tenant; the deployment env app is the fallback either way.
 */
async function resolveRefreshCredentials(
  sql: Sql,
  providerId: string,
): Promise<{
  tenantId: string;
  clientId: string;
  clientSecret: string;
} | null> {
  if (providerId === 'entra-id') {
    try {
      const config = await resolveSignInConfig(sql, undefined);
      if (
        config !== null &&
        config !== 'ambiguous' &&
        config.providerId === 'entra-id' &&
        typeof config.issuer === 'string' &&
        typeof config.organizationId === 'string'
      ) {
        const tenantId = extractTenantId(config.issuer);
        const secrets = await readSsoSecrets(sql, config.organizationId);
        if (secrets.clientId && secrets.clientSecret) {
          return {
            tenantId,
            clientId: secrets.clientId,
            clientSecret: secrets.clientSecret,
          };
        }
      }
    } catch (error) {
      console.warn(
        '[onedrive] SSO connection credentials unavailable, falling back to env:',
        error instanceof Error ? error.message : error,
      );
    }
  }
  const tenantId = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
  const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

/** The Better Auth Microsoft login-account lane (legacy / SSO shortcut). */
async function resolveLoginAccountToken(
  sql: Sql,
  userId: string,
): Promise<string | null> {
  const rows = await sql<
    {
      id: string;
      providerId: string;
      accessToken: string | null;
      refreshToken: string | null;
      accessTokenExpiresAt: Date | null;
      refreshTokenExpiresAt: Date | null;
      updatedAt: Date | null;
    }[]
  >`
    SELECT "id", "providerId" AS "providerId", "accessToken",
           "refreshToken", "accessTokenExpiresAt", "refreshTokenExpiresAt",
           "updatedAt"
    FROM "account"
    WHERE "userId" = ${userId}
  `;
  const candidates: LoginAccountRow[] = rows.map((row) => ({
    id: row.id,
    providerId: row.providerId,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    accessTokenExpiresAtDate: row.accessTokenExpiresAt,
    refreshTokenExpiresAtDate: row.refreshTokenExpiresAt,
    updatedAt: row.updatedAt?.getTime() ?? 0,
  }));
  const account = pickMicrosoftAccount(candidates);
  if (!account) return null;

  const now = Date.now();
  const accessExpiresAt = account.accessTokenExpiresAtDate?.getTime();
  const accessLive =
    typeof account.accessToken === 'string' &&
    account.accessToken !== '' &&
    (accessExpiresAt === undefined ||
      accessExpiresAt > now + TOKEN_EXPIRY_BUFFER_MS);
  if (accessLive) return account.accessToken;

  const refreshUsable =
    typeof account.refreshToken === 'string' &&
    account.refreshToken !== '' &&
    (account.refreshTokenExpiresAtDate === null ||
      account.refreshTokenExpiresAtDate.getTime() > now);
  if (!refreshUsable || account.refreshToken === null) return null;

  const credentials = await resolveRefreshCredentials(sql, account.providerId);
  if (!credentials) {
    console.warn('[onedrive] no OAuth credentials to refresh a login token');
    return null;
  }
  const refreshed = await refreshMicrosoftLoginToken({
    refreshToken: account.refreshToken,
    ...credentials,
  });
  if (!refreshed.success || !refreshed.accessToken || !refreshed.expiresAt) {
    return null;
  }
  await sql`
    UPDATE "account" SET
      "accessToken" = ${refreshed.accessToken},
      "accessTokenExpiresAt" = ${new Date(refreshed.expiresAt)},
      "refreshToken" = ${refreshed.newRefreshToken ?? account.refreshToken},
      "refreshTokenExpiresAt" = ${
        refreshed.refreshTokenExpiresAt !== undefined
          ? new Date(refreshed.refreshTokenExpiresAt)
          : account.refreshTokenExpiresAtDate
      },
      "updatedAt" = ${new Date()}
    WHERE "id" = ${account.id}
  `;
  return refreshed.accessToken;
}

/**
 * Resolve a Microsoft Graph token for Knowledge OneDrive/SharePoint:
 * per-user cloud-import grant first, login account second (the 0.4
 * `withMicrosoftToken` order). Agents must not call this.
 */
export async function resolveGraphTokenForUser(
  sql: Sql,
  args: { organizationId: string; userId: string },
): Promise<GraphTokenResult> {
  if (isCloudImportProvider('onedrive')) {
    const cloud = await resolveCloudAccessToken(sql, {
      organizationId: args.organizationId,
      userId: args.userId,
      provider: 'onedrive',
    });
    if (cloud.success) return { success: true, token: cloud.accessToken };
  }
  const loginToken = await resolveLoginAccountToken(sql, args.userId);
  if (loginToken !== null) return { success: true, token: loginToken };
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
    const download = await fetch(url, {
      headers: { Authorization: `Bearer ${args.token}` },
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
    // Buffered on purpose: the pg worker has no 64 MB isolate cap (the 0.4
    // streaming constraint), and `putOrgBlobBytes` enforces the same size
    // ceiling uploads get.
    const bytes = new Uint8Array(await download.arrayBuffer());
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
    data?: { hash?: string; mimeType?: string; size?: number };
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
  }) => Promise<{ _id: never; contentHash?: string } | null>;
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
      const rows = await sql<{ id: string; contentHash: string | null }[]>`
        SELECT id, content_hash AS "contentHash" FROM app.documents
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
        RETURNING id
      `;
      const id = inserted[0]?.id;
      if (!id) throw new Error('Document insert failed');
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg ids stand in for the reused pipeline's Convex Id<'documents'> brand
      return id as never;
    },
    updateDocument: async (updateArgs) => {
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
      const hashChanged =
        updateArgs.contentHash !== undefined &&
        doc.contentHash !== updateArgs.contentHash;
      // Hash change + new blob → the old blob joins historyFiles (the 0.4
      // contract: an addressable, erasable history rather than a hard drop).
      let historyFiles = doc.historyFiles;
      const blobReplaced =
        hashChanged && doc.fileRef !== null && doc.fileRef !== newFileRef;
      if (blobReplaced && doc.fileRef !== null) {
        if (!historyFiles.includes(doc.fileRef)) {
          historyFiles = [...historyFiles, doc.fileRef];
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

      // The replaced blob's corpus chunks are keyed by the OLD ref — release
      // them through the shared refcounted seam (the 0.4
      // `reindexDocumentInRag` old-entry purge, made durable: a swallowed
      // failure used to strand the stale rows forever). The ref sits in
      // `history_files` now, so the job de-indexes the corpus and keeps the
      // bytes; the new blob indexes via the schedule dep below.
      if (blobReplaced && doc.fileRef !== null) {
        const oldRef = doc.fileRef;
        await sql.begin(async (tx) => {
          await addJobInTx(tx, 'knowledge.release_refs', {
            organizationId,
            refs: [oldRef],
          });
        });
      }
    },
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
  /** Single-file only: the source is gone (404) — mirror removed, config
   *  should deactivate. */
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

  const existingDocs = await listProviderDocumentRefs(
    sql,
    adapter,
    args.organizationId,
  );
  const toPrune = selectDocumentsToPrune(
    args.configId,
    new Set(args.files.map((f) => f.id)),
    existingDocs,
  );
  const refById = new Map(existingDocs.map((doc) => [doc.documentId, doc]));
  const refsToPrune = toPrune
    .map((documentId) => refById.get(documentId))
    .filter((ref): ref is SyncedDocumentRef => ref !== undefined);

  // Resolve the sync-target root so each prune reaps the now-empty
  // subfolders it leaves behind, stopping at — never deleting — the root.
  const rootSegments = (args.itemPath || args.itemName)
    .split('/')
    .filter((s) => s.trim().length > 0);
  const cleanupAncestorsUpTo =
    refsToPrune.length > 0 && rootSegments.length > 0
      ? ((await findHubFolderByPath(sql, args.organizationId, rootSegments)) ??
        undefined)
      : undefined;

  const deleted = await pruneSyncedDocuments(sql, {
    organizationId: args.organizationId,
    refs: refsToPrune,
    ...(cleanupAncestorsUpTo !== undefined ? { cleanupAncestorsUpTo } : {}),
  });

  return {
    created: importResult.successCount,
    skipped: importResult.skippedCount,
    deleted,
    errorsCount: importResult.results.filter((r) => r.status === 'error')
      .length,
  };
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
      `No valid ${adapter.displayName} token for the config owner`,
    );
  }

  if (config.itemType === 'folder') {
    const listed = await adapter.listFolderContents({
      itemId: config.itemId,
      token: token.token,
      recursive: true,
    });
    if (!listed.success) {
      throw new Error(listed.error ?? 'Failed to list folder contents');
    }
    return reconcileFolderWith(sql, adapter, {
      organizationId: config.organizationId,
      configId: config.id,
      itemId: config.itemId,
      itemName: config.itemName,
      ...(config.itemPath !== null ? { itemPath: config.itemPath } : {}),
      userId: config.userId,
      ...(config.teamId !== null ? { teamId: config.teamId } : {}),
      files: listed.files ?? [],
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
const SYNC_CLAIM_STALE_MS = 30 * 60 * 1000;

/**
 * Cron scan: one per-config job per syncable config. `error` configs are
 * retried too (a transient vendor failure must not silently end a sync
 * forever — the 0.4 active-only listing predates this engine); `inactive`
 * is the only terminal state (cancel, source deleted, folder removed).
 */
export async function runSyncScanWith(
  sql: Sql,
  adapter: SyncProviderAdapter,
): Promise<number> {
  const rows = await sql<{ id: string; organizationId: string }[]>`
    SELECT id, org_id AS "organizationId" FROM ${sql.unsafe(adapter.configTable)}
    WHERE status IN ('active', 'error')
    ORDER BY created_at_ms ASC
    LIMIT 1000
  `;
  for (const row of rows) {
    await addJobInTx(
      sql,
      adapter.configJobName,
      { organizationId: row.organizationId, configId: row.id },
      { singletonKey: `${adapter.singletonPrefix}${row.id}` },
    );
  }
  return rows.length;
}

/** One per-config sync job: claim, reconcile, stamp the outcome. */
export async function runSyncConfigJobWith(
  sql: Sql,
  adapter: SyncProviderAdapter,
  payload: { organizationId: string; configId: string },
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
