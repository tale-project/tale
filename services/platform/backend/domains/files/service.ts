import type { Sql, TransactionSql } from 'postgres';

import { encodeS3Ref, parseBlobRef } from '../../core/lib/storage/blob_ref.ts';
import { s3KeyBelongsToOrg } from '../../core/lib/storage/blob_ref.ts';
import { browserFacing } from '../../core/lib/storage/object_store.ts';
import {
  buildObjectKey,
  resolveObjectStore,
  s3DeleteObject,
  s3HeadObject,
  s3PresignGetUrl,
  s3PresignPutUrl,
  s3PutObject,
} from '../../lib/object-store.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';

/**
 * Files domain core — the upload/serve/delete lanes over the S3-only object
 * store, plus the `app.file_metadata` ledger. The RAG dispatch, OCR and
 * transcription pipelines land with knowledge/tts (ledger); their columns
 * already exist on the table.
 *
 * Upload is a two-step handshake: `createUploadHandoff` presigns a PUT to a
 * server-minted key (the client never names keys), the client uploads, then
 * `registerUpload` verifies the blob really landed (HEAD: exists + size) and
 * writes the metadata row — an unverified key can never become a row.
 */

export class FileError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 503;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 503 = 400,
  ) {
    super(message);
    this.name = 'FileError';
    this.code = code;
    this.status = status;
  }
}

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export interface UploadHandoff {
  /** The blob reference (`s3:<key>`) the client binds with after the PUT. */
  storageRef: string;
  /** Presigned PUT URL, valid for 15 minutes. */
  uploadUrl: string;
}

async function requireOrgStore(sql: Sql, organizationId: string) {
  const orgSlug = await resolveOrgSlug(sql, organizationId);
  if (!orgSlug) {
    throw new FileError('ORG_NOT_FOUND', 'Organization not found', 404);
  }
  try {
    return { orgSlug, store: await resolveObjectStore(orgSlug) };
  } catch {
    throw new FileError(
      'OBJECT_STORE_UNCONFIGURED',
      'No object storage configured for this deployment',
      503,
    );
  }
}

export async function createUploadHandoff(
  sql: Sql,
  scope: { organizationId: string },
  args: { contentType: string; size: number },
): Promise<UploadHandoff> {
  if (args.size <= 0 || args.size > MAX_UPLOAD_BYTES) {
    throw new FileError('FILE_SIZE_INVALID', 'Invalid file size');
  }
  const { orgSlug, store } = await requireOrgStore(sql, scope.organizationId);
  const key = buildObjectKey(store, orgSlug);
  // The browser performs this PUT, so it is signed against the origin the
  // browser can reach — see `browserFacing`.
  const uploadUrl = await s3PresignPutUrl(browserFacing(store), key, {
    contentType: args.contentType,
  });
  return { storageRef: encodeS3Ref(key), uploadUrl };
}

/**
 * REST-door presign: the caller declares no size (unlike the session lane) —
 * the bind step HEADs the landed object, so the ceiling is enforced at
 * registration instead. Only the content type shapes the PUT.
 */
export async function createRestUploadHandoff(
  sql: Sql,
  scope: { organizationId: string },
  args: { contentType?: string },
): Promise<UploadHandoff> {
  const { orgSlug, store } = await requireOrgStore(sql, scope.organizationId);
  const key = buildObjectKey(store, orgSlug);
  const uploadUrl = await s3PresignPutUrl(browserFacing(store), key, {
    contentType: args.contentType ?? 'application/octet-stream',
  });
  return { storageRef: encodeS3Ref(key), uploadUrl };
}

function requireOrgScopedKey(ref: string, orgSlug: string): string {
  const parsed = parseBlobRef(ref);
  if (parsed.backend !== 's3' || !s3KeyBelongsToOrg(parsed.key, orgSlug)) {
    throw new FileError('BLOB_REF_INVALID', 'Invalid blob reference', 403);
  }
  return parsed.key;
}

export interface RegisterUploadArgs {
  storageRef: string;
  fileName: string;
  contentType: string;
  threadId?: string;
  source?: string;
}

/** Verify the blob landed, then write the metadata row (size from HEAD). */
export async function registerUpload(
  sql: Sql,
  tx: TransactionSql,
  scope: { organizationId: string; userId: string },
  args: RegisterUploadArgs,
): Promise<{ fileId: string; size: number }> {
  const { orgSlug, store } = await requireOrgStore(sql, scope.organizationId);
  const key = requireOrgScopedKey(args.storageRef, orgSlug);
  const head = await s3HeadObject(store, key);
  if (!head) {
    throw new FileError('BLOB_NOT_FOUND', 'Blob was not uploaded', 404);
  }
  // The REST presign lane carries no size, so the ceiling is enforced on the
  // landed object; the session lane gates at presign too (double is fine).
  if (head.size > MAX_UPLOAD_BYTES) {
    throw new FileError('FILE_SIZE_INVALID', 'Uploaded object is too large');
  }
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.file_metadata (
      org_id, storage_ref, file_name, content_type, size, source,
      uploaded_by, thread_id, created_at_ms
    ) VALUES (
      ${scope.organizationId}, ${args.storageRef}, ${args.fileName},
      ${args.contentType}, ${head.size}, ${args.source ?? null},
      ${scope.userId}, ${args.threadId ?? null}, ${Date.now()}
    )
    RETURNING id
  `;
  const fileId = inserted[0]?.id;
  if (!fileId) {
    throw new FileError('FILE_REGISTER_FAILED', 'Insert failed');
  }
  return { fileId, size: head.size };
}

export interface FileMetadataRow {
  id: string;
  organizationId: string;
  storageRef: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedBy: string | null;
  threadId: string | null;
  createdAt: number;
}

export async function getFileMetadata(
  sql: Sql,
  organizationId: string,
  fileId: string,
): Promise<FileMetadataRow | null> {
  const rows = await sql<FileMetadataRow[]>`
    SELECT id, org_id AS "organizationId", storage_ref AS "storageRef",
           file_name AS "fileName", content_type AS "contentType",
           size::float8 AS size, uploaded_by AS "uploadedBy",
           thread_id AS "threadId", created_at_ms::float8 AS "createdAt"
    FROM app.file_metadata
    WHERE id = ${fileId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Resolve a file row by EITHER identifier the app uses.
 *
 * The identifier vocabulary is genuinely mixed: listings hand out the row's
 * own id, while the POST upload lane's `storageId` IS the blob ref, and the
 * 0.4 `getFileUrl` contract took the ref. The `s3:` prefix makes the two
 * unambiguous, and a ref is org-scoped twice over — by this WHERE and by the
 * key's own org prefix at presign time.
 */
export async function getFileMetadataByIdOrRef(
  sql: Sql,
  organizationId: string,
  idOrRef: string,
): Promise<FileMetadataRow | null> {
  if (!idOrRef.startsWith('s3:')) {
    return getFileMetadata(sql, organizationId, idOrRef);
  }
  const rows = await sql<FileMetadataRow[]>`
    SELECT id, org_id AS "organizationId", storage_ref AS "storageRef",
           file_name AS "fileName", content_type AS "contentType",
           size::float8 AS size, uploaded_by AS "uploadedBy",
           thread_id AS "threadId", created_at_ms::float8 AS "createdAt"
    FROM app.file_metadata
    WHERE storage_ref = ${idOrRef} AND org_id = ${organizationId}
    ORDER BY created_at_ms ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Presigned GET for a blob ref the caller's org owns. */
export async function getFileUrl(
  sql: Sql,
  scope: { organizationId: string },
  storageRef: string,
): Promise<string> {
  const { orgSlug, store } = await requireOrgStore(sql, scope.organizationId);
  const key = requireOrgScopedKey(storageRef, orgSlug);
  // Handed to the browser, so signed against the origin it can reach.
  return s3PresignGetUrl(browserFacing(store), key);
}

/**
 * Delete a blob + its metadata row. Callers gate WHO may delete (uploader /
 * owning-domain cascade); this enforces only org scoping.
 */
export async function deleteFile(
  sql: Sql,
  tx: TransactionSql,
  scope: { organizationId: string },
  fileId: string,
): Promise<void> {
  const meta = await getFileMetadata(tx, scope.organizationId, fileId);
  if (!meta) {
    return;
  }
  const { orgSlug, store } = await requireOrgStore(sql, scope.organizationId);
  const key = requireOrgScopedKey(meta.storageRef, orgSlug);
  await tx`DELETE FROM app.file_metadata WHERE id = ${fileId}`;
  // Blob delete is best-effort AFTER the row delete commits its intent; an
  // orphaned blob is reclaimable by a sweep, a dangling row is user-visible.
  try {
    await s3DeleteObject(store, key);
  } catch (error) {
    console.warn(`[files] blob delete failed for ${key}:`, error);
  }
}

/**
 * Best-effort delete of org blobs by ref (`s3:<key>`), the shared reclaim
 * helper for lanes that hold refs outside `app.file_metadata` (tts audio,
 * webdav orphan compensation). A delete failure logs and moves on — an
 * orphaned blob is reclaimable later, a thrown reclaim would fail the
 * caller's real work.
 */
export async function deleteOrgBlobRefs(
  db: Sql | TransactionSql,
  organizationId: string,
  refs: readonly string[],
): Promise<void> {
  if (refs.length === 0) return;
  try {
    const orgSlug = await resolveOrgSlug(db, organizationId);
    if (!orgSlug) return;
    const store = await resolveObjectStore(orgSlug);
    for (const ref of refs) {
      const key = ref.startsWith('s3:') ? ref.slice(3) : ref;
      try {
        await s3DeleteObject(store, key);
      } catch (error) {
        console.warn(`[files] blob delete failed for ${key}:`, error);
      }
    }
  } catch (error) {
    console.warn('[files] blob reclaim skipped (store unresolved):', error);
  }
}

/**
 * Store RAW BYTES into the org's store and answer the blob ref — the mail-
 * attachments write lane (the 0.4 `storeOrgBlob` contract): the bytes are
 * already in hand, so there is no presign/verify handshake.
 */
export async function putOrgBlobBytes(
  sql: Sql,
  organizationId: string,
  args: { bytes: Uint8Array; contentType: string },
): Promise<string> {
  if (args.bytes.byteLength === 0 || args.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new FileError('FILE_SIZE_INVALID', 'Invalid blob size');
  }
  const { orgSlug, store } = await requireOrgStore(sql, organizationId);
  const key = buildObjectKey(store, orgSlug);
  await s3PutObject(store, key, args.bytes, args.contentType);
  return encodeS3Ref(key);
}

/**
 * Metadata row for bytes already stored via {@link putOrgBlobBytes} — size
 * is known, so no HEAD round-trip. Idempotent on the blob ref: a re-ingest
 * of the same attachment answers the existing row.
 */
export async function registerUploadedBytes(
  sql: Sql,
  args: {
    organizationId: string;
    storageRef: string;
    fileName: string;
    contentType: string;
    size: number;
    source?: string;
    uploadedBy?: string;
    skipRagIndexing?: boolean;
  },
): Promise<{ fileId: string }> {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM app.file_metadata
    WHERE org_id = ${args.organizationId} AND storage_ref = ${args.storageRef}
    LIMIT 1
  `;
  if (existing[0]) return { fileId: existing[0].id };
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO app.file_metadata (
      org_id, storage_ref, file_name, content_type, size, source,
      uploaded_by, skip_rag_indexing, created_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.storageRef}, ${args.fileName},
      ${args.contentType}, ${args.size}, ${args.source ?? null},
      ${args.uploadedBy ?? null}, ${args.skipRagIndexing === true},
      ${Date.now()}
    )
    RETURNING id
  `;
  const fileId = inserted[0]?.id;
  if (!fileId) throw new FileError('FILE_REGISTER_FAILED', 'Insert failed');
  return { fileId };
}

/**
 * HEAD an org-scoped blob (upload landed but not yet registered): size for
 * validation gates that must run BEFORE the metadata row exists. Null when
 * the object is missing; throws on a ref outside the org's namespace.
 */
export async function statOrgBlob(
  sql: Sql,
  organizationId: string,
  storageRef: string,
): Promise<{ size: number } | null> {
  const { orgSlug, store } = await requireOrgStore(sql, organizationId);
  const key = requireOrgScopedKey(storageRef, orgSlug);
  const head = await s3HeadObject(store, key);
  return head === null ? null : { size: head.size };
}

/**
 * Reclaim a blob whose upload was REJECTED after landing (policy refusal,
 * unsupported type): the 0.4 `deleteRejectedUploadBlob` contract. Never
 * touches a blob that became a real file; the org-namespace check on the
 * key is the safety boundary for the unregistered case.
 */
export async function deleteRejectedUploadBlob(
  sql: Sql,
  organizationId: string,
  storageRef: string,
): Promise<{ deleted: boolean }> {
  const linked = await sql<{ id: string }[]>`
    SELECT id FROM app.file_metadata
    WHERE org_id = ${organizationId} AND storage_ref = ${storageRef}
    LIMIT 1
  `;
  if (linked[0]) return { deleted: false };
  const { orgSlug, store } = await requireOrgStore(sql, organizationId);
  const key = requireOrgScopedKey(storageRef, orgSlug);
  try {
    await s3DeleteObject(store, key);
  } catch (error) {
    console.warn(`[files] rejected-blob delete failed for ${key}:`, error);
  }
  return { deleted: true };
}
