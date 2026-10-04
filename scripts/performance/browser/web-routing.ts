import assert from 'node:assert/strict';

import { proxy } from 'hono/proxy';

/** The task-board routes normally separated by services/proxy/Caddyfile. */
export function backendOwns(path: string) {
  return (
    (path.startsWith('/api/') && path !== '/api/health') ||
    path === '/events' ||
    path === '/.well-known/oauth-authorization-server/api/auth'
  );
}

export function diagnosticWebFetch(
  web: { fetch(request: Request): Response | Promise<Response> },
  backend: string,
) {
  const target = new URL(backend);
  assert(
    target.protocol === 'http:' &&
      target.hostname === '127.0.0.1' &&
      target.pathname === '/' &&
      !target.username &&
      !target.password &&
      !target.search &&
      !target.hash,
    'Diagnostic API must be an exact private loopback origin',
  );
  return (request: Request) => {
    const url = new URL(request.url);
    if (!backendOwns(url.pathname)) return web.fetch(request);
    return proxy(`${target.origin}${url.pathname}${url.search}`, {
      raw: request,
      redirect: 'manual',
      strictConnectionProcessing: true,
    });
  };
}
