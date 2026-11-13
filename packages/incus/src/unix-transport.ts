// The Incus API over the node's local Unix socket — the admin door, used
// only by a one-time bootstrap on a single box (an operator in the
// `incus-admin` group, before any restricted certificate exists). Everything
// else reaches the node over mutual TLS with a certificate restricted to one
// project. The socket carries plain HTTP; the client's bounds (timeout,
// cancellation, response cap, no redirect) all hold. It opens no websocket:
// an exec session needs the TLS endpoint.

import { IncusClient, type IncusFetch } from './client.ts';

/** Where a Zabbly or distribution Incus listens. */
export const DEFAULT_INCUS_SOCKET = '/var/lib/incus/unix.socket';

/** The origin requests over the socket name; the socket decides where they
 * go. */
const UNIX_ORIGIN = 'http://incus.socket';

/** A fetch that speaks HTTP over the Unix socket at `socketPath`. */
export function unixSocketFetch(socketPath: string): IncusFetch {
  return (url, init) =>
    fetch(url, {
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: init.signal,
      unix: socketPath,
      redirect: 'error',
    });
}

/** A client over the local Unix socket, for bootstrap only. */
export function createUnixSocketClient(options: {
  socketPath?: string;
  project: string;
  signal: () => AbortSignal | undefined;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}): IncusClient {
  return new IncusClient({
    endpoint: UNIX_ORIGIN,
    project: options.project,
    // No TLS on the socket: the material is never sent anywhere.
    tls: { ca: '', cert: '', key: '' },
    signal: options.signal,
    fetch: unixSocketFetch(options.socketPath ?? DEFAULT_INCUS_SOCKET),
    ...(options.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.requestTimeoutMs }),
    ...(options.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: options.maxResponseBytes }),
  });
}
