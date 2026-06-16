import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { type Plugin } from 'vite';
import { type RawData, WebSocket, WebSocketServer } from 'ws';

import {
  buildScreencastAuthHeaders,
  resolveSandboxToken,
  spawnerScreencastPath,
} from '../lib/screencast-relay';

/**
 * Dev-server mirror of the production `/screencast/:threadId` WebSocket that
 * `server.ts` hosts (Part A live browser view). `bun dev` runs Vite, not
 * `server.ts`, so — like `serve-webdav`/`watch-examples` mirror their own
 * `server.ts` routes — this re-implements the browser-facing screencast WS for
 * dev. The frontend (noVNC `RFB`) is then identical in dev and prod.
 *
 * Flow: terminate the browser RFB-over-WS here, authorize via the same
 * `/api/sandbox/screencast-auth` Convex oracle (cookie → org), then open a WS
 * client to the spawner with the HMAC headers and relay raw binary frames both
 * ways. Reuses the production relay's auth helpers (`screencast-relay.ts`) so
 * the HMAC contract can't drift; only the WS plumbing differs (Node `ws` here
 * vs Bun's native WS in `server.ts`).
 */
const SCREENCAST_RE = /^\/screencast\/([^/?]+)/;

/** Convex site-proxy (:3211) where the screencast-auth httpAction lives. */
function convexSiteProxy(): string {
  return process.env.CONVEX_SITE_PROXY_URL || 'http://127.0.0.1:3211';
}

/**
 * Spawner WS base. In `bun dev` the host reaches the spawner at its loopback
 * publish (compose maps `127.0.0.1:8003`), NOT the `sandbox:8003` docker-network
 * name that `SANDBOX_URL` carries in the Vite process env — so we default to
 * loopback and only honor an explicit `SANDBOX_DEV_WS_URL` override.
 */
function spawnerWsBase(): string {
  return process.env.SANDBOX_DEV_WS_URL || 'ws://127.0.0.1:8003';
}

/** Cookie → vetted sessionId via the same oracle the prod server uses. Returns
 * null on any non-200 (401/403/409) — the upgrade is then refused. */
async function authorizeScreencast(
  threadId: string,
  cookie: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${convexSiteProxy()}/api/sandbox/screencast-auth?threadId=${encodeURIComponent(threadId)}`,
      { headers: cookie ? { cookie } : {} },
    );
    if (!res.ok) return null;
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const body = (await res.json()) as { sessionId?: string };
    return body.sessionId ?? null;
  } catch (err) {
    console.warn('[serve-screencast] auth oracle call failed:', err);
    return null;
  }
}

export function serveScreencast(): Plugin {
  return {
    name: 'serve-screencast',
    apply: 'serve',
    configureServer(server) {
      const httpServer = server.httpServer;
      if (!httpServer) return;
      const wss = new WebSocketServer({ noServer: true });

      httpServer.on(
        'upgrade',
        (req: IncomingMessage, socket: Duplex, head: Buffer) => {
          const match = SCREENCAST_RE.exec(req.url ?? '');
          // Not our path — leave the socket untouched so Vite's HMR upgrade
          // handler (and any other) can claim it.
          if (!match) return;
          const threadId = decodeURIComponent(match[1]);

          void (async () => {
            const sessionId = await authorizeScreencast(
              threadId,
              req.headers.cookie ?? '',
            );
            if (!sessionId) {
              socket.write(
                'HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n',
              );
              socket.destroy();
              return;
            }
            wss.handleUpgrade(req, socket, head, (browser) => {
              relayToSpawner(browser, sessionId);
            });
          })();
        },
      );

      function relayToSpawner(browser: WebSocket, sessionId: string): void {
        const path = spawnerScreencastPath(sessionId);
        const headers = buildScreencastAuthHeaders(path, resolveSandboxToken());
        const spawner = new WebSocket(`${spawnerWsBase()}${path}`, { headers });
        browser.binaryType = 'nodebuffer';
        spawner.binaryType = 'nodebuffer';

        let closed = false;
        const pending: RawData[] = [];
        const teardown = (): void => {
          if (closed) return;
          closed = true;
          try {
            spawner.close();
          } catch (err) {
            console.warn('[serve-screencast] spawner close failed:', err);
          }
          try {
            browser.close();
          } catch (err) {
            console.warn('[serve-screencast] browser close failed:', err);
          }
        };

        spawner.on('open', () => {
          for (const buf of pending) spawner.send(buf);
          pending.length = 0;
        });
        // spawner → browser (framebuffer); browser → spawner (RFB input, tiny).
        spawner.on('message', (data) => {
          if (browser.readyState === WebSocket.OPEN) browser.send(data);
        });
        browser.on('message', (data) => {
          if (spawner.readyState === WebSocket.OPEN) spawner.send(data);
          else pending.push(data);
        });
        for (const ev of ['close', 'error'] as const) {
          spawner.on(ev, teardown);
          browser.on(ev, teardown);
        }
      }
    },
  };
}
