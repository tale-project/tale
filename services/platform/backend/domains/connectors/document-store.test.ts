// @vitest-environment node

/**
 * The workflow `document.*` natives over the 0.5 documents domain.
 *
 * Regression: the first 0.5 store answered "the folder does not exist" for
 * every PROJECT folder and filed created documents through the hub-only door,
 * which dropped the harvested blob (`storageId`) and the idempotency key — a
 * desk automation's deliverables never reached the quarter folder its task is
 * bound to. This pins the 0.4 contract: any org folder; a blob-backed row in
 * THAT folder, stamped as the run's output, keyed per (folder, name) unless
 * the node names its own key; a blob the org does not hold is refused before
 * any row is written.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorError } from '../../../lib/connectors/errors.ts';
import {
  linkAgentDocumentFile,
  storeAgentTextBlob,
  upsertAgentDocument,
} from '../documents/agent-write.ts';
import { listFolderDocumentsBounded } from '../documents/service.ts';
import { getFileMetadataByIdOrRef } from '../files/service.ts';
import {
  FolderError,
  listFolders,
  loadFolderOrThrow,
} from '../folders/service.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import { pgDocumentStore } from './document-store.ts';

vi.mock('../documents/agent-write.ts', () => ({
  linkAgentDocumentFile: vi.fn(),
  storeAgentTextBlob: vi.fn(),
  upsertAgentDocument: vi.fn(),
}));
vi.mock('../documents/service.ts', () => ({
  listFolderDocumentsBounded: vi.fn(),
}));
vi.mock('../files/service.ts', () => ({ getFileMetadataByIdOrRef: vi.fn() }));
vi.mock('../folders/paths.ts', () => ({ findHubFolderByPath: vi.fn() }));
vi.mock('../folders/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../folders/service.ts')>()),
  listFolders: vi.fn(),
  loadFolderOrThrow: vi.fn(),
}));
vi.mock('../projects/service.ts', () => ({ getProjectAuthContext: vi.fn() }));

const sql = {} as unknown as Sql;

const QUARTER_FOLDER = {
  id: 'fld-q1',
  organizationId: 'org_1',
  name: '2026Q1',
  parentId: null,
  teamId: null,
  teamTags: [] as string[],
  projectId: 'proj-1',
  createdBy: 'user-1',
  createdAt: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getProjectAuthContext).mockResolvedValue({
    organizationId: 'org_1',
    userId: 'system',
    role: 'owner',
    teamIds: [],
  } as never);
  vi.mocked(loadFolderOrThrow).mockResolvedValue(QUARTER_FOLDER);
  vi.mocked(upsertAgentDocument).mockResolvedValue({
    documentId: 'doc-1',
    action: 'created',
    contentChanged: true,
  });
});

describe('pgDocumentStore.create', () => {
  it('claims a harvested blob into a PROJECT folder as the run s document', async () => {
    vi.mocked(getFileMetadataByIdOrRef).mockResolvedValue({
      id: 'file-1',
      organizationId: 'org_1',
      storageRef: 's3:test/blob-1',
      fileName: 'return.xml',
      contentType: 'application/octet-stream',
      size: 12,
      uploadedBy: null,
      documentId: null,
      threadId: null,
      conversationId: null,
      createdAt: 1,
    });

    const result = await pgDocumentStore(sql).create({
      organizationId: 'org_1',
      folderId: 'fld-q1',
      name: 'return.xml',
      storageId: 's3:test/blob-1',
      contentType: 'application/xml',
    });

    expect(result).toEqual({ documentId: 'doc-1', action: 'created' });
    // The blob is verified as THIS org's before anything is written.
    expect(getFileMetadataByIdOrRef).toHaveBeenCalledWith(
      sql,
      'org_1',
      's3:test/blob-1',
    );
    expect(upsertAgentDocument).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      externalItemId: 'workflow:fld-q1:return.xml',
      title: 'return.xml',
      fileRef: 's3:test/blob-1',
      mimeType: 'application/xml',
      extension: 'xml',
      sourceProvider: 'agent',
      createdBy: 'workflow',
      folderId: 'fld-q1',
      auditActorId: 'workflow',
    });
    // Promoted like an upload: file row bound, indexing queued.
    expect(linkAgentDocumentFile).toHaveBeenCalledWith(sql, {
      storageRef: 's3:test/blob-1',
      documentId: 'doc-1',
    });
    expect(storeAgentTextBlob).not.toHaveBeenCalled();
  });

  it('keeps the node s own idempotency key and the blob s type when none is named', async () => {
    vi.mocked(getFileMetadataByIdOrRef).mockResolvedValue({
      storageRef: 's3:test/blob-2',
      contentType: 'text/csv',
    } as never);

    await pgDocumentStore(sql).create({
      organizationId: 'org_1',
      folderId: 'fld-q1',
      name: 'journal.csv',
      storageId: 's3:test/blob-2',
      externalItemId: 'vat:2026Q1:journal',
    });

    expect(upsertAgentDocument).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        externalItemId: 'vat:2026Q1:journal',
        mimeType: 'text/csv',
      }),
    );
  });

  it('stores inline text first — a document always carries a blob', async () => {
    vi.mocked(storeAgentTextBlob).mockResolvedValue({
      storageRef: 's3:test/inline-1',
      fileId: 'file-9',
      size: 5,
    });

    await pgDocumentStore(sql).create({
      organizationId: 'org_1',
      folderId: 'fld-q1',
      name: 'notes.md',
      content: 'hello',
      contentType: 'text/markdown',
    });

    expect(storeAgentTextBlob).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      fileName: 'notes.md',
      content: 'hello',
      contentType: 'text/markdown',
      uploadedBy: 'workflow',
    });
    expect(upsertAgentDocument).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        fileRef: 's3:test/inline-1',
        mimeType: 'text/markdown',
        folderId: 'fld-q1',
      }),
    );
    expect(getFileMetadataByIdOrRef).not.toHaveBeenCalled();
  });

  it('does not re-promote a same-blob re-run', async () => {
    vi.mocked(getFileMetadataByIdOrRef).mockResolvedValue({
      storageRef: 's3:test/blob-1',
      contentType: 'application/xml',
    } as never);
    vi.mocked(upsertAgentDocument).mockResolvedValue({
      documentId: 'doc-1',
      action: 'updated',
      contentChanged: false,
    });

    const result = await pgDocumentStore(sql).create({
      organizationId: 'org_1',
      folderId: 'fld-q1',
      name: 'return.xml',
      storageId: 's3:test/blob-1',
    });

    expect(result).toEqual({ documentId: 'doc-1', action: 'updated' });
    expect(linkAgentDocumentFile).not.toHaveBeenCalled();
  });

  it('refuses a blob the organization does not hold, before any row', async () => {
    vi.mocked(getFileMetadataByIdOrRef).mockResolvedValue(null);

    const refused = await pgDocumentStore(sql)
      .create({
        organizationId: 'org_1',
        folderId: 'fld-q1',
        name: 'return.xml',
        storageId: 's3:other-org/blob-1',
      })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(refused).toBeInstanceOf(ConnectorError);
    if (!(refused instanceof ConnectorError)) throw new Error('unreachable');
    expect(refused.code).toBe('INPUT_INVALID');
    expect(refused.message).toContain('not a stored file of this organization');
    expect(upsertAgentDocument).not.toHaveBeenCalled();
    expect(storeAgentTextBlob).not.toHaveBeenCalled();
  });

  it('refuses a folder outside the organization as missing, before any row', async () => {
    vi.mocked(loadFolderOrThrow).mockResolvedValue({
      ...QUARTER_FOLDER,
      organizationId: 'org_other',
    });

    await expect(
      pgDocumentStore(sql).create({
        organizationId: 'org_1',
        folderId: 'fld-q1',
        name: 'return.xml',
        content: 'x',
      }),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(storeAgentTextBlob).not.toHaveBeenCalled();
    expect(upsertAgentDocument).not.toHaveBeenCalled();
  });

  it('reads a folder the org does not have as missing (FolderError → refusal)', async () => {
    vi.mocked(loadFolderOrThrow).mockRejectedValue(
      new FolderError('FOLDER_NOT_FOUND', 'Folder not found', 404),
    );

    await expect(
      pgDocumentStore(sql).create({
        organizationId: 'org_1',
        folderId: 'fld-missing',
        name: 'return.xml',
        content: 'x',
      }),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });
});

describe('pgDocumentStore.listFolder', () => {
  it('lists a PROJECT folder and walks its subfolders under the project', async () => {
    vi.mocked(listFolderDocumentsBounded).mockResolvedValue({
      documents: [
        { id: 'doc-a', title: 'sales.csv', fileRef: 's3:test/a' },
        { id: 'doc-b', title: 'memo', fileRef: null },
      ] as never,
      truncated: false,
    });
    vi.mocked(listFolders).mockResolvedValue([]);

    const listing = await pgDocumentStore(sql).listFolder({
      organizationId: 'org_1',
      folderId: 'fld-q1',
      recursive: true,
    });

    expect(listing).toEqual({
      files: [
        { name: 'sales.csv', storageId: 's3:test/a' },
        // A text-only document rides along under its document id.
        { name: 'memo', storageId: 'doc-b' },
      ],
      truncated: false,
    });
    expect(listFolderDocumentsBounded).toHaveBeenCalledWith(
      sql,
      expect.anything(),
      { folderId: 'fld-q1', limit: 200 },
    );
    // Subfolders of a project folder are the PROJECT's — the hub family
    // would answer nothing and the tree would read as flat.
    expect(listFolders).toHaveBeenCalledWith(sql, expect.anything(), {
      parentId: 'fld-q1',
      projectId: 'proj-1',
    });
  });

  it('answers null for a folder of another organization', async () => {
    vi.mocked(loadFolderOrThrow).mockResolvedValue({
      ...QUARTER_FOLDER,
      organizationId: 'org_other',
    });

    await expect(
      pgDocumentStore(sql).listFolder({
        organizationId: 'org_1',
        folderId: 'fld-q1',
      }),
    ).resolves.toBeNull();
    expect(listFolderDocumentsBounded).not.toHaveBeenCalled();
  });
});
