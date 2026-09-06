// @vitest-environment node

/**
 * `POST /files/upload` lands the bytes BEFORE it records the upload intent,
 * and the intent row is the only record that the blob exists — so a failed
 * intent write used to answer 500 with an object in the bucket that no
 * sweep could ever find. The route now reclaims the blob it just minted
 * before surfacing the error.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { createFileRoutes } from './routes.ts';
import { deleteOrgBlobRefs, putOrgBlobBytes } from './service.ts';
import { recordUploadIntent } from './upload-intents.ts';

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('sessionBundle', { user: { id: 'user_1' } });
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
      c.set('orgId', 'org_1');
      c.set('orgMember', { role: 'member' });
      await next();
    },
}));
vi.mock('../../lib/rate-limit.ts', () => ({
  checkUserRateLimit: vi.fn(() => Promise.resolve()),
  RateLimitExceededError: class RateLimitExceededError extends Error {},
}));
vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return {
    ...actual,
    putOrgBlobBytes: vi.fn(() => Promise.resolve('s3:blobs/acme/minted')),
    deleteOrgBlobRefs: vi.fn(() => Promise.resolve()),
  };
});
vi.mock('./upload-intents.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./upload-intents.ts')>();
  return { ...actual, recordUploadIntent: vi.fn(() => Promise.resolve()) };
});

function app() {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mocked middleware never touches either dependency
  return createFileRoutes({ sql: {} as Sql, auth: {} as Auth });
}

function upload() {
  return app().request('/upload?purpose=file', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'hello',
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('POST /files/upload', () => {
  it('answers the minted ref once the intent is recorded', async () => {
    const res = await upload();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ storageId: 's3:blobs/acme/minted' });
    expect(putOrgBlobBytes).toHaveBeenCalledTimes(1);
    expect(recordUploadIntent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        userId: 'user_1',
        purpose: 'file',
        storageRef: 's3:blobs/acme/minted',
      }),
    );
    expect(deleteOrgBlobRefs).not.toHaveBeenCalled();
  });

  it('reclaims the landed blob when the intent cannot be recorded, then surfaces the error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(recordUploadIntent).mockRejectedValueOnce(
      new Error('connection reset'),
    );

    const res = await upload();

    expect(res.status).toBe(500);
    expect(deleteOrgBlobRefs).toHaveBeenCalledWith(expect.anything(), 'org_1', [
      's3:blobs/acme/minted',
    ]);
  });
});
