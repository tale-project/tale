import type { Sql, TransactionSql } from 'postgres';

import { encodeS3Ref, parseBlobRef } from '../../core/lib/storage/blob_ref.ts';
import { s3KeyBelongsToOrg } from '../../core/lib/storage/blob_ref.ts';
import { browserFacing } from '../../core/lib/storage/object_store.ts';
import {
  buildObjectKey,
  deleteOrgObject,
  locateOrgObjectStore,
  resolveObjectStore,
  s3DeleteObject,
  s3GetObjectBytes,
  s3HeadObject,
  s3PresignGetUrl,
  s3PresignPutUrl,
  s3PutObject,
} from '../../lib/object-store.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { consumeUploadIntent, type UploadPurpose } from './upload-intents.ts';

/**
 * Files domain core — the upload/serve/delete lanes over the S3-only object
 * store, plus the `app.file_metadata` ledger. The RAG dispatch, OCR and
 * transcription pipelines land with knowledge/tts (ledger); their columns
 * already exist on the table.
 *
 * Upload is a two-step handshake: `createRestUploadHandoff` presigns a PUT to
 * a server-minted key (the client never names keys), the client uploads, then
 * `registerUpload` verifies the blob really landed (HEAD: exists + size) and
 * writes the metadata row — an unverified key can never become a row, and
 * (`upload-intents.ts`) a key the caller did not mint can never become THEIR
 * row: the org prefix on a key proves tenancy, the intent proves ownership.
 */

export class FileError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 413 | 503;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 | 413 | 503 = 400,
  ) {
    super(message);
    this.name = 'FileError';
    this.code = code;
    this.status = status;
  }
}

/** The largest blob the platform stores (uploads, imports, harvests). The
 * intake lanes refuse past it BEFORE buffering — see `bounded-body.ts`. */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export interface UploadHandoff {
  /** The blob reference (`s3:<key>`) the client binds with after the PUT. */
  storageRef: string;
  /** Presigned PUT URL, valid for 15 minutes. */
  uploadUrl: string;
}

async function requireOrgSlug(
  sql: Sql,
  organizationId: string,
): Promise<string> {
  const orgSlug = await resolveOrgSlug(sql, organizationId);
  if (!orgSlug) {
    throw new FileError('ORG_NOT_FOUND', 'Organization not found', 404);
  }
  return orgSlug;
}

function unconfigured(): FileError {
  return new FileError(
    'OBJECT_STORE_UNCONFIGURED',
    'No object storage configured for this deployment',
    503,
  );
}

/** The org's CURRENT store — where a newly minted key lands. */
async function requireOrgStore(sql: Sql, organizationId: string) {
  const orgSlug = await requireOrgSlug(sql, organizationId);
  try {
    return { orgSlug, store: await resolveObjectStore(orgSlug) };
  } catch {
    throw unconfigured();
  }
}

/**
 * The store that holds an EXISTING blob of the org's: its own bucket, or the
 * deployment default the blob was written to before the org connected one
 * (`locateOrgObjectStore`). Serve lanes presign against this; a key outside
 * the org's namespace is refused before any store is asked.
 */
async function requireOrgStoreForRef(
  sql: Sql,
  organizationId: string,
  storageRef: string,
) {
  const orgSlug = await requireOrgSlug(sql, organizationId);
  const key = requireOrgScopedKey(storageRef, orgSlug);
  try {
    return { orgSlug, key, store: await locateOrgObjectStore(orgSlug, key) };
  } catch {
    throw unconfigured();
  }
}

/**
 * Presign for the session `/blob-upload` lane and the REST door alike: the
 * caller declares no size — the bind step HEADs the landed object, so the
 * ceiling is enforced at registration. A DECLARED content type is signed
 * into the PUT (the
 * client's PUT must then carry the identical `Content-Type` header — see the
 * API reference); an omitted one leaves the URL header-agnostic so bare
 * `curl -T` clients keep working, with the attachment-forced GET lane as the
 * serve-side guarantee.
 */
export async function createRestUploadHandoff(
  sql: Sql,
  scope: { organizationId: string },
  args: { contentType?: string },
): Promise<UploadHandoff> {
  const { orgSlug, store } = await requireOrgStore(sql, scope.organizationId);
  const key = buildObjectKey(store, orgSlug);
  const uploadUrl = await s3PresignPutUrl(
    browserFacing(store),
    key,
    args.contentType !== undefined && args.contentType !== ''
      ? { contentType: args.contentType }
      : {},
  );
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

/**
 * Who vouches that the caller owns the blob being registered. Every caller
 * must say: the session lanes consume the app intent minted for the ref
 * (`app.upload_intents`); the REST door has already consumed its own
 * single-use `rest_upload_intents` row in the same transaction.
 */
export type UploadIntentGate =
  | { kind: 'app'; purpose: UploadPurpose }
  | { kind: 'external' };

/**
 * Verify the caller owns the blob (intent), that it landed (HEAD: exists +
 * size), and that no row claims it yet, then write the metadata row.
 */
export async function registerUpload(
  sql: Sql,
  tx: TransactionSql,
  scope: { organizationId: string; userId: string },
  args: RegisterUploadArgs,
  gate: UploadIntentGate,
): Promise<{ fileId: string; size: number }> {
  if (gate.kind === 'app') {
    const owned = await consumeUploadIntent(tx, {
      organizationId: scope.organizationId,
      userId: scope.userId,
      purpose: gate.purpose,
      storageRef: args.storageRef,
    });
    if (!owned) {
      throw new FileError(
        'UPLOAD_NOT_OWNED',
        'This upload is not yours to bind, or the upload session expired. Upload the file again.',
        403,
      );
    }
  }
  // Keys are random per mint and intents single-use, so a second row for
  // one blob is never a legitimate outcome of this lane — and a duplicate is
  // exactly how a stranger's row came to be deletable through its uploader.
  const claimed = await tx<{ id: string }[]>`
    SELECT id FROM app.file_metadata
    WHERE org_id = ${scope.organizationId} AND storage_ref = ${args.storageRef}
    LIMIT 1
  `;
  if (claimed[0]) {
    throw new FileError(
      'BLOB_ALREADY_REGISTERED',
      'This blob is already registered',
      409,
    );
  }
  const { orgSlug, store } = await requireOrgStore(sql, scope.organizationId);
  const key = requireOrgScopedKey(args.storageRef, orgSlug);
  const head = await s3HeadObject(store, key);
  if (!head) {
    throw new FileError('BLOB_NOT_FOUND', 'Blob was not uploaded', 404);
  }
  // Presign carries no size, so the ceiling is enforced on the landed object.
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
  /** The bindings the read gate (`access.ts`) walks. */
  documentId: string | null;
  threadId: string | null;
  conversationId: string | null;
  createdAt: number;
}

const FILE_METADATA_COLUMNS = `
  id, org_id AS "organizationId", storage_ref AS "storageRef",
  file_name AS "fileName", content_type AS "contentType",
  size::float8 AS size, uploaded_by AS "uploadedBy",
  document_id AS "documentId", thread_id AS "threadId",
  conversation_id AS "conversationId", created_at_ms::float8 AS "createdAt"
`;

export async function getFileMetadata(
  sql: Sql | TransactionSql,
  organizationId: string,
  fileId: string,
): Promise<FileMetadataRow | null> {
  const rows = await sql<FileMetadataRow[]>`
    SELECT ${sql.unsafe(FILE_METADATA_COLUMNS)}
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
    SELECT ${sql.unsafe(FILE_METADATA_COLUMNS)}
    FROM app.file_metadata
    WHERE storage_ref = ${idOrRef} AND org_id = ${organizationId}
    ORDER BY created_at_ms ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Presigned GET for a blob ref the caller's org owns. Tenancy only — WHO may
 * read the row is decided first, by `access.ts` (the callers hold a row the
 * read gate admitted; this never sees a bare client ref). A `filename`
 * presigns with `response-content-disposition: attachment` so the browser
 * saves under the real name (object keys are `<org>/<uuid>`, nameless by
 * design); omit it for inline rendering.
 */
export async function getFileUrl(
  sql: Sql,
  scope: { organizationId: string },
  storageRef: string,
  opts: { filename?: string } = {},
): Promise<string> {
  const { key, store } = await requireOrgStoreForRef(
    sql,
    scope.organizationId,
    storageRef,
  );
  // Handed to the browser, so signed against the origin it can reach.
  return s3PresignGetUrl(browserFacing(store), key, {
    ...(opts.filename !== undefined && { filename: opts.filename }),
  });
}

/**
 * Delete a metadata row and, when nothing else serves the blob, the blob.
 * Callers gate WHO may delete (uploader / admin); this enforces org scoping
 * and the ownership boundaries: a document-bound row is the document's
 * content and dies with the document (the documents domain cascades), and
 * bytes still referenced by another row or document survive the row.
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
  if (meta.documentId !== null) {
    throw new FileError(
      'FILE_BOUND_TO_DOCUMENT',
      'This file is a document; delete the document instead',
      409,
    );
  }
  const { orgSlug } = await requireOrgStore(sql, scope.organizationId);
  const key = requireOrgScopedKey(meta.storageRef, orgSlug);
  await tx`DELETE FROM app.file_metadata WHERE id = ${fileId}`;
  const stillReferenced = await tx<{ referenced: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM app.file_metadata
      WHERE org_id = ${scope.organizationId}
        AND storage_ref = ${meta.storageRef}
    ) OR EXISTS (
      SELECT 1 FROM app.documents
      WHERE org_id = ${scope.organizationId}
        AND file_ref = ${meta.storageRef}
    ) AS referenced
  `;
  if (stillReferenced[0]?.referenced ?? false) {
    return;
  }
  // Blob delete is best-effort AFTER the row delete commits its intent; an
  // orphaned blob is reclaimable by a sweep, a dangling row is user-visible.
  // Every store that may hold the blob is cleared (own bucket AND the
  // default store a pre-switch blob was written to).
  try {
    await deleteOrgObject(orgSlug, key);
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
    for (const ref of refs) {
      const key = ref.startsWith('s3:') ? ref.slice(3) : ref;
      try {
        await deleteOrgObject(orgSlug, key);
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
 * GET the raw bytes of an org-scoped blob — the server-side read lane for a
 * caller that needs the bytes in hand rather than a presigned URL (an
 * outbound mail attachment the SMTP native composes). Throws on a ref outside
 * the org's namespace, so a stranger's ref is refused before any request.
 *
 * The check is the org NAMESPACE, deliberately: a ref is a random object key
 * under the org's prefix (capability-shaped — it is never listed to a caller
 * who could not see the file), and document/project visibility belongs to
 * the door that handed the ref out, not to this byte read. A caller that
 * must enforce visibility resolves the document first and passes its ref.
 */
export async function getOrgBlobBytes(
  sql: Sql,
  organizationId: string,
  storageRef: string,
): Promise<{ bytes: Uint8Array }> {
  const { orgSlug, store } = await requireOrgStore(sql, organizationId);
  const key = requireOrgScopedKey(storageRef, orgSlug);
  return { bytes: await s3GetObjectBytes(store, key) };
}

/**
 * Reclaim a blob whose upload was REJECTED after landing (policy refusal,
 * unsupported type): the 0.4 `deleteRejectedUploadBlob` contract. Never
 * touches a blob that became a real file, and never a blob the caller did
 * not mint: the reclaim consumes the caller's own upload intent, so naming
 * another member's staged key answers `deleted: false` like a missing one.
 */
export async function deleteRejectedUploadBlob(
  sql: Sql,
  scope: { organizationId: string; userId: string },
  storageRef: string,
): Promise<{ deleted: boolean }> {
  const { organizationId } = scope;
  const linked = await sql<{ id: string }[]>`
    SELECT id FROM app.file_metadata
    WHERE org_id = ${organizationId} AND storage_ref = ${storageRef}
    LIMIT 1
  `;
  if (linked[0]) return { deleted: false };
  const owned = await consumeUploadIntent(sql, {
    organizationId,
    userId: scope.userId,
    storageRef,
  });
  if (!owned) return { deleted: false };
  const { orgSlug, store } = await requireOrgStore(sql, organizationId);
  const key = requireOrgScopedKey(storageRef, orgSlug);
  try {
    await s3DeleteObject(store, key);
  } catch (error) {
    console.warn(`[files] rejected-blob delete failed for ${key}:`, error);
  }
  return { deleted: true };
}
