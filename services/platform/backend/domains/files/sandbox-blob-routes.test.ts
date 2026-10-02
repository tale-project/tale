// @vitest-environment node

import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { serve } from '@hono/node-server';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stageFiles } from '../../../../sandbox-runtime/daemon/src/file-ops.ts';
import { signStageToken } from '../../core/lib/storage/sandbox_stage_token';
import { createSandboxBlobRoutes } from './sandbox-blob-routes';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../../lib/object-store.ts', () => ({
  locateOrgObjectStore: vi.fn(async () => ({})),
  s3PresignGetUrl: vi.fn(async () => 'https://internal-object-store.test/blob'),
  fetchPresignedObject: mocks.fetch,
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(async () => 'acme'),
}));

describe('sandbox blob bounded transfer', () => {
  beforeEach(() => {
    vi.stubEnv('WEBDAV_APP_PASSWORD_HMAC_KEY', 'a'.repeat(64));
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  async function request(maxBytes?: number, expectedBytes?: number) {
    const token = await signStageToken({
      ref: 's3:acme/blob',
      org: 'org',
      ...(maxBytes === undefined ? {} : { maxBytes }),
      ...(expectedBytes === undefined ? {} : { expectedBytes }),
    });
    return createSandboxBlobRoutes({ sql: {} as Sql }).request(
      `/?token=${token}`,
    );
  }

  it('retains ordinary v1 response length and bytes', async () => {
    mocks.fetch.mockResolvedValue(
      new Response('contents', { headers: { 'Content-Length': '8' } }),
    );
    const result = await request();
    expect(result.status).toBe(200);
    expect(result.headers.get('content-length')).toBe('8');
    expect(await result.text()).toBe('contents');
  });

  it('accepts the exact byte ceiling, without a possibly false response length', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array([0, 1, 2, 255]), {
        headers: { 'Content-Length': '4' },
      }),
    );
    const result = await request(4);
    expect(result.headers.get('content-length')).toBeNull();
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(
      new Uint8Array([0, 1, 2, 255]),
    );
  });

  it('rejects an oversized declaration and cancels upstream before reading bytes', async () => {
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        headers: { 'Content-Length': '5' },
      }),
    );
    const result = await request(4);
    expect(result.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([undefined, '1'])(
    'errors after response headers for a missing or lying length %s and cancels upstream',
    async (declared) => {
      const cancel = vi.fn();
      let reads = 0;
      mocks.fetch.mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              reads += 1;
              if (reads > 3) controller.close();
              else controller.enqueue(new Uint8Array([1, 2, 3]));
            },
            cancel,
          }),
          {
            headers:
              declared === undefined ? {} : { 'Content-Length': declared },
          },
        ),
      );
      const result = await request(4);
      expect(result.status).toBe(200);
      expect(result.headers.get('content-length')).toBeNull();
      await expect(result.arrayBuffer()).rejects.toThrow();
      expect(cancel).toHaveBeenCalledOnce();
      expect(reads).toBeLessThanOrEqual(4);
    },
  );

  it('propagates an upstream body error instead of returning a truncated file', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('fixture stream failed'));
          },
        }),
      ),
    );
    const result = await request(4);
    await expect(result.arrayBuffer()).rejects.toThrow('fixture stream failed');
  });

  it('propagates downstream cancellation to the upstream reader', async () => {
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const result = await request(4);
    await result.body!.cancel('fixture consumer stopped');
    expect(cancel).toHaveBeenCalledWith('fixture consumer stopped');
  });

  it.each([undefined, '1', '3', '4'])(
    'refuses clean short EOF regardless of declared length %s',
    async (declared) => {
      mocks.fetch.mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: declared === undefined ? {} : { 'Content-Length': declared },
        }),
      );
      const response = await request(4, 4);
      expect(response.status).toBe(200);
      await expect(response.arrayBuffer()).rejects.toThrow(
        'Stage byte count mismatch',
      );
    },
  );

  it.each([0, 4])('accepts exact expected bytes %s', async (size) => {
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array(size)));
    const response = await request(Math.max(1, size), size);
    expect((await response.arrayBuffer()).byteLength).toBe(size);
  });

  it('retains max-only v2 semantics for a smaller complete body', async () => {
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array(3)));
    const response = await request(4);
    expect((await response.arrayBuffer()).byteLength).toBe(3);
  });

  it.each([
    'missing_length',
    'lying_length',
    'body_error',
    'short_missing',
    'short_truthful',
    'short_lying',
    'empty',
  ] as const)(
    'runnerd writes no partial file after headers for %s, and preserves an existing destination',
    async (mode) => {
      const root = await mkdtemp(path.join(tmpdir(), 'tale-bounded-stream-'));
      vi.stubEnv('TALE_WORKSPACE_ROOT', root);
      const oldPath = path.join(root, 'previous.bin');
      const newPath = path.join(root, 'new.bin');
      const original = Buffer.from([9, 8, 7]);
      await writeFile(oldPath, original);
      const cancels: unknown[] = [];
      mocks.fetch.mockImplementation(async () => {
        let reads = 0;
        return new Response(
          new ReadableStream<Uint8Array>({
            async pull(controller) {
              reads += 1;
              if (mode === 'empty') {
                controller.close();
                return;
              }
              if (reads === 1) {
                controller.enqueue(new Uint8Array([1, 2, 3]));
                return;
              }
              // Headers and the first chunk reach the real HTTP consumer before
              // the next chunk either exceeds the cap or fails upstream.
              await new Promise((resolve) => setTimeout(resolve, 10));
              if (mode === 'body_error')
                controller.error(new Error('fixture body failure'));
              else if (mode.startsWith('short_')) controller.close();
              else if (reads <= 3)
                controller.enqueue(new Uint8Array([4, 5, 6]));
              else controller.close();
            },
            cancel(reason) {
              cancels.push(reason);
            },
          }),
          {
            headers:
              mode === 'lying_length' || mode === 'short_lying'
                ? { 'Content-Length': '1' }
                : mode === 'short_truthful'
                  ? { 'Content-Length': '3' }
                  : {},
          },
        );
      });
      const app = createSandboxBlobRoutes({ sql: {} as Sql });
      const server = serve({
        fetch: app.fetch,
        hostname: '127.0.0.1',
        port: 0,
      });
      if (!server.listening)
        await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('Local blob fixture did not listen');
      const token = await signStageToken({
        ref: 's3:acme/blob',
        org: 'org',
        maxBytes: 4,
        expectedBytes: 4,
      });
      const url = `http://127.0.0.1:${address.port}/?token=${token}`;
      try {
        const result = await stageFiles(
          [
            { path: oldPath, url },
            { path: newPath, url },
          ],
          { fetchTimeoutMs: 1000 },
        );
        expect(result.staged).toEqual([]);
        expect(result.skipped).toHaveLength(2);
        expect(await readFile(oldPath)).toEqual(original);
        await expect(stat(newPath)).rejects.toMatchObject({ code: 'ENOENT' });
        if (mode === 'missing_length' || mode === 'lying_length')
          expect(cancels).toHaveLength(2);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        // Keep the fixture and its retained original bytes for inspection.
      }
    },
  );
});

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
  const fetched = mocks.fetch;

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
