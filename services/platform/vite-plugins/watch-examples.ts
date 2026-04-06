import type { ServerResponse } from 'node:http';

import path from 'node:path';
import { type Plugin } from 'vite';

import { createConfigWatcher } from '../lib/config-watcher';

/**
 * Vite plugin that watches the config directory for JSON changes and serves
 * an SSE endpoint at /events/file — the same path used by server.ts in
 * production, so the frontend code is identical in dev and prod.
 */
export function watchExamples(): Plugin {
  const configDir =
    process.env.TALE_CONFIG_DIR ||
    path.resolve(__dirname, '..', '..', '..', 'examples');

  const clients = new Set<ServerResponse>();

  return {
    name: 'watch-examples',
    apply: 'serve',
    configureServer(server) {
      const watcher = createConfigWatcher(configDir);
      watcher.onChange((event) => {
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        for (const client of clients) {
          try {
            client.write(payload);
          } catch {
            clients.delete(client);
          }
        }
      });

      // Serve SSE at /events/file in the Vite dev server
      server.middlewares.use('/events/file', (_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('data: {"type":"connected"}\n\n');
        clients.add(res);
        res.on('close', () => clients.delete(res));
      });
    },
  };
}
