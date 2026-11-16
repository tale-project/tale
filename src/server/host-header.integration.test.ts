// A request whose Host header is no host name cannot be given a URL: Bun builds
// `request.url` from that header. The server answers it with a 400 of its own,
// as a protocol error, instead of failing with a 500 before any route runs. That
// 400 carries the security headers, as the 500 it replaces and every other
// answer do.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bunServers, serverModule } from '@/tests/utils/site-server';

const servers = bunServers();
let directory: string;
let port: number;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'tale-host-header-'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html>shell');
  const [origin] = await servers.start(`
import { startReactServer, defaultReactServerSecurityHeaders } from ${JSON.stringify(serverModule)};
const server = startReactServer({
  port: 0,
  hostname: '127.0.0.1',
  distDir: ${JSON.stringify(directory)},
  logPrefix: 'host-header-test',
  localeRouting: 'none',
  securityHeaders: defaultReactServerSecurityHeaders,
});
console.log('READY ' + server.port);
`);
  port = Number(new URL(origin).port);
});
afterAll(() => {
  servers.stop();
  rmSync(directory, { recursive: true, force: true });
});

interface Answer {
  status: number;
  body: string;
  type: string;
  headers: http.IncomingHttpHeaders;
}

/** `fetch` cannot lie about its Host header; this can. */
function getWithHost(
  path: string,
  host: string,
  headers: http.OutgoingHttpHeaders = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { host: '127.0.0.1', port, path, headers: { ...headers, Host: host } },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body,
            type: response.headers['content-type'] ?? '',
            headers: response.headers,
          }),
        );
      },
    );
    request.on('error', reject);
  });
}

/** What a proper answer carries over plain HTTP; the 400 must carry it too. */
const SECURITY_HEADERS = [
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'x-permitted-cross-domain-policies',
] as const;

describe('the Host header', () => {
  it.each(['localhost:abc', 'localhost:99999', 'exa mple.com'])(
    'answers 400 when it is %j, on the health route and on a page alike',
    async (host) => {
      for (const path of ['/api/health', '/']) {
        const answer = await getWithHost(path, host);
        expect(answer.status).toBe(400);
        expect(answer.type).toContain('text/plain');
        expect(answer.body).toBe('Bad Request');
      }
    },
  );

  it.each(['localhost:abc', 'exa mple.com'])(
    'carries the security headers of every other answer when it is %j',
    async (host) => {
      const proper = await getWithHost('/api/health', `localhost:${port}`);
      for (const path of ['/api/health', '/']) {
        const refused = await getWithHost(path, host);
        expect(refused.status).toBe(400);
        for (const name of SECURITY_HEADERS) {
          expect(refused.headers[name], `${path} ${name}`).toBeDefined();
          expect(refused.headers[name], `${path} ${name}`).toBe(
            proper.headers[name],
          );
        }
        // Plain HTTP: no Strict-Transport-Security, as for any answer.
        expect(refused.headers['strict-transport-security']).toBeUndefined();
      }
    },
  );

  it('adds Strict-Transport-Security to it when the request came over HTTPS through a proxy', async () => {
    const forwarded = { 'X-Forwarded-Proto': 'https' };
    const proper = await getWithHost(
      '/api/health',
      `localhost:${port}`,
      forwarded,
    );
    const refused = await getWithHost('/', 'localhost:abc', forwarded);
    expect(refused.status).toBe(400);
    expect(proper.headers['strict-transport-security']).toBeDefined();
    expect(refused.headers['strict-transport-security']).toBe(
      proper.headers['strict-transport-security'],
    );
  });

  it('answers a request with a proper Host header as usual', async () => {
    const health = await getWithHost('/api/health', `localhost:${port}`);
    expect(health.status).toBe(200);
    const page = await getWithHost('/', '127.0.0.1');
    expect(page.status).toBe(200);
    expect(page.body).toContain('shell');
  });
});
