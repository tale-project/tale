import { createHash } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { extractExtension } from '../../../lib/shared/file-types.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { putOrgBlobBytes, registerUploadedBytes } from '../files/service.ts';
import { markRagQueued } from '../knowledge/service.ts';
import { releasePreviousBlob } from './blob-rotation.ts';
import { emitDocumentChangeHints } from './hints.ts';
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
   * org-hub one every other project's agents would retrieve. A `folderId`
   * wins over it — scope follows the folder there — so this only applies to
   * a FOLDERLESS write. */
  projectId?: string;
  /**
   * File the document INTO this folder (the workflow `document.create`
   * contract). The folder's scope becomes the document's — its project, or
   * its hub team — derived from the folder row instead of trusted from the
   * caller, so a filed output is never invisible in the project's Files
   * tree. Within a folder, a same-named ACTIVE document is the same document
   * whoever wrote it first (an upload, a seed, an earlier run): the write
   * refreshes that row's blob instead of parking a same-named sibling.
   */
  folderId?: string;
  /** Whom the governance trail names — the binding actor, never whoever
   * deployed the automation. Absent writes no audit row. */
  auditActorId?: string;
}

/** The scope a filed document takes: the folder's, or the caller's project. */
interface TargetScope {
  projectId: string | null;
  teamId: string | null;
  teamTags: string[];
}

export interface UpsertAgentDocumentResult {
  documentId: string;
  action: 'created' | 'updated';
  /** Whether the row now serves DIFFERENT bytes than before — a fresh row, or
   * a refresh that swapped the blob. False for a same-blob re-run, so a
   * caller keys blob promotion (file binding, indexing) on new content. */
  contentChanged: boolean;
}

/**
 * Create or refresh the agent's document, keyed by `(org, externalItemId)`.
 * The lookup deliberately ignores lifecycle: a trashed row with the same key
 * is refreshed in place rather than resurrected as a duplicate. A row that
 * became a controlled record refuses the refresh (content freeze) — the
 * record lifecycle owns those bytes.
 *
 * Concurrent runs converge on ONE row: the key is unique in the schema
 * (0073), the insert is `ON CONFLICT DO NOTHING`, and a run that loses the
 * insert race re-reads the winner's row under the lock and refreshes it —
 * FOR UPDATE over zero rows locks nothing, so the check alone never could.
 */
export async function upsertAgentDocument(
  sql: Sql,
  args: UpsertAgentDocumentArgs,
): Promise<UpsertAgentDocumentResult> {
  const title = args.title.trim();
  if (title === '' || title.length > 512) {
    throw new DocumentError('DOCUMENT_TITLE_INVALID', 'Invalid title');
  }
  const extension = args.extension ?? extractExtension(title);
  const sourceProvider = args.sourceProvider ?? 'agent';
  return sql.begin(async (tx) => {
    const now = Date.now();
    const scope = await resolveTargetScope(tx, args);
    // `content_hash` mirrors the bytes `file_ref` serves — resolved from the
    // blob's ledger row (`storeAgentTextBlob` stamps it) so a refreshed
    // document never keeps the previous blob's hash.
    const ledger = await tx<{ contentHash: string | null }[]>`
      SELECT content_hash AS "contentHash" FROM app.file_metadata
      WHERE org_id = ${args.organizationId} AND storage_ref = ${args.fileRef}
      LIMIT 1
    `;
    const contentHash = ledger[0]?.contentHash ?? null;
    // Every write is also a realtime fact: the document reads refetch, and
    // a project document moves its folder's task facts (`hints.ts`).
    const hint = (documentId: string) =>
      emitDocumentChangeHints(tx, {
        orgId: args.organizationId,
        entityId: documentId,
        projectId: scope.projectId,
      });

    const refresh = async (existing: {
      id: string;
      fileRef: string | null;
      record: Record<string, unknown> | null;
    }): Promise<UpsertAgentDocumentResult> => {
      // 'agent' documents can be controlled records (records.ts): a re-run
      // is a generic content writer, so the SAME freeze rule every human
      // content path applies holds here — a controlled record's bytes move
      // only through the attested replacement flow.
      assertGenericDocumentContentWritableJson(existing.record);
      // A folderless write keeps the row where it is (the hub root, or the
      // folder a person moved it to); a folder write files it there and
      // re-scopes it to that folder — a hub team's row cannot keep a team
      // once it sits in a project folder, and vice versa.
      const refile = args.folderId !== undefined;
      await tx`
        UPDATE app.documents SET
          title = ${title}, file_ref = ${args.fileRef},
          mime_type = ${args.mimeType}, extension = ${extension ?? null},
          source_provider = ${sourceProvider},
          content_hash = ${contentHash},
          project_id = ${scope.projectId},
          folder_id = CASE WHEN ${refile} THEN ${args.folderId ?? null}
                           ELSE folder_id END,
          team_id = CASE WHEN ${refile} THEN ${scope.teamId} ELSE team_id END,
          team_tags = CASE WHEN ${refile} THEN ${scope.teamTags}::text[]
                           ELSE team_tags END,
          lifecycle_status = 'active', updated_at_ms = ${now}
        WHERE id = ${existing.id}
      `;
      if (existing.fileRef !== null && existing.fileRef !== args.fileRef) {
        await releasePreviousBlob(tx, {
          organizationId: args.organizationId,
          documentId: existing.id,
          previousFileRef: existing.fileRef,
        });
      }
      await auditWrite(tx, args, 'updated', existing.id, title);
      await hint(existing.id);
      return {
        documentId: existing.id,
        action: 'updated' as const,
        contentChanged: existing.fileRef !== args.fileRef,
      };
    };

    const existing = await lockAgentDocument(tx, args);
    if (existing !== null) return refresh(existing);
    // Same folder + same name = the same document, WHOEVER wrote it first
    // (an upload, a seed, an earlier run under another key): publishing
    // refreshes that document's blob instead of parking a sibling. Its own
    // key stays — a sync-owned row must keep reconciling under the id its
    // connector knows.
    if (args.folderId !== undefined) {
      const sameName = await lockDocumentInFolderByTitle(tx, {
        organizationId: args.organizationId,
        folderId: args.folderId,
        title,
      });
      if (sameName !== null) return refresh(sameName);
    }

    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.documents (
        org_id, title, file_ref, mime_type, extension, source_provider,
        external_item_id, content_hash, project_id, folder_id, team_id,
        team_tags, created_by, created_at_ms, updated_at_ms
      ) VALUES (
        ${args.organizationId}, ${title}, ${args.fileRef}, ${args.mimeType},
        ${extension ?? null}, ${sourceProvider},
        ${args.externalItemId}, ${contentHash}, ${scope.projectId},
        ${args.folderId ?? null}, ${scope.teamId}, ${scope.teamTags},
        ${args.createdBy}, ${now}, ${now}
      )
      ON CONFLICT (org_id, external_item_id)
        WHERE external_item_id IS NOT NULL
        DO NOTHING
      RETURNING id
    `;
    const created = inserted[0]?.id;
    if (created !== undefined) {
      await auditWrite(tx, args, 'created', created, title);
      await hint(created);
      return {
        documentId: created,
        action: 'created' as const,
        contentChanged: true,
      };
    }
    // Lost the insert race: the winner's row is committed by now (ON
    // CONFLICT waits for it) — refresh it exactly as a re-run would.
    const winner = await lockAgentDocument(tx, args);
    if (winner === null) {
      throw new DocumentError('DOCUMENT_CREATE_FAILED', 'Insert failed');
    }
    return refresh(winner);
  });
}

/**
 * Where the document lands. A folder decides everything — its project or
 * its hub team, read from the folder row itself (org-coherent, else the
 * folder reads as missing). A folderless write takes the caller's project,
 * verified the same way: a project id would otherwise land on the row
 * unverified — and a mistyped or foreign id files the document where nothing
 * reaches it (the hub lists `project_id IS NULL`, retrieval scopes need a
 * readable project), so the write answers "ok" and the work is lost. The
 * same org-scoped gate the task writer applies (`agentCreateTaskTrusted`): a
 * project or folder in ANOTHER org reads as missing, never as forbidden, so
 * an opaque id cannot be probed for existence.
 */
async function resolveTargetScope(
  tx: TransactionSql,
  args: Pick<
    UpsertAgentDocumentArgs,
    'organizationId' | 'projectId' | 'folderId'
  >,
): Promise<TargetScope> {
  if (args.folderId !== undefined) {
    const folders = await tx<TargetScope[]>`
      SELECT project_id AS "projectId", team_id AS "teamId",
             team_tags AS "teamTags"
      FROM app.folders
      WHERE id = ${args.folderId} AND org_id = ${args.organizationId}
      LIMIT 1
    `;
    const folder = folders[0];
    if (folder === undefined) {
      throw new DocumentError('FOLDER_NOT_FOUND', 'Folder not found', 404);
    }
    return folder;
  }
  if (args.projectId !== undefined) {
    const owned = await tx<{ id: string }[]>`
      SELECT id FROM app.projects
      WHERE id = ${args.projectId} AND org_id = ${args.organizationId}
      LIMIT 1
    `;
    if (owned.length === 0) {
      throw new DocumentError('PROJECT_NOT_FOUND', 'Project not found', 404);
    }
    return { projectId: args.projectId, teamId: null, teamTags: [] };
  }
  return { projectId: null, teamId: null, teamTags: [] };
}

/** The folder's ACTIVE row of that name, locked for the upsert transaction —
 * trashed twins stay out: a person who deleted `report.md` must get a fresh
 * document, not the one they removed brought back under the run's name. */
async function lockDocumentInFolderByTitle(
  tx: TransactionSql,
  args: { organizationId: string; folderId: string; title: string },
): Promise<{
  id: string;
  fileRef: string | null;
  record: Record<string, unknown> | null;
} | null> {
  const rows = await tx<
    {
      id: string;
      fileRef: string | null;
      record: Record<string, unknown> | null;
    }[]
  >`
    SELECT id, file_ref AS "fileRef", record FROM app.documents
    WHERE org_id = ${args.organizationId}
      AND folder_id = ${args.folderId}
      AND title = ${args.title}
      AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
    ORDER BY created_at_ms
    LIMIT 1
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/** The key's row (any lifecycle), locked for the upsert transaction. */
async function lockAgentDocument(
  tx: TransactionSql,
  args: { organizationId: string; externalItemId: string },
): Promise<{
  id: string;
  fileRef: string | null;
  record: Record<string, unknown> | null;
} | null> {
  const rows = await tx<
    {
      id: string;
      fileRef: string | null;
      record: Record<string, unknown> | null;
    }[]
  >`
    SELECT id, file_ref AS "fileRef", record FROM app.documents
    WHERE org_id = ${args.organizationId}
      AND external_item_id = ${args.externalItemId}
    ORDER BY created_at_ms
    LIMIT 1
    FOR UPDATE
  `;
  return rows[0] ?? null;
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
