// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, expect, it, vi } from 'vitest';

import { resolveObjectStore, s3DeleteObject } from '../../lib/object-store.ts';
import { deleteRejectedUploadBlob } from './service.ts';
import {
  claimRejectedUpload,
  releaseReclaimedIntent,
} from './upload-intents.ts';

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
  releaseReclaimedIntent: vi.fn(),
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
  // The claim's tombstone goes only once the store confirmed the delete.
  expect(releaseReclaimedIntent).toHaveBeenCalledWith(expect.anything(), {
    organizationId: 'org_1',
    storageRef: 's3:blobs/acme/aaa',
  });
  expect(
    vi.mocked(s3DeleteObject).mock.invocationCallOrder[0] ?? 0,
  ).toBeLessThan(
    vi.mocked(releaseReclaimedIntent).mock.invocationCallOrder[0] ?? 0,
  );
});

it('keeps the tombstone for the sweep when the store refuses the delete (#4111)', async () => {
  vi.mocked(claimRejectedUpload).mockResolvedValue(true);
  vi.mocked(resolveObjectStore).mockResolvedValue({ bucket: 'blobs' } as never);
  vi.mocked(s3DeleteObject).mockRejectedValue(new Error('store down'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const outcome = await deleteRejectedUploadBlob(
    vi.fn() as unknown as Sql,
    scope,
    's3:blobs/acme/aaa',
  );

  // The upload is the caller's no more either way; its bytes are the
  // sweep's now, which finds the tombstone on the org's next mint.
  expect(outcome).toEqual({ deleted: true });
  expect(releaseReclaimedIntent).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('the abandoned-upload sweep retries it'),
    expect.any(Error),
  );
  warn.mockRestore();
});
