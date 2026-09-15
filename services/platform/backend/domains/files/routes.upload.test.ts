// @vitest-environment node

/**
 * `POST /files/upload` lands the bytes BEFORE it records the upload intent,
 * and the intent row is the only record that the blob exists — so a failed
 * intent write used to answer 500 with an object in the bucket that no
 * sweep could ever find. The route now reclaims the blob it just minted
 * before surfacing the error.
 *
 * The presigning doors sign for the origin the browser is on. Behind the
 * proxy that is the proxied Host plus the forwarded scheme, so a link handed
 * out on an additional site origin stays on it instead of crossing to
 * SITE_URL, where the upload, preview or download would travel without the
 * session and depend on CORS.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));
// The deployment-default store as the environment seeds it: the internal
// endpoint the backend dials, and the canonical origin a browser reaches.
vi.mock('../../lib/object-store.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/object-store.ts')>();
  const { buildS3ObjectStore } =
    await import('../../core/lib/storage/object_store.ts');
  const store = buildS3ObjectStore(
    {
      region: 'us-east-1',
      endpoint: 'http://object-store:9000',
      publicEndpoint: 'https://tale.example.com',
      bucket: 'tale-blobs',
      forcePathStyle: true,
    },
    { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
  );
  return {
    ...actual,
    resolveObjectStore: vi.fn(() => Promise.resolve(store)),
    locateOrgObjectStore: vi.fn(() => Promise.resolve(store)),
  };
});
vi.mock('./access.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./access.ts')>();
  return {
    ...actual,
    viewerForMember: vi.fn(() => Promise.resolve({})),
    assertFileReadable: vi.fn(() => Promise.resolve()),
  };
});
vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return {
    ...actual,
    putOrgBlobBytes: vi.fn(() => Promise.resolve('s3:blobs/acme/minted')),
    deleteOrgBlobRefs: vi.fn(() => Promise.resolve()),
    getFileMetadataByIdOrRef: vi.fn(() =>
      Promise.resolve({
        id: 'file_1',
        organizationId: 'org_1',
        storageRef: 's3:acme/blob-1',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        size: 3,
        uploadedBy: 'user_1',
        documentId: null,
        threadId: null,
        conversationId: null,
        createdAt: 0,
      }),
    ),
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

describe('presigning doors on a deployment with several origins', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_URL', 'https://tale.example.com');
    vi.stubEnv('ADDITIONAL_SITE_URLS', 'https://tale.partner.example');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** A request as the proxy hands it on: the browser's Host and scheme. */
  const proxied = (scheme: string) => ({
    host: 'tale.partner.example',
    'x-forwarded-proto': scheme,
  });

  it('POST /blob-upload hands out a PUT on the origin the browser is on', async () => {
    const res = await app().request('/blob-upload', {
      method: 'POST',
      headers: { ...proxied('https'), 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'application/pdf' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; s3Ref: string };
    const url = new URL(body.url);
    expect(url.origin).toBe('https://tale.partner.example');
    expect(url.pathname).toMatch(/^\/tale-blobs\/acme\/[0-9a-f-]{36}$/);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-type;host',
    );
  });

  it('GET /serve redirects to a download on the origin the browser is on', async () => {
    const res = await app().request(
      `/serve?ref=${encodeURIComponent('s3:acme/blob-1')}&filename=report.pdf`,
      { headers: proxied('https') },
    );

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.origin).toBe('https://tale.partner.example');
    expect(location.pathname).toBe('/tale-blobs/acme/blob-1');
    expect(location.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('stays on the canonical origin when the edge forwarded plain http', async () => {
    const res = await app().request(
      `/serve?ref=${encodeURIComponent('s3:acme/blob-1')}`,
      { headers: proxied('http') },
    );

    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location') ?? '').origin).toBe(
      'https://tale.example.com',
    );
  });
});
