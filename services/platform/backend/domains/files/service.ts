import {
  formatRangeHeader,
  ifRangeMatches,
  parseRangeHeader,
  unsatisfiableContentRange,
} from '@tale/shared/http/range';
import type { Sql, TransactionSql } from 'postgres';

import { encodeS3Ref, parseBlobRef } from '../../core/lib/storage/blob_ref.ts';
import { s3KeyBelongsToOrg } from '../../core/lib/storage/blob_ref.ts';
import { browserFacing } from '../../core/lib/storage/object_store.ts';
import { canonicalEntityTag } from '../../lib/conditional-get.ts';
import {
  buildObjectKey,
  deleteOrgObject,
  fetchPresignedObject,
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
  args: {
    contentType?: string;
    /** How long the signed PUT stays valid — the REST door passes its
     * intent's own lifetime, so the URL and the `expiresAt` it is handed
     * out with agree (the store's default is half the intent's). */
    expiresInSec?: number;
  },
): Promise<UploadHandoff> {
  const { orgSlug, store } = await requireOrgStore(sql, scope.organizationId);
  const key = buildObjectKey(store, orgSlug);
  const uploadUrl = await s3PresignPutUrl(browserFacing(store), key, {
    ...(args.contentType !== undefined && args.contentType !== ''
      ? { contentType: args.contentType }
      : {}),
    ...(args.expiresInSec !== undefined
      ? { expiresInSec: args.expiresInSec }
      : {}),
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
  /** The caller's opt-out from RAG indexing (0.4 `skipRagIndexing`). Every
   * enqueue gate reads the column, so a row that carries it never indexes,
   * however it is later re-bound. */
  skipRagIndexing?: boolean;
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
      uploaded_by, thread_id, skip_rag_indexing, created_at_ms
    ) VALUES (
      ${scope.organizationId}, ${args.storageRef}, ${args.fileName},
      ${args.contentType}, ${head.size}, ${args.source ?? null},
      ${scope.userId}, ${args.threadId ?? null},
      ${args.skipRagIndexing === true ? true : null}, ${Date.now()}
    )
    RETURNING id
  `;
  const fileId = inserted[0]?.id;
  if (!fileId) {
    throw new Error('FILE_REGISTER_FAILED: the insert answered no row');
  }
  return { fileId, size: head.size };
}

/**
 * The page shape of an uploaded image: one page, nothing scanned to detect,
 * and vision needed to read it at all (the 0.4 `extractFileMetadata` image
 * branch). Stamped at registration because the ingest lane refuses images
 * before it fetches a byte, so nothing downstream would ever fill these in.
 */
export async function stampImageVisionMetadata(
  db: Sql | TransactionSql,
  fileId: string,
): Promise<void> {
  await db`
    UPDATE app.file_metadata
    SET page_count = 1, scanned_pages_detected = 0, vision_required = true
    WHERE id = ${fileId}
  `;
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
  options: { lock?: boolean } = {},
): Promise<FileMetadataRow | null> {
  const rows = await sql<FileMetadataRow[]>`
    SELECT ${sql.unsafe(FILE_METADATA_COLUMNS)}
    FROM app.file_metadata
    WHERE id = ${fileId} AND org_id = ${organizationId}
    LIMIT 1
    ${sql.unsafe(options.lock === true ? 'FOR UPDATE' : '')}
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

/** What `openFileContent` hands a door: the status and headers to answer,
 * and the body to stream (null for a HEAD, a 304 or a 416). */
export interface FileContent {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

/** The client's preconditions on a content read: `If-None-Match` and
 * `If-Modified-Since` are forwarded to the store, which owns the
 * validators it issued (`ETag`, `Last-Modified`) and answers 304 itself;
 * `If-Range` on a resumed download is judged HERE against the object's
 * validators — a mismatch serves the whole file again, since the client's
 * partial copy is of other bytes. */
export interface FileContentConditions {
  ifNoneMatch?: string;
  ifModifiedSince?: string;
  ifRange?: string;
}

/**
 * `If-None-Match` as the store must see it. RFC 9110 §13.1.2 makes the
 * comparison weak — `W/"x"` names the same bytes as `"x"` — and the edge
 * suffixes the tag of an answer it compressed (a text transcript comes
 * back as `"x-gzip"`); the store compares strongly and would answer the
 * whole file to either form. Every member is reduced to the opaque tag
 * the store issued (`canonicalEntityTag`).
 */
function strongIfNoneMatch(header: string): string {
  return header
    .split(',')
    .map(canonicalEntityTag)
    .filter((member) => member !== '')
    .join(', ');
}

/** The validators a HEAD attests, as response headers: what a GET of the
 * same bytes carries, so a HEAD answers them too (the document lane's
 * "the headers alone" promise) and a 416 can name the representation. */
function validatorHeaders(head: {
  etag: string | null;
  lastModified: string | null;
}): Headers {
  const headers = new Headers();
  if (head.etag !== null) headers.set('etag', head.etag);
  if (head.lastModified !== null) {
    headers.set('last-modified', head.lastModified);
  }
  return headers;
}

/**
 * The 416 a range the file cannot satisfy answers (RFC 9110 §15.5.17):
 * an EMPTY body, a `Content-Range` naming the size alone (so the client
 * learns where the file ends), and nothing that describes a body —
 * the store's own 416 carries the `Content-Type`/`Content-Length` of its
 * XML error document, which, forwarded onto a bodiless answer, promised
 * bytes that never came and made the edge abort the stream.
 */
function unsatisfiable(
  size: number,
  validators: { etag: string | null; lastModified: string | null },
): FileContent {
  const headers = validatorHeaders(validators);
  headers.set('content-range', unsatisfiableContentRange(size));
  headers.set('accept-ranges', 'bytes');
  headers.set('content-length', '0');
  return { status: 416, headers, body: null };
}

/** The size a store's own 416 names in its `Content-Range` (the
 * unsatisfied form carries no positions, only the size), or null when it
 * names none. */
function sizeFromContentRange(header: string | null): number | null {
  const match = /^bytes \*\/(\d+)$/.exec(header?.trim() ?? '');
  const size = match === null ? NaN : Number(match[1]);
  return Number.isSafeInteger(size) ? size : null;
}

/**
 * Open a blob's bytes for a door that serves them ITSELF — the REST file
 * lane. Signed against the store's own endpoint (the platform dials it,
 * never a browser) and fetched here, so no presigned URL and no second
 * authentication ever reaches the client: the old 302 sent a bearer-
 * carrying client to a presigned URL on the platform's own origin, where
 * the store refused the two authentications and `curl -L -o` wrote that
 * refusal into the file.
 *
 * A `Range` is judged HERE, against the object's HEAD, before any byte is
 * asked for: a satisfiable range reaches the store normalised (a suffix
 * resolved, the end clamped) and answers 206; one starting at or past the
 * end — `bytes=<size>-`, what a resumed download sends once its copy is
 * complete — answers a local 416 with an empty body and no upstream GET;
 * one this lane cannot read (another unit, several ranges, `bytes=abc`)
 * is ignored and the whole file answers 200; and `If-Range` naming
 * another representation drops the range for the same reason. The store's
 * own 416, when a race still produces one, is never forwarded: its headers
 * describe an XML error body this answer does not carry, and the edge
 * aborted the stream on the promise.
 *
 * `If-None-Match` / `If-Modified-Since` are forwarded (the store answers
 * 304 with no body — a mirror that already holds the bytes spends a round
 * trip instead of the file); `head` answers the metadata alone — size,
 * type, `ETag`, `Last-Modified`, `Accept-Ranges` — and ignores `Range`.
 * Null when the blob is gone; a store that cannot be reached or answers
 * an error is `OBJECT_STORE_UNAVAILABLE` (503) — never a 404 that would
 * read as "the file does not exist".
 */
export async function openFileContent(
  sql: Sql,
  scope: { organizationId: string },
  storageRef: string,
  opts: {
    head?: boolean;
    range?: string;
    conditions?: FileContentConditions;
    signal?: AbortSignal;
  } = {},
): Promise<FileContent | null> {
  const { key, store } = await requireOrgStoreForRef(
    sql,
    scope.organizationId,
    storageRef,
  );
  const unavailable = (why: string): FileError =>
    new FileError(
      'OBJECT_STORE_UNAVAILABLE',
      `The object store did not serve the file: ${why}`,
      503,
    );
  const headObject = async () => {
    try {
      return await s3HeadObject(store, key);
    } catch (error) {
      throw unavailable(error instanceof Error ? error.message : String(error));
    }
  };
  if (opts.head === true) {
    const head = await headObject();
    if (head === null) return null;
    const headers = validatorHeaders(head);
    headers.set('content-length', String(head.size));
    if (head.contentType !== null) {
      headers.set('content-type', head.contentType);
    }
    headers.set('accept-ranges', 'bytes');
    return { status: 200, headers, body: null };
  }
  const conditions = opts.conditions ?? {};
  // The range the store is asked for — normalised, or none: the whole file.
  let range: string | undefined;
  let attested: { etag: string | null; lastModified: string | null } | null =
    null;
  if (opts.range !== undefined) {
    const head = await headObject();
    if (head === null) return null;
    attested = head;
    const lastModified =
      head.lastModified === null ? null : new Date(head.lastModified);
    const rangeHolds =
      conditions.ifRange === undefined ||
      ifRangeMatches(conditions.ifRange, head.etag, lastModified);
    const parsed = rangeHolds ? parseRangeHeader(opts.range, head.size) : null;
    if (parsed === 'unsatisfiable') return unsatisfiable(head.size, head);
    if (parsed !== null) range = formatRangeHeader(parsed);
  }
  const presigned = await s3PresignGetUrl(store, key);
  const forwarded: Record<string, string> = {
    ...(range === undefined ? {} : { range }),
    ...(conditions.ifNoneMatch === undefined
      ? {}
      : { 'if-none-match': strongIfNoneMatch(conditions.ifNoneMatch) }),
    // RFC 9110 §13.1.3: `If-Modified-Since` is ignored when `If-None-Match`
    // is present — the store would still evaluate it, with a one-second
    // slack that lets a mirror keep bytes replaced within that second.
    ...(conditions.ifModifiedSince === undefined ||
    conditions.ifNoneMatch !== undefined
      ? {}
      : { 'if-modified-since': conditions.ifModifiedSince }),
    // Judged above against the HEAD; forwarded verbatim with the range so
    // a store that honours it re-checks the bytes it is about to send.
    ...(conditions.ifRange === undefined || range === undefined
      ? {}
      : { 'if-range': conditions.ifRange }),
  };
  let upstream: Response;
  try {
    upstream = await fetchPresignedObject(presigned, {
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      ...(Object.keys(forwarded).length === 0 ? {} : { headers: forwarded }),
    });
  } catch (error) {
    throw unavailable(error instanceof Error ? error.message : String(error));
  }
  if (upstream.status === 404) {
    await upstream.body?.cancel().catch(() => undefined);
    return null;
  }
  if (upstream.status === 304) {
    await upstream.body?.cancel().catch(() => undefined);
    return { status: 304, headers: upstream.headers, body: null };
  }
  if (upstream.status === 416) {
    // The bytes moved under the HEAD (or the store disagrees about the
    // size): answer the lane's own 416, sized by what the store names.
    await upstream.body?.cancel().catch(() => undefined);
    const size = sizeFromContentRange(upstream.headers.get('content-range'));
    return unsatisfiable(
      size ?? (await headObject())?.size ?? 0,
      attested ?? { etag: null, lastModified: null },
    );
  }
  if (!upstream.ok) {
    await upstream.body?.cancel().catch(() => undefined);
    throw unavailable(`the store answered ${upstream.status}`);
  }
  return {
    status: upstream.status,
    headers: upstream.headers,
    body: upstream.body,
  };
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
  if (!fileId)
    throw new Error('FILE_REGISTER_FAILED: the insert answered no row');
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
