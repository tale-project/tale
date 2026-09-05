// @vitest-environment node

/**
 * The settings panel's file lane, both halves.
 *
 * WRITE: the project's edit gate is this door's only authorization, and it
 * used to run inside the transaction — after the bytes were already in the
 * org's store. A rewrite also left the previous blob bound and active (no
 * sweep reaps a `project_text` row), and a bind that failed after the store
 * write stranded the fresh one the same way.
 *
 * READ: the read half must tell ABSENCE from FAILURE. Absence in
 * every form (no folder, no file, no blob) is the empty map — a first-run
 * panel pre-fills its declared defaults. A store that cannot answer is not
 * absence: answering `{}` there made the panel show defaults, and the
 * operator's next Save wrote them over the real file. The read now refuses
 * with a coded 503 the panel renders as its load-failed state.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { s3GetObjectBytesIfExists } from '../../core/lib/storage/object_store.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  deleteOrgBlobRefs,
  putOrgBlobBytes,
  registerUploadedBytes,
} from '../files/service.ts';
import {
  assertProjectFolderWrite,
  getOrCreateProjectFolder,
} from '../folders/service.ts';
import {
  ensureProjectTextDocument,
  readProjectTextValues,
} from './project-text.ts';
import { DocumentError } from './service.ts';

vi.mock('../../core/lib/storage/object_store.ts', () => ({
  s3GetObjectBytesIfExists: vi.fn(),
}));
vi.mock('../../lib/object-store.ts', () => ({
  resolveObjectStore: vi.fn(() => Promise.resolve({ bucket: 'tale' })),
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));
vi.mock('../projects/service.ts', () => ({
  loadProjectOrThrow: vi.fn(() => Promise.resolve({ id: 'proj-1' })),
  assertReadable: vi.fn(),
}));
vi.mock('../files/service.ts', () => ({
  putOrgBlobBytes: vi.fn(),
  registerUploadedBytes: vi.fn(),
  deleteOrgBlobRefs: vi.fn(),
}));
vi.mock('../folders/service.ts', () => ({
  getOrCreateProjectFolder: vi.fn(),
  assertProjectFolderWrite: vi.fn(),
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

function fakeSql(fileRef: string | null): Sql {
  const run = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT d.file_ref')) {
      return Promise.resolve(fileRef === null ? [] : [{ fileRef }]);
    }
    return Promise.resolve([]);
  };
  return run as unknown as Sql;
}

const auth = {
  organizationId: 'org_1',
  userId: 'user-1',
  role: 'admin',
  teamIds: [] as string[],
};
const args = {
  projectId: 'proj-1',
  folderName: 'Setup',
  fileName: 'policy.yaml',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('readProjectTextValues', () => {
  it('parses the file the store has', async () => {
    vi.mocked(s3GetObjectBytesIfExists).mockResolvedValueOnce(
      new TextEncoder().encode('rate: "19"\nregion: DE\n'),
    );
    await expect(
      readProjectTextValues(fakeSql('s3:acme/policy'), auth, args),
    ).resolves.toEqual({ rate: '19', region: 'DE' });
  });

  it('answers the empty map when no document points at a file', async () => {
    await expect(
      readProjectTextValues(fakeSql(null), auth, args),
    ).resolves.toEqual({});
    expect(s3GetObjectBytesIfExists).not.toHaveBeenCalled();
  });

  it('answers the empty map when the blob is gone (absence)', async () => {
    vi.mocked(s3GetObjectBytesIfExists).mockResolvedValueOnce(null);
    await expect(
      readProjectTextValues(fakeSql('s3:acme/policy'), auth, args),
    ).resolves.toEqual({});
  });

  it('refuses with a coded 503 when the store cannot answer (failure)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(s3GetObjectBytesIfExists).mockRejectedValueOnce(
      new Error('S3 GET acme/policy failed: 503 slow down'),
    );
    const refused = await readProjectTextValues(
      fakeSql('s3:acme/policy'),
      auth,
      args,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(DocumentError);
    if (!(refused instanceof DocumentError)) throw new Error('unreachable');
    expect(refused.code).toBe('PROJECT_TEXT_READ_FAILED');
    expect(refused.status).toBe(503);
  });
});

interface Statement {
  text: string;
  values: unknown[];
}

const LOOKUP = 'SELECT id, file_ref AS "fileRef" FROM app.documents';

function fakeWriteSql(
  existing: { id: string; fileRef: string | null } | null,
): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith(LOOKUP)) {
      return Promise.resolve(existing === null ? [] : [existing]);
    }
    if (text.startsWith('INSERT INTO app.documents')) {
      return Promise.resolve([{ id: 'doc-new' }]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(run, {
    begin: (callback: (t: typeof run) => unknown): unknown => callback(run),
  }) as unknown as Sql;
  return { sql, statements };
}

const writeArgs = {
  projectId: 'proj-1',
  folderName: 'Setup',
  fileName: 'policy.yaml',
  yaml: { rate: '19' },
};

describe('ensureProjectTextDocument', () => {
  it('refuses before any byte lands when the caller cannot edit the project', async () => {
    vi.mocked(assertProjectFolderWrite).mockRejectedValueOnce(
      new Error('RBAC_FORBIDDEN'),
    );
    const fake = fakeWriteSql(null);

    await expect(
      ensureProjectTextDocument(fake.sql, auth, writeArgs),
    ).rejects.toThrow('RBAC_FORBIDDEN');

    expect(putOrgBlobBytes).not.toHaveBeenCalled();
    expect(registerUploadedBytes).not.toHaveBeenCalled();
  });

  it('rotates the previous blob out when a save rewrites the file', async () => {
    vi.mocked(putOrgBlobBytes).mockResolvedValueOnce('s3:acme/policy-2');
    vi.mocked(registerUploadedBytes).mockResolvedValueOnce({
      fileId: 'file-2',
    });
    vi.mocked(getOrCreateProjectFolder).mockResolvedValueOnce({
      folderId: 'folder-1',
      name: 'Setup',
      created: false,
    });
    const fake = fakeWriteSql({ id: 'doc-1', fileRef: 's3:acme/policy-1' });

    const result = await ensureProjectTextDocument(fake.sql, auth, writeArgs);

    expect(result).toEqual({
      folderId: 'folder-1',
      documentId: 'doc-1',
      createdFolder: false,
      action: 'updated',
    });
    const unbind = fake.statements.find(
      (s) =>
        s.text.startsWith('UPDATE app.file_metadata SET') &&
        s.text.includes("lifecycle_status = 'trashed'"),
    );
    expect(unbind?.text).toContain('document_id = NULL');
    expect(unbind?.values).toEqual(
      expect.arrayContaining(['org_1', 'doc-1', 's3:acme/policy-1']),
    );
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'knowledge.release_refs',
      { organizationId: 'org_1', refs: ['s3:acme/policy-1'] },
    );
    expect(deleteOrgBlobRefs).not.toHaveBeenCalled();
  });

  it('reclaims the blob it wrote when the bind fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(putOrgBlobBytes).mockResolvedValueOnce('s3:acme/policy-3');
    vi.mocked(registerUploadedBytes).mockResolvedValueOnce({
      fileId: 'file-3',
    });
    vi.mocked(getOrCreateProjectFolder).mockRejectedValueOnce(
      new Error('folder insert failed'),
    );
    const fake = fakeWriteSql(null);

    await expect(
      ensureProjectTextDocument(fake.sql, auth, writeArgs),
    ).rejects.toThrow('folder insert failed');

    const reclaim = fake.statements.find((s) =>
      s.text.startsWith('DELETE FROM app.file_metadata'),
    );
    expect(reclaim?.text).toContain('document_id IS NULL');
    expect(reclaim?.values).toEqual(
      expect.arrayContaining(['file-3', 'org_1']),
    );
    expect(deleteOrgBlobRefs).toHaveBeenCalledWith(fake.sql, 'org_1', [
      's3:acme/policy-3',
    ]);
  });
});
