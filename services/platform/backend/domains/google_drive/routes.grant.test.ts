// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { listFiles } from '../../core/google_drive/list_files.ts';
import type {
  GraphTokenResult,
  PgSyncImportDeps,
} from '../onedrive/service.ts';
import { createGoogleDriveRoutes } from './routes.ts';
import {
  createGoogleDriveImportDeps,
  resolveDriveTokenForUser,
} from './service.ts';

/**
 * The Google Drive import door reads the member's grant again before each
 * file, the check every listing makes. It used to read it once, at the
 * start: a grant revoked or expired while the files came in (access removed
 * at Google ends the token at once) failed every file after it on a refused
 * token, and the import answered a plain failure. Now the import
 * stops at the file the grant ended at and answers the grant's own sentence
 * beside the files it did import. The real pipeline runs here over fake
 * deps; auth, the budget and the grant resolver are stubbed.
 */

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('sessionBundle', {
        user: { id: 'user-1', email: 'member@example.com' },
      });
      await next();
    },
}));

vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('orgId', 'org-1');
      c.set('orgMember', { role: 'admin' });
      await next();
    },
  requireOrgAbility: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

vi.mock('../../lib/rate-limit-response.ts', () => ({
  chargeOrgRateLimit: vi.fn(async () => null),
}));

vi.mock('../projects/service.ts', () => ({
  getProjectAuthContext: vi.fn(async () => ({})),
}));

vi.mock('../../core/google_drive/list_files.ts', () => ({
  listFiles: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  resolveDriveTokenForUser: vi.fn(),
  createGoogleDriveImportDeps: vi.fn(),
}));

const RECONNECT =
  'Google Drive is not authorized for importing. Connect Google Drive from Documents.';

/** Import deps that land every file the pipeline asks for. */
function landingDeps(): PgSyncImportDeps {
  const deps = {
    getFileMetadata: vi.fn(async () => ({ success: true, data: {} })),
    downloadToStorage: vi.fn(async () => ({
      success: true,
      storageId: 'blob-1',
      size: 10,
    })),
    findDocumentByExternalId: vi.fn(async () => null),
    createDocument: vi.fn(async () => 'doc-1'),
    updateDocument: vi.fn(),
    setDocumentFolder: vi.fn(),
    getOrCreateFolderPath: vi.fn(),
    saveFileMetadata: vi.fn(),
    linkDocumentToFile: vi.fn(),
    scheduleHubDocumentRagIndexing: vi.fn(),
    bindDocumentToSync: vi.fn(),
    upsertSyncConfig: vi.fn(),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the pipeline reads these as plain values
  return deps as unknown as PgSyncImportDeps;
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test doubles; auth and the limiter are mocked
const deps = { sql: {} as Sql, auth: {} as Auth };

const importRequest = (count: number) =>
  Promise.resolve(
    createGoogleDriveRoutes(deps).request('/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: Array.from({ length: count }, (_, index) => ({
          id: `file-${index + 1}`,
          name: `f${index + 1}.docx`,
          size: 10,
        })),
        importType: 'one-time',
      }),
    }),
  );

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /import when the grant ends part-way [GDRIVE-R6]', () => {
  it('stops at the file the grant ended at and answers its sentence', async () => {
    // The door's own read, then one per file: live for two files.
    const answers: GraphTokenResult[] = [
      { success: true, token: 'tok' },
      { success: true, token: 'tok' },
      { success: true, token: 'tok' },
      { success: false, error: RECONNECT, needsReauth: true },
    ];
    vi.mocked(resolveDriveTokenForUser).mockImplementation(
      async () => answers.shift() ?? answers[answers.length - 1],
    );
    const pipeline = landingDeps();
    vi.mocked(createGoogleDriveImportDeps).mockReturnValue(pipeline);

    const res = await importRequest(4);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: false,
      totalFiles: 4,
      successCount: 2,
      failedCount: 0,
      error: RECONNECT,
      results: [{ fileId: 'file-1' }, { fileId: 'file-2' }],
    });
    expect(resolveDriveTokenForUser).toHaveBeenCalledWith(
      deps.sql,
      { organizationId: 'org-1', userId: 'user-1' },
      { forceRefresh: false },
    );
    expect(pipeline.downloadToStorage).toHaveBeenCalledTimes(2);
  });

  it('names every file the import was asked for when the grant is gone at the start', async () => {
    vi.mocked(resolveDriveTokenForUser).mockResolvedValue({
      success: false,
      error: RECONNECT,
      needsReauth: true,
    });

    const res = await importRequest(3);

    expect(await res.json()).toMatchObject({
      success: false,
      totalFiles: 3,
      successCount: 0,
      error: RECONNECT,
    });
    expect(createGoogleDriveImportDeps).not.toHaveBeenCalled();
  });
});

/**
 * Access removed at Google ends the token at once, and the listing — the
 * picker's, and an import's folder walk — used to answer Drive's 401 as a
 * plain failure: a toast, never the connect dialog. The listing door now
 * refreshes the grant once on a 401: a grant that cannot be refreshed
 * answers its own sentence, which the picker hands to the connect dialog.
 */
describe('POST /list-files when Drive refuses the token', () => {
  const refused = {
    success: false,
    error:
      'Google Drive API error: 401 {"error":{"code":401,"message":"Invalid Credentials"}}',
    unauthorized: true,
  };
  const list = () =>
    Promise.resolve(
      createGoogleDriveRoutes(deps).request('/list-files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ folderId: 'folder-1' }),
      }),
    );

  it('answers the grant sentence when the grant cannot be refreshed', async () => {
    vi.mocked(resolveDriveTokenForUser).mockImplementation(
      async (_sql, _args, options) =>
        options?.forceRefresh === true
          ? { success: false, error: RECONNECT, needsReauth: true }
          : { success: true, token: 'tok' },
    );
    vi.mocked(listFiles).mockResolvedValue(refused);

    const res = await list();

    expect(await res.json()).toEqual({ success: false, error: RECONNECT });
    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it('lists again with the refreshed token', async () => {
    vi.mocked(resolveDriveTokenForUser).mockImplementation(
      async (_sql, _args, options) => ({
        success: true,
        token: options?.forceRefresh === true ? 'tok-2' : 'tok',
      }),
    );
    const listed = { success: true, items: [], truncated: false };
    vi.mocked(listFiles)
      .mockResolvedValueOnce(refused)
      .mockResolvedValueOnce(listed);

    const res = await list();

    expect(await res.json()).toEqual(listed);
    expect(vi.mocked(listFiles).mock.calls[1]?.[0]).toBe('tok-2');
  });

  it('answers any other failure as it is, with no refresh', async () => {
    vi.mocked(resolveDriveTokenForUser).mockResolvedValue({
      success: true,
      token: 'tok',
    });
    const outage = { success: false, error: 'Google Drive API error: 503 {}' };
    vi.mocked(listFiles).mockResolvedValue(outage);

    const res = await list();

    expect(await res.json()).toEqual(outage);
    expect(resolveDriveTokenForUser).toHaveBeenCalledTimes(1);
  });
});
