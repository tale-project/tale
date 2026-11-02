import http from 'node:http';

export interface Handshake {
  /** The server agreed to switch to the WebSocket protocol (101). */
  upgraded: boolean;
  /** The status the server answered with. */
  status: number;
  /** What it said when it refused, if it did. */
  body: string;
}

/**
 * Asks for a WebSocket by hand, with the headers a script of any website could
 * not control from the browser (`Host`, `Sec-Fetch-Site`) and the one it cannot
 * leave out (`Origin`): the browser's own `WebSocket` reports a refusal as a
 * bare error, this shows the status and the reason.
 */
export function handshake(options: {
  /** The backend's port: the worker's own (`server.port`). */
  port: number;
  path: string;
  host: string;
  origin?: string;
  /** Who started the request, as a browser says it (`same-origin`, `cross-site`, ...): a program says nothing. */
  fetchSite?: string;
}): Promise<Handshake> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: options.port,
      path: options.path,
      method: 'GET',
      headers: {
        Host: options.host,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...(options.origin === undefined ? {} : { Origin: options.origin }),
        ...(options.fetchSite === undefined
          ? {}
          : { 'Sec-Fetch-Site': options.fetchSite }),
      },
    });
    request.on('response', (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () =>
        resolve({ upgraded: false, status: response.statusCode ?? 0, body }),
      );
    });
    request.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve({ upgraded: true, status: response.statusCode ?? 0, body: '' });
    });
    request.on('error', reject);
    request.end();
  });
}

export interface OtherSite {
  /** Where its page is: another origin (another port) of this computer. */
  origin: string;
  close: () => Promise<void>;
}

/**
 * Another website, for a page to run in that is not the app's: a web server
 * of its own on this computer (a dev server, a page opened from a file
 * server: the kind of site the app's "no login" door has to be safe from)
 * with one empty page. Unlike the app's pages it carries no Content Security
 * Policy, so what its script sends is stopped by the app or by nothing.
 */
export async function serveOtherSite(): Promise<OtherSite> {
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>Another site</title><p>Another site');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The other site has no port');
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
