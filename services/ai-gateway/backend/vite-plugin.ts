/**
 * Mount the gateway's API on the Vite dev server.
 *
 * `bun run dev` serves the SPA from Vite, not from `server.ts`, so without
 * this the panel would have no API to talk to and the whole screen would be
 * undevelopable. The plugin runs the same `createGateway` the production
 * server does, so a route behaves identically in both.
 *
 * Development may generate the four secrets it needs, printing them once —
 * see `backend/config.ts`. Production never does.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Plugin } from 'vite';

import { createGateway } from './gateway';

/** Rebuild a WHATWG `Request` from what Connect hands the middleware. */
async function toRequest(
  incoming: IncomingMessage,
  origin: string,
): Promise<Request> {
  const method = incoming.method ?? 'GET';
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value))
      for (const item of value) headers.append(name, item);
    else if (typeof value === 'string') headers.set(name, value);
  }

  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    body = Buffer.concat(chunks).toString('utf8');
  }

  return new Request(new URL(incoming.url ?? '/', origin), {
    method,
    headers,
    body,
  });
}

async function send(
  outgoing: ServerResponse,
  response: Response,
): Promise<void> {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => {
    // `set-cookie` is the one header that may legitimately repeat.
    if (name.toLowerCase() === 'set-cookie') outgoing.appendHeader(name, value);
    else outgoing.setHeader(name, value);
  });
  const text = await response.text();
  outgoing.end(text);
}

export function gatewayApi(): Plugin {
  return {
    name: 'ai-gateway-api',
    configureServer(server) {
      const gateway = createGateway({ generateMissingSecrets: true });
      const stop = gateway.startRefreshLoop();
      server.httpServer?.once('close', stop);

      server.middlewares.use((incoming, outgoing, next) => {
        const path = (incoming.url ?? '/').split('?')[0] ?? '/';
        if (!path.startsWith('/api/')) {
          next();
          return;
        }

        void (async () => {
          try {
            const origin = `http://${incoming.headers.host ?? 'localhost'}`;
            const request = await toRequest(incoming, origin);
            const handled = gateway.dispatch(request, new URL(request.url));
            if (!handled) {
              next();
              return;
            }
            await send(outgoing, await handled);
          } catch (error) {
            console.error('[ai-gateway] dev API request failed:', error);
            outgoing.statusCode = 500;
            outgoing.end();
          }
        })();
      });
    },
  };
}
