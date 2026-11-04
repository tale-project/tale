/**
 * Raw HTTPS for the container tests: bytes written as given to a published
 * port, past any HTTP client that would frame them itself, with the edge's
 * certificate verified against one trust anchor.
 */
import { connect } from 'node:tls';

/**
 * Sends `request` to 127.0.0.1:`port` over TLS for `servername`, verified
 * against `ca` alone, and answers what came back until the server closed or
 * ten seconds passed. A connection that failed answers the error with what
 * came back before it.
 */
export function rawTlsRequest(opts: {
  port: number;
  servername: string;
  ca: string;
  request: string;
}): Promise<{ response: string; error?: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let error: string | undefined;
    const socket = connect({
      host: '127.0.0.1',
      port: opts.port,
      servername: opts.servername,
      ca: opts.ca,
      ALPNProtocols: ['http/1.1'],
    });
    const done = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ response: Buffer.concat(chunks).toString('utf8'), error });
    };
    const timer = setTimeout(done, 10_000);
    socket.on('secureConnect', () => socket.write(opts.request));
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('end', done);
    socket.on('error', (failure: Error) => {
      error = failure.message;
      done();
    });
  });
}
