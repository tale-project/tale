/**
 * A loopback HTTP server for client tests: listens on an ephemeral port on
 * 127.0.0.1, records every request it sees, and tears down open
 * connections (event streams included) on close.
 */

import { createServer } from 'node:http';
import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface SeenRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface TestServer {
  url: string;
  requests: SeenRequest[];
  close: () => Promise<void>;
}

export type Handler = (
  request: SeenRequest,
  response: ServerResponse,
) => void | Promise<void>;

export async function startServer(handler: Handler): Promise<TestServer> {
  const requests: SeenRequest[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => {
      const seen: SeenRequest = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body,
      };
      requests.push(seen);
      Promise.resolve(handler(seen, res)).catch((error: unknown) => {
        console.error('test server handler failed', error);
        res.statusCode = 599;
        res.end();
      });
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A loopback port nothing listens on: bound once, then released. */
export async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return port;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
