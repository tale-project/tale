import http from 'node:http';

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
