import { existsSync } from 'node:fs';
import type { ServerResponse } from 'node:http';

import { type Plugin } from 'vite';

import { createConfigWatcher } from '../lib/config-watcher';

/**
 * Vite plugin that watches the org config tree (`TALE_CONFIG_DIR`) and
 * serves the config-file SSE endpoint at /events/file — the same path
 * server.ts serves in production, so the frontend code is identical in dev
 * and prod. Without a config dir there is nothing to watch: the door still
 * answers (the client's EventSource must not error-loop) but only ever says
 * `connected`.
 */
export function watchExamples(): Plugin {
  const configDir = process.env.TALE_CONFIG_DIR;
  const clients = new Set<ServerResponse>();

  return {
    name: 'watch-examples',
    apply: 'serve',
    configureServer(server) {
      if (configDir && existsSync(configDir)) {
        const watcher = createConfigWatcher(configDir);
        watcher.onChange((event) => {
          const payload = `data: ${JSON.stringify(event)}\n\n`;
          for (const client of clients) {
            try {
              client.write(payload);
            } catch (err) {
              console.warn('SSE write failed; dropping client', err);
              clients.delete(client);
            }
          }
        });
        server.httpServer?.once('close', () => {
          void watcher.close();
        });
      } else {
        console.warn(
          `[watch-examples] TALE_CONFIG_DIR ${configDir ? `(${configDir}) does not exist` : 'is not set'}; config-file events are off`,
        );
      }

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
