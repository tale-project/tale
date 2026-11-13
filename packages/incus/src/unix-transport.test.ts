// The Unix-socket transport bootstrap uses: plain HTTP over a local socket,
// with the client's bounds, and nothing else (no TLS endpoint, no
// websockets, no redirect).

import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IncusClient } from './client.ts';
import { createUnixSocketClient } from './unix-transport.ts';

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`rejected with a non-Error: ${String(error)}`, {
      cause: error,
    });
  }
  throw new Error('expected the promise to reject');
}

const directory = mkdtempSync(join(tmpdir(), 'incus-unix-'));
const socketPath = join(directory, 'unix.socket');
const seen: string[] = [];
const server = Bun.serve({
  unix: socketPath,
  fetch: async (req) => {
    const url = new URL(req.url);
    seen.push(
      `${req.method} ${url.pathname}${url.search} ${req.headers.get('content-type') ?? ''}`,
    );
    if (url.pathname === '/1.0/projects/elsewhere') {
      return new Response(null, {
        status: 302,
        headers: { location: 'http://x/1.0' },
      });
    }
    if (url.pathname === '/1.0/slow')
      return new Promise<Response>(() => undefined);
    return new Response(
      JSON.stringify({
        type: 'sync',
        status_code: 200,
        metadata:
          url.pathname === '/1.0'
            ? {
                api_extensions: ['instance_oci'],
                auth: 'trusted',
                environment: { server_version: '7.6' },
              }
            : { name: 'stack', config: { restricted: 'true' } },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  },
});

afterAll(() => {
  void server.stop(true);
  rmSync(directory, { recursive: true, force: true });
});

describe('the Unix socket', () => {
  test('reads and writes reach the socket, scoped to the project', async () => {
    const client = createUnixSocketClient({
      socketPath,
      project: 'stack',
      signal: () => undefined,
    });
    expect((await client.getServer()).serverVersion).toBe('7.6');
    await client.patchInstance('db', { config: { 'user.x': '1' } });
    expect(seen).toContain('GET /1.0 ');
    expect(seen).toContain(
      'PATCH /1.0/instances/db?project=stack application/json',
    );
  });

  test('a redirect is an error, and a call ends at its timeout', async () => {
    const client = createUnixSocketClient({
      socketPath,
      project: 'stack',
      signal: () => undefined,
      requestTimeoutMs: 200,
    });
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await rejection(client.getProject('elsewhere'));
      await rejection(client.sync('GET', '/1.0/slow'));
    } finally {
      warn.mockRestore();
    }
  });

  test('no websocket over the socket: an exec session needs the TLS endpoint', () => {
    const client = createUnixSocketClient({
      socketPath,
      project: 'stack',
      signal: () => undefined,
    });
    expect(() => client.openWebSocket('/1.0/operations/x/websocket')).toThrow(
      'TLS endpoint',
    );
  });

  test('a plain-HTTP endpoint without a transport of its own is refused', () => {
    expect(
      () =>
        new IncusClient({
          endpoint: 'http://node:8443',
          project: 'stack',
          tls: { ca: '', cert: '', key: '' },
          signal: () => undefined,
        }),
    ).toThrow('not https');
  });
});
