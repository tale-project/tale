import { expect, test } from 'bun:test';

import { createApp } from '../../services/platform/server';
import { webHost } from './browser/origins.mjs';
import { backendOwns, diagnosticWebFetch } from './browser/web-routing';

const template =
  '<html><head></head><body><script>window.__ENV__ = "__ENV_PLACEHOLDER__";window.__ACCEPT_LANGUAGE__ = "__ACCEPT_LANGUAGE_PLACEHOLDER__";</script><main>Owned shell</main></body></html>';

async function fixture(
  api: (request: Request) => Response | Promise<Response>,
) {
  const backend = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: api });
  let handle = (_request: Request): Response | Promise<Response> =>
    new Response(null, { status: 503 });
  let web: ReturnType<typeof Bun.serve> | undefined;
  try {
    web = Bun.serve({
      hostname: webHost,
      port: 0,
      fetch: (request) => handle(request),
    });
    const origin = web.url.origin;
    const app = createApp(
      {
        SITE_URL: origin,
        SITE_ORIGINS: [origin],
        BASE_PATH: '',
        FILE_EVENTS_ENABLED: false,
        SENTRY_DSN: undefined,
        SENTRY_TRACES_SAMPLE_RATE: 0,
        TALE_VERSION: undefined,
        CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: [],
      },
      {
        indexHtml: template,
        orgStorageOrigins: () => [],
        orgFrameAncestors: () => [],
      },
    );
    handle = diagnosticWebFetch(app, backend.url.origin);
    return {
      origin,
      stop: async () => {
        await Promise.all([web!.stop(true), backend.stop(true)]);
      },
    };
  } catch (error) {
    await Promise.allSettled([web?.stop(true), backend.stop(true)]);
    throw error;
  }
}

test('real production web health, HEAD and nonce/env shell remain web-owned over an owned listener', async () => {
  const calls: string[] = [];
  const f = await fixture((request) => {
    calls.push(new URL(request.url).pathname);
    return new Response('backend');
  });
  try {
    const health = await fetch(`${f.origin}/api/health`);
    expect(health.status).toBe(200);
    const body = await health.text();
    expect(JSON.parse(body).status).toBe('ok');
    const head = await fetch(`${f.origin}/api/health`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(Number(head.headers.get('content-length'))).toBe(
      Buffer.byteLength(body),
    );
    const shell = await fetch(`${f.origin}/`, {
      headers: { accept: 'text/html', 'accept-language': 'en' },
    });
    const html = await shell.text();
    expect(shell.status).toBe(200);
    expect(html).toContain(f.origin);
    expect(html).not.toContain('__ENV_PLACEHOLDER__');
    expect(html).not.toContain('__ACCEPT_LANGUAGE_PLACEHOLDER__');
    expect(html).toMatch(/<script nonce="[^"]+"/);
    expect(shell.headers.get('content-security-policy')).toContain("'nonce-");
    expect((await fetch(`${f.origin}/events/file`)).status).toBe(404);
    expect(calls).toEqual([]);
  } finally {
    await f.stop();
  }
});

test('API proxy preserves method, query, body, cookies, Origin, Host and manual redirects', async () => {
  const calls: Record<string, unknown>[] = [];
  const f = await fixture(async (request) => {
    const url = new URL(request.url);
    calls.push({
      path: url.pathname,
      query: url.search,
      method: request.method,
      body: await request.text(),
      cookie: request.headers.get('cookie'),
      origin: request.headers.get('origin'),
      host: request.headers.get('host'),
    });
    if (url.pathname === '/api/redirect') {
      const headers = new Headers({ location: '/api/should-not-follow' });
      headers.append('set-cookie', 'one=first; Path=/; HttpOnly');
      headers.append('set-cookie', 'two=second; Path=/; HttpOnly');
      return new Response(null, { status: 302, headers });
    }
    return Response.json({ session: 'synthetic' });
  });
  try {
    const result = await fetch(`${f.origin}/api/session?value=a%2Fb`, {
      method: 'POST',
      headers: {
        cookie: 'session=synthetic',
        origin: f.origin,
        'content-type': 'application/json',
      },
      body: '{"owned":true}',
    });
    expect(await result.json()).toEqual({ session: 'synthetic' });
    expect(calls[0]).toEqual({
      path: '/api/session',
      query: '?value=a%2Fb',
      method: 'POST',
      body: '{"owned":true}',
      cookie: 'session=synthetic',
      origin: f.origin,
      host: new URL(f.origin).host,
    });
    const redirected = await fetch(`${f.origin}/api/redirect`, {
      redirect: 'manual',
    });
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get('location')).toBe('/api/should-not-follow');
    expect(redirected.headers.getSetCookie()).toEqual([
      'one=first; Path=/; HttpOnly',
      'two=second; Path=/; HttpOnly',
    ]);
    await fetch(`${f.origin}/.well-known/oauth-authorization-server/api/auth`);
    expect(calls.map((call) => call.path)).toEqual([
      '/api/session',
      '/api/redirect',
      '/.well-known/oauth-authorization-server/api/auth',
    ]);
  } finally {
    await f.stop();
  }
});

test('event proxy streams its first chunk and propagates client cancellation upstream', async () => {
  let canceled!: () => void;
  const cancellation = new Promise<void>((resolve) => {
    canceled = resolve;
  });
  const f = await fixture((request) => {
    request.signal.addEventListener('abort', canceled, { once: true });
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(': owned\n\n'));
        },
        cancel: canceled,
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await fetch(`${f.origin}/events`, {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      ': owned\n\n',
    );
    controller.abort();
    await Promise.race([
      cancellation,
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error('Upstream stream did not cancel')),
          2000,
        );
      }),
    ]);
    expect(backendOwns('/events/file')).toBe(false);
    expect(backendOwns('/api/health')).toBe(false);
    expect(backendOwns('/events/other')).toBe(false);
  } finally {
    if (deadline) clearTimeout(deadline);
    controller.abort();
    await f.stop();
  }
});
