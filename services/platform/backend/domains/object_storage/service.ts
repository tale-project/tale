import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';

import { checkProviderHostPolicy } from '../../../lib/net/host-policy.ts';
import { zodErrorMessage } from '../../../lib/shared/schemas/format-error.ts';
import { objectStorageConnectionFileSchema } from '../../../lib/shared/schemas/object_storage.ts';
import {
  atomicWrite,
  atomicWriteSecret,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  removeDirSafe,
  removeFileSafe,
} from '../../core/lib/file_io.ts';
import {
  encryptJsonWithSops,
  hasSopsKey,
  invalidateSecretsCache,
} from '../../core/lib/sops.ts';
import { parseBlobRef } from '../../core/lib/storage/blob_ref.ts';
import {
  buildS3ObjectStore,
  invalidateOrgObjectStore,
  probeS3ObjectStore,
  s3DeleteObject,
  s3GetObject,
  s3HeadObject,
  s3PutObject,
  sameObjectStore,
  type S3ObjectStore,
} from '../../core/lib/storage/object_store.ts';
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
} from '../../core/object_storage/file_utils.ts';
import { toJson } from '../../db/sql.ts';
import { clearObjectStoreCache } from '../../lib/object-store.ts';

/**
 * Per-org BYO object-storage admin (the 0.4 `object_storage` domain, the
 * file half re-orchestrated over the SAME `file_utils` + `object_store`
 * helpers) + the 0.5 BLOB BACKFILL: 0.4 moved Convex `_storage` blobs into
 * the bucket; in 0.5 every blob is already an S3 key, so the twin MOVES an
 * org's objects from the deployment-default store into its own bucket —
 * each copy is written with its stored content type, verified against the
 * source's size, and only then is the source deleted. Keys (and therefore
 * refs) stay identical: reads locate a blob in whichever store holds it
 * (`locateOrgObjectStore`) before, during and after the move.
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
    const content = hasSopsKey()
      ? await encryptJsonWithSops(plaintext)
      : plaintext;
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

/** The walk order — every org-owned table that holds `s3:` blob refs of
 * its own (the CHECK in migrations 0053 + 0078 mirrors this list). */
export type BackfillPhase =
  | 'documents'
  | 'fileMetadata'
  | 'ttsChunks'
  | 'videoLinks'
  | 'done';

export interface BackfillStatusView {
  runId: string;
  status: 'running' | 'completed' | 'failed';
  dryRun: boolean;
  phase: BackfillPhase;
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

/**
 * A progress stamp at least this often while a batch is still copying, so
 * the watchdog's stale window (`BACKFILL_STALE_MS`) measures real liveness
 * even through a batch of large blobs — and so a fenced run notices soon.
 */
const STAMP_INTERVAL_MS = 60_000;

/**
 * A progress stamp matched no `running` row: the watchdog (or an operator)
 * already flipped this run to a terminal state — a fresh run may be copying
 * — so this engine must stop and leave the terminal row exactly as it is.
 */
export class BackfillFencedError extends Error {
  constructor(runId: string) {
    super(`backfill run ${runId} is no longer running; stopping`);
    this.name = 'BackfillFencedError';
  }
}

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

/**
 * Move ONE blob: HEAD source → HEAD target → GET source → PUT target with
 * the source's content type → HEAD target to verify the landed size →
 * DELETE source. A blob already gone from the source has nothing left to
 * move; a target copy that already matches the source finishes the move
 * (deletes the source) — the resume path after a run that died between
 * its verified PUT and its source delete; a target copy of the WRONG size
 * (an unverified copy from an earlier engine) is re-copied over. A copy
 * that lands short is deleted again before counting as failed, so the
 * next run never mistakes it for the real one.
 */
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
    const sourceHead = source === null ? null : await s3HeadObject(source, key);
    if (sourceHead === null) {
      counters.skipped += 1;
      return;
    }
    const targetHead = target === null ? null : await s3HeadObject(target, key);
    if (targetHead !== null && targetHead.size === sourceHead.size) {
      if (!dryRun && source !== null) await s3DeleteObject(source, key);
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
    const { bytes, contentType } = await s3GetObject(source, key);
    await s3PutObject(
      target,
      key,
      bytes,
      contentType ?? 'application/octet-stream',
    );
    const landed = await s3HeadObject(target, key);
    if (landed === null || landed.size !== sourceHead.size) {
      await s3DeleteObject(target, key);
      throw new Error(
        `copy landed at ${landed === null ? 'no' : landed.size} bytes, the source has ${sourceHead.size}`,
      );
    }
    await s3DeleteObject(source, key);
    counters.migrated += 1;
    counters.bytesMigrated += bytes.byteLength;
  } catch (error) {
    counters.failed += 1;
    console.warn(`[object-storage] backfill failed for ${ref}:`, error);
  }
}

interface BackfillRefSite {
  ref: string;
  table: string;
  name?: string;
}

/**
 * The backfill engine — one run to completion: a keyset walk per phase over
 * every org-owned table holding blob refs (documents' file_ref + history,
 * file_metadata, tts_audio_chunks, video_link_jobs), progress stamped per
 * batch and at least every `STAMP_INTERVAL_MS`. Every stamp is fenced on
 * `status = 'running'`: a run the watchdog failed stops at its next stamp
 * instead of copying beside a fresh run and flipping itself to completed.
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

  let lastStampAt = Date.now();
  const stamp = async (phase: BackfillPhase): Promise<void> => {
    const stamped = await sql<{ id: string }[]>`
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
      WHERE id = ${args.runId} AND status = 'running'
      RETURNING id
    `;
    if (stamped.length === 0) throw new BackfillFencedError(args.runId);
    lastStampAt = Date.now();
  };
  const stampIfDue = async (phase: BackfillPhase): Promise<void> => {
    if (Date.now() - lastStampAt >= STAMP_INTERVAL_MS) await stamp(phase);
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
    // Source and target are one physical bucket: every blob is already
    // "there", and finishing a move would delete the only copy.
    if (source !== null && target !== null && sameObjectStore(source, target)) {
      throw new ObjectStorageError(
        'SAME_STORE',
        "The organization's bucket is the deployment's default store; there is nothing to move.",
      );
    }

    const walk = async <Row extends { id: string }>(
      phase: BackfillPhase,
      page: (cursor: string) => Promise<Row[]>,
      refsOf: (row: Row) => BackfillRefSite[],
    ): Promise<void> => {
      await stamp(phase);
      let cursor = '';
      for (;;) {
        const rows = await page(cursor);
        if (rows.length === 0) break;
        for (const row of rows) {
          counters.rowsScanned += 1;
          for (const site of refsOf(row)) {
            await handleRef(
              site.ref,
              site.table,
              site.name,
              source,
              target,
              run.dryRun,
              counters,
            );
            await stampIfDue(phase);
          }
        }
        cursor = rows[rows.length - 1]?.id ?? cursor;
        await stamp(phase);
      }
    };

    // Phase 1: documents (file_ref + every historyFiles entry).
    await walk(
      'documents',
      (cursor) => sql<
        { id: string; title: string; fileRef: string; historyFiles: string[] }[]
      >`
        SELECT id, title, file_ref AS "fileRef",
               history_files AS "historyFiles"
        FROM app.documents
        WHERE org_id = ${args.organizationId} AND id > ${cursor}
        ORDER BY id ASC
        LIMIT ${BATCH}
      `,
      (doc) => [
        { ref: doc.fileRef, table: 'documents', name: doc.title },
        ...doc.historyFiles.map((ref) => ({
          ref,
          table: 'documents.history',
          name: doc.title,
        })),
      ],
    );

    // Phase 2: loose file_metadata rows.
    await walk(
      'fileMetadata',
      (cursor) => sql<
        { id: string; fileName: string | null; storageRef: string }[]
      >`
        SELECT id, file_name AS "fileName", storage_ref AS "storageRef"
        FROM app.file_metadata
        WHERE org_id = ${args.organizationId} AND id > ${cursor}
        ORDER BY id ASC
        LIMIT ${BATCH}
      `,
      (file) => [
        {
          ref: file.storageRef,
          table: 'fileMetadata',
          ...(file.fileName !== null ? { name: file.fileName } : {}),
        },
      ],
    );

    // Phase 3: synthesized TTS audio. Nameless in the sample on purpose —
    // the chunk's text is message content.
    await walk(
      'ttsChunks',
      (cursor) => sql<{ id: string; storageRef: string }[]>`
        SELECT id, storage_ref AS "storageRef"
        FROM app.tts_audio_chunks
        WHERE org_id = ${args.organizationId} AND storage_ref IS NOT NULL
          AND id > ${cursor}
        ORDER BY id ASC
        LIMIT ${BATCH}
      `,
      (chunk) => [{ ref: chunk.storageRef, table: 'ttsChunks' }],
    );

    // Phase 4: video-link captions / extracted audio.
    await walk(
      'videoLinks',
      (cursor) => sql<
        { id: string; videoTitle: string | null; storageRef: string }[]
      >`
        SELECT id, video_title AS "videoTitle", storage_ref AS "storageRef"
        FROM app.video_link_jobs
        WHERE org_id = ${args.organizationId} AND storage_ref IS NOT NULL
          AND id > ${cursor}
        ORDER BY id ASC
        LIMIT ${BATCH}
      `,
      (job) => [
        {
          ref: job.storageRef,
          table: 'videoLinks',
          ...(job.videoTitle !== null ? { name: job.videoTitle } : {}),
        },
      ],
    );

    await stamp('done');
    const completed = await sql<{ id: string }[]>`
      UPDATE app.object_storage_backfill_runs SET
        status = 'completed', finished_at_ms = ${Date.now()},
        updated_at_ms = ${Date.now()}
      WHERE id = ${args.runId} AND status = 'running'
      RETURNING id
    `;
    if (completed.length === 0) throw new BackfillFencedError(args.runId);
  } catch (error) {
    if (error instanceof BackfillFencedError) {
      console.warn(`[object-storage] ${error.message}`);
      return;
    }
    console.error(`[object-storage] backfill run ${args.runId} failed:`, error);
    await sql`
      UPDATE app.object_storage_backfill_runs SET
        status = 'failed', finished_at_ms = ${Date.now()},
        updated_at_ms = ${Date.now()},
        last_error = ${error instanceof Error ? error.message : String(error)}
      WHERE id = ${args.runId} AND status = 'running'
    `;
  }
}

/**
 * A backfill that has not stamped progress in this long is dead. The engine
 * stamps `updated_at_ms` per ~100-row batch and at least every
 * `STAMP_INTERVAL_MS` while a batch is still copying, so silence past this
 * window means its process died mid-copy.
 */
const BACKFILL_STALE_MS = 30 * 60 * 1000;

/**
 * Crash-recovery watchdog for the blob backfill (the job-liveness class): a
 * run whose process died mid-copy is left `status='running'` forever, and the
 * `object_storage_backfill_one_running` partial unique index then rejects
 * every future backfill for the org (409). Fail stale runs so the status UI
 * stops spinning and the org can re-run — re-running is idempotent
 * (`handleRef` skips blobs already moved and finishes a verified copy whose
 * source delete was cut off), so a fresh run finishes the move cheaply. The
 * failed run's engine, if still alive, stops at its next fenced stamp.
 */
export async function recoverStuckBackfills(
  sql: Sql,
  options: { staleMs?: number } = {},
): Promise<{ failed: number }> {
  const now = Date.now();
  const cutoff = now - (options.staleMs ?? BACKFILL_STALE_MS);
  const failed = await sql<{ id: string }[]>`
    UPDATE app.object_storage_backfill_runs SET
      status = 'failed', finished_at_ms = ${now}, updated_at_ms = ${now},
      last_error = 'the backfill process stopped before finishing (watchdog)'
    WHERE status = 'running' AND updated_at_ms < ${cutoff}
    RETURNING id
  `;
  if (failed.length > 0) {
    console.warn(
      `[object-storage] watchdog failed ${failed.length} stalled backfill run(s)`,
    );
  }
  return { failed: failed.length };
}
