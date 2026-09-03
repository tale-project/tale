import { createHash } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { extractExtension } from '../../../lib/shared/file-types.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { putOrgBlobBytes, registerUploadedBytes } from '../files/service.ts';
import { markRagQueued } from '../knowledge/service.ts';
import {
  assertGenericDocumentContentWritableJson,
  DocumentError,
} from './service.ts';

/**
 * The `document_create` workspace tool's lower half — an AGENT writing an
 * inline text artefact into the Documents hub (or into its run's project).
 *
 * It is its own door rather than a call into `createHubDocument` because the
 * tool's identity is IDEMPOTENCE: the same agent writing `report.md` again
 * refreshes one document instead of parking a sibling every run, so the row is
 * keyed by `external_item_id` (the caller namespaces it by scope + actor) and
 * upserted under a row lock. Authority is already resolved by the dispatch —
 * there is no role matrix here, only org scoping and the audit trail every
 * standing-grant write leaves.
 */

/** Bytes in the object store plus the `file_metadata` row that owns them. */
export async function storeAgentTextBlob(
  sql: Sql,
  args: {
    organizationId: string;
    fileName: string;
    content: string;
    contentType: string;
    /** Actor attribution for the file row (the binding actor, not a user). */
    uploadedBy?: string;
  },
): Promise<{ storageRef: string; fileId: string; size: number }> {
  const bytes = new TextEncoder().encode(args.content);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  // The blob first: a failed store must never leave a document row pointing
  // at nothing (the project-text lane's rule, for the same reason).
  const storageRef = await putOrgBlobBytes(sql, args.organizationId, {
    bytes,
    contentType: args.contentType,
  });
  const { fileId } = await registerUploadedBytes(sql, {
    organizationId: args.organizationId,
    storageRef,
    fileName: args.fileName,
    contentType: args.contentType,
    size: bytes.byteLength,
    source: 'agent',
    ...(args.uploadedBy !== undefined ? { uploadedBy: args.uploadedBy } : {}),
  });
  // Stamp the ledger row so the document upsert can keep `content_hash`
  // coherent with the bytes `file_ref` actually serves (the knowledge-entry
  // lane's sha256-hex convention).
  await sql`
    UPDATE app.file_metadata
    SET content_hash = ${contentHash}, sha256 = ${contentHash}
    WHERE id = ${fileId} AND org_id = ${args.organizationId}
  `;
  return { storageRef, fileId, size: bytes.byteLength };
}

export interface UpsertAgentDocumentArgs {
  organizationId: string;
  /** The idempotency key — the caller namespaces it by scope AND actor. */
  externalItemId: string;
  title: string;
  /** The blob ref the document serves (`storeAgentTextBlob`'s `storageRef`). */
  fileRef: string;
  mimeType: string;
  extension?: string;
  sourceProvider?: string;
  createdBy: string;
  /** Present for a project-bound run: the document is a PROJECT file, not an
   * org-hub one every other project's agents would retrieve. */
  projectId?: string;
  /** Whom the governance trail names — the binding actor, never whoever
   * deployed the automation. Absent writes no audit row. */
  auditActorId?: string;
}

/**
 * Create or refresh the agent's document, keyed by `(org, externalItemId)`.
 * The lookup deliberately ignores lifecycle: a trashed row with the same key
 * is refreshed in place rather than resurrected as a duplicate. A row that
 * became a controlled record refuses the refresh (content freeze) — the
 * record lifecycle owns those bytes.
 */
export async function upsertAgentDocument(
  sql: Sql,
  args: UpsertAgentDocumentArgs,
): Promise<{ documentId: string; action: 'created' | 'updated' }> {
  const title = args.title.trim();
  if (title === '' || title.length > 512) {
    throw new DocumentError('DOCUMENT_TITLE_INVALID', 'Invalid title');
  }
  const extension = args.extension ?? extractExtension(title);
  return sql.begin(async (tx) => {
    const now = Date.now();
    if (args.projectId !== undefined) {
      // A project id would otherwise land on the row unverified — and a
      // mistyped or foreign id files the document where nothing reaches it:
      // the hub lists `project_id IS NULL`, retrieval scopes need a readable
      // project, so the write answers "ok" and the work is lost. The same
      // org-scoped gate the task writer applies (`agentCreateTaskTrusted`):
      // a project in ANOTHER org reads as missing, never as forbidden, so an
      // opaque id cannot be probed for existence.
      const owned = await tx<{ id: string }[]>`
        SELECT id FROM app.projects
        WHERE id = ${args.projectId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      if (owned.length === 0) {
        throw new DocumentError('PROJECT_NOT_FOUND', 'Project not found', 404);
      }
    }
    // `content_hash` mirrors the bytes `file_ref` serves — resolved from the
    // blob's ledger row (`storeAgentTextBlob` stamps it) so a refreshed
    // document never keeps the previous blob's hash.
    const ledger = await tx<{ contentHash: string | null }[]>`
      SELECT content_hash AS "contentHash" FROM app.file_metadata
      WHERE org_id = ${args.organizationId} AND storage_ref = ${args.fileRef}
      LIMIT 1
    `;
    const contentHash = ledger[0]?.contentHash ?? null;
    const existing = await tx<
      { id: string; record: Record<string, unknown> | null }[]
    >`
      SELECT id, record FROM app.documents
      WHERE org_id = ${args.organizationId}
        AND external_item_id = ${args.externalItemId}
      ORDER BY created_at_ms
      LIMIT 1
      FOR UPDATE
    `;
    const documentId = existing[0]?.id;
    if (documentId !== undefined) {
      // 'agent' documents can be controlled records (records.ts): a re-run
      // is a generic content writer, so the SAME freeze rule every human
      // content path applies holds here — a controlled record's bytes move
      // only through the attested replacement flow.
      assertGenericDocumentContentWritableJson(existing[0]?.record ?? null);
      await tx`
        UPDATE app.documents SET
          title = ${title}, file_ref = ${args.fileRef},
          mime_type = ${args.mimeType}, extension = ${extension ?? null},
          content_hash = ${contentHash},
          project_id = ${args.projectId ?? null},
          lifecycle_status = 'active', updated_at_ms = ${now}
        WHERE id = ${documentId}
      `;
      await auditWrite(tx, args, 'updated', documentId, title);
      return { documentId, action: 'updated' as const };
    }
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.documents (
        org_id, title, file_ref, mime_type, extension, source_provider,
        external_item_id, content_hash, project_id, created_by,
        created_at_ms, updated_at_ms
      ) VALUES (
        ${args.organizationId}, ${title}, ${args.fileRef}, ${args.mimeType},
        ${extension ?? null}, ${args.sourceProvider ?? 'agent'},
        ${args.externalItemId}, ${contentHash}, ${args.projectId ?? null},
        ${args.createdBy}, ${now}, ${now}
      )
      RETURNING id
    `;
    const created = inserted[0]?.id;
    if (created === undefined) {
      throw new DocumentError('DOCUMENT_CREATE_FAILED', 'Insert failed');
    }
    await auditWrite(tx, args, 'created', created, title);
    return { documentId: created, action: 'created' as const };
  });
}

/** The governance trail a standing-grant document write leaves. Rides the
 * upsert's own transaction — the audit chain locks its head there. */
async function auditWrite(
  tx: TransactionSql,
  args: UpsertAgentDocumentArgs,
  action: 'created' | 'updated',
  documentId: string,
  title: string,
): Promise<void> {
  if (args.auditActorId === undefined) return;
  await createAuditLog(tx, {
    organizationId: args.organizationId,
    actorId: args.auditActorId,
    actorType: 'api',
    action: `document.${action}`,
    category: 'data',
    resourceType: 'document',
    resourceId: documentId,
    resourceName: title,
    metadata: { viaAgent: true },
    status: 'success',
  });
}

/**
 * Promote the blob to the document exactly as a human upload does: bind the
 * `file_metadata` row (so the temp-file reaper leaves it alone) and queue RAG
 * indexing for the fresh content — an agent's report is only useful later if
 * it is retrievable. Both halves ride ONE transaction; the job is enqueued in
 * it, so a rolled-back link never leaves an orphan index job.
 */
export async function linkAgentDocumentFile(
  sql: Sql,
  args: { storageRef: string; documentId: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    // The document carries the org, so the file row is bound INSIDE it — the
    // blob ref alone would be an org-blind write.
    const documents = await tx<{ orgId: string }[]>`
      SELECT org_id AS "orgId" FROM app.documents
      WHERE id = ${args.documentId} LIMIT 1
    `;
    const orgId = documents[0]?.orgId;
    if (orgId === undefined) return;
    const files = await tx<{ id: string }[]>`
      UPDATE app.file_metadata SET document_id = ${args.documentId}
      WHERE storage_ref = ${args.storageRef} AND org_id = ${orgId}
      RETURNING id
    `;
    const fileId = files[0]?.id;
    // No metadata row is not an error (0.4 parity): the document stands, it
    // just never gets indexed from this call.
    if (fileId === undefined) return;
    await markRagQueued(tx, fileId);
    await addJobInTx(tx, 'rag.index_file', { fileId });
  });
}
