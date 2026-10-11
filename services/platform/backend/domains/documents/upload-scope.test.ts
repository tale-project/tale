// @vitest-environment node

import type { TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { createDocumentFromUpload, createHubDocument } from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('./hints.ts', () => ({ emitDocumentChangeHints: vi.fn() }));
vi.mock('../knowledge/service.ts', () => ({ markRagQueued: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx: vi.fn(),
}));

const auth = {
  organizationId: 'org-1',
  userId: 'user-1',
  role: 'editor',
  teamIds: [],
};

type FolderFixture = {
  id: string;
  organizationId: string;
  projectId: string | null;
  teamTags: string[];
};

function database(options: {
  existingProjectId: string | null;
  boundDuringLock?: boolean;
  /** A fresh upload no document holds yet. */
  unbound?: boolean;
  folders?: Record<string, FolderFixture>;
}) {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings
      .reduce(
        (query, part, i) =>
          query +
          part +
          (typeof values[i] === 'object' &&
          values[i] !== null &&
          'sql' in values[i]
            ? String(values[i].sql)
            : i < values.length
              ? '?'
              : ''),
        '',
      )
      .replace(/\s+/g, ' ')
      .trim();
    statements.push({ text, values });
    if (text.includes('FROM app.file_metadata'))
      return [
        {
          id: 'file-1',
          organizationId: 'org-1',
          uploadedBy: 'user-1',
          storageRef: 's3:acme/file-1',
          contentType: 'text/plain',
          documentId:
            options.unbound ||
            (options.boundDuringLock && !text.includes('FOR UPDATE'))
              ? null
              : 'doc-1',
          threadId: null,
          conversationId: null,
        },
      ];
    if (text.includes('FROM app.documents'))
      return [
        {
          id: 'doc-1',
          organizationId: 'org-1',
          projectId: options.existingProjectId,
        },
      ];
    if (text.includes('FROM app.projects'))
      return [
        {
          id: 'p-1',
          organizationId: 'org-1',
          teamId: null,
          sharedWithTeamIds: [],
          archivedAt: null,
        },
      ];
    if (text.includes('FROM app.folders')) {
      const id = values.find((value) => typeof value === 'string');
      const folder = typeof id === 'string' ? options.folders?.[id] : undefined;
      return folder ? [folder] : [];
    }
    if (text.startsWith('INSERT INTO app.documents')) return [{ id: 'doc-2' }];
    return [];
  };
  const tx = Object.assign(tag, {
    unsafe: (sql: string) => ({ sql }),
    json: (value: unknown) => value,
  }) as unknown as TransactionSql;
  return { tx, statements };
}

describe('document upload scope admission [DOC-R10]', () => {
  it.each([
    [null, 'p-1'],
    ['p-1', undefined],
    ['p-1', 'p-2'],
  ])(
    'refuses to reuse a %s upload in scope %s',
    async (existingProjectId, projectId) => {
      const { tx, statements } = database({ existingProjectId });
      await expect(
        createDocumentFromUpload(tx, auth, {
          fileId: 'file-1',
          fileName: 'Private.txt',
          ...(projectId !== undefined ? { projectId } : {}),
        }),
      ).rejects.toMatchObject({ code: 'UPLOAD_SCOPE_CONFLICT' });
      expect(
        statements.some(({ text }) =>
          text.startsWith('INSERT INTO app.documents'),
        ),
      ).toBe(false);
    },
  );

  it.each([null, 'p-1'])(
    'preserves repeated document creation within scope %s',
    async (projectId) => {
      const { tx } = database({ existingProjectId: projectId });
      await expect(
        createDocumentFromUpload(tx, auth, {
          fileId: 'file-1',
          fileName: 'Shared.txt',
          ...(projectId !== null ? { projectId } : {}),
        }),
      ).resolves.toBe('doc-2');
    },
  );

  it('sees a project binding that committed while the Hub writer waited', async () => {
    const { tx, statements } = database({
      existingProjectId: 'p-1',
      boundDuringLock: true,
    });
    await expect(
      createHubDocument(tx, auth, { title: 'Published', fileId: 'file-1' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      statements.some(({ text }) =>
        text.startsWith('INSERT INTO app.documents'),
      ),
    ).toBe(false);
  });

  it('sees a Hub binding that committed while the project writer waited', async () => {
    const { tx, statements } = database({
      existingProjectId: null,
      boundDuringLock: true,
    });
    await expect(
      createDocumentFromUpload(tx, auth, {
        fileId: 'file-1',
        fileName: 'Private.txt',
        projectId: 'p-1',
      }),
    ).rejects.toMatchObject({ code: 'UPLOAD_SCOPE_CONFLICT' });
    expect(
      statements.some(({ text }) =>
        text.startsWith('INSERT INTO app.documents'),
      ),
    ).toBe(false);
  });
});

// The Files tab once sent a project's upload with a folder picked in the
// project shown before (#3918). This check is what refused it: a folder
// counts only in the place the file is uploaded to.
describe('an upload is filed only in a folder of the place it was uploaded to [DOC-R13]', () => {
  const folders: Record<string, FolderFixture> = {
    'folder-p1': {
      id: 'folder-p1',
      organizationId: 'org-1',
      projectId: 'p-1',
      teamTags: [],
    },
    'folder-p2': {
      id: 'folder-p2',
      organizationId: 'org-1',
      projectId: 'p-2',
      teamTags: [],
    },
    'folder-hub': {
      id: 'folder-hub',
      organizationId: 'org-1',
      projectId: null,
      teamTags: [],
    },
    'folder-other-org': {
      id: 'folder-other-org',
      organizationId: 'org-2',
      projectId: 'p-1',
      teamTags: [],
    },
  };
  const created = (statements: { text: string; values: unknown[] }[]) =>
    statements.filter(({ text }) =>
      text.startsWith('INSERT INTO app.documents'),
    );

  it.each([
    ['another project', 'folder-p2'],
    ['the library', 'folder-hub'],
    ['another organization', 'folder-other-org'],
  ])(
    'answers a project upload into a folder of %s as not found',
    async (_place, folderId) => {
      const { tx, statements } = database({
        existingProjectId: null,
        unbound: true,
        folders,
      });
      await expect(
        createDocumentFromUpload(tx, auth, {
          fileId: 'file-1',
          fileName: 'new-upload.txt',
          projectId: 'p-1',
          folderId,
        }),
      ).rejects.toMatchObject({ code: 'FOLDER_NOT_FOUND', status: 404 });
      expect(created(statements)).toEqual([]);
    },
  );

  it('answers a library upload into a project folder as not found', async () => {
    const { tx, statements } = database({
      existingProjectId: null,
      unbound: true,
      folders,
    });
    await expect(
      createDocumentFromUpload(tx, auth, {
        fileId: 'file-1',
        fileName: 'new-upload.txt',
        folderId: 'folder-p1',
      }),
    ).rejects.toMatchObject({ code: 'FOLDER_NOT_FOUND', status: 404 });
    expect(created(statements)).toEqual([]);
  });

  it('files a project upload in one of its own folders', async () => {
    const { tx, statements } = database({
      existingProjectId: null,
      unbound: true,
      folders,
    });
    await expect(
      createDocumentFromUpload(tx, auth, {
        fileId: 'file-1',
        fileName: 'new-upload.txt',
        projectId: 'p-1',
        folderId: 'folder-p1',
      }),
    ).resolves.toBe('doc-2');
    const [insert] = created(statements);
    expect(insert?.values).toEqual(
      expect.arrayContaining(['p-1', 'folder-p1']),
    );
  });

  it('files a project upload without a folder at the top of the project', async () => {
    const { tx, statements } = database({
      existingProjectId: null,
      unbound: true,
      folders,
    });
    await expect(
      createDocumentFromUpload(tx, auth, {
        fileId: 'file-1',
        fileName: 'new-upload.txt',
        projectId: 'p-1',
      }),
    ).resolves.toBe('doc-2');
    expect(
      statements.some(({ text }) => text.includes('FROM app.folders')),
    ).toBe(false);
    expect(created(statements)).toHaveLength(1);
  });
});
