import type { TransactionSql } from 'postgres';

import { createAuditLog } from '../audit_logs/service.ts';
import type { AuditLogActorType } from '../audit_logs/types.ts';

/**
 * The audit rows a document's lifecycle owes — one vocabulary for every door
 * that creates, rewrites or removes a row: the app's upload and hub imports,
 * the UI's purge and folder cascade, and the WebDAV tree (PUT, COPY, DELETE,
 * an overwriting MOVE). Emitted INSIDE the writing transaction beside the
 * hints (`./hints.ts`), so a row and its account commit together.
 *
 * Two removals, two rows: the UI purges (`document.deleted` — the bytes are
 * gone) while WebDAV and the folder cascade trash (`document.trashed` — the
 * row waits in the Trash for a restore, `governance/trash.ts`). A reader who
 * needs "is it recoverable" must be able to tell them apart.
 */

export interface DocumentAuditActor {
  organizationId: string;
  userId: string;
  email?: string;
  /** Defaults to `user`. */
  type?: AuditLogActorType;
}

/** The actor a request-scoped auth context names. */
export function documentActor(
  auth: { organizationId: string; userId: string; email?: string },
  type?: AuditLogActorType,
): DocumentAuditActor {
  return {
    organizationId: auth.organizationId,
    userId: auth.userId,
    ...(auth.email !== undefined ? { email: auth.email } : {}),
    ...(type !== undefined ? { type } : {}),
  };
}

function actorFields(actor: DocumentAuditActor) {
  return {
    organizationId: actor.organizationId,
    actorId: actor.userId,
    ...(actor.email !== undefined ? { actorEmail: actor.email } : {}),
    actorType: actor.type ?? 'user',
  };
}

export function auditDocumentCreated(
  tx: TransactionSql,
  actor: DocumentAuditActor,
  doc: {
    documentId: string;
    title: string;
    /** Where the bytes came from: `upload`, `api_import`, `webdav`, … */
    sourceProvider: string;
    projectId?: string | null;
    teamIds?: string[];
    folderId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  return createAuditLog(tx, {
    ...actorFields(actor),
    action: 'document.created',
    category: 'data',
    resourceType: 'document',
    resourceId: doc.documentId,
    resourceName: doc.title,
    metadata: {
      sourceProvider: doc.sourceProvider,
      ...(doc.projectId !== undefined ? { projectId: doc.projectId } : {}),
      ...(doc.teamIds !== undefined ? { teamIds: doc.teamIds } : {}),
      ...(doc.folderId !== undefined ? { folderId: doc.folderId } : {}),
      ...doc.metadata,
    },
    status: 'success',
  });
}

/** The row's content was rewritten in place (a WebDAV overwrite). */
export function auditDocumentUpdated(
  tx: TransactionSql,
  actor: DocumentAuditActor,
  doc: {
    documentId: string;
    title: string | null;
    changedFields?: string[];
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  return createAuditLog(tx, {
    ...actorFields(actor),
    action: 'document.updated',
    category: 'data',
    resourceType: 'document',
    resourceId: doc.documentId,
    ...(doc.title !== null ? { resourceName: doc.title } : {}),
    ...(doc.changedFields !== undefined
      ? { changedFields: doc.changedFields }
      : {}),
    ...(doc.metadata !== undefined ? { metadata: doc.metadata } : {}),
    status: 'success',
  });
}

export type DocumentRemovalMode = 'trashed' | 'purged';

export function auditDocumentRemoved(
  tx: TransactionSql,
  actor: DocumentAuditActor,
  doc: {
    documentId: string;
    title: string | null;
    mode: DocumentRemovalMode;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  return createAuditLog(tx, {
    ...actorFields(actor),
    action: doc.mode === 'purged' ? 'document.deleted' : 'document.trashed',
    category: 'data',
    resourceType: 'document',
    resourceId: doc.documentId,
    ...(doc.title !== null ? { resourceName: doc.title } : {}),
    ...(doc.metadata !== undefined ? { metadata: doc.metadata } : {}),
    status: 'success',
  });
}

/** A folder went with its contents — one row for the cascade, with counts. */
export function auditFolderDeleted(
  tx: TransactionSql,
  actor: DocumentAuditActor,
  folder: {
    folderId: string;
    name: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  return createAuditLog(tx, {
    ...actorFields(actor),
    action: 'folder.deleted',
    category: 'data',
    resourceType: 'folder',
    resourceId: folder.folderId,
    resourceName: folder.name,
    ...(folder.metadata !== undefined ? { metadata: folder.metadata } : {}),
    status: 'success',
  });
}
