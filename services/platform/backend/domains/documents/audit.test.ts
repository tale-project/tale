// @vitest-environment node

/**
 * The document audit vocabulary every door shares. Two removals, two rows:
 * a purge (`document.deleted`, the UI) and a trash (`document.trashed`,
 * WebDAV and the folder cascade) must never read alike — one is
 * recoverable from the Trash, the other is not.
 */

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAuditLog } = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));

import {
  auditDocumentCreated,
  auditDocumentRemoved,
  auditDocumentUpdated,
  auditFolderDeleted,
  documentActor,
} from './audit.ts';

const tx = {} as unknown as TransactionSql;
const actor = documentActor({
  organizationId: 'org-1',
  userId: 'user-1',
  email: 'ada@example.test',
});

const row = () => createAuditLog.mock.calls[0]?.[1];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('document audit rows', () => {
  it('names the source, scope and door of a creation', async () => {
    await auditDocumentCreated(tx, actor, {
      documentId: 'doc-1',
      title: 'plan.txt',
      sourceProvider: 'webdav',
      projectId: null,
      teamIds: ['team-1'],
      folderId: 'folder-1',
      metadata: { door: 'webdav' },
    });
    expect(createAuditLog).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      actorId: 'user-1',
      actorEmail: 'ada@example.test',
      actorType: 'user',
      action: 'document.created',
      category: 'data',
      resourceType: 'document',
      resourceId: 'doc-1',
      resourceName: 'plan.txt',
      metadata: {
        sourceProvider: 'webdav',
        projectId: null,
        teamIds: ['team-1'],
        folderId: 'folder-1',
        door: 'webdav',
      },
      status: 'success',
    });
  });

  it('keeps the upload row exactly as the upload lane wrote it', async () => {
    await auditDocumentCreated(tx, actor, {
      documentId: 'doc-1',
      title: 'report.pdf',
      sourceProvider: 'upload',
      projectId: 'project-1',
      teamIds: [],
    });
    expect(row()).toMatchObject({
      metadata: {
        sourceProvider: 'upload',
        projectId: 'project-1',
        teamIds: [],
      },
    });
    expect((row() as { metadata: object }).metadata).not.toHaveProperty(
      'folderId',
    );
  });

  it('records an API import under the api actor type', async () => {
    await auditDocumentCreated(tx, documentActor(actor, 'api'), {
      documentId: 'doc-1',
      title: 'import.md',
      sourceProvider: 'api_import',
    });
    expect(row()).toMatchObject({
      actorType: 'api',
      metadata: { sourceProvider: 'api_import' },
    });
  });

  it('tells a trash from a purge by the action', async () => {
    await auditDocumentRemoved(tx, actor, {
      documentId: 'doc-1',
      title: 'plan.txt',
      mode: 'trashed',
      metadata: { door: 'webdav' },
    });
    await auditDocumentRemoved(tx, actor, {
      documentId: 'doc-2',
      title: null,
      mode: 'purged',
      metadata: { controlled: false },
    });
    const rows = createAuditLog.mock.calls.map((call) => call[1]);
    expect(rows[0]).toMatchObject({
      action: 'document.trashed',
      resourceId: 'doc-1',
      resourceName: 'plan.txt',
      metadata: { door: 'webdav' },
    });
    expect(rows[1]).toMatchObject({
      action: 'document.deleted',
      resourceId: 'doc-2',
      metadata: { controlled: false },
    });
    expect(rows[1]).not.toHaveProperty('resourceName');
  });

  it('records an in-place rewrite and a folder cascade', async () => {
    await auditDocumentUpdated(tx, actor, {
      documentId: 'doc-1',
      title: 'plan.txt',
      changedFields: ['fileRef'],
      metadata: { door: 'webdav' },
    });
    await auditFolderDeleted(tx, actor, {
      folderId: 'folder-1',
      name: 'Reports',
      metadata: { trashedDocumentCount: 3, door: 'webdav' },
    });
    const rows = createAuditLog.mock.calls.map((call) => call[1]);
    expect(rows[0]).toMatchObject({
      action: 'document.updated',
      changedFields: ['fileRef'],
    });
    expect(rows[1]).toMatchObject({
      action: 'folder.deleted',
      resourceType: 'folder',
      resourceId: 'folder-1',
      resourceName: 'Reports',
      metadata: { trashedDocumentCount: 3, door: 'webdav' },
    });
  });
});
