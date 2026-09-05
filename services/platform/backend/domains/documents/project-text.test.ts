// @vitest-environment node

/**
 * The settings panel's read half must tell ABSENCE from FAILURE. Absence in
 * every form (no folder, no file, no blob) is the empty map — a first-run
 * panel pre-fills its declared defaults. A store that cannot answer is not
 * absence: answering `{}` there made the panel show defaults, and the
 * operator's next Save wrote them over the real file. The read now refuses
 * with a coded 503 the panel renders as its load-failed state.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { s3GetObjectBytesIfExists } from '../../core/lib/storage/object_store.ts';
import { readProjectTextValues } from './project-text.ts';
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
