// @vitest-environment node

/**
 * The web tier as a listener: `startWebServer` and what a process that runs
 * it relies on — the port, the run markers, the wait a stopping replica
 * grants its balancer, and the API it asks.
 *
 * It used to be `Bun.serve` behind a shell that waited for the port, wrote
 * the ready marker and forwarded SIGTERM. The process does all of that
 * itself now, in whichever role it runs (`backend/main.ts`, beside the API;
 * `backend/web-main.ts`, alone), so it is tested here over real sockets.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type Server,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createApp,
  DEFAULT_WEB_DRAIN_MS,
  DEFAULT_WEB_PORT,
  endFileEventStreams,
  HEALTH_CHECK_WINDOW_MS,
  startWebServer,
  webDrainMs,
  webPort,
  type WebServer,
} from './server';
import { _resetStatusProbeCache } from './status-probe';

const baseEnv = {
  SITE_URL: 'https://tale.example.com',
  SITE_ORIGINS: ['https://tale.example.com'] as readonly string[],
  BASE_PATH: '',
  FILE_EVENTS_ENABLED: true,
  SENTRY_DSN: undefined,
  SENTRY_TRACES_SAMPLE_RATE: 1,
  TALE_VERSION: undefined,
  CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: [] as readonly string[],
};

const directories: string[] = [];
const servers: WebServer[] = [];
const backends: Server[] = [];

async function tempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function portOf(server: { address(): AddressInfo | string | null }): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the listener has no port');
  }
  return address.port;
}

/** A web tier on a port of the machine's choosing, on loopback. */
async function start(
  options: Parameters<typeof startWebServer>[0] = {},
): Promise<{ web: WebServer; url: string; markers: string }> {
  const markers =
    options.app?.markerDirectory ?? (await tempDirectory('tale-web-markers-'));
  const web = await startWebServer({
    port: 0,
    hostname: '127.0.0.1',
    ...options,
    app: { ...options.app, markerDirectory: markers },
  });
  servers.push(web);
  return { web, url: `http://127.0.0.1:${portOf(web.server)}`, markers };
}

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** One request over a socket of its own, nothing decoded: `fetch` would
 * inflate a compressed body and hide the header that said so. */
function raw(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method: options.method ?? 'GET',
        headers: { connection: 'close', ...options.headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

interface FakeBackend {
  url: string;
  /** The paths it was asked, in order. */
  asked: string[];
}

/** A stand-in for the API: the three doors the web tier asks. */
async function fakeBackend(
  answers: { stores?: boolean; orgSlugs?: string[] | null } = {},
): Promise<FakeBackend> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(request.url ?? '');
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.url === '/ping') {
      json(200, { ok: true });
    } else if (request.url === '/health/stores') {
      const up = answers.stores ?? true;
      json(up ? 200 : 503, {
        stores: { app_db: up, knowledge_db: up, object_store: up },
      });
    } else if (request.url === '/api/sse/auth') {
      const slugs =
        answers.orgSlugs === undefined ? ['acme'] : answers.orgSlugs;
      if (slugs === null || request.headers.cookie === undefined) {
        response.writeHead(401).end('Unauthenticated');
      } else {
        json(200, { userId: 'u1', orgSlugs: slugs });
      }
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  backends.push(server);
  return { url: `http://127.0.0.1:${portOf(server)}`, asked };
}

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://tale.example.com');
  // Nothing listens here: a test that reaches the API by the variable, where
  // it should have asked the one it was given, fails instead of passing by
  // accident.
  vi.stubEnv('TALE_BACKEND_URL', 'http://127.0.0.1:1');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  _resetStatusProbeCache();
});

afterEach(async () => {
  for (const web of servers.splice(0)) await web.close();
  for (const backend of backends.splice(0)) {
    backend.closeAllConnections();
    await new Promise((resolve) => {
      backend.close(resolve);
    });
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the port the web tier listens on', () => {
  test('is 3000 unless APP_PORT names another', () => {
    expect(DEFAULT_WEB_PORT).toBe(3000);
    expect(webPort(undefined)).toBe(3000);
    expect(webPort('')).toBe(3000);
    expect(webPort('  ')).toBe(3000);
    expect(webPort('8080')).toBe(8080);
    expect(webPort(' 8080 ')).toBe(8080);
    expect(webPort('65535')).toBe(65_535);
  });

  test('reads APP_PORT from the environment when given nothing', () => {
    vi.stubEnv('APP_PORT', '8443');
    expect(webPort()).toBe(8443);
  });

  test.each(['0', '65536', '-1', '80.5', '3000abc', 'web', '0x50', '1e3'])(
    'fails the start on %s: a web tier on a guessed port answers nowhere',
    (value) => {
      expect(() => webPort(value)).toThrow(/APP_PORT must be a port number/);
    },
  );
});

describe('how long a stopping web tier keeps answering', () => {
  test('is six seconds unless SHUTDOWN_DRAIN_SECONDS names another span', () => {
    expect(DEFAULT_WEB_DRAIN_MS).toBe(6000);
    expect(webDrainMs(undefined)).toBe(6000);
    expect(webDrainMs('')).toBe(6000);
    expect(webDrainMs(' ')).toBe(6000);
    expect(webDrainMs('0')).toBe(0);
    expect(webDrainMs('2')).toBe(2000);
    expect(webDrainMs('2.5')).toBe(2500);
    expect(webDrainMs('300')).toBe(300_000);
  });

  test('reads SHUTDOWN_DRAIN_SECONDS from the environment when given nothing', () => {
    vi.stubEnv('SHUTDOWN_DRAIN_SECONDS', '1');
    expect(webDrainMs()).toBe(1000);
  });

  test.each(['-1', '301', 'soon', 'NaN', 'Infinity'])(
    'falls back to the default on %s and says so: a stop never fails over it',
    (value) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(webDrainMs(value)).toBe(6000);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('SHUTDOWN_DRAIN_SECONDS must be a number'),
      );
    },
  );
});

describe('whether a stopping web tier waits at all', () => {
  test('does not wait when nothing has checked its health: no balancer would act on the 503', async () => {
    const { web, url } = await start();
    // Serving the app is not a health check.
    await fetch(`${url}/status.json`);
    expect(web.drainMs()).toBe(0);
  });

  test.each(['/api/health', '/api/admission'])(
    'waits the drain span once %s has been asked',
    async (door) => {
      const { web, url } = await start();
      await fetch(`${url}${door}`);
      expect(web.drainMs()).toBe(DEFAULT_WEB_DRAIN_MS);
    },
  );

  test('waits the span the environment names', async () => {
    vi.stubEnv('SHUTDOWN_DRAIN_SECONDS', '2');
    const { web, url } = await start();
    await fetch(`${url}/api/health`);
    expect(web.drainMs()).toBe(2000);
  });

  test('stops waiting once the last check is three of the edge’s intervals old', async () => {
    const { web, url } = await start();
    await fetch(`${url}/api/health`);
    const checkedAt = Date.now();
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(checkedAt + HEALTH_CHECK_WINDOW_MS - 1000);
    expect(web.drainMs()).toBe(DEFAULT_WEB_DRAIN_MS);

    now.mockReturnValue(checkedAt + HEALTH_CHECK_WINDOW_MS + 1000);
    expect(web.drainMs()).toBe(0);
  });

  test('tells the caller that asked to be told, too', async () => {
    const onHealthCheck = vi.fn();
    const { url } = await start({ app: { onHealthCheck } });
    await fetch(`${url}/api/health`);
    await fetch(`${url}/status.json`);
    expect(onHealthCheck).toHaveBeenCalledTimes(1);
  });
});

describe('the run markers of a web tier', () => {
  test('answers health at once, and admission only once it is marked ready', async () => {
    const { web, url, markers } = await start();
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
    const starting = await fetch(`${url}/api/admission`);
    expect(starting.status).toBe(503);
    expect(await starting.json()).toEqual({ status: 'starting' });
    expect(existsSync(join(markers, 'platform-ready'))).toBe(false);

    web.markReady();

    expect(existsSync(join(markers, 'platform-ready'))).toBe(true);
    expect((await fetch(`${url}/api/admission`)).status).toBe(200);
  });

  test('says it is running in the line the dev log reader shows', async () => {
    const { web } = await start();
    web.markReady();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Tale Platform is running!'),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Application: https://tale.example.com'),
    );
  });

  test('turns health to 503 the moment it is told to stop, and keeps answering', async () => {
    const { web, url, markers } = await start();
    web.markReady();

    web.markShuttingDown();

    expect(existsSync(join(markers, 'platform-shutting-down'))).toBe(true);
    const health = await fetch(`${url}/api/health`);
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({ status: 'shutting_down' });
    expect((await fetch(`${url}/api/admission`)).status).toBe(503);
    // The listener is still there for the requests a balancer sends until
    // its next check: the shell answers.
    expect((await fetch(`${url}/status.json`)).status).toBe(200);
  });

  test('closes the listener and deletes both markers', async () => {
    const { web, url, markers } = await start();
    web.markReady();
    web.markShuttingDown();

    await web.close();
    servers.splice(servers.indexOf(web), 1);

    expect(existsSync(join(markers, 'platform-ready'))).toBe(false);
    expect(existsSync(join(markers, 'platform-shutting-down'))).toBe(false);
    await expect(fetch(`${url}/api/health`)).rejects.toThrow();
  });

  test('does not inherit the markers of a previous run', async () => {
    const markers = await tempDirectory('tale-web-markers-');
    await writeFile(join(markers, 'platform-ready'), '');
    await writeFile(join(markers, 'platform-shutting-down'), '');

    const { url } = await start({ app: { markerDirectory: markers } });

    // A leftover shutdown marker would hold health at 503 for good, and a
    // leftover ready marker would admit a replica that is not ready.
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
    expect((await fetch(`${url}/api/admission`)).status).toBe(503);
    expect(existsSync(join(markers, 'platform-shutting-down'))).toBe(false);
    expect(existsSync(join(markers, 'platform-ready'))).toBe(false);
  });

  test('leaves a withdrawal marker alone: the runtime that set it clears it', async () => {
    const markers = await tempDirectory('tale-web-markers-');
    await writeFile(join(markers, 'platform-withdrawn'), '');

    const { web, url } = await start({ app: { markerDirectory: markers } });
    web.markReady();

    expect(existsSync(join(markers, 'platform-withdrawn'))).toBe(true);
    expect((await fetch(`${url}/api/admission`)).status).toBe(503);
  });
});

describe('starting the listener', () => {
  test('fails the start when its port is taken, instead of crashing later', async () => {
    const { web } = await start();
    await expect(
      startWebServer({
        port: portOf(web.server),
        hostname: '127.0.0.1',
        app: { markerDirectory: await tempDirectory('tale-web-markers-') },
      }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  test('serves a built file with its length, to GET and to HEAD alike', async () => {
    const dist = await tempDirectory('tale-web-dist-');
    await mkdir(join(dist, 'assets'));
    const script = 'console.log("built");\n'.repeat(200);
    await writeFile(join(dist, 'assets', 'app-abcdef12.js'), script);
    const { url } = await start({ app: { distDirectory: dist } });

    const got = await raw(`${url}/assets/app-abcdef12.js`);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(got.headers['content-length']).toBe(String(script.length));
    expect(got.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(got.body.toString()).toBe(script);

    const head = await raw(`${url}/assets/app-abcdef12.js`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe(String(script.length));
    expect(head.body.byteLength).toBe(0);
  });

  test('serves the compressed neighbour of a built file to a client that takes it', async () => {
    const dist = await tempDirectory('tale-web-dist-');
    await mkdir(join(dist, 'assets'));
    await writeFile(join(dist, 'assets', 'app-abcdef12.js'), 'x'.repeat(5000));
    // Not real Brotli: the server hands the neighbour over as it is, so the
    // bytes only have to be recognisable.
    await writeFile(join(dist, 'assets', 'app-abcdef12.js.br'), 'BROTLI');
    const { url } = await start({ app: { distDirectory: dist } });

    const compressed = await raw(`${url}/assets/app-abcdef12.js`, {
      headers: { 'accept-encoding': 'gzip, br' },
    });
    expect(compressed.status).toBe(200);
    expect(compressed.headers['content-encoding']).toBe('br');
    expect(compressed.headers['content-length']).toBe('6');
    expect(compressed.headers.vary).toContain('Accept-Encoding');
    expect(compressed.headers['content-type']).toBe(
      'text/javascript; charset=utf-8',
    );
    expect(compressed.body.toString()).toBe('BROTLI');

    const plain = await raw(`${url}/assets/app-abcdef12.js`);
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.headers['content-length']).toBe('5000');
    expect(plain.headers.vary).toContain('Accept-Encoding');
  });

  test('answers a byte range of a built file', async () => {
    const dist = await tempDirectory('tale-web-dist-');
    await mkdir(join(dist, 'assets'));
    await writeFile(join(dist, 'assets', 'app-abcdef12.js'), '0123456789');
    const { url } = await start({ app: { distDirectory: dist } });

    const part = await raw(`${url}/assets/app-abcdef12.js`, {
      headers: { range: 'bytes=2-5' },
    });
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe('bytes 2-5/10');
    expect(part.body.toString()).toBe('2345');

    const beyond = await raw(`${url}/assets/app-abcdef12.js`, {
      headers: { range: 'bytes=50-' },
    });
    expect(beyond.status).toBe(416);
    expect(beyond.headers['content-range']).toBe('bytes */10');
  });
});

describe('the API a web tier asks', () => {
  test('asks the one it was given for the status page, not the one the environment names', async () => {
    const backend = await fakeBackend();
    const { url } = await start({ app: { backendUrl: backend.url } });

    const status = await fetch(`${url}/status.json`);

    expect(await status.json()).toMatchObject({
      status: 'operational',
      components: [
        { id: 'backend', status: 'operational' },
        { id: 'database', status: 'operational' },
        { id: 'object-store', status: 'operational' },
      ],
    });
    expect(backend.asked.sort()).toEqual(['/health/stores', '/ping']);
  });

  test('reports what that API reports: a store it cannot reach is a degraded site', async () => {
    const backend = await fakeBackend({ stores: false });
    const { url } = await start({ app: { backendUrl: backend.url } });

    expect(await (await fetch(`${url}/status.json`)).json()).toMatchObject({
      status: 'degraded',
      components: [
        { id: 'backend', status: 'operational' },
        { id: 'database', status: 'outage' },
        { id: 'object-store', status: 'outage' },
      ],
    });
  });

  test('asks it for the session verdict too', async () => {
    const backend = await fakeBackend({ orgSlugs: ['acme'] });
    const app = createApp(baseEnv, { backendUrl: backend.url });

    const accepted = await app.fetch(
      new Request('http://localhost/canvas-preview', {
        method: 'POST',
        headers: {
          cookie: 'better-auth.session_token=valid',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'html=%3Cp%3Ehi%3C%2Fp%3E',
      }),
    );

    expect(accepted.status).toBe(200);
    expect(backend.asked).toEqual(['/api/sse/auth']);
  });

  test('refuses the session the API refuses', async () => {
    const backend = await fakeBackend({ orgSlugs: null });
    const app = createApp(baseEnv, { backendUrl: backend.url });

    const refused = await app.fetch(
      new Request('http://localhost/events/file', {
        headers: { cookie: 'better-auth.session_token=stale' },
      }),
    );

    expect(refused.status).toBe(401);
    expect(backend.asked).toEqual(['/api/sse/auth']);
  });

  test('falls back to TALE_BACKEND_URL when it was given none: the web role', async () => {
    const backend = await fakeBackend();
    vi.stubEnv('TALE_BACKEND_URL', `${backend.url}/`);
    const { url } = await start();

    expect(await (await fetch(`${url}/status.json`)).json()).toMatchObject({
      status: 'operational',
    });
    expect(backend.asked.sort()).toEqual(['/health/stores', '/ping']);
  });
});

describe('the registry /metrics answers', () => {
  test('is the one it was given: a process that serves the API too has one for both', async () => {
    const app = createApp(baseEnv, {
      metrics: async () =>
        new Response('tale_backend_up 1\n', {
          headers: { 'content-type': 'text/plain' },
        }),
    });

    const metrics = await app.fetch(new Request('http://localhost/metrics'));

    expect(await metrics.text()).toBe('tale_backend_up 1\n');
  });
});

describe('the file event streams of a stopping web tier', () => {
  test('ends every open stream, so the listener can close', async () => {
    const backend = await fakeBackend({ orgSlugs: ['acme'] });
    const app = createApp(baseEnv, { backendUrl: backend.url });
    const open = () =>
      app.fetch(
        new Request('http://localhost/events/file', {
          headers: { cookie: 'better-auth.session_token=valid' },
        }),
      );
    const first = await open();
    const second = await open();
    expect(first.status).toBe(200);
    // The handler enqueues string frames; Response types the body as bytes.
    const reader = (
      first.body as unknown as ReadableStream<string>
    ).getReader();
    expect((await reader.read()).value).toBe('data: {"type":"connected"}\n\n');

    expect(endFileEventStreams()).toBe(2);

    expect((await reader.read()).done).toBe(true);
    expect(endFileEventStreams()).toBe(0);
    await second.body?.cancel();
  });
});
