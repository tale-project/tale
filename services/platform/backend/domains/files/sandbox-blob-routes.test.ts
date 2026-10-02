// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signStageToken } from '../../core/lib/storage/sandbox_stage_token.ts';
import { fetchPresignedObject } from '../../lib/object-store.ts';
import { createSandboxBlobRoutes } from './sandbox-blob-routes.ts';

vi.mock('../../lib/object-store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/object-store.ts')>()),
  locateOrgObjectStore: vi.fn(() => Promise.resolve({ backend: 's3' })),
  s3PresignGetUrl: vi.fn(() => Promise.resolve('https://store/acme/blob-1')),
  fetchPresignedObject: vi.fn(),
}));
vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));

/**
 * The staging door answers the in-sandbox daemon, which reports nothing but
 * the status it got (`http_<status>`). The store's 404 therefore has to
 * reach it as a 404 — a task whose attachment's bytes are gone used to read
 * `http_502`, the same as a store that is down, and the run host could only
 * say "try again" to a file that will never come back. Every other store
 * failure stays the 502 the daemon already knows.
 */
describe('/api/sandbox-blob', () => {
  const app = createSandboxBlobRoutes({ sql: {} as Sql });
  const fetched = vi.mocked(fetchPresignedObject);

  beforeEach(() => {
    vi.stubEnv('WEBDAV_APP_PASSWORD_HMAC_KEY', 'k'.repeat(64));
    fetched.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function stage(ref = 's3:tale/acme/blob-1'): Promise<Response> {
    const token = await signStageToken({ ref, org: 'org-1' });
    return app.request(`/?token=${encodeURIComponent(token ?? '')}`);
  }

  it('streams the object through with download semantics', async () => {
    fetched.mockResolvedValue(
      new Response('bytes', {
        status: 200,
        headers: { 'content-type': 'text/plain', 'content-length': '5' },
      }),
    );
    const res = await stage();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('bytes');
    expect(res.headers.get('content-disposition')).toBe('attachment');
    expect(res.headers.get('content-length')).toBe('5');
  });

  it("passes the store's 404 through: the ref outlived its bytes", async () => {
    fetched.mockResolvedValue(new Response('NoSuchKey', { status: 404 }));
    expect((await stage()).status).toBe(404);
  });

  it('answers 502 for every other store failure', async () => {
    fetched.mockResolvedValueOnce(new Response('slow down', { status: 503 }));
    expect((await stage()).status).toBe(502);
    fetched.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await stage()).status).toBe(502);
  });

  it('refuses a forged token, and a key outside the org namespace reads as missing', async () => {
    expect((await app.request('/?token=v1.zzzz.zzzz')).status).toBe(403);
    expect((await stage('s3:tale/someone-else/blob-1')).status).toBe(404);
    expect(fetched).not.toHaveBeenCalled();
  });
});
