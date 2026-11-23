import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  createServer as createHttpServer,
  type IncomingHttpHeaders,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer, preview } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** What the store was asked. */
interface StoreRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

function portOf(address: AddressInfo | string | null | undefined): number {
  if (address === null || address === undefined || typeof address === 'string')
    throw new Error('Expected a TCP listener');
  return address.port;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the blob store through the platform Vite proxy', () => {
  it.each(['dev', 'preview'] as const)(
    'hands a presigned upload on the app origin to the store as it was signed, in %s',
    async (mode) => {
      const received: StoreRequest[] = [];
      const store = createHttpServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          received.push({
            method: request.method,
            url: request.url,
            headers: request.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
          response.writeHead(200, { ETag: '"stored"' });
          response.end();
        });
      });
      await new Promise<void>((resolve) =>
        store.listen(0, '127.0.0.1', resolve),
      );
      // The store the dev orchestrator names (scripts/dev-secrets.ts), read
      // by the config as it loads.
      vi.stubEnv(
        'OBJECT_STORE_ENDPOINT',
        `http://127.0.0.1:${portOf(store.address())}`,
      );
      vi.stubEnv('OBJECT_STORE_BUCKET', 'tale-blobs');
      vi.stubEnv('OBJECT_STORE_ACCESS_KEY', 'tale');
      vi.stubEnv('OBJECT_STORE_SECRET_KEY', 'tale_dev_object_store');
      vi.resetModules();
      const { default: platformConfig } = await import('../vite.config');

      const root = await mkdtemp(join(tmpdir(), 'tale-object-store-proxy-'));
      let closeVite: (() => Promise<void>) | undefined;
      try {
        await mkdir(join(root, 'dist'));
        await writeFile(
          join(root, 'dist/index.html'),
          '<!doctype html><title>Store test</title>',
        );
        const config = {
          configFile: false as const,
          root,
          logLevel: 'silent' as const,
          server: {
            host: '127.0.0.1',
            port: 0,
            proxy: platformConfig.server?.proxy,
          },
          preview: {
            host: '127.0.0.1',
            port: 0,
            proxy: platformConfig.preview?.proxy,
          },
          optimizeDeps: { noDiscovery: true },
        };
        let vitePort: number;
        if (mode === 'dev') {
          const vite = await createServer(config);
          closeVite = () => vite.close();
          await vite.listen();
          vitePort = portOf(vite.httpServer?.address());
        } else {
          const vite = await preview(config);
          closeVite = () =>
            new Promise<void>((resolve, reject) =>
              vite.httpServer.close((error) =>
                error ? reject(error) : resolve(),
              ),
            );
          vitePort = portOf(vite.httpServer.address());
        }

        // A link as the backend signs it for the app's origin: the bucket's
        // path and the signature in the query.
        const path =
          '/tale-blobs/northlight-labs/document?X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=abc';
        const response = await fetch(`http://127.0.0.1:${vitePort}${path}`, {
          method: 'PUT',
          headers: { 'content-type': 'text/plain' },
          body: 'Brand guidelines',
        });
        expect(response.status).toBe(200);
        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({
          method: 'PUT',
          url: path,
          body: 'Brand guidelines',
        });
        // Both signed headers as the browser sent them: the host is the
        // app's, which the signature covers, not the store's.
        expect(received[0]?.headers.host).toBe(`127.0.0.1:${vitePort}`);
        expect(received[0]?.headers['content-type']).toBe('text/plain');
      } finally {
        await closeVite?.();
        await new Promise<void>((resolve) => {
          store.close(() => resolve());
        });
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
