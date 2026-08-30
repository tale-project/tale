import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';

import {
  atomicWrite,
  atomicWriteSecret,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  removeDirSafe,
  removeFileSafe,
} from '../../../convex/lib/file_io.ts';
import { checkProviderHostPolicy } from '../../../convex/lib/http/host_policy.ts';
import {
  encryptJsonWithSops,
  hasSopsKey,
  invalidateSecretsCache,
} from '../../../convex/lib/sops.ts';
import { parseBlobRef } from '../../../convex/lib/storage/blob_ref.ts';
import {
  buildS3ObjectStore,
  invalidateOrgObjectStore,
  probeS3ObjectStore,
  s3GetObjectBytes,
  s3HeadObject,
  s3PutObject,
  type S3ObjectStore,
} from '../../../convex/lib/storage/object_store.ts';
import {
  parseObjectStorageConnectionJson,
  readObjectStorageSecrets,
  readOrgObjectStorageConnection,
  resolveObjectStorageConnectionFilePath,
  resolveObjectStorageConnectionSecretsFilePath,
  resolveObjectStorageHistoryDir,
  serializeObjectStorageConnectionJson,
  serializeObjectStorageSecretsJson,
  type ObjectStorageConnectionFile,
} from '../../../convex/object_storage/file_utils.ts';
import { zodErrorMessage } from '../../../lib/shared/schemas/format-error.ts';
import { objectStorageConnectionFileSchema } from '../../../lib/shared/schemas/object_storage.ts';
import { toJson } from '../../db/sql.ts';
import { clearObjectStoreCache } from '../../lib/object-store.ts';

/**
 * Per-org BYO object-storage admin (the 0.4 `object_storage` domain, the
 * file half re-orchestrated over the SAME `file_utils` + `object_store`
 * helpers) + the 0.5 BLOB BACKFILL: 0.4 moved Convex `_storage` blobs into
 * the bucket; in 0.5 every blob is already an S3 key, so the twin copies an
 * org's objects from the deployment-default store into its own bucket —
 * keys (and therefore refs) stay identical, reads flip over per object as
 * the copy lands.
 */
export class ObjectStorageError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;
  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'ObjectStorageError';
    this.code = code;
    this.status = status;
  }
}

export interface ObjectStorageConnectionView {
  configured: boolean;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  bucket?: string;
  prefix?: string;
  hasCredentials?: boolean;
}

const MAX_HISTORY_ENTRIES = 20;

function gateEndpoint(endpoint: string | undefined): void {
  if (endpoint) {
    checkProviderHostPolicy(endpoint);
  }
}

async function snapshotHistory(
  orgSlug: string,
  currentContent: string,
): Promise<void> {
  const historyDir = resolveObjectStorageHistoryDir(orgSlug);
  await mkdir(historyDir, { recursive: true });
  await atomicWrite(
    path.join(historyDir, `${generateHistoryTimestamp()}.json`),
    currentContent,
  );
  await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
}

async function credentialsConfigured(orgSlug: string): Promise<boolean> {
  const raw = await readFileSafe(
    resolveObjectStorageConnectionSecretsFilePath(orgSlug),
  );
  return raw !== null && raw.trim().length > 0;
}

export async function readConnectionView(
  orgSlug: string,
): Promise<ObjectStorageConnectionView> {
  const configRaw = await readFileSafe(
    resolveObjectStorageConnectionFilePath(orgSlug),
  );
  if (configRaw === null) {
    return { configured: false };
  }
  const connection = parseObjectStorageConnectionJson(configRaw);
  return {
    configured: true,
    region: connection.region,
    ...(connection.endpoint !== undefined
      ? { endpoint: connection.endpoint }
      : {}),
    forcePathStyle: connection.forcePathStyle,
    bucket: connection.bucket,
    ...(connection.prefix !== undefined ? { prefix: connection.prefix } : {}),
    hasCredentials: await credentialsConfigured(orgSlug),
  };
}

function parseConnectionInput(input: unknown): ObjectStorageConnectionFile {
  const parsed = objectStorageConnectionFileSchema.safeParse(input);
  if (!parsed.success) {
    throw new ObjectStorageError(
      'INVALID_CONNECTION',
      zodErrorMessage('Invalid object-storage connection', parsed.error),
    );
  }
  return parsed.data;
}

export async function writeConnection(
  orgSlug: string,
  args: {
    connection: unknown;
    accessKeyId?: string;
    secretAccessKey?: string;
  },
): Promise<void> {
  const connection = parseConnectionInput(args.connection);
  gateEndpoint(connection.endpoint);

  const hasKey = !!args.accessKeyId && args.accessKeyId.length > 0;
  const hasSecret = !!args.secretAccessKey && args.secretAccessKey.length > 0;
  if (hasKey !== hasSecret) {
    throw new ObjectStorageError(
      'INVALID_CREDENTIALS',
      'Both accessKeyId and secretAccessKey must be provided together.',
    );
  }
  if (!hasKey && !(await credentialsConfigured(orgSlug))) {
    throw new ObjectStorageError(
      'CREDENTIALS_REQUIRED',
      'accessKeyId and secretAccessKey are required to configure object storage.',
    );
  }

  const filePath = resolveObjectStorageConnectionFilePath(orgSlug);
  const serialized = serializeObjectStorageConnectionJson(connection);
  const currentContent = await readFileSafe(filePath);
  if (currentContent) {
    await snapshotHistory(orgSlug, currentContent);
  }
  await atomicWrite(filePath, serialized);

  if (hasKey && hasSecret && args.accessKeyId && args.secretAccessKey) {
    const secretsPath = resolveObjectStorageConnectionSecretsFilePath(orgSlug);
    const plaintext = serializeObjectStorageSecretsJson({
      accessKeyId: args.accessKeyId,
      secretAccessKey: args.secretAccessKey,
    });
    const content = hasSopsKey() ? encryptJsonWithSops(plaintext) : plaintext;
    await atomicWriteSecret(secretsPath, content);
    invalidateSecretsCache(secretsPath);
  }

  invalidateOrgObjectStore(orgSlug);
  clearObjectStoreCache();
}

export async function deleteConnection(orgSlug: string): Promise<void> {
  const secretsPath = resolveObjectStorageConnectionSecretsFilePath(orgSlug);
  await removeFileSafe(resolveObjectStorageConnectionFilePath(orgSlug));
  await removeFileSafe(secretsPath);
  await removeDirSafe(resolveObjectStorageHistoryDir(orgSlug));
  invalidateSecretsCache(secretsPath);
  invalidateOrgObjectStore(orgSlug);
  clearObjectStoreCache();
}

export interface ObjectStorageProbeResult {
  ok: boolean;
  error?: string;
}

/** PUT→GET→DELETE round-trip on the candidate bucket. Never throws. */
export async function probeConnection(args: {
  connection: unknown;
  accessKeyId?: string;
  secretAccessKey?: string;
  orgSlug?: string;
}): Promise<ObjectStorageProbeResult> {
  try {
    const connection = parseConnectionInput(args.connection);
    gateEndpoint(connection.endpoint);
    const credentials =
      args.accessKeyId && args.secretAccessKey
        ? {
            accessKeyId: args.accessKeyId,
            secretAccessKey: args.secretAccessKey,
          }
        : args.orgSlug
          ? await readObjectStorageSecrets(args.orgSlug)
          : undefined;
    if (!credentials) {
      return {
        ok: false,
        error: 'Enter the access key ID and the secret access key to test.',
      };
    }
    const store = buildS3ObjectStore(connection, credentials);
    await probeS3ObjectStore(store);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------- backfill

export interface BackfillStatusView {
  runId: string;
  status: 'running' | 'completed' | 'failed';
  dryRun: boolean;
  phase: 'documents' | 'fileMetadata' | 'done';
  continuation: number;
  rowsScanned: number;
  migrated: number;
  skipped: number;
  failed: number;
  bytesMigrated: number;
  candidates: number;
  candidateBytes: number;
  sample: Array<{ ref: string; table: string; name?: string; size?: number }>;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  lastError?: string;
}

interface BackfillRunRow {
  id: string;
  status: string;
  dryRun: boolean;
  phase: string;
  rowsScanned: number;
  migrated: number;
  skipped: number;
  failed: number;
  bytesMigrated: number;
  candidates: number;
  candidateBytes: number;
  sample: BackfillStatusView['sample'];
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  lastError: string | null;
}

const RUN_COLUMNS = `
  id, status, dry_run AS "dryRun", phase,
  rows_scanned AS "rowsScanned", migrated, skipped, failed,
  bytes_migrated::float8 AS "bytesMigrated", candidates,
  candidate_bytes::float8 AS "candidateBytes", sample,
  started_at_ms::float8 AS "startedAt", updated_at_ms::float8 AS "updatedAt",
  finished_at_ms::float8 AS "finishedAt", last_error AS "lastError"
`;

export async function getBackfillStatus(
  sql: Sql,
  organizationId: string,
): Promise<BackfillStatusView | null> {
  const rows = await sql<BackfillRunRow[]>`
    SELECT ${sql.unsafe(RUN_COLUMNS)} FROM app.object_storage_backfill_runs
    WHERE org_id = ${organizationId}
    ORDER BY started_at_ms DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    runId: row.id,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CHECK-constrained columns
    status: row.status as BackfillStatusView['status'],
    dryRun: row.dryRun,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CHECK-constrained columns
    phase: row.phase as BackfillStatusView['phase'],
    continuation: 0,
    rowsScanned: row.rowsScanned,
    migrated: row.migrated,
    skipped: row.skipped,
    failed: row.failed,
    bytesMigrated: row.bytesMigrated,
    candidates: row.candidates,
    candidateBytes: row.candidateBytes,
    sample: row.sample,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    ...(row.finishedAt !== null ? { finishedAt: row.finishedAt } : {}),
    ...(row.lastError !== null ? { lastError: row.lastError } : {}),
  };
}

export async function createBackfillRun(
  sql: Sql,
  args: {
    organizationId: string;
    orgSlug: string;
    dryRun: boolean;
    triggeredBy: string;
  },
): Promise<string> {
  const now = Date.now();
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.object_storage_backfill_runs (
        org_id, org_slug, dry_run, status, phase, triggered_by,
        started_at_ms, updated_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.orgSlug}, ${args.dryRun}, 'running',
        'documents', ${args.triggeredBy}, ${now}, ${now}
      ) RETURNING id
    `;
    return rows[0]?.id ?? '';
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23505'
    ) {
      throw new ObjectStorageError(
        'BACKFILL_ALREADY_RUNNING',
        'A blob backfill is already running for this organization.',
        409,
      );
    }
    throw error;
  }
}

const BATCH = 100;
const MAX_SAMPLE = 25;

interface BackfillCounters {
  rowsScanned: number;
  migrated: number;
  skipped: number;
  failed: number;
  bytesMigrated: number;
  candidates: number;
  candidateBytes: number;
  sample: BackfillStatusView['sample'];
}

async function handleRef(
  ref: string,
  table: string,
  name: string | undefined,
  source: S3ObjectStore | null,
  target: S3ObjectStore | null,
  dryRun: boolean,
  counters: BackfillCounters,
): Promise<void> {
  let key: string;
  try {
    const parsed = parseBlobRef(ref);
    if (parsed.backend !== 's3') {
      counters.skipped += 1;
      return;
    }
    key = parsed.key;
  } catch {
    counters.skipped += 1;
    return;
  }
  try {
    if (target !== null && (await s3HeadObject(target, key)) !== null) {
      counters.skipped += 1;
      return;
    }
    const sourceHead = source === null ? null : await s3HeadObject(source, key);
    if (sourceHead === null) {
      counters.skipped += 1;
      return;
    }
    counters.candidates += 1;
    counters.candidateBytes += sourceHead.size;
    if (counters.sample.length < MAX_SAMPLE) {
      counters.sample.push({
        ref,
        table,
        ...(name !== undefined ? { name } : {}),
        size: sourceHead.size,
      });
    }
    if (dryRun || target === null || source === null) return;
    const bytes = await s3GetObjectBytes(source, key);
    await s3PutObject(target, key, bytes, 'application/octet-stream');
    counters.migrated += 1;
    counters.bytesMigrated += bytes.byteLength;
  } catch (error) {
    counters.failed += 1;
    console.warn(`[object-storage] backfill failed for ${ref}:`, error);
  }
}

/**
 * The backfill engine — one run to completion (batched walks with progress
 * stamped per batch). Documents first (file_ref + history_files), then
 * file_metadata; refs stay identical so nothing is rewritten.
 */
export async function runBackfill(
  sql: Sql,
  args: { runId: string; organizationId: string },
): Promise<void> {
  const runs = await sql<{ orgSlug: string; dryRun: boolean }[]>`
    SELECT org_slug AS "orgSlug", dry_run AS "dryRun"
    FROM app.object_storage_backfill_runs
    WHERE id = ${args.runId} AND status = 'running'
  `;
  const run = runs[0];
  if (!run) return;

  const counters: BackfillCounters = {
    rowsScanned: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    bytesMigrated: 0,
    candidates: 0,
    candidateBytes: 0,
    sample: [],
  };

  const stamp = async (
    phase: 'documents' | 'fileMetadata' | 'done',
  ): Promise<void> => {
    await sql`
      UPDATE app.object_storage_backfill_runs SET
        phase = ${phase},
        rows_scanned = ${counters.rowsScanned},
        migrated = ${counters.migrated}, skipped = ${counters.skipped},
        failed = ${counters.failed},
        bytes_migrated = ${counters.bytesMigrated},
        candidates = ${counters.candidates},
        candidate_bytes = ${counters.candidateBytes},
        sample = ${sql.json(toJson(counters.sample))},
        updated_at_ms = ${Date.now()}
      WHERE id = ${args.runId}
    `;
  };

  try {
    const defaultConn = await readOrgObjectStorageConnection('default');
    const source =
      defaultConn === null
        ? null
        : buildS3ObjectStore(defaultConn.connection, defaultConn.secrets);
    const ownConn = await readOrgObjectStorageConnection(run.orgSlug);
    const target =
      ownConn === null
        ? null
        : buildS3ObjectStore(ownConn.connection, ownConn.secrets);
    if (!run.dryRun && target === null) {
      throw new ObjectStorageError(
        'NOT_CONFIGURED',
        'Configure the object-storage connection before moving existing blobs into it.',
      );
    }

    // Phase 1: documents (file_ref + every historyFiles entry).
    let cursor = '';
    for (;;) {
      const docs = await sql<
        { id: string; title: string; fileRef: string; historyFiles: string[] }[]
      >`
        SELECT id, title, file_ref AS "fileRef",
               history_files AS "historyFiles"
        FROM app.documents
        WHERE org_id = ${args.organizationId} AND id > ${cursor}
        ORDER BY id ASC
        LIMIT ${BATCH}
      `;
      if (docs.length === 0) break;
      for (const doc of docs) {
        counters.rowsScanned += 1;
        await handleRef(
          doc.fileRef,
          'documents',
          doc.title,
          source,
          target,
          run.dryRun,
          counters,
        );
        for (const historyRef of doc.historyFiles) {
          await handleRef(
            historyRef,
            'documents.history',
            doc.title,
            source,
            target,
            run.dryRun,
            counters,
          );
        }
      }
      cursor = docs[docs.length - 1]?.id ?? cursor;
      await stamp('documents');
    }

    // Phase 2: loose file_metadata rows.
    await stamp('fileMetadata');
    cursor = '';
    for (;;) {
      const files = await sql<
        { id: string; fileName: string | null; storageRef: string }[]
      >`
        SELECT id, file_name AS "fileName", storage_ref AS "storageRef"
        FROM app.file_metadata
        WHERE org_id = ${args.organizationId} AND id > ${cursor}
        ORDER BY id ASC
        LIMIT ${BATCH}
      `;
      if (files.length === 0) break;
      for (const file of files) {
        counters.rowsScanned += 1;
        await handleRef(
          file.storageRef,
          'fileMetadata',
          file.fileName ?? undefined,
          source,
          target,
          run.dryRun,
          counters,
        );
      }
      cursor = files[files.length - 1]?.id ?? cursor;
      await stamp('fileMetadata');
    }

    await stamp('done');
    await sql`
      UPDATE app.object_storage_backfill_runs SET
        status = 'completed', finished_at_ms = ${Date.now()},
        updated_at_ms = ${Date.now()}
      WHERE id = ${args.runId}
    `;
  } catch (error) {
    console.error(`[object-storage] backfill run ${args.runId} failed:`, error);
    await sql`
      UPDATE app.object_storage_backfill_runs SET
        status = 'failed', finished_at_ms = ${Date.now()},
        updated_at_ms = ${Date.now()},
        last_error = ${error instanceof Error ? error.message : String(error)}
      WHERE id = ${args.runId}
    `;
  }
}
