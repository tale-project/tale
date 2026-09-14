import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer, preview } from 'vite';
import { describe, expect, it } from 'vitest';

import platformConfig from '../vite.config';

describe('WebDAV discovery through the platform Vite proxy', () => {
  it.each(['dev', 'preview'] as const)(
    'preserves DAV OPTIONS and restricted CORS in %s',
    async (mode) => {
      const root = await mkdtemp(join(tmpdir(), 'tale-dav-preflight-'));
      const backend = createHttpServer((_request, response) => {
        response.writeHead(200, {
          DAV: '1, 2',
          Allow: 'OPTIONS, PROPFIND, GET, PUT',
        });
        response.end();
      });
      await new Promise<void>((resolve) =>
        backend.listen(0, '127.0.0.1', resolve),
      );
      const address = backend.address();
      if (address === null || typeof address === 'string')
        throw new Error('Expected TCP backend');
      const proxy = { '/dav': { target: `http://127.0.0.1:${address.port}` } };
      const server = {
        host: '127.0.0.1',
        port: 0,
        cors: platformConfig.server?.cors,
        proxy,
      };
      let closeVite: (() => Promise<void>) | undefined;
      try {
        await mkdir(join(root, 'dist'));
        await writeFile(
          join(root, 'dist/index.html'),
          '<!doctype html><title>DAV test</title>',
        );
        const config = {
          configFile: false as const,
          root,
          logLevel: 'silent' as const,
          server,
          preview: {
            ...platformConfig.preview,
            port: 0,
            host: '127.0.0.1',
            proxy,
          },
          optimizeDeps: { noDiscovery: true },
        };
        let httpAddress;
        if (mode === 'dev') {
          const vite = await createServer(config);
          closeVite = () => vite.close();
          await vite.listen();
          httpAddress = vite.httpServer?.address();
        } else {
          const vite = await preview(config);
          closeVite = () =>
            new Promise<void>((resolve, reject) =>
              vite.httpServer.close((error) =>
                error ? reject(error) : resolve(),
              ),
            );
          httpAddress = vite.httpServer.address();
        }
        if (
          httpAddress === null ||
          httpAddress === undefined ||
          typeof httpAddress === 'string'
        )
          throw new Error('Expected TCP Vite server');
        for (const origin of [undefined, 'https://foreign.example']) {
          const response = await fetch(
            `http://127.0.0.1:${httpAddress.port}/dav/acme/documents/`,
            {
              method: 'OPTIONS',
              headers: origin === undefined ? {} : { Origin: origin },
            },
          );
          expect(response.status).toBe(200);
          expect(response.headers.get('dav')).toBe('1, 2');
          expect(response.headers.get('allow')).toContain('PROPFIND');
          expect(
            response.headers.get('access-control-allow-origin'),
          ).toBeNull();
        }
      } finally {
        await closeVite?.();
        await new Promise<void>((resolve, reject) =>
          backend.close((error) => (error ? reject(error) : resolve())),
        );
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
