import type { Sql, TransactionSql } from 'postgres';

import { hasTeamAccess } from '../../../convex/lib/team_access.ts';
import { checkProjectAccess } from '../../../convex/projects/access.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { getFileMetadata } from '../files/service.ts';
import { loadFolderOrThrow } from '../folders/service.ts';
import { markRagQueued } from '../knowledge/service.ts';
import { assertNotHeld } from '../legal_holds/service.ts';
import { stopSyncForTrashedDocument } from '../onedrive/service.ts';
import {
  loadProjectOrThrow,
  type ProjectAuthContext,
} from '../projects/service.ts';

/**
 * Documents domain, Tier A — the Document Hub core: create-from-upload,
 * hub/project scoped reads, rename/move/team edits, trash/restore soft
 * lifecycle, project attach/detach (the mutual-exclusivity rule this module
 * owns with `convex/documents/access.ts` semantics), and mention search.
 *
 * Ledger (Tier B with their infra): controlled records (approvals),
 * replacement uploads (redesign), generate-document lanes (LLM), sync
 * configs (onedrive/google_drive), RAG dispatch (knowledge), WebDAV
 * resolvers, hard-delete blob erasure + legal holds (governance).
 */

export class DocumentError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404;

  constructor(code: string, message: string, status: 400 | 403 | 404 = 400) {
    super(message);
    this.name = 'DocumentError';
    this.code = code;
    this.status = status;
  }
}

export interface DocumentRow {
  id: string;
  organizationId: string;
  title: string | null;
  fileRef: string | null;
  mimeType: string | null;
  extension: string | null;
  sourceProvider: string | null;
  externalItemId: string | null;
  contentHash: string | null;
  historyFiles: string[];
  teamId: string | null;
  teamTags: string[];
  projectId: string | null;
  createdBy: string | null;
  folderId: string | null;
  metadata: Record<string, unknown> | null;
  lifecycleStatus: string | null;
  createdAt: number;
  updatedAt: number;
}

const DOCUMENT_COLUMNS = `
  id, org_id AS "organizationId", title, file_ref AS "fileRef",
  mime_type AS "mimeType", extension, source_provider AS "sourceProvider",
  external_item_id AS "externalItemId", content_hash AS "contentHash",
  history_files AS "historyFiles",
  team_id AS "teamId", team_tags AS "teamTags", project_id AS "projectId",
  created_by AS "createdBy", folder_id AS "folderId", metadata,
  lifecycle_status AS "lifecycleStatus",
  created_at_ms::float8 AS "createdAt", updated_at_ms::float8 AS "updatedAt"
`;

function extractExtension(fileName: string): string | undefined {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(fileName.trim());
  return match?.[1]?.toLowerCase();
}

export async function loadDocumentOrThrow(
  sql: Sql | TransactionSql,
  documentId: string,
): Promise<DocumentRow> {
  const rows = await sql<DocumentRow[]>`
    SELECT ${sql.unsafe(DOCUMENT_COLUMNS)} FROM app.documents
    WHERE id = ${documentId} LIMIT 1
  `;
  const doc = rows[0];
  if (!doc) {
    throw new DocumentError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
  }
  return doc;
}

function isProjectScoped(doc: Pick<DocumentRow, 'projectId'>): boolean {
  return doc.projectId != null;
}

/** Hub visibility (never true for project docs) — the list-safe predicate. */
export function hasKnowledgeHubDocumentAccess(
  doc: Pick<DocumentRow, 'projectId' | 'teamId' | 'teamTags'>,
  userTeamIds: string[],
): boolean {
  if (isProjectScoped(doc)) {
    return false;
  }
  return hasTeamAccess(
    { teamId: doc.teamId ?? undefined, teamTags: doc.teamTags },
    userTeamIds,
  );
}

/** Point-read gate, whatever the scope; 404-shaped to avoid probing. */
export async function assertDocumentVisible(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  doc: DocumentRow,
): Promise<void> {
  if (doc.organizationId !== auth.organizationId) {
    throw new DocumentError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
  }
  if (!isProjectScoped(doc)) {
    if (!hasKnowledgeHubDocumentAccess(doc, auth.teamIds)) {
      throw new DocumentError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
    }
    return;
  }
  const project = await loadProjectOrThrow(sql, doc.projectId ?? '');
  const access = checkProjectAccess(
    { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
    auth.teamIds,
    auth.role,
  );
  if (!access.canRead) {
    throw new DocumentError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
  }
}

// ---------------------------------------------------------------------------
// Create from upload
// ---------------------------------------------------------------------------

export interface CreateDocumentFromUploadArgs {
  fileId: string;
  fileName: string;
  teamId?: string;
  projectId?: string;
  folderId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Bind a registered upload (`app.file_metadata` row) as a document. The
 * project lane needs edit access; the hub lane inherits the folder's team.
 */
export async function createDocumentFromUpload(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: CreateDocumentFromUploadArgs,
): Promise<string> {
  const file = await getFileMetadata(tx, auth.organizationId, args.fileId);
  if (!file) {
    throw new DocumentError('FILE_NOT_FOUND', 'Upload not found', 404);
  }

  let effectiveTeamId = args.teamId ?? null;
  if (args.projectId) {
    if (args.teamId) {
      throw new DocumentError(
        'DOCUMENT_SCOPE_CONFLICT',
        'A project document cannot also carry a team',
      );
    }
    const project = await loadProjectOrThrow(tx, args.projectId);
    if (project.organizationId !== auth.organizationId) {
      throw new DocumentError('ORG_FORBIDDEN', 'Wrong organization', 403);
    }
    const access = checkProjectAccess(
      { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
      auth.teamIds,
      auth.role,
    );
    if (!access.canRead) {
      throw new DocumentError('PROJECT_FORBIDDEN', 'No project access', 403);
    }
    if (!access.canEdit) {
      throw new DocumentError('RBAC_FORBIDDEN', 'Editor role required', 403);
    }
    if (args.folderId) {
      const folder = await loadFolderOrThrow(tx, args.folderId);
      if (
        folder.organizationId !== auth.organizationId ||
        folder.projectId !== args.projectId
      ) {
        throw new DocumentError('FOLDER_NOT_FOUND', 'Folder not found', 404);
      }
    }
  } else if (args.folderId) {
    const folder = await loadFolderOrThrow(tx, args.folderId);
    if (
      folder.organizationId !== auth.organizationId ||
      folder.projectId !== null
    ) {
      throw new DocumentError('FOLDER_NOT_FOUND', 'Folder not found', 404);
    }
    if (folder.teamId) {
      if (
        !hasTeamAccess(
          { teamId: folder.teamId, teamTags: folder.teamTags },
          auth.teamIds,
        )
      ) {
        throw new DocumentError(
          'FOLDER_NOT_ACCESSIBLE',
          'Folder not accessible',
          403,
        );
      }
      effectiveTeamId = folder.teamId;
    }
  }

  const now = Date.now();
  const extension = extractExtension(args.fileName);
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.documents (
      org_id, title, file_ref, mime_type, extension, source_provider,
      team_id, team_tags, project_id, created_by, folder_id, metadata,
      created_at_ms, updated_at_ms
    ) VALUES (
      ${auth.organizationId}, ${args.fileName}, ${file.storageRef},
      ${file.contentType}, ${extension ?? null}, 'upload',
      ${effectiveTeamId}, ${effectiveTeamId ? [effectiveTeamId] : []},
      ${args.projectId ?? null}, ${auth.userId}, ${args.folderId ?? null},
      ${args.metadata === undefined ? null : tx.json(toJson(args.metadata))},
      ${now}, ${now}
    )
    RETURNING id
  `;
  const documentId = inserted[0]?.id;
  if (!documentId) {
    throw new DocumentError('DOCUMENT_CREATE_FAILED', 'Insert failed');
  }
  await tx`
    UPDATE app.file_metadata SET document_id = ${documentId}
    WHERE id = ${args.fileId}
  `;
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
    actorType: 'user',
    action: 'document.created',
    category: 'data',
    resourceType: 'document',
    resourceId: documentId,
    resourceName: args.fileName,
    metadata: {
      sourceProvider: 'upload',
      projectId: args.projectId ?? null,
      teamId: effectiveTeamId,
    },
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'document',
    entityId: documentId,
  });
  // RAG ingest rides the same transaction: rollback enqueues nothing.
  await markRagQueued(tx, args.fileId);
  await addJobInTx(tx, 'rag.index_file', { fileId: args.fileId });
  return documentId;
}

// ---------------------------------------------------------------------------
// Updates + lifecycle
// ---------------------------------------------------------------------------

export async function updateDocument(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    documentId: string;
    title?: string;
    folderId?: string | null;
    teamId?: string | null;
    content?: string | null;
    metadata?: Record<string, unknown> | null;
    mimeType?: string | null;
    extension?: string | null;
    sourceProvider?: string | null;
  },
): Promise<void> {
  const doc = await loadDocumentOrThrow(tx, args.documentId);
  await assertDocumentVisible(tx, auth, doc);

  let title = doc.title;
  if (args.title !== undefined) {
    const trimmed = args.title.trim();
    if (trimmed.length === 0 || trimmed.length > 512) {
      throw new DocumentError('DOCUMENT_TITLE_INVALID', 'Invalid title');
    }
    title = trimmed;
  }
  let folderId = doc.folderId;
  if (args.folderId !== undefined) {
    if (args.folderId !== null) {
      const folder = await loadFolderOrThrow(tx, args.folderId);
      const sameScope = isProjectScoped(doc)
        ? folder.projectId === doc.projectId
        : folder.projectId === null;
      if (folder.organizationId !== auth.organizationId || !sameScope) {
        throw new DocumentError('FOLDER_NOT_FOUND', 'Folder not found', 404);
      }
    }
    folderId = args.folderId;
  }
  let teamId = doc.teamId;
  let teamTags = doc.teamTags;
  if (args.teamId !== undefined) {
    if (isProjectScoped(doc) && args.teamId !== null) {
      throw new DocumentError(
        'DOCUMENT_SCOPE_CONFLICT',
        'A project document cannot carry a team',
      );
    }
    teamId = args.teamId;
    teamTags = args.teamId ? [args.teamId] : [];
  }

  await tx`
    UPDATE app.documents SET
      title = ${title}, folder_id = ${folderId}, team_id = ${teamId},
      team_tags = ${teamTags},
      content = ${args.content !== undefined ? args.content : tx.unsafe('content')},
      metadata = ${args.metadata !== undefined ? (args.metadata === null ? null : tx.json(toJson(args.metadata))) : tx.unsafe('metadata')},
      mime_type = ${args.mimeType !== undefined ? args.mimeType : tx.unsafe('mime_type')},
      extension = ${args.extension !== undefined ? args.extension : tx.unsafe('extension')},
      source_provider = ${args.sourceProvider !== undefined ? args.sourceProvider : tx.unsafe('source_provider')},
      updated_at_ms = ${Date.now()}
    WHERE id = ${args.documentId}
  `;
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'document',
    entityId: args.documentId,
  });
}

/** Soft trash / restore. Hard delete + blob erasure land with governance. */
export async function setDocumentTrashed(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  documentId: string,
  trashed: boolean,
): Promise<void> {
  const doc = await loadDocumentOrThrow(tx, documentId);
  await assertDocumentVisible(tx, auth, doc);
  if (trashed) {
    // Preservation gate: an org hold (or the author's custodian hold)
    // freezes destructive paths.
    await assertNotHeld(
      tx,
      auth.organizationId,
      'document',
      documentId,
      undefined,
      doc.createdBy ?? undefined,
    );
  }
  await tx`
    UPDATE app.documents SET
      lifecycle_status = ${trashed ? 'trashed' : null},
      status_changed_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
    WHERE id = ${documentId}
  `;
  if (trashed) {
    // A directly-selected single-file OneDrive sync maps 1:1 to this
    // document — trashing it means "stop syncing it", or the next scheduled
    // run refreshes the mirror the user just removed. No-op otherwise.
    await stopSyncForTrashedDocument(tx, {
      organizationId: doc.organizationId,
      metadata: doc.metadata,
    });
  }
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
    actorType: 'user',
    action: trashed ? 'document.trashed' : 'document.restored',
    category: 'data',
    resourceType: 'document',
    resourceId: documentId,
    ...(doc.title !== null ? { resourceName: doc.title } : {}),
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'document',
    entityId: documentId,
  });
}

// ---------------------------------------------------------------------------
// Project attach/detach (the projects-domain gap, closed here)
// ---------------------------------------------------------------------------

/** Attach a hub document to a project (requires teamless doc + edit access). */
export async function attachDocumentToProject(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { documentId: string; projectId: string },
): Promise<void> {
  const doc = await loadDocumentOrThrow(tx, args.documentId);
  await assertDocumentVisible(tx, auth, doc);
  if (doc.projectId) {
    throw new DocumentError(
      'DOCUMENT_ALREADY_IN_PROJECT',
      'Document already belongs to a project',
    );
  }
  if (doc.teamId || doc.teamTags.length > 0) {
    throw new DocumentError(
      'DOCUMENT_SCOPE_CONFLICT',
      'A team document cannot be attached to a project',
    );
  }
  const project = await loadProjectOrThrow(tx, args.projectId);
  const access = checkProjectAccess(
    { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
    auth.teamIds,
    auth.role,
  );
  if (!access.canRead || !access.canEdit) {
    throw new DocumentError('RBAC_FORBIDDEN', 'Editor role required', 403);
  }
  await tx`
    UPDATE app.documents SET
      project_id = ${args.projectId}, folder_id = NULL,
      updated_at_ms = ${Date.now()}
    WHERE id = ${args.documentId}
  `;
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
    actorType: 'user',
    action: 'project.file.attached',
    category: 'data',
    resourceType: 'project',
    resourceId: args.projectId,
    resourceName: project.name,
    metadata: { documentId: args.documentId },
    status: 'success',
  });
}

/** Detach back to the org-wide library (explicit destination, audited). */
export async function detachDocumentFromProject(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  documentId: string,
): Promise<void> {
  const doc = await loadDocumentOrThrow(tx, documentId);
  await assertDocumentVisible(tx, auth, doc);
  if (!doc.projectId) {
    throw new DocumentError(
      'DOCUMENT_NOT_IN_PROJECT',
      'Document is not attached to a project',
    );
  }
  const project = await loadProjectOrThrow(tx, doc.projectId);
  const access = checkProjectAccess(
    { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
    auth.teamIds,
    auth.role,
  );
  if (!access.canEdit) {
    throw new DocumentError('RBAC_FORBIDDEN', 'Editor role required', 403);
  }
  await tx`
    UPDATE app.documents SET
      project_id = NULL, folder_id = NULL, updated_at_ms = ${Date.now()}
    WHERE id = ${documentId}
  `;
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
    actorType: 'user',
    action: 'project.file.detached',
    category: 'data',
    resourceType: 'project',
    resourceId: doc.projectId,
    resourceName: project.name,
    metadata: { documentId, destination: 'org-library' },
    status: 'success',
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Hub listing (project docs never appear); optional folder filter. */
export async function listDocuments(
  sql: Sql,
  auth: ProjectAuthContext,
  options: {
    folderId?: string | null;
    includeTrashed?: boolean;
    limit?: number;
  } = {},
): Promise<DocumentRow[]> {
  const limit = Math.min(options.limit ?? 200, 500);
  const rows = await sql<DocumentRow[]>`
    SELECT ${sql.unsafe(DOCUMENT_COLUMNS)} FROM app.documents
    WHERE org_id = ${auth.organizationId}
      AND project_id IS NULL
      AND (${options.includeTrashed ?? false}
        OR lifecycle_status IS DISTINCT FROM 'trashed')
      AND (${options.folderId === undefined}
        OR folder_id IS NOT DISTINCT FROM ${options.folderId ?? null})
    ORDER BY updated_at_ms DESC
    LIMIT ${limit}
  `;
  return rows.filter((doc) => hasKnowledgeHubDocumentAccess(doc, auth.teamIds));
}

/** One project's documents (project read access required). */
export async function listProjectDocuments(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<DocumentRow[]> {
  const project = await loadProjectOrThrow(sql, projectId);
  const access = checkProjectAccess(
    { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
    auth.teamIds,
    auth.role,
  );
  if (!access.canRead) {
    throw new DocumentError('PROJECT_FORBIDDEN', 'No project access', 403);
  }
  return sql<DocumentRow[]>`
    SELECT ${sql.unsafe(DOCUMENT_COLUMNS)} FROM app.documents
    WHERE org_id = ${auth.organizationId}
      AND project_id = ${projectId}
      AND lifecycle_status IS DISTINCT FROM 'trashed'
    ORDER BY updated_at_ms DESC
    LIMIT 500
  `;
}

export async function getDocumentById(
  sql: Sql,
  auth: ProjectAuthContext,
  documentId: string,
): Promise<DocumentRow> {
  const doc = await loadDocumentOrThrow(sql, documentId);
  await assertDocumentVisible(sql, auth, doc);
  return doc;
}

/** Bounded hub title search for the `@` mention picker. */
export async function searchDocumentsForMention(
  sql: Sql,
  auth: ProjectAuthContext,
  query: string,
  limit = 20,
): Promise<DocumentRow[]> {
  const term = `%${query.trim()}%`;
  if (query.trim().length === 0) {
    return [];
  }
  const rows = await sql<DocumentRow[]>`
    SELECT ${sql.unsafe(DOCUMENT_COLUMNS)} FROM app.documents
    WHERE org_id = ${auth.organizationId}
      AND project_id IS NULL
      AND lifecycle_status IS DISTINCT FROM 'trashed'
      AND title ILIKE ${term}
    ORDER BY updated_at_ms DESC
    LIMIT ${Math.min(limit, 50) * 3}
  `;
  return rows
    .filter((doc) => hasKnowledgeHubDocumentAccess(doc, auth.teamIds))
    .slice(0, Math.min(limit, 50));
}

// ---------------------------------------------------------------------------
// REST hub surface (the /api/v1/documents door)
// ---------------------------------------------------------------------------

export interface CreateHubDocumentArgs {
  title: string;
  content?: string;
  fileId?: string;
  mimeType?: string;
  extension?: string;
  sourceProvider?: string;
  metadata?: Record<string, unknown>;
  teamId?: string;
  folderId?: string;
}

/**
 * Create a Knowledge-Hub document (never project-scoped — that lane is
 * `createDocumentFromUpload`). The 0.4 REST `createDocument` semantics:
 * a hub folder must be org/team scoped (a project folder reads as absent),
 * and a backing blob links its `file_metadata` row and queues RAG indexing —
 * a content-only document is NOT indexed by this door (0.4 parity).
 */
export async function createHubDocument(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: CreateHubDocumentArgs,
): Promise<string> {
  const title = args.title.trim();
  if (title.length === 0 || title.length > 512) {
    throw new DocumentError('DOCUMENT_TITLE_INVALID', 'Invalid title');
  }
  if (args.folderId !== undefined) {
    const folder = await loadFolderOrThrow(tx, args.folderId);
    if (
      folder.organizationId !== auth.organizationId ||
      folder.projectId !== null
    ) {
      throw new DocumentError('FOLDER_NOT_FOUND', 'Folder not found', 404);
    }
  }
  const file =
    args.fileId !== undefined
      ? await getFileMetadata(tx, auth.organizationId, args.fileId)
      : null;
  if (args.fileId !== undefined && file === null) {
    throw new DocumentError('FILE_NOT_FOUND', 'Upload not found', 404);
  }
  const now = Date.now();
  const extension = args.extension ?? extractExtension(title);
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.documents (
      org_id, title, content, file_ref, mime_type, extension,
      source_provider, team_id, team_tags, created_by, folder_id, metadata,
      created_at_ms, updated_at_ms
    ) VALUES (
      ${auth.organizationId}, ${title}, ${args.content ?? null},
      ${file?.storageRef ?? null},
      ${args.mimeType ?? file?.contentType ?? null}, ${extension ?? null},
      ${args.sourceProvider ?? 'api_import'}, ${args.teamId ?? null},
      ${args.teamId !== undefined ? [args.teamId] : []}, ${auth.userId},
      ${args.folderId ?? null},
      ${args.metadata === undefined ? null : tx.json(toJson(args.metadata))},
      ${now}, ${now}
    )
    RETURNING id
  `;
  const documentId = inserted[0]?.id;
  if (!documentId) {
    throw new DocumentError('DOCUMENT_CREATE_FAILED', 'Insert failed');
  }
  if (file !== null) {
    await tx`
      UPDATE app.file_metadata SET document_id = ${documentId}
      WHERE id = ${file.id}
    `;
    await markRagQueued(tx, file.id);
    await addJobInTx(tx, 'rag.index_file', { fileId: file.id });
  }
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
    actorType: 'api',
    action: 'document.created',
    category: 'data',
    resourceType: 'document',
    resourceId: documentId,
    resourceName: title,
    metadata: { sourceProvider: args.sourceProvider ?? 'api_import' },
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'document',
    entityId: documentId,
  });
  return documentId;
}

export interface HubDocumentsPage {
  page: DocumentRow[];
  isDone: boolean;
  continueCursor: string;
}

/**
 * Hub documents, newest first, cursor-paginated — the REST listing. The
 * cursor is `<createdAt>:<id>` of the last row; team visibility filters
 * POST-page (like the in-app listing), so a page may run short of `limit`.
 */
export async function listHubDocumentsPage(
  sql: Sql,
  auth: ProjectAuthContext,
  options: {
    sourceProvider?: string;
    folderId?: string;
    cursor: string | null;
    limit: number;
  },
): Promise<HubDocumentsPage> {
  const limit = Math.max(1, Math.min(options.limit, 100));
  let cursorCreatedAt: number | null = null;
  let cursorId: string | null = null;
  if (options.cursor !== null && options.cursor !== '') {
    const split = options.cursor.indexOf(':');
    const createdAt = Number(options.cursor.slice(0, split));
    if (split > 0 && Number.isFinite(createdAt)) {
      cursorCreatedAt = createdAt;
      cursorId = options.cursor.slice(split + 1);
    }
  }
  const rows = await sql<DocumentRow[]>`
    SELECT ${sql.unsafe(DOCUMENT_COLUMNS)} FROM app.documents
    WHERE org_id = ${auth.organizationId}
      AND project_id IS NULL
      AND lifecycle_status IS DISTINCT FROM 'trashed'
      AND (${options.sourceProvider ?? null}::text IS NULL
        OR source_provider = ${options.sourceProvider ?? null})
      AND (${options.folderId ?? null}::text IS NULL
        OR folder_id = ${options.folderId ?? null})
      AND (${cursorCreatedAt}::bigint IS NULL
        OR created_at_ms < ${cursorCreatedAt}
        OR (created_at_ms = ${cursorCreatedAt} AND id < ${cursorId}))
    ORDER BY created_at_ms DESC, id DESC
    LIMIT ${limit + 1}
  `;
  const raw = rows.slice(0, limit);
  const last = raw[raw.length - 1];
  const isDone = rows.length <= limit;
  return {
    page: raw.filter((doc) => hasKnowledgeHubDocumentAccess(doc, auth.teamIds)),
    isDone,
    continueCursor: isDone || !last ? '' : `${last.createdAt}:${last.id}`,
  };
}

/** The columns REST serves beyond the standard projection. */
export async function readDocumentRestExtras(
  sql: Sql,
  documentId: string,
): Promise<{ content: string | null; record: unknown } | null> {
  const rows = await sql<{ content: string | null; record: unknown }[]>`
    SELECT content, record FROM app.documents WHERE id = ${documentId} LIMIT 1
  `;
  return rows[0] ?? null;
}
