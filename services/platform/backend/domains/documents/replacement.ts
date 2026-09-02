import { createHash, randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import {
  DOCUMENT_MAX_FILE_SIZE,
  isRagIndexableFile,
} from '../../../lib/shared/file-types.ts';
import { attestDocumentContentType } from '../../core/documents/attest_document_bytes.ts';
import {
  putImmutableS3Blob,
  s3BlobSize,
} from '../../core/lib/storage/blob_access.ts';
import {
  encodeS3Ref,
  parseBlobRef,
  s3KeyBelongsToOrg,
} from '../../core/lib/storage/blob_ref.ts';
import { s3GetObjectBytes } from '../../core/lib/storage/object_store.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  buildObjectKey,
  resolveObjectStore,
  s3DeleteObject,
  s3PresignPutUrl,
} from '../../lib/object-store.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { assertNotHeld } from '../legal_holds/service.ts';
import {
  loadProjectOrThrow,
  type ProjectAuthContext,
} from '../projects/service.ts';
import {
  openRecordRevision,
  parseControlledRecord,
  type ControlledRecord,
} from './records.ts';
import {
  assertDocumentVisible,
  DocumentError,
  loadDocumentOrThrow,
  validateDocumentUploadForOrg,
  type DocumentRow,
} from './service.ts';

/**
 * Controlled-document replacement uploads (the 0.4 intent protocol,
 * s3-only): begin mints an intent + a STAGING presign; finalize attests the
 * staged bytes (magic-byte content type + sha256), promotes them to a
 * reserved IMMUTABLE final key (create-only + hash-verified readback), and
 * binds under the same guards the intent was minted with. A crashed
 * finalize resumes through the same lease machine; cancel/expiry leave
 * durable cleanup work the sweeper drains.
 */

export const REPLACEMENT_UPLOAD_LEASE_MS = 10 * 60 * 1000;
const REPLACEMENT_UPLOAD_RECOVERY_MS = 60 * 60 * 1000;
const REPLACEMENT_UPLOAD_CLEANUP_GRACE_MS = 60 * 1000;
const PRESIGN_TTL_SEC = 15 * 60;
const MAX_CLEANUP_BATCH = 20;
const CLEANUP_RETRY_BACKOFF_MS = 5 * 60 * 1000;

/** Draft-only replacement refs that may accumulate outside approved
 * snapshots (the 0.4 row-size guard, kept for parity). */
const MAX_DRAFT_HISTORY_FILES = 200;

export interface ReplacementIntentRow {
  id: string;
  organizationId: string;
  orgSlug: string;
  actorUserId: string;
  actorEmail: string;
  documentId: string;
  expectedRecordState: 'draft' | 'approved';
  expectedVersion: number;
  expectedFileId: string;
  fileName: string;
  clientContentType: string | null;
  lastModified: number | null;
  stagingRef: string;
  finalRef: string;
  state: string;
  uploadExpiresAt: number;
  leaseId: string | null;
  leaseExpiresAt: number | null;
  verifiedContentType: string | null;
  contentHash: string | null;
  size: number | null;
  resultVersion: number | null;
  cleanupPending: boolean;
  cleanupDueAt: number | null;
  cleanupAttempts: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

const INTENT_COLUMNS = `
  id, org_id AS "organizationId", org_slug AS "orgSlug",
  actor_user_id AS "actorUserId", actor_email AS "actorEmail",
  document_id AS "documentId",
  expected_record_state AS "expectedRecordState",
  expected_version AS "expectedVersion", expected_file_id AS "expectedFileId",
  file_name AS "fileName", client_content_type AS "clientContentType",
  last_modified_ms::float8 AS "lastModified",
  staging_ref AS "stagingRef", final_ref AS "finalRef", state,
  upload_expires_at_ms::float8 AS "uploadExpiresAt",
  lease_id AS "leaseId", lease_expires_at_ms::float8 AS "leaseExpiresAt",
  verified_content_type AS "verifiedContentType",
  content_hash AS "contentHash", size::float8 AS size,
  result_version AS "resultVersion", cleanup_pending AS "cleanupPending",
  cleanup_due_at_ms::float8 AS "cleanupDueAt",
  cleanup_attempts AS "cleanupAttempts", last_error AS "lastError",
  created_at_ms::float8 AS "createdAt", updated_at_ms::float8 AS "updatedAt"
`;

function invalidIntent(message: string): DocumentError {
  return new DocumentError('UPLOAD_INTENT_INVALID', message);
}

async function requireIntentForPrincipal(
  db: Sql | TransactionSql,
  auth: ProjectAuthContext,
  intentId: string,
): Promise<ReplacementIntentRow> {
  const rows = await db<ReplacementIntentRow[]>`
    SELECT ${db.unsafe(INTENT_COLUMNS)} FROM app.document_replacement_uploads
    WHERE id = ${intentId} LIMIT 1
  `;
  const intent = rows[0];
  if (!intent) {
    throw invalidIntent('The replacement upload intent no longer exists.');
  }
  if (
    intent.organizationId !== auth.organizationId ||
    intent.actorUserId !== auth.userId
  ) {
    throw invalidIntent('This replacement upload belongs to another user.');
  }
  return intent;
}

/** The write standard shared with records.ts (project canEdit), plus the
 * controlled + active gates every replacement step re-checks. */
async function requireReplacementDocument(
  db: Sql | TransactionSql,
  auth: ProjectAuthContext,
  documentId: string,
): Promise<{ doc: DocumentRow; record: ControlledRecord }> {
  const doc = await loadDocumentOrThrow(db, documentId);
  await assertDocumentVisible(db, auth, doc);
  if (doc.projectId !== null) {
    const project = await loadProjectOrThrow(db, doc.projectId);
    const access = checkProjectAccess(
      { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
      auth.teamIds,
      auth.role,
    );
    if (!access.canEdit) {
      throw new DocumentError('PROJECT_FORBIDDEN', 'No project access', 403);
    }
  }
  const record = parseControlledRecord(doc.record);
  if (record === null) {
    throw new DocumentError(
      'DOCUMENT_NOT_CONTROLLED',
      'This document is not a controlled record.',
    );
  }
  if ((doc.lifecycleStatus ?? 'active') !== 'active') {
    throw new DocumentError(
      'DOCUMENT_RECORD_INVALID_STATE',
      'Only an active controlled record can replace its file.',
    );
  }
  return { doc, record };
}

function replacementTargetMatches(
  doc: DocumentRow,
  record: ControlledRecord,
  target: Pick<
    ReplacementIntentRow,
    'expectedRecordState' | 'expectedVersion' | 'expectedFileId'
  >,
): boolean {
  return (
    record.state === target.expectedRecordState &&
    record.version === target.expectedVersion &&
    doc.fileRef !== null &&
    doc.fileRef === target.expectedFileId
  );
}

/** Prove the current approved artifact is already retained before a
 * replacement opens the next draft (the 0.4 snapshot-integrity gate). */
function requireCurrentApprovedSnapshot(
  doc: DocumentRow,
  record: ControlledRecord,
): void {
  const matches = record.approvedVersions.filter(
    (snapshot) =>
      snapshot.version === record.version &&
      doc.fileRef !== null &&
      snapshot.fileId === doc.fileRef &&
      (snapshot.contentHash ?? undefined) === (doc.contentHash ?? undefined),
  );
  const retained =
    doc.fileRef !== null && doc.historyFiles.includes(doc.fileRef);
  if (record.state !== 'approved' || matches.length !== 1 || !retained) {
    throw new DocumentError(
      'DOCUMENT_RECORD_APPROVED_SNAPSHOT_INVALID',
      'The current approved record does not have one matching retained snapshot.',
      400,
      { version: record.version },
    );
  }
}

function assertDraftHistoryCapacity(
  doc: DocumentRow,
  record: ControlledRecord,
): void {
  const approvedRefs = new Set(
    record.approvedVersions.map((version) => version.fileId),
  );
  const draftHistoryRefs = new Set(
    doc.historyFiles.filter((ref) => !approvedRefs.has(ref)),
  );
  const currentRef = doc.fileRef ?? undefined;
  const wouldGrow =
    currentRef !== undefined &&
    !approvedRefs.has(currentRef) &&
    !draftHistoryRefs.has(currentRef);
  if (wouldGrow && draftHistoryRefs.size >= MAX_DRAFT_HISTORY_FILES) {
    throw new DocumentError(
      'DOCUMENT_RECORD_REPLACEMENT_LIMIT',
      'This draft has reached its file-replacement history limit. Open a new controlled record instead.',
      400,
      { limit: MAX_DRAFT_HISTORY_FILES },
    );
  }
}

async function assertReplacementNotHeld(
  db: Sql | TransactionSql,
  doc: DocumentRow,
): Promise<void> {
  await assertNotHeld(
    db,
    doc.organizationId,
    'document',
    doc.id,
    undefined,
    doc.createdBy ?? undefined,
  );
}

async function scheduleCleanupSweep(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await addJobInTx(tx, 'documents.replacement_cleanup', {});
  });
}

async function supersedeIntent(
  db: Sql | TransactionSql,
  intent: ReplacementIntentRow,
  lastError: string,
): Promise<void> {
  const now = Date.now();
  await db`
    UPDATE app.document_replacement_uploads SET
      state = 'superseded', cleanup_pending = true,
      cleanup_due_at_ms = ${Math.max(now, intent.uploadExpiresAt + REPLACEMENT_UPLOAD_CLEANUP_GRACE_MS)},
      lease_id = NULL, lease_expires_at_ms = NULL,
      last_error = ${lastError}, updated_at_ms = ${now}
    WHERE id = ${intent.id}
  `;
}

// ---------------------------------------------------------------------------
// Begin
// ---------------------------------------------------------------------------

export interface BeginReplacementArgs {
  documentId: string;
  expectedRecordState: 'draft' | 'approved';
  expectedVersion: number;
  expectedFileId: string;
  fileName: string;
  contentType?: string;
  lastModified?: number;
}

export async function beginReplacementUpload(
  sql: Sql,
  auth: ProjectAuthContext,
  args: BeginReplacementArgs,
): Promise<{
  intentId: string;
  url: string;
  method: 'PUT';
  uploadContentType: string;
  uploadExpiresAt: number;
}> {
  if (
    !Number.isInteger(args.expectedVersion) ||
    args.expectedVersion < 1 ||
    args.fileName.trim().length === 0
  ) {
    throw invalidIntent('Invalid replacement upload intent metadata.');
  }
  const orgSlug = await resolveOrgSlug(sql, auth.organizationId);
  if (orgSlug === null) {
    throw new DocumentError('ORG_NOT_FOUND', 'Organization not found', 404);
  }
  const { doc, record } = await requireReplacementDocument(
    sql,
    auth,
    args.documentId,
  );
  if (record.state !== 'draft' && record.state !== 'approved') {
    throw new DocumentError(
      'DOCUMENT_RECORD_INVALID_STATE',
      'Only a controlled-record draft or approved record can replace its file.',
    );
  }
  if (!replacementTargetMatches(doc, record, args)) {
    throw new DocumentError(
      'DOCUMENT_RECORD_VERSION_MISMATCH',
      'The controlled record changed. Reopen the dialog.',
    );
  }
  if (args.expectedRecordState === 'approved') {
    requireCurrentApprovedSnapshot(doc, record);
  }
  await assertReplacementNotHeld(sql, doc);
  assertDraftHistoryCapacity(doc, record);

  const store = await resolveObjectStore(orgSlug);
  const stagingKey = buildObjectKey(store, orgSlug);
  const finalKey = buildObjectKey(store, orgSlug);
  const uploadContentType =
    args.contentType?.trim() || 'application/octet-stream';
  const uploadExpiresAt = Date.now() + PRESIGN_TTL_SEC * 1000;
  const url = await s3PresignPutUrl(store, stagingKey, {
    contentType: uploadContentType,
    expiresInSec: PRESIGN_TTL_SEC,
  });
  const now = Date.now();
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO app.document_replacement_uploads (
      org_id, org_slug, actor_user_id, actor_email, document_id,
      expected_record_state, expected_version, expected_file_id, file_name,
      client_content_type, last_modified_ms, staging_ref, final_ref, state,
      upload_expires_at_ms, cleanup_pending, cleanup_due_at_ms,
      cleanup_attempts, created_at_ms, updated_at_ms
    ) VALUES (
      ${auth.organizationId}, ${orgSlug}, ${auth.userId},
      ${auth.email ?? ''}, ${doc.id},
      ${args.expectedRecordState}, ${args.expectedVersion},
      ${args.expectedFileId}, ${args.fileName},
      ${args.contentType ?? null}, ${args.lastModified ?? null},
      ${encodeS3Ref(stagingKey)}, ${encodeS3Ref(finalKey)}, 'issued',
      ${uploadExpiresAt}, true,
      ${uploadExpiresAt + REPLACEMENT_UPLOAD_CLEANUP_GRACE_MS},
      0, ${now}, ${now}
    ) RETURNING id
  `;
  const intentId = inserted[0]?.id;
  if (intentId === undefined) {
    throw invalidIntent('Intent insert failed.');
  }
  return {
    intentId,
    url,
    method: 'PUT',
    uploadContentType,
    uploadExpiresAt,
  };
}

// ---------------------------------------------------------------------------
// Finalize (acquire → attest → promote → bind, resumable by lease)
// ---------------------------------------------------------------------------

function rejectionError(code: string): DocumentError {
  return new DocumentError(
    code,
    'The replacement upload can no longer be finalized.',
  );
}

export async function finalizeReplacementUpload(
  sql: Sql,
  auth: ProjectAuthContext,
  intentId: string,
): Promise<{ version: number }> {
  const leaseId = randomUUID();
  let acquired = false;
  try {
    // Acquire: one transaction that re-checks every mint-time guard and
    // takes the lease (or answers a settled outcome).
    const phase = await sql.begin(async (tx) => {
      const intent = await requireIntentForPrincipal(tx, auth, intentId);
      if (intent.state === 'bound') {
        if (intent.resultVersion === null) {
          throw invalidIntent(
            'The completed replacement has no result version.',
          );
        }
        return { kind: 'bound' as const, version: intent.resultVersion };
      }
      if (
        intent.state === 'failed' ||
        intent.state === 'cancelled' ||
        intent.state === 'superseded' ||
        intent.state === 'cleaned'
      ) {
        throw rejectionError(intent.state);
      }
      const now = Date.now();
      if (
        intent.leaseId !== null &&
        intent.leaseId !== leaseId &&
        (intent.leaseExpiresAt ?? 0) > now
      ) {
        throw new DocumentError(
          'UPLOAD_INTENT_IN_PROGRESS',
          'This replacement upload is already being finalized.',
        );
      }
      const { doc, record } = await requireReplacementDocument(
        tx,
        auth,
        intent.documentId,
      );
      if (!replacementTargetMatches(doc, record, intent)) {
        await supersedeIntent(
          tx,
          intent,
          'The controlled record changed before binding.',
        );
        throw rejectionError('DOCUMENT_RECORD_VERSION_MISMATCH');
      }
      if (intent.expectedRecordState === 'approved') {
        requireCurrentApprovedSnapshot(doc, record);
      }
      await assertReplacementNotHeld(tx, doc);
      assertDraftHistoryCapacity(doc, record);

      const leaseExpiresAt = now + REPLACEMENT_UPLOAD_LEASE_MS;
      if (intent.state === 'promoted') {
        const claimed = await tx<{ id: string }[]>`
          UPDATE app.document_replacement_uploads SET
            lease_id = ${leaseId}, lease_expires_at_ms = ${leaseExpiresAt},
            cleanup_due_at_ms = ${now + REPLACEMENT_UPLOAD_RECOVERY_MS},
            updated_at_ms = ${now}
          WHERE id = ${intent.id}
            AND (lease_id IS NULL OR lease_id = ${leaseId}
              OR lease_expires_at_ms <= ${now})
          RETURNING id
        `;
        if (!claimed[0]) {
          throw new DocumentError(
            'UPLOAD_INTENT_IN_PROGRESS',
            'This replacement upload is already being finalized.',
          );
        }
        return { kind: 'promoted' as const, intent };
      }
      // The staged blob must not already back a registered file.
      const bound = await tx<{ id: string }[]>`
        SELECT id FROM app.file_metadata
        WHERE org_id = ${intent.organizationId}
          AND storage_ref = ${intent.stagingRef}
        LIMIT 1
      `;
      if (bound[0]) {
        throw new DocumentError(
          'UPLOAD_BLOB_ALREADY_BOUND',
          'The uploaded replacement file is already in use.',
        );
      }
      const claimed = await tx<{ id: string }[]>`
        UPDATE app.document_replacement_uploads SET
          state = 'attesting', lease_id = ${leaseId},
          lease_expires_at_ms = ${leaseExpiresAt},
          cleanup_due_at_ms = ${leaseExpiresAt + REPLACEMENT_UPLOAD_CLEANUP_GRACE_MS},
          last_error = NULL, updated_at_ms = ${now}
        WHERE id = ${intent.id}
          AND (lease_id IS NULL OR lease_id = ${leaseId}
            OR lease_expires_at_ms <= ${now})
        RETURNING id
      `;
      if (!claimed[0]) {
        throw new DocumentError(
          'UPLOAD_INTENT_IN_PROGRESS',
          'This replacement upload is already being finalized.',
        );
      }
      return { kind: 'attest' as const, intent };
    });
    if (phase.kind === 'bound') return { version: phase.version };
    acquired = true;
    let intent = phase.intent;

    if (phase.kind === 'attest') {
      // Attest OUTSIDE any transaction (network reads): size cap, magic-byte
      // content type, sha256; then create-only promotion + verified readback.
      const declaredSize = await s3BlobSize(intent.orgSlug, intent.stagingRef);
      if (declaredSize === null) {
        throw new DocumentError(
          'UPLOAD_BLOB_INVALID',
          'The uploaded replacement file no longer exists.',
        );
      }
      if (declaredSize > DOCUMENT_MAX_FILE_SIZE) {
        throw new DocumentError(
          'FILE_TOO_LARGE',
          `File exceeds the ${Math.round(DOCUMENT_MAX_FILE_SIZE / (1024 * 1024))} MB limit`,
          400,
          { reasonCode: 'file_too_large', limitBytes: DOCUMENT_MAX_FILE_SIZE },
        );
      }
      const store = await resolveObjectStore(intent.orgSlug);
      const stagingParsed = parseBlobRef(intent.stagingRef);
      if (
        stagingParsed.backend !== 's3' ||
        !s3KeyBelongsToOrg(stagingParsed.key, intent.orgSlug)
      ) {
        throw invalidIntent('The replacement staging key is invalid.');
      }
      const bytes = await s3GetObjectBytes(store, stagingParsed.key);
      if (bytes.byteLength > DOCUMENT_MAX_FILE_SIZE) {
        throw new DocumentError(
          'FILE_TOO_LARGE',
          `File exceeds the ${Math.round(DOCUMENT_MAX_FILE_SIZE / (1024 * 1024))} MB limit`,
          400,
          { reasonCode: 'file_too_large', limitBytes: DOCUMENT_MAX_FILE_SIZE },
        );
      }
      const verifiedContentType = await attestDocumentContentType(
        bytes,
        intent.fileName,
      );
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      await putImmutableS3Blob(
        intent.orgSlug,
        intent.finalRef,
        bytes,
        verifiedContentType,
      );
      const finalParsed = parseBlobRef(intent.finalRef);
      if (finalParsed.backend !== 's3') {
        throw invalidIntent('The replacement final key is invalid.');
      }
      const promoted = await s3GetObjectBytes(store, finalParsed.key);
      const promotedHash = createHash('sha256').update(promoted).digest('hex');
      if (promotedHash !== contentHash) {
        throw new DocumentError(
          'UPLOAD_BLOB_INVALID',
          'The immutable replacement object does not match its attestation.',
        );
      }
      await sql`
        UPDATE app.document_replacement_uploads SET
          state = 'promoted', verified_content_type = ${verifiedContentType},
          content_hash = ${contentHash}, size = ${bytes.byteLength},
          updated_at_ms = ${Date.now()}
        WHERE id = ${intent.id} AND lease_id = ${leaseId}
      `;
      intent = {
        ...intent,
        verifiedContentType,
        contentHash,
        size: bytes.byteLength,
      };
    }

    // Bind: one transaction under the lease.
    const version = await sql.begin((tx) =>
      bindReplacement(tx, auth, intent, leaseId),
    );
    return { version };
  } catch (error) {
    if (acquired) {
      try {
        await sql`
          UPDATE app.document_replacement_uploads SET
            state = 'failed', cleanup_pending = true,
            cleanup_due_at_ms = ${Date.now() + REPLACEMENT_UPLOAD_CLEANUP_GRACE_MS},
            lease_id = NULL, lease_expires_at_ms = NULL,
            last_error = ${error instanceof Error ? error.message : String(error)},
            updated_at_ms = ${Date.now()}
          WHERE id = ${intentId} AND lease_id = ${leaseId}
            AND state IN ('attesting', 'promoted')
        `;
        await scheduleCleanupSweep(sql);
      } catch (failError) {
        console.warn('[replacement] fail-mark failed:', failError);
      }
    }
    throw error;
  }
}

function extractExtensionLocal(fileName: string): string | undefined {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(fileName.trim());
  return match?.[1]?.toLowerCase();
}

async function bindReplacement(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  intentIn: ReplacementIntentRow,
  leaseId: string,
): Promise<number> {
  const intent = await requireIntentForPrincipal(tx, auth, intentIn.id);
  if (intent.state === 'bound' && intent.resultVersion !== null) {
    return intent.resultVersion;
  }
  if (
    intent.state !== 'promoted' ||
    intent.leaseId !== leaseId ||
    (intent.leaseExpiresAt ?? 0) <= Date.now() ||
    intent.verifiedContentType === null ||
    intent.contentHash === null ||
    intent.size === null
  ) {
    throw invalidIntent(
      'The replacement upload has not been attested for this lease.',
    );
  }
  const verifiedContentType = intent.verifiedContentType;
  const contentHash = intent.contentHash;
  const size = intent.size;
  const { doc, record } = await requireReplacementDocument(
    tx,
    auth,
    intent.documentId,
  );
  if (!replacementTargetMatches(doc, record, intent)) {
    await supersedeIntent(
      tx,
      intent,
      'The controlled record changed before the final bind.',
    );
    throw rejectionError('DOCUMENT_RECORD_VERSION_MISMATCH');
  }
  if (intent.expectedRecordState === 'approved') {
    requireCurrentApprovedSnapshot(doc, record);
  }
  await assertReplacementNotHeld(tx, doc);
  assertDraftHistoryCapacity(doc, record);

  const expectedExtension =
    doc.extension ?? extractExtensionLocal(doc.title ?? '');
  const replacementExtension = extractExtensionLocal(intent.fileName);
  if (replacementExtension !== expectedExtension) {
    throw new DocumentError(
      'DOCUMENT_RECORD_EXTENSION_MISMATCH',
      expectedExtension !== undefined
        ? `Choose a .${expectedExtension} file to replace this document.`
        : 'Choose a file with the same format as this document.',
      400,
      { expectedExtension: expectedExtension ?? null },
    );
  }
  if (doc.contentHash === contentHash) {
    throw new DocumentError(
      'DOCUMENT_RECORD_FILE_UNCHANGED',
      'The selected file has the same content as the current file.',
    );
  }
  const alreadyBound = await tx<{ id: string }[]>`
    SELECT id FROM app.file_metadata
    WHERE org_id = ${intent.organizationId}
      AND storage_ref = ${intent.finalRef}
    LIMIT 1
  `;
  if (alreadyBound[0]) {
    throw new DocumentError(
      'UPLOAD_BLOB_ALREADY_BOUND',
      'The replacement blob is already bound.',
    );
  }
  // Policy gates with the ATTESTED size/type (never browser metadata).
  const validated = await validateDocumentUploadForOrg(tx, auth, {
    fileName: intent.fileName,
    contentType: verifiedContentType,
    size,
  });
  if (validated.contentType !== verifiedContentType) {
    throw invalidIntent('The server attestation changed during binding.');
  }
  if (
    expectedExtension === undefined &&
    doc.mimeType !== null &&
    verifiedContentType !== doc.mimeType
  ) {
    throw new DocumentError(
      'DOCUMENT_RECORD_EXTENSION_MISMATCH',
      'Choose a file with the same format as this document.',
    );
  }

  const shouldIndex = isRagIndexableFile(intent.fileName, verifiedContentType);
  const now = Date.now();
  const insertedMeta = await tx<{ id: string }[]>`
    INSERT INTO app.file_metadata (
      org_id, storage_ref, document_id, source, file_name, content_type,
      size, sha256, uploaded_by, rag_status, rag_queued_at_ms, created_at_ms
    ) VALUES (
      ${intent.organizationId}, ${intent.finalRef}, ${intent.documentId},
      'user', ${intent.fileName}, ${verifiedContentType}, ${size},
      ${contentHash}, ${intent.actorUserId},
      ${shouldIndex ? 'queued' : 'unsupported'},
      ${shouldIndex ? now : null}, ${now}
    ) RETURNING id
  `;
  const fileMetadataId = insertedMeta[0]?.id;
  if (fileMetadataId === undefined) {
    throw invalidIntent('The replacement file row insert failed.');
  }

  let resultVersion = record.version;
  if (intent.expectedRecordState === 'approved') {
    const opened = await openRecordRevision(tx, auth, doc.id);
    resultVersion = opened.version;
  }

  const previousFileRef = doc.fileRef;
  const previousHash = doc.contentHash;
  const metadata = {
    ...doc.metadata,
    size,
    sourceProvider: doc.sourceProvider ?? 'upload',
    sourceMode: 'manual',
    lastModified: intent.lastModified ?? now,
  };
  // The content swap: current blob into history, replacement becomes
  // current (the 0.4 `replaceControlledDocumentContentInternal`).
  await tx`
    UPDATE app.documents SET
      file_ref = ${intent.finalRef},
      mime_type = ${verifiedContentType},
      extension = ${replacementExtension ?? null},
      content_hash = ${contentHash},
      metadata = ${tx.json(toJson(metadata))},
      history_files = CASE
        WHEN ${previousFileRef}::text IS NOT NULL
          AND NOT (history_files @> ARRAY[${previousFileRef}::text])
        THEN history_files || ${[previousFileRef ?? '']}
        ELSE history_files
      END,
      updated_at_ms = ${now}
    WHERE id = ${doc.id}
  `;
  if (shouldIndex) {
    await addJobInTx(tx, 'rag.index_file', { fileId: fileMetadataId });
  }
  if (previousFileRef !== null && previousFileRef !== intent.finalRef) {
    // The corpus is keyed by blob ref, so the replaced version's rows must
    // go dark now that the ref is history — otherwise the superseded
    // content keeps answering RAG queries as if current. Bytes stay (the
    // retained snapshot in `history_files` holds them); the durable job
    // keeps network I/O out of this transaction and retries on failure.
    await addJobInTx(tx, 'knowledge.release_refs', {
      organizationId: intent.organizationId,
      refs: [previousFileRef],
    });
  }
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: intent.actorUserId,
    actorEmail: intent.actorEmail,
    actorType: 'user',
    action: 'document.record_file_replaced',
    category: 'data',
    resourceType: 'document',
    resourceId: doc.id,
    ...(doc.title !== null ? { resourceName: doc.title } : {}),
    previousState: {
      state: 'draft',
      version: resultVersion,
      fileId: previousFileRef,
      contentHash: previousHash,
    },
    newState: {
      state: 'draft',
      version: resultVersion,
      fileId: intent.finalRef,
      contentHash,
    },
    metadata: {
      replacementIntentId: intent.id,
      sourceRecordState: intent.expectedRecordState,
      replacementFileName: intent.fileName,
      replacementSize: size,
    },
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'document',
    entityId: doc.id,
  });

  const cleanupPending = intent.stagingRef !== intent.finalRef;
  await tx`
    UPDATE app.document_replacement_uploads SET
      state = 'bound', result_version = ${resultVersion},
      cleanup_pending = ${cleanupPending},
      cleanup_due_at_ms = ${cleanupPending ? Math.max(now, intent.uploadExpiresAt + REPLACEMENT_UPLOAD_CLEANUP_GRACE_MS) : null},
      lease_id = NULL, lease_expires_at_ms = NULL, last_error = NULL,
      updated_at_ms = ${now}
    WHERE id = ${intent.id}
  `;
  if (cleanupPending) {
    await addJobInTx(tx, 'documents.replacement_cleanup', {});
  }
  return resultVersion;
}

// ---------------------------------------------------------------------------
// Status / cancel / cleanup
// ---------------------------------------------------------------------------

export interface ReplacementUploadStatus {
  state: string;
  resultVersion?: number;
  cleanupPending: boolean;
  lastError?: string;
  updatedAt: number;
}

/** The principal's own intent status (the reconcile read). */
export async function getReplacementUploadStatus(
  sql: Sql,
  auth: ProjectAuthContext,
  intentId: string,
): Promise<ReplacementUploadStatus> {
  const intent = await requireIntentForPrincipal(sql, auth, intentId);
  return {
    state: intent.state,
    ...(intent.resultVersion !== null
      ? { resultVersion: intent.resultVersion }
      : {}),
    cleanupPending: intent.cleanupPending,
    ...(intent.lastError !== null ? { lastError: intent.lastError } : {}),
    updatedAt: intent.updatedAt,
  };
}

export async function cancelReplacementUpload(
  sql: Sql,
  auth: ProjectAuthContext,
  intentId: string,
): Promise<{ state: 'bound' | 'cancelled'; resultVersion?: number }> {
  const outcome = await sql.begin(async (tx) => {
    const intent = await requireIntentForPrincipal(tx, auth, intentId);
    if (intent.state === 'bound') {
      return {
        state: 'bound' as const,
        ...(intent.resultVersion !== null
          ? { resultVersion: intent.resultVersion }
          : {}),
      };
    }
    const now = Date.now();
    await tx`
      UPDATE app.document_replacement_uploads SET
        state = 'cancelled', cleanup_pending = true,
        cleanup_due_at_ms = ${Math.max(now, intent.uploadExpiresAt + REPLACEMENT_UPLOAD_CLEANUP_GRACE_MS)},
        lease_id = NULL, lease_expires_at_ms = NULL,
        last_error = 'Replacement upload cancelled.', updated_at_ms = ${now}
      WHERE id = ${intent.id}
    `;
    await addJobInTx(tx, 'documents.replacement_cleanup', {});
    return { state: 'cancelled' as const };
  });
  return outcome;
}

/**
 * Physically remove due staging/orphan refs, acknowledging each intent only
 * after every delete succeeds; failures stay durable with backoff. The
 * `documents.replacement_cleanup` job + a periodic schedule drive it.
 */
export async function runReplacementCleanup(sql: Sql): Promise<number> {
  const now = Date.now();
  const due = await sql<ReplacementIntentRow[]>`
    SELECT ${sql.unsafe(INTENT_COLUMNS)} FROM app.document_replacement_uploads
    WHERE cleanup_pending = true
      AND cleanup_due_at_ms IS NOT NULL AND cleanup_due_at_ms <= ${now}
      AND state <> 'cleaned'
    ORDER BY cleanup_due_at_ms ASC
    LIMIT ${MAX_CLEANUP_BATCH}
  `;
  let cleaned = 0;
  for (const intent of due) {
    // A live lease means a finalize is mid-flight — leave it alone.
    if ((intent.leaseExpiresAt ?? 0) > now) continue;
    const refs: string[] = [];
    if (intent.state !== 'bound') refs.push(intent.stagingRef);
    if (intent.state !== 'bound' && intent.finalRef !== intent.stagingRef) {
      refs.push(intent.finalRef);
    }
    if (intent.state === 'bound' && intent.stagingRef !== intent.finalRef) {
      refs.push(intent.stagingRef);
    }
    try {
      const store = await resolveObjectStore(intent.orgSlug);
      for (const ref of refs) {
        const parsed = parseBlobRef(ref);
        if (parsed.backend !== 's3') continue;
        // Never reclaim a ref a registered file row now owns.
        const owned = await sql<{ id: string }[]>`
          SELECT id FROM app.file_metadata
          WHERE org_id = ${intent.organizationId} AND storage_ref = ${ref}
          LIMIT 1
        `;
        if (owned[0]) continue;
        await s3DeleteObject(store, parsed.key);
      }
      await sql`
        UPDATE app.document_replacement_uploads SET
          cleanup_pending = false,
          state = CASE WHEN state = 'bound' THEN state ELSE 'cleaned' END,
          cleanup_due_at_ms = NULL, updated_at_ms = ${Date.now()}
        WHERE id = ${intent.id}
      `;
      cleaned += 1;
    } catch (error) {
      await sql`
        UPDATE app.document_replacement_uploads SET
          cleanup_attempts = cleanup_attempts + 1,
          cleanup_due_at_ms = ${Date.now() + CLEANUP_RETRY_BACKOFF_MS},
          last_error = ${error instanceof Error ? error.message : String(error)},
          updated_at_ms = ${Date.now()}
        WHERE id = ${intent.id}
      `;
      console.warn(
        `[replacement] cleanup failed for intent ${intent.id}:`,
        error,
      );
    }
  }
  return cleaned;
}
