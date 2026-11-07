// WebSocket endpoints of `startReactServer`, proved against a real Bun server:
// the upgrade is decided before any other route, a refusal is answered as
// given, and a request that is no socket here goes through the normal pipeline.
// A server started without the option keeps answering upgrade requests as
// ordinary requests.

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bunServers, serverModule } from '@/tests/utils/site-server';

const servers = bunServers();
let directory: string;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'tale-websocket-'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html>shell');
});
afterAll(() => {
  servers.stop();
  rmSync(directory, { recursive: true, force: true });
});

/** A server over a one-page `dist/`, with or without a socket endpoint. */
async function start(withSockets: boolean): Promise<string> {
  const [origin] = await servers.start(`
import { startReactServer } from ${JSON.stringify(serverModule)};
const server = startReactServer({
  port: 0,
  hostname: '127.0.0.1',
  distDir: ${JSON.stringify(directory)},
  logPrefix: 'websocket-test',
  localeRouting: 'none',
  extraRoutes(request, url) {
    if (url.pathname === '/plain') return new Response('plain');
    return null;
  },
  ${
    withSockets
      ? `websocket: {
    upgrade(request, url) {
      if (url.pathname === '/socket') {
        return { data: { name: url.searchParams.get('name') ?? 'anonymous' } };
      }
      if (url.pathname === '/refused') {
        return new Response('no sockets for you', { status: 403 });
      }
      return null;
    },
    handler: {
      open(ws) { ws.send('hello ' + ws.data.name); },
      message(ws, message) { ws.send('echo ' + message); },
    },
  },`
      : ''
  }
});
console.log('READY ' + server.port);
`);
  return origin;
}

/** What the server answers to a request that asks for an upgrade. */
function askToUpgrade(
  origin: string,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.get(
      `${origin}${path}`,
      {
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body }),
        );
      },
    );
    request.on('error', reject);
  });
}

/**
 * A socket client in its own Bun process: jsdom replaces `Event` in this one,
 * and Node's WebSocket refuses events that are not its own. Resolves with the
 * messages it collected, or rejects when the socket fails or stays silent.
 */
const CLIENT = `
const socket = new WebSocket(process.env.SOCKET_URL);
const wanted = Number(process.env.SOCKET_COUNT);
const received = [];
const giveUp = setTimeout(() => { console.error('silent'); process.exit(1); }, 10000);
socket.addEventListener('open', () => {
  if (process.env.SOCKET_SEND) socket.send(process.env.SOCKET_SEND);
});
socket.addEventListener('message', (event) => {
  received.push(String(event.data));
  if (received.length === wanted) {
    clearTimeout(giveUp);
    console.log(JSON.stringify(received));
    socket.close();
    process.exit(0);
  }
});
socket.addEventListener('error', () => { console.error('failed'); process.exit(1); });
`;

function converse(
  origin: string,
  path: string,
  send: string | null,
  count: number,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'bun',
      ['--eval', CLIENT],
      {
        env: {
          ...process.env,
          SOCKET_URL: origin.replace('http', 'ws') + path,
          SOCKET_SEND: send ?? '',
          SOCKET_COUNT: String(count),
        },
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`the socket at ${path}: ${stderr}`));
        else resolve(JSON.parse(stdout) as string[]);
      },
    );
  });
}

describe('a server with a websocket endpoint', () => {
  it('upgrades an address the service accepts and hands its data to the handler', async () => {
    const origin = await start(true);
    expect(await converse(origin, '/socket?name=ada', 'ping', 2)).toEqual([
      'hello ada',
      'echo ping',
    ]);
  });

  it('answers a refused upgrade as the service gave it', async () => {
    const origin = await start(true);
    expect(await askToUpgrade(origin, '/refused')).toEqual({
      status: 403,
      body: 'no sockets for you',
    });
  });

  it('sends an address that is no socket through the normal pipeline', async () => {
    const origin = await start(true);
    expect(await askToUpgrade(origin, '/plain')).toEqual({
      status: 200,
      body: 'plain',
    });
  });

  it('answers a request without an upgrade header as before', async () => {
    const origin = await start(true);
    const plain = await fetch(`${origin}/plain`);
    expect(await plain.text()).toBe('plain');
    const socketAddress = await fetch(`${origin}/socket`);
    expect(socketAddress.status).toBe(200);
    expect(await socketAddress.text()).toContain('shell');
  });
});

describe('a server without a websocket endpoint', () => {
  it('answers an upgrade request like any other request', async () => {
    const origin = await start(false);
    expect(await askToUpgrade(origin, '/plain')).toEqual({
      status: 200,
      body: 'plain',
    });
  });
});
