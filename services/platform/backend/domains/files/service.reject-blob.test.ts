// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, expect, it, vi } from 'vitest';

import { resolveObjectStore, s3DeleteObject } from '../../lib/object-store.ts';
import { deleteRejectedUploadBlob } from './service.ts';
import { claimRejectedUpload } from './upload-intents.ts';

/**
 * The rejected-upload reclaim decides nothing of its own: the claim on the
 * caller's intent (`claimRejectedUpload`) is the whole rule — the stamp a
 * non-consuming bind wrote and every row that holds the ref — so a check
 * beside it can never again diverge from it (#4104). A refused claim never
 * reaches the store.
 */

vi.mock(import('./upload-intents.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  claimRejectedUpload: vi.fn(),
}));
vi.mock(import('../../lib/object-store.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveObjectStore: vi.fn(),
  s3DeleteObject: vi.fn(),
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));

const scope = { organizationId: 'org_1', userId: 'user_1' };

afterEach(() => {
  vi.clearAllMocks();
});

it('answers deleted: false without a store call when the claim refuses', async () => {
  vi.mocked(claimRejectedUpload).mockResolvedValue(false);
  const sql = vi.fn();

  const outcome = await deleteRejectedUploadBlob(
    sql as unknown as Sql,
    scope,
    's3:blobs/acme/held',
  );

  expect(outcome).toEqual({ deleted: false });
  expect(claimRejectedUpload).toHaveBeenCalledWith(sql, {
    ...scope,
    storageRef: 's3:blobs/acme/held',
  });
  // No statement of its own: the claim is the only question asked.
  expect(sql).not.toHaveBeenCalled();
  expect(resolveObjectStore).not.toHaveBeenCalled();
  expect(s3DeleteObject).not.toHaveBeenCalled();
});

it('deletes the org-scoped key once the claim succeeds', async () => {
  vi.mocked(claimRejectedUpload).mockResolvedValue(true);
  const store = { bucket: 'blobs' };
  vi.mocked(resolveObjectStore).mockResolvedValue(store as never);
  vi.mocked(s3DeleteObject).mockResolvedValue(undefined);

  const outcome = await deleteRejectedUploadBlob(
    vi.fn() as unknown as Sql,
    scope,
    's3:blobs/acme/aaa',
  );

  expect(outcome).toEqual({ deleted: true });
  expect(s3DeleteObject).toHaveBeenCalledWith(store, 'blobs/acme/aaa');
});
