import type { Sql, TransactionSql } from 'postgres';

import {
  DOCUMENT_MAX_FILE_SIZE,
  DOCUMENT_UPLOAD_ALLOWED_EXTENSIONS,
  isAllowedDocumentUpload,
  resolveFileType,
} from '../../../lib/shared/file-types.ts';
import { authorizeRls } from '../../auth/access.ts';
import { hasTeamAccess } from '../../core/lib/team_access.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  readGovernancePolicyForOrg,
  resolveOrgSlug,
} from '../../lib/org-config.ts';
import {
  checkOrganizationRateLimit,
  checkUserRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  getFileMetadata,
  registerUploadedBytes,
  statOrgBlob,
} from '../files/service.ts';
import { ownsUploadedBlob } from '../files/upload-intents.ts';
import { buildHubFolderPath } from '../folders/paths.ts';
import { assertFolderMutable, loadFolderOrThrow } from '../folders/service.ts';
import { markRagQueued } from '../knowledge/service.ts';
import { assertNotHeld } from '../legal_holds/service.ts';
import {
  deactivateSyncConfigsForPath,
  stopSyncForTrashedDocument,
} from '../onedrive/service.ts';
import {
  listProjects,
  loadProjectOrThrow,
  type ProjectAuthContext,
} from '../projects/service.ts';
import { purgeDocument } from '../retention/service.ts';

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
  readonly status: 400 | 403 | 404 | 429;
  /** Structured refusal payload (reasonCode, limitBytes…) for the client. */
  readonly data?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 429 = 400,
    data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DocumentError';
    this.code = code;
    this.status = status;
    if (data !== undefined) {
      this.data = data;
    }
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
  record: Record<string, unknown> | null;
  scannedPagesDetected: number | null;
  ocrApplied: boolean | null;
  sourceCreatedAt: number | null;
  sourceModifiedAt: number | null;
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
  lifecycle_status AS "lifecycleStatus", record,
  scanned_pages_detected AS "scannedPagesDetected",
  ocr_applied AS "ocrApplied",
  source_created_at_ms::float8 AS "sourceCreatedAt",
  source_modified_at_ms::float8 AS "sourceModifiedAt",
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

/**
 * `loadDocumentOrThrow` under a row lock — for a transaction that decides on
 * the row's CURRENT state and then rewrites it (the replacement bind), so two
 * such transactions serialize on the row instead of both deciding on the
 * same snapshot and the second silently overwriting the first. Meaningful
 * only inside a transaction; the lock is released with it.
 */
export async function loadDocumentForUpdate(
  tx: Sql | TransactionSql,
  documentId: string,
): Promise<DocumentRow> {
  const rows = await tx<DocumentRow[]>`
    SELECT ${tx.unsafe(DOCUMENT_COLUMNS)} FROM app.documents
    WHERE id = ${documentId} LIMIT 1
    FOR UPDATE
  `;
  const doc = rows[0];
  if (!doc) {
    throw new DocumentError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
  }
  return doc;
}

/**
 * Every document whose content is the blob `storageRef` — a multi-team upload
 * creates one document per team from ONE blob, and the file row's own
 * `document_id` names only the last of them — plus the document that row
 * names (a replaced document keeps its old file row's pointer). The files
 * read gate (`files/access.ts`) walks these: the blob is readable when any
 * one of them is.
 */
export async function listDocumentsForBlob(
  sql: Sql | TransactionSql,
  organizationId: string,
  args: { storageRef: string; documentId: string | null },
): Promise<DocumentRow[]> {
  return sql<DocumentRow[]>`
    SELECT ${sql.unsafe(DOCUMENT_COLUMNS)} FROM app.documents
    WHERE org_id = ${organizationId}
      AND (file_ref = ${args.storageRef} OR id = ${args.documentId ?? ''})
    LIMIT 50
  `;
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

/**
 * The org-role write gate every document mutation consults (the
 * products/contacts idiom): `documents: write` in the role matrix — owner,
 * admin, developer and editor pass; the read-only `member` and `disabled`
 * roles refuse. This is the org-wide floor; project lanes ADD their
 * project-`canEdit` check on top, and team scoping stays a separate
 * visibility question. Agent standing-grant writes (`agent-write.ts`) are
 * authorized by their dispatch, not this matrix.
 */
export function assertDocumentsWriteRole(
  auth: Pick<ProjectAuthContext, 'role'>,
): void {
  if (!authorizeRls(auth.role, 'documents', 'write')) {
    throw new DocumentError('RBAC_FORBIDDEN', 'Insufficient role', 403);
  }
}

/**
 * The 0.4 `assertGenericDocumentContentWritable` on the jsonb record
 * projection (twin of `assertRecordTrashableJson` below; the typed original
 * lives in `core/documents/access.ts` and guards the WebDAV lane). Generic
 * writers may change an uncontrolled document's content, but a controlled
 * record's bytes and identity fields have exactly one door — the attested
 * replacement flow in `records.ts`: `in_review`/`approved` are frozen, and
 * even a `draft` refuses here so its content moves only through that flow.
 */
export function assertGenericDocumentContentWritableJson(
  record: Record<string, unknown> | null,
): void {
  if (record === null) return;
  if (record.state === 'in_review' || record.state === 'approved') {
    throw new DocumentError(
      'DOCUMENT_RECORD_FROZEN',
      record.state === 'in_review'
        ? 'This controlled record is in review and frozen. Wait for the review decision (or request changes) before editing its content.'
        : 'This controlled record is approved and immutable. Open a new revision to edit its content.',
      400,
      { state: record.state },
    );
  }
  throw new DocumentError(
    'DOCUMENT_RECORD_REPLACEMENT_REQUIRED',
    'Replace controlled-record content through the dedicated replacement flow.',
    400,
    { state: typeof record.state === 'string' ? record.state : null },
  );
}

/**
 * A hub team assignment must come from the caller's own teams — the rule the
 * plural `teamIds` lane established (`TEAM_ACCESS_DENIED`), applied to every
 * lane that stamps `team_id`/`team_tags`. Membership implies the team exists
 * and is in-org, and it keeps the invariant that you can never file a
 * document into a scope nobody — including you — can see (`hasTeamAccess`
 * has no admin bypass, so an unknown id would hide the row from everyone).
 */
export function assertHubTeamAssignable(
  auth: Pick<ProjectAuthContext, 'teamIds'>,
  teamId: string,
): void {
  if (!auth.teamIds.includes(teamId)) {
    throw new DocumentError(
      'TEAM_ACCESS_DENIED',
      'Cannot assign document to a team you do not belong to',
      403,
    );
  }
}

/**
 * The document-write standard every mutating lane consults — the app update
 * and trash doors, the REST PATCH, the controlled-record transitions and the
 * replacement flow: the org-role write matrix, visibility (404-shaped), and
 * for a project file EDIT access to the owning project. Today the write
 * matrix and `EDITOR_ROLES` admit the same roles, so a writer who can see a
 * project file can also edit it; the explicit `canEdit` check keeps the rule
 * true if either matrix ever moves (`write-guards.test.ts` pins the pair).
 * `lock` takes the row lock (`loadDocumentForUpdate`) for a transaction that
 * rewrites the row it decided on.
 */
export async function requireDocumentWriteAccess(
  db: Sql | TransactionSql,
  auth: ProjectAuthContext,
  documentId: string,
  options: { lock?: boolean } = {},
): Promise<DocumentRow> {
  assertDocumentsWriteRole(auth);
  const doc =
    options.lock === true
      ? await loadDocumentForUpdate(db, documentId)
      : await loadDocumentOrThrow(db, documentId);
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
  return doc;
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
  contentHash?: string;
  /** Never RAG-index this upload (sticky on the file_metadata row). */
  skipRagIndexing?: boolean;
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
  assertDocumentsWriteRole(auth);
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
  } else if (args.teamId) {
    assertHubTeamAssignable(auth, args.teamId);
  }
  if (!args.projectId && args.folderId) {
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
      content_hash, team_id, team_tags, project_id, created_by, folder_id,
      metadata, created_at_ms, updated_at_ms
    ) VALUES (
      ${auth.organizationId}, ${args.fileName}, ${file.storageRef},
      ${file.contentType}, ${extension ?? null}, 'upload',
      ${args.contentHash ?? null},
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
    UPDATE app.file_metadata SET document_id = ${documentId},
      skip_rag_indexing = CASE
        WHEN ${args.skipRagIndexing === true} THEN true
        ELSE skip_rag_indexing
      END
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
  // RAG ingest rides the same transaction: rollback enqueues nothing. A
  // skip-flagged upload never enters the corpus (sticky on the file row).
  if (args.skipRagIndexing !== true) {
    await markRagQueued(tx, args.fileId);
    await addJobInTx(tx, 'rag.index_file', { fileId: args.fileId });
  }
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
    teamIds?: string[];
    content?: string | null;
    metadata?: Record<string, unknown> | null;
    mimeType?: string | null;
    extension?: string | null;
    sourceProvider?: string | null;
  },
): Promise<{ teamScopeChanged: boolean; fileRef: string | null }> {
  const doc = await requireDocumentWriteAccess(tx, auth, args.documentId);
  // Content-freeze guard (core/documents/access.ts doctrine): the bytes and
  // their identity fields move ONLY while uncontrolled — renames, folder
  // moves, team and metadata edits stay allowed in every record state.
  if (
    args.content !== undefined ||
    args.mimeType !== undefined ||
    args.extension !== undefined ||
    args.sourceProvider !== undefined
  ) {
    assertGenericDocumentContentWritableJson(doc.record);
  }

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
    if (args.teamId !== null) {
      assertHubTeamAssignable(auth, args.teamId);
    }
    teamId = args.teamId;
    teamTags = args.teamId ? [args.teamId] : [];
  }
  if (args.teamIds !== undefined) {
    if (args.teamIds.length > 0) {
      if (isProjectScoped(doc)) {
        throw new DocumentError(
          'DOCUMENT_SCOPE_CONFLICT',
          'A project document cannot be assigned to teams. Detach it from the project first.',
        );
      }
      if (doc.folderId !== null) {
        const folder = await loadFolderOrThrow(tx, doc.folderId);
        if (folder.teamId) {
          throw new DocumentError(
            'TEAM_INHERITED_FROM_FOLDER',
            'Cannot change team: inherited from parent folder',
          );
        }
      }
      const memberTeams = new Set(auth.teamIds);
      for (const id of args.teamIds) {
        if (!memberTeams.has(id)) {
          throw new DocumentError(
            'TEAM_ACCESS_DENIED',
            'Cannot assign document to a team you do not belong to',
            403,
          );
        }
      }
    }
    teamId = args.teamIds[0] ?? null;
    teamTags = args.teamIds;
  }
  const teamScopeChanged =
    teamId !== doc.teamId ||
    teamTags.length !== doc.teamTags.length ||
    teamTags.some((tag, index) => tag !== doc.teamTags[index]);

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
  return { teamScopeChanged, fileRef: doc.fileRef };
}

/** Soft trash / restore. Hard delete + blob erasure land with governance. */
export async function setDocumentTrashed(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  documentId: string,
  trashed: boolean,
): Promise<void> {
  const doc = await requireDocumentWriteAccess(tx, auth, documentId);
  if (trashed) {
    // Controlled-record protection: reviewed/approved records never trash.
    assertRecordTrashableJson(doc.record);
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
  assertDocumentsWriteRole(auth);
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
  assertDocumentsWriteRole(auth);
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

/** The most rows one hub listing read pulls. */
const HUB_LIST_READ_MAX = 500;

/** The hub listing's rows as stored, newest first — BEFORE the caller's
 * team filter, so a bound judged on them is the truth about the folder. */
async function selectHubDocuments(
  sql: Sql,
  auth: ProjectAuthContext,
  options: {
    folderId?: string | null;
    includeTrashed?: boolean;
    limit: number;
  },
): Promise<DocumentRow[]> {
  return sql<DocumentRow[]>`
    SELECT ${sql.unsafe(DOCUMENT_COLUMNS)} FROM app.documents
    WHERE org_id = ${auth.organizationId}
      AND project_id IS NULL
      AND (${options.includeTrashed ?? false}
        OR lifecycle_status IS NULL OR lifecycle_status = 'active')
      AND (${options.folderId === undefined}
        OR folder_id IS NOT DISTINCT FROM ${options.folderId ?? null})
    ORDER BY created_at_ms DESC
    LIMIT ${options.limit}
  `;
}

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
  const rows = await selectHubDocuments(sql, auth, {
    ...options,
    limit: Math.min(options.limit ?? 200, HUB_LIST_READ_MAX),
  });
  return rows.filter((doc) => hasKnowledgeHubDocumentAccess(doc, auth.teamIds));
}

/**
 * One folder's active documents for a BOUNDED reader, with the truth about
 * the bound: `truncated` says the folder holds more rows than `limit` —
 * judged on the stored rows, so a row the caller may not see never masks a
 * cut. The workflow `document.list` native reads folders through this.
 */
export async function listFolderDocumentsBounded(
  sql: Sql,
  auth: ProjectAuthContext,
  args: { folderId: string | null; limit: number },
): Promise<{ documents: DocumentRow[]; truncated: boolean }> {
  const limit = Math.min(Math.max(args.limit, 1), HUB_LIST_READ_MAX);
  const rows = await selectHubDocuments(sql, auth, {
    folderId: args.folderId,
    limit: limit + 1,
  });
  const truncated = rows.length > limit;
  return {
    documents: (truncated ? rows.slice(0, limit) : rows).filter((doc) =>
      hasKnowledgeHubDocumentAccess(doc, auth.teamIds),
    ),
    truncated,
  };
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
    ORDER BY created_at_ms DESC
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
  assertDocumentsWriteRole(auth);
  const title = args.title.trim();
  if (title.length === 0 || title.length > 512) {
    throw new DocumentError('DOCUMENT_TITLE_INVALID', 'Invalid title');
  }
  if (args.teamId !== undefined) {
    assertHubTeamAssignable(auth, args.teamId);
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

// ---------------------------------------------------------------------------
// Hub reads (the 0.4 Knowledge page wire — see view.ts for the item shape)
// ---------------------------------------------------------------------------

const HUB_PAGE_MAX = 100;
const HUB_SEARCH_MAX = 25;

/** SQL twin of `hasKnowledgeHubDocumentAccess`: hub rows only, team rules. */
function hubAccessClause(sql: Sql, auth: ProjectAuthContext) {
  return sql`
    project_id IS NULL
    AND ((team_id IS NULL AND cardinality(team_tags) = 0)
      OR team_id = ANY(${auth.teamIds})
      OR team_tags && ${auth.teamIds})
  `;
}

/** Keyset cursor for the hub page walk (creation DESC, id DESC). */
function decodePageCursor(
  cursor: string | null,
): { createdAt: number; id: string } | null {
  if (cursor === null || cursor === '') return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'c' in parsed &&
      typeof parsed.c === 'number' &&
      'i' in parsed &&
      typeof parsed.i === 'string'
    ) {
      return { createdAt: parsed.c, id: parsed.i };
    }
  } catch (error) {
    console.warn('[documents] bad page cursor ignored:', error);
  }
  return null;
}

function encodePageCursor(row: { createdAt: number; id: string }): string {
  return Buffer.from(
    JSON.stringify({ c: row.createdAt, i: row.id }),
    'utf8',
  ).toString('base64url');
}

/** The hub listing PAGE (0.4 `listDocumentsPaginated`): newest first, the
 * optional folder/provider/extension facets, keyset cursor. */
export async function listHubDocumentsPaginated(
  sql: Sql,
  auth: ProjectAuthContext,
  args: {
    cursor: string | null;
    numItems: number;
    folderId?: string;
    sourceProvider?: string;
    extension?: string;
  },
): Promise<{ page: DocumentRow[]; isDone: boolean; continueCursor: string }> {
  const numItems = Math.min(Math.max(args.numItems, 1), HUB_PAGE_MAX);
  const after = decodePageCursor(args.cursor);
  const folderId = args.folderId ?? null;
  const sourceProvider = args.sourceProvider ?? null;
  const extension = args.extension ?? null;
  const rows = await sql<DocumentRow[]>`
    SELECT ${sql.unsafe(DOCUMENT_COLUMNS)} FROM app.documents
    WHERE org_id = ${auth.organizationId}
      AND ${hubAccessClause(sql, auth)}
      AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
      AND (${folderId}::text IS NULL OR folder_id = ${folderId})
      AND (${sourceProvider}::text IS NULL
        OR source_provider = ${sourceProvider})
      AND (${extension}::text IS NULL OR extension = ${extension})
      AND (${after === null}
        OR (created_at_ms, id) < (${after?.createdAt ?? 0}, ${after?.id ?? ''}))
    ORDER BY created_at_ms DESC, id DESC
    LIMIT ${numItems + 1}
  `;
  const isDone = rows.length <= numItems;
  const page = isDone ? rows : rows.slice(0, numItems);
  const last = page.at(-1);
  return {
    page,
    isDone,
    continueCursor:
      last === undefined
        ? ''
        : encodePageCursor({ createdAt: last.createdAt, id: last.id }),
  };
}

/** Raw org document count (the 0.4 approx counter's answer). */
export async function approxCountDocumentsForOrg(
  sql: Sql,
  organizationId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.documents
    WHERE org_id = ${organizationId}
  `;
  return Number(rows[0]?.count ?? '0');
}

/** The caller's upload-quota usage (0.4 `getUploadUsage`): the
 * `upload_policy` per-user volume ceiling against their uploaded bytes. */
export async function computeUploadUsageForUser(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<{ limited: boolean; usedBytes: number; limitBytes: number | null }> {
  const policy = await readGovernancePolicyForOrg(
    sql,
    organizationId,
    'upload_policy',
  );
  const limitBytes =
    policy?.enabled === true && policy.maxTotalVolumeBytesPerUser != null
      ? policy.maxTotalVolumeBytesPerUser
      : null;
  if (limitBytes === null) {
    return { limited: false, usedBytes: 0, limitBytes: null };
  }
  const rows = await sql<{ total: string | null }[]>`
    SELECT sum(size)::text AS total FROM app.file_metadata
    WHERE org_id = ${organizationId} AND uploaded_by = ${userId}
  `;
  return {
    limited: true,
    usedBytes: Number(rows[0]?.total ?? '0'),
    limitBytes,
  };
}

export interface DocumentVersionView {
  storageId: string;
  createdAt: number;
  isCurrent: boolean;
  fileName?: string;
  size?: number;
  contentType?: string;
}

/** Version history (0.4 `listDocumentVersions`): the current blob + prior
 * `historyFiles`, decorated from `file_metadata`. Null on access failure. */
export async function listDocumentVersionsView(
  sql: Sql,
  auth: ProjectAuthContext,
  documentId: string,
): Promise<{
  documentId: string;
  title?: string;
  versions: DocumentVersionView[];
} | null> {
  let doc: DocumentRow;
  try {
    doc = await loadDocumentOrThrow(sql, documentId);
    await assertDocumentVisible(sql, auth, doc);
  } catch (error) {
    console.warn('[documents] versions access refused', error);
    return null;
  }
  if (doc.lifecycleStatus !== null && doc.lifecycleStatus !== 'active') {
    return null;
  }
  const refs = [
    ...(doc.fileRef !== null ? [doc.fileRef] : []),
    ...doc.historyFiles,
  ];
  const metaByRef = new Map<
    string,
    { fileName: string; size: number; contentType: string; createdAt: number }
  >();
  if (refs.length > 0) {
    const metas = await sql<
      {
        storageRef: string;
        fileName: string;
        size: number;
        contentType: string;
        createdAt: number;
      }[]
    >`
      SELECT storage_ref AS "storageRef", file_name AS "fileName", size,
             content_type AS "contentType",
             created_at_ms::float8 AS "createdAt"
      FROM app.file_metadata
      WHERE org_id = ${auth.organizationId} AND storage_ref = ANY(${refs})
    `;
    for (const meta of metas) metaByRef.set(meta.storageRef, meta);
  }
  const toVersion = (ref: string, isCurrent: boolean): DocumentVersionView => {
    const meta = metaByRef.get(ref);
    const version: DocumentVersionView = {
      storageId: ref,
      createdAt: meta?.createdAt ?? doc.updatedAt,
      isCurrent,
    };
    if (meta !== undefined) {
      version.fileName = meta.fileName;
      version.size = meta.size;
      version.contentType = meta.contentType;
    }
    return version;
  };
  const versions: DocumentVersionView[] = [];
  if (doc.fileRef !== null) versions.push(toVersion(doc.fileRef, true));
  // History newest-first after the current head.
  for (const ref of [...doc.historyFiles].reverse()) {
    versions.push(toVersion(ref, false));
  }
  return {
    documentId: doc.id,
    ...(doc.title !== null ? { title: doc.title } : {}),
    versions,
  };
}

/** Deep-link resolve by stable externalItemId (0.4 wire; null fail-closed). */
export async function getDocumentByExternalItemIdView(
  sql: Sql,
  auth: ProjectAuthContext,
  args: { externalItemId: string; projectId?: string },
): Promise<{
  documentId: string;
  title?: string;
  folderId?: string;
  hasHistory: boolean;
} | null> {
  const externalItemId = args.externalItemId.trim();
  if (externalItemId === '') return null;
  const rows = await sql<DocumentRow[]>`
    SELECT ${sql.unsafe(DOCUMENT_COLUMNS)} FROM app.documents
    WHERE org_id = ${auth.organizationId}
      AND external_item_id = ${externalItemId}
      AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
    LIMIT 1
  `;
  const doc = rows[0];
  if (!doc) return null;
  if (args.projectId !== undefined && doc.projectId !== args.projectId) {
    return null;
  }
  try {
    await assertDocumentVisible(sql, auth, doc);
  } catch (error) {
    console.warn('[documents] external-id access refused', error);
    return null;
  }
  return {
    documentId: doc.id,
    ...(doc.title !== null ? { title: doc.title } : {}),
    ...(doc.folderId !== null ? { folderId: doc.folderId } : {}),
    hasHistory: doc.historyFiles.length > 0,
  };
}

export interface DocumentSearchHit {
  documentId: string;
  title: string;
  snippet: string;
  folderId?: string;
  projectId?: string;
  updatedAt: number;
}

/** Palette search over hub + readable-project documents (title match; the
 * 0.4 snippet = folder path / 'Project file' / ''). */
export async function searchDocumentsView(
  sql: Sql,
  auth: ProjectAuthContext,
  query: string,
): Promise<DocumentSearchHit[]> {
  const term = query.trim();
  if (term === '') return [];
  const projects = await listProjects(sql, auth);
  const projectIds = projects.map((project) => project.id);
  const rows = await sql<(DocumentRow & { folderPath: string | null })[]>`
    SELECT ${sql.unsafe(DOCUMENT_COLUMNS)}, folder_path AS "folderPath"
    FROM app.documents
    WHERE org_id = ${auth.organizationId}
      AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
      AND title ILIKE ${`%${term}%`}
      AND (${hubAccessClause(sql, auth)}
        OR (project_id IS NOT NULL AND project_id = ANY(${projectIds})))
    ORDER BY coalesce(source_modified_at_ms, created_at_ms) DESC
    LIMIT ${HUB_SEARCH_MAX}
  `;
  return rows.map((row) => {
    const folderPath = row.folderPath?.trim() ?? '';
    const hit: DocumentSearchHit = {
      documentId: row.id,
      title: row.title?.trim() ?? 'Untitled',
      snippet:
        folderPath !== ''
          ? folderPath
          : row.projectId !== null
            ? 'Project file'
            : '',
      updatedAt: row.sourceModifiedAt ?? row.createdAt,
    };
    if (row.folderId !== null) hit.folderId = row.folderId;
    if (row.projectId !== null) hit.projectId = row.projectId;
    return hit;
  });
}

// ---------------------------------------------------------------------------
// Retry RAG indexing
// ---------------------------------------------------------------------------

const RAG_IN_FLIGHT_STALE_MS = 35 * 60 * 1000;

/**
 * The user-facing "Retry"/"Reindex" affordance. Returns the established
 * `{ success, error? }` wire shape (never throws for guard failures):
 * unsupported formats and fresh in-flight jobs are refusals with a message.
 */
export async function retryRagIndexingForDocument(
  sql: Sql,
  auth: ProjectAuthContext,
  documentId: string,
): Promise<{ success: boolean; error?: string }> {
  // A write-shaped door (it re-queues billable indexing work and rewrites
  // the file row's RAG bookkeeping); the UI shows Retry only to writers.
  assertDocumentsWriteRole(auth);
  try {
    await checkUserRateLimit(sql, 'file:rag-retry', auth.userId);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return { success: false, error: error.message };
    }
    throw error;
  }
  let doc: DocumentRow;
  try {
    doc = await loadDocumentOrThrow(sql, documentId);
    await assertDocumentVisible(sql, auth, doc);
  } catch (error) {
    console.warn('[documents] rag retry access refused', error);
    return { success: false, error: 'Document not found' };
  }
  if (doc.fileRef === null) {
    return { success: false, error: 'Document has no file' };
  }
  const metas = await sql<
    {
      id: string;
      ragStatus: string | null;
      ragError: string | null;
      ragQueuedAt: number | null;
      createdAt: number;
    }[]
  >`
    SELECT id, rag_status AS "ragStatus", rag_error AS "ragError",
           rag_queued_at_ms::float8 AS "ragQueuedAt",
           created_at_ms::float8 AS "createdAt"
    FROM app.file_metadata
    WHERE org_id = ${auth.organizationId} AND storage_ref = ${doc.fileRef}
    LIMIT 1
  `;
  const meta = metas[0];
  if (!meta) {
    return { success: false, error: 'Document has no file' };
  }
  // Terminal, non-retryable: no extractor exists — a retry reproduces the
  // same rejection (public endpoint; the UI hiding the button is no gate).
  if (meta.ragStatus === 'unsupported') {
    return {
      success: false,
      error:
        meta.ragError ??
        "This file type has no text extractor and can't be indexed for RAG search.",
    };
  }
  // In-flight guard: a fresh queued/running row already has a live job; past
  // the stale threshold the prior job is dead and retry is the fast path.
  if (meta.ragStatus === 'running' || meta.ragStatus === 'queued') {
    const clock = meta.ragQueuedAt ?? meta.createdAt;
    if (Date.now() - clock < RAG_IN_FLIGHT_STALE_MS) {
      return {
        success: false,
        error: 'Indexing is already in progress for this file.',
      };
    }
  }
  await sql.begin(async (tx) => {
    await markRagQueued(tx, meta.id);
    await addJobInTx(tx, 'rag.index_file', { fileId: meta.id });
    await emitHintInTx(tx, {
      orgId: auth.organizationId,
      entity: 'document',
      entityId: documentId,
    });
  });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Upload validation (0.4 `validateDocumentUpload` + `checkUploadPolicy`)
// ---------------------------------------------------------------------------

/**
 * Gate a blob before it becomes a document's current file: org rate limit,
 * global size ceiling, the org's upload policy (extension/MIME/size caps +
 * per-user volume quota), then the global format allowlist. Throws
 * `DocumentError` with the 0.4 wire codes + structured refusal data.
 */
export async function validateDocumentUploadForOrg(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  args: { fileName: string; contentType?: string; size: number },
): Promise<{ contentType: string; extension: string | undefined }> {
  try {
    await checkOrganizationRateLimit(sql, 'file:upload', auth.organizationId);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      throw new DocumentError('RATE_LIMITED', error.message, 429, {
        retryAfterMs: error.retryAfter,
      });
    }
    throw error;
  }
  const contentType = resolveFileType(args.fileName, args.contentType ?? '');
  const extension = extractExtension(args.fileName);
  if (!Number.isFinite(args.size) || args.size < 0) {
    throw new DocumentError(
      'UPLOAD_BLOB_INVALID',
      'The uploaded file size is invalid.',
    );
  }
  if (args.size > DOCUMENT_MAX_FILE_SIZE) {
    throw new DocumentError(
      'FILE_TOO_LARGE',
      `File exceeds the ${Math.round(DOCUMENT_MAX_FILE_SIZE / (1024 * 1024))} MB limit`,
      400,
      { reasonCode: 'file_too_large', limitBytes: DOCUMENT_MAX_FILE_SIZE },
    );
  }

  const policy = await readGovernancePolicyForOrg(
    sql,
    auth.organizationId,
    'upload_policy',
  );
  if (policy?.enabled === true) {
    const ext = extension?.toLowerCase().replace(/^\./, '');
    if (ext !== undefined && (policy.blockedExtensions?.length ?? 0) > 0) {
      const blocked = (policy.blockedExtensions ?? []).map((entry) =>
        entry.toLowerCase().replace(/^\./, ''),
      );
      if (blocked.includes(ext)) {
        throw new DocumentError(
          'UPLOAD_POLICY_REJECTED',
          `File type .${ext} is not allowed by organization policy`,
          400,
          { reasonCode: 'extension_blocked' },
        );
      }
    }
    if (ext !== undefined && (policy.allowedExtensions?.length ?? 0) > 0) {
      const allowed = (policy.allowedExtensions ?? []).map((entry) =>
        entry.toLowerCase().replace(/^\./, ''),
      );
      if (!allowed.includes(ext)) {
        throw new DocumentError(
          'UPLOAD_POLICY_REJECTED',
          `File type .${ext} is not in the allowed list`,
          400,
          { reasonCode: 'extension_not_allowed' },
        );
      }
    }
    if ((policy.allowedMimeTypes?.length ?? 0) > 0) {
      const match = (policy.allowedMimeTypes ?? []).some((pattern) =>
        pattern.endsWith('/*')
          ? contentType.startsWith(pattern.replace('/*', '/'))
          : contentType === pattern,
      );
      if (!match) {
        throw new DocumentError(
          'UPLOAD_POLICY_REJECTED',
          `MIME type ${contentType} is not allowed by organization policy`,
          400,
          { reasonCode: 'mime_not_allowed' },
        );
      }
    }
    // Per-MIME override wins over the global cap; longest prefix match.
    let limit = policy.maxFileSizeBytes ?? undefined;
    if ((policy.maxFileSizeLimits?.length ?? 0) > 0) {
      const override = [...(policy.maxFileSizeLimits ?? [])]
        .filter((entry) => contentType.startsWith(entry.mimeTypePrefix))
        .sort((a, b) => b.mimeTypePrefix.length - a.mimeTypePrefix.length)[0];
      if (override) limit = override.maxBytes;
    }
    if (limit !== undefined && args.size > limit) {
      throw new DocumentError(
        'UPLOAD_POLICY_REJECTED',
        `File size exceeds the ${Math.round(limit / (1024 * 1024))} MB limit`,
        400,
        { reasonCode: 'file_too_large', limitBytes: limit },
      );
    }
    if (policy.maxTotalVolumeBytesPerUser != null) {
      const rows = await sql<{ total: string | null }[]>`
        SELECT sum(size)::text AS total FROM app.file_metadata
        WHERE org_id = ${auth.organizationId}
          AND uploaded_by = ${auth.userId}
      `;
      const usedBytes = Number(rows[0]?.total ?? '0');
      if (usedBytes + args.size > policy.maxTotalVolumeBytesPerUser) {
        const maxGB = Math.round(
          policy.maxTotalVolumeBytesPerUser / (1024 * 1024 * 1024),
        );
        throw new DocumentError(
          'UPLOAD_POLICY_REJECTED',
          `Total upload volume would exceed the ${maxGB} GB limit`,
          400,
          {
            reasonCode: 'volume_exceeded',
            usedBytes,
            limitBytes: policy.maxTotalVolumeBytesPerUser,
          },
        );
      }
    }
  }

  if (!isAllowedDocumentUpload(contentType, args.fileName)) {
    throw new DocumentError(
      'UNSUPPORTED_FILE_TYPE',
      `Unsupported file type. Supported extensions: ${[
        ...DOCUMENT_UPLOAD_ALLOWED_EXTENSIONS,
      ].join(', ')}.`,
    );
  }
  return { contentType, extension };
}

export interface CreateDocumentFromBlobUploadArgs {
  storageRef: string;
  fileName: string;
  contentType?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
  teamId?: string;
  projectId?: string;
  folderId?: string;
  skipRagIndexing?: boolean;
}

/**
 * The session upload lane's bind step (0.4 `createDocumentFromUpload` with a
 * blob ref): prove the caller owns the blob, HEAD-attest it landed, validate
 * against policy with the AUTHORITATIVE size, register the metadata row,
 * then bind the document — all in the caller's transaction, so a refusal
 * strands nothing. Ownership is proven WITHOUT consuming the upload intent:
 * one blob legitimately becomes one document per selected team.
 */
export async function createDocumentFromBlobUpload(
  sql: Sql,
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: CreateDocumentFromBlobUploadArgs,
): Promise<string> {
  assertDocumentsWriteRole(auth);
  const owned = await ownsUploadedBlob(tx, {
    organizationId: auth.organizationId,
    userId: auth.userId,
    storageRef: args.storageRef,
  });
  if (!owned) {
    throw new DocumentError(
      'UPLOAD_NOT_OWNED',
      'This upload is not yours to bind, or the upload session expired. Upload the file again.',
      403,
    );
  }
  const stat = await statOrgBlob(sql, auth.organizationId, args.storageRef);
  if (stat === null) {
    throw new DocumentError(
      'UPLOAD_BLOB_INVALID',
      'The uploaded file no longer exists.',
      404,
    );
  }
  const { contentType } = await validateDocumentUploadForOrg(tx, auth, {
    fileName: args.fileName,
    ...(args.contentType !== undefined
      ? { contentType: args.contentType }
      : {}),
    size: stat.size,
  });
  const { fileId } = await registerUploadedBytes(tx, {
    organizationId: auth.organizationId,
    storageRef: args.storageRef,
    fileName: args.fileName,
    contentType,
    size: stat.size,
    source: 'document-upload',
    uploadedBy: auth.userId,
    ...(args.skipRagIndexing === true ? { skipRagIndexing: true } : {}),
  });
  return createDocumentFromUpload(tx, auth, {
    fileId,
    fileName: args.fileName,
    ...(args.teamId !== undefined ? { teamId: args.teamId } : {}),
    ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
    ...(args.folderId !== undefined ? { folderId: args.folderId } : {}),
    ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    ...(args.contentHash !== undefined
      ? { contentHash: args.contentHash }
      : {}),
    ...(args.skipRagIndexing === true ? { skipRagIndexing: true } : {}),
  });
}

// ---------------------------------------------------------------------------
// Hard delete (the 0.4 `deleteDocument` contract)
// ---------------------------------------------------------------------------

/** The 0.4 `recordTrashRefusal` on the jsonb record projection. */
function recordTrashRefusalFromJson(
  record: Record<string, unknown> | null,
): 'in_review' | 'approved' | 'retained_history' | null {
  if (record === null) return null;
  if (record.state === 'in_review') return 'in_review';
  if (record.state === 'approved') return 'approved';
  const approved = Array.isArray(record.approvedVersions)
    ? record.approvedVersions
    : [];
  return approved.length > 0 ? 'retained_history' : null;
}

/** Refuse destroying a protected controlled record; uncontrolled documents
 * and never-approved first drafts pass. */
export function assertRecordTrashableJson(
  record: Record<string, unknown> | null,
): void {
  const refusal = recordTrashRefusalFromJson(record);
  if (refusal === null) return;
  throw new DocumentError(
    'DOCUMENT_RECORD_PROTECTED',
    refusal === 'in_review'
      ? 'This controlled record is in review and cannot be deleted. Resolve the review first.'
      : refusal === 'approved'
        ? 'This controlled record is approved and cannot be deleted. Its approved version is a retained record.'
        : 'This controlled record has an approved version in its history, which is a retained record, so it cannot be deleted.',
    400,
    { state: typeof record?.state === 'string' ? record.state : null },
  );
}

/**
 * Hard-delete a document: visibility + project-edit gates, the controlled-
 * record protection, legal holds, sync stop, then `purgeDocument` (corpus
 * entry, blobs + history, file rows, dependent knowledge-entry chains, the
 * row). Controlled drafts leave an audit trail before they go.
 */
export async function deleteDocumentHard(
  sql: Sql,
  auth: ProjectAuthContext,
  documentId: string,
): Promise<void> {
  assertDocumentsWriteRole(auth);
  const doc = await loadDocumentOrThrow(sql, documentId);
  await assertDocumentVisible(sql, auth, doc);
  if (isProjectScoped(doc)) {
    const project = await loadProjectOrThrow(sql, doc.projectId ?? '');
    const access = checkProjectAccess(
      { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
      auth.teamIds,
      auth.role,
    );
    if (!access.canEdit) {
      throw new DocumentError('PROJECT_FORBIDDEN', 'No project access', 403);
    }
  }
  assertRecordTrashableJson(doc.record);
  await assertNotHeld(
    sql,
    auth.organizationId,
    'document',
    documentId,
    undefined,
    doc.createdBy ?? undefined,
  );
  await sql.begin(async (tx) => {
    // A directly-selected single-file sync maps 1:1 to this document —
    // deleting it means "stop syncing it".
    await stopSyncForTrashedDocument(tx, {
      organizationId: doc.organizationId,
      metadata: doc.metadata,
    });
    await createAuditLog(tx, {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
      actorType: 'user',
      action: 'document.deleted',
      category: 'data',
      resourceType: 'document',
      resourceId: documentId,
      ...(doc.title !== null ? { resourceName: doc.title } : {}),
      metadata: {
        controlled: doc.record !== null,
        ...(doc.record !== null
          ? {
              recordState:
                typeof doc.record.state === 'string' ? doc.record.state : null,
            }
          : {}),
      },
      status: 'success',
    });
    await emitHintInTx(tx, {
      orgId: auth.organizationId,
      entity: 'document',
      entityId: documentId,
    });
  });
  const orgSlug = await resolveOrgSlug(sql, auth.organizationId);
  await purgeDocument(sql, orgSlug, {
    id: doc.id,
    fileRef: doc.fileRef,
    organizationId: doc.organizationId,
    historyFiles: doc.historyFiles,
  });
}

/**
 * Delete a hub/project folder WITH its contents (the 0.4 `deleteFolder`
 * cascade): hold + controlled-record pre-walks refuse up-front; sync configs
 * targeting the subtree deactivate; every descendant document purges
 * (corpus, blobs, file rows); the folder subtree rows go last (parent FK
 * cascades). Non-atomic across purges by contract — same as 0.4's
 * scheduled cascade; the pre-walks keep refusals all-or-nothing.
 */
export async function deleteFolderCascade(
  sql: Sql,
  auth: ProjectAuthContext,
  folderId: string,
): Promise<void> {
  assertDocumentsWriteRole(auth);
  const folder = await loadFolderOrThrow(sql, folderId);
  await assertFolderMutable(sql, auth, folder);
  await assertNotHeld(sql, auth.organizationId, 'folder', folderId);
  const docs = await sql<DocumentRow[]>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM app.folders
      WHERE id = ${folderId} AND org_id = ${auth.organizationId}
      UNION ALL
      SELECT f.id FROM app.folders f
      JOIN subtree s ON f.parent_id = s.id
      WHERE f.org_id = ${auth.organizationId}
    )
    SELECT ${sql.unsafe(DOCUMENT_COLUMNS)} FROM app.documents
    WHERE org_id = ${auth.organizationId}
      AND folder_id IN (SELECT id FROM subtree)
  `;
  // Pre-walks: one protected record or held document refuses EVERYTHING
  // before anything is removed.
  for (const doc of docs) {
    assertRecordTrashableJson(doc.record);
    await assertNotHeld(
      sql,
      auth.organizationId,
      'document',
      doc.id,
      undefined,
      doc.createdBy ?? undefined,
    );
  }
  // Deleting a synced folder means "stop syncing it" — resolve the path
  // BEFORE rows go, or the next run recreates what was just removed.
  const folderPath =
    folder.projectId === null
      ? await buildHubFolderPath(sql, auth.organizationId, folderId)
      : null;
  const orgSlug = await resolveOrgSlug(sql, auth.organizationId);
  for (const doc of docs) {
    await purgeDocument(sql, orgSlug, {
      id: doc.id,
      fileRef: doc.fileRef,
      organizationId: doc.organizationId,
      historyFiles: doc.historyFiles,
    });
  }
  await sql.begin(async (tx) => {
    if (folderPath !== null) {
      await deactivateSyncConfigsForPath(tx, auth.organizationId, folderPath);
    }
    await tx`
      DELETE FROM app.folders
      WHERE id = ${folderId} AND org_id = ${auth.organizationId}
    `;
    await createAuditLog(tx, {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
      actorType: 'user',
      action: 'folder.deleted',
      category: 'data',
      resourceType: 'folder',
      resourceId: folderId,
      resourceName: folder.name,
      metadata: { deletedDocumentCount: docs.length },
      status: 'success',
    });
    await emitHintInTx(tx, {
      orgId: auth.organizationId,
      entity: 'document',
      entityId: folderId,
    });
    await emitHintInTx(tx, {
      orgId: auth.organizationId,
      entity: 'folder',
      entityId: folderId,
    });
  });
}
