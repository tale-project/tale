/**
 * The relay a session's yt-dlp reaches video ingestion's proxies through
 * (tale-project/tale#4942, `core/video_links/relay.ts`).
 *
 * yt-dlp is given the API listener as its proxy and shows a token for its
 * job with each request. It asks for a tunnel (`CONNECT host:port`) to a
 * host it speaks TLS with, and sends a plain `http://` request whole, in
 * absolute form (`GET http://host/path`). The relay carries both through the
 * one configured proxy the token names. It dials nothing else: not the host
 * yt-dlp asks for, and not a proxy that is not in the deployment's settings.
 * The proxy's credentials stay here.
 *
 * A request in absolute form never reaches the application. Left to it, the
 * application would answer for whatever host the request names with a route
 * of its own that happens to share the path, and that answer would be stored
 * as the video's.
 *
 * What it answers a tunnel request with is yt-dlp's whole view of what
 * happened, and `proxyFailedRun` (`core/video_links/ytdlp.ts`) reads it:
 * - 200: the tunnel is open;
 * - 407: the proxy refused the credentials of its entry, as the proxy said;
 * - 530: the proxy itself could not be used (`RELAY_PROXY_UNREACHABLE_STATUS`);
 * - the proxy's own status where it would not carry this one request (502,
 *   503, 403), which is no fault of the proxy;
 * - 531: the relay's own refusal (`RELAY_REFUSED_STATUS`): the token is not
 *   one of this deployment's, has expired, or names a proxy that is no
 *   longer configured. The same answer for each, and nothing that says
 *   which.
 *
 * A tunnel holds two sockets and no bytes: each side is read only as fast
 * as the other takes them. It ends with its token: a job's token outlives
 * every run it is minted for, and nothing is carried for one that has run
 * out.
 */

import http, {
  Server,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import type net from 'node:net';
import type tls from 'node:tls';

import type { ServerType } from '@hono/node-server';

import {
  openProxyTunnel,
  parseVideoProxyUpstream,
  ProxyTunnelError,
  type ProxyTunnel,
  type VideoProxyUpstream,
} from '../../core/video_links/proxy_tunnel.ts';
import {
  RELAY_PROXY_UNREACHABLE_STATUS,
  RELAY_PROXY_USER,
  RELAY_REFUSED_STATUS,
} from '../../core/video_links/relay.ts';
import {
  verifyVideoRelayToken,
  videoProxyDigest,
  type VideoRelayGrant,
} from '../../core/video_links/relay_token.ts';
import { configuredYtdlpProxyUrls } from '../../core/video_links/ytdlp.ts';

/** The tunnels and plain requests the relay carries at once. yt-dlp opens a
 * handful per video, an organization runs three videos at a time, and a
 * worker five jobs: this is room for all of them. */
export const RELAY_MAX_TUNNELS = 128;

/** What one job may have carried at once: several times what a yt-dlp that
 * downloads one stream opens, and a bound on what one token can take of the
 * room above. */
export const RELAY_MAX_TUNNELS_PER_JOB = 16;

/** How long a proxy is given to open a tunnel. Under yt-dlp's own socket
 * timeout (`--socket-timeout 30`), so that yt-dlp hears the relay's answer
 * for a proxy that does not answer instead of giving up a moment before
 * it, with nothing that says which proxy was at fault. */
export const RELAY_OPEN_TIMEOUT_MS = 20_000;

/** How long a tunnel may carry nothing before it is closed: the sandbox
 * egress proxy's own idle limit for a tunnel. */
const IDLE_TIMEOUT_MS = 600_000;

/** How long a refused request's socket is given to take its answer. */
const REFUSAL_FLUSH_MS = 5_000;

type OpenTunnel = (
  upstream: VideoProxyUpstream,
  host: string,
  port: number,
  options: { timeoutMs: number; signal: AbortSignal },
) => Promise<ProxyTunnel>;

export interface VideoProxyRelayOptions {
  /** The environment the proxies and the signing key are read from. */
  readonly env?: NodeJS.ProcessEnv;
  /** Opens the tunnel; the real dialer unless a test brings its own. */
  readonly open?: OpenTunnel;
  /** The clock a token's expiry is read against. */
  readonly now?: () => number;
  readonly openTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxTunnels?: number;
  readonly maxTunnelsPerJob?: number;
  /** Trust anchors to verify an `https` proxy with when a plain request is
   * passed to it. For tests; the default is the runtime's. */
  readonly ca?: tls.ConnectionOptions['ca'];
}

/** `host` and `port` of a `CONNECT` request's target, or `null` for one that
 * is no `host:port`. Nothing but a host name or an address is taken for a
 * host, so nothing can ride it into a proxy's request line. */
export function connectTarget(
  target: string,
): { host: string; port: number } | null {
  const match =
    /^(?:\[([0-9A-Fa-f:.]+)\]|([A-Za-z0-9._-]+)):([0-9]{1,5})$/.exec(target);
  if (match === null) return null;
  const port = Number(match[3]);
  if (port < 1 || port > 65_535) return null;
  const host = match[1] ?? match[2] ?? '';
  return host === '' ? null : { host, port };
}

/** The token of a `Proxy-Authorization: Basic` header that names the relay's
 * user, or `null`. */
function tokenOf(header: string | undefined): string | null {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header ?? '');
  if (match === null) return null;
  const [user, ...rest] = Buffer.from(match[1] ?? '', 'base64')
    .toString('utf8')
    .split(':');
  return user === RELAY_PROXY_USER && rest.length > 0 ? rest.join(':') : null;
}

/**
 * The answer to a tunnel request that gets no tunnel. The socket goes with
 * it: nothing reads a refused client, so its own end would never be heard,
 * and a socket left half open is held for as long as its peer cares to.
 */
function refuse(client: net.Socket, status: number, reason: string): void {
  const flush = setTimeout(() => client.destroy(), REFUSAL_FLUSH_MS);
  flush.unref();
  client.once('close', () => clearTimeout(flush));
  client.end(
    `HTTP/1.1 ${status} ${reason}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`,
    () => client.destroy(),
  );
}

/** The headers that are one connection's own, and never passed on. */
const HOP_BY_HOP: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** The headers of a message that belong to its far end: all but the ones of
 * the connection it arrived on, and the ones that connection names. */
function endToEnd(
  headers: IncomingHttpHeaders,
): Record<string, string | string[]> {
  const named = new Set(
    (headers.connection ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name !== ''),
  );
  const passed: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP.has(name) || named.has(name))
      continue;
    passed[name] = value;
  }
  return passed;
}

/** The credentials of a proxy's entry as an HTTP proxy is shown them. */
function proxyAuthorization(upstream: VideoProxyUpstream): OutgoingHttpHeaders {
  return upstream.username === null
    ? {}
    : {
        'proxy-authorization': `Basic ${Buffer.from(
          `${upstream.username}:${upstream.password ?? ''}`,
        ).toString('base64')}`,
      };
}

/** Each configured proxy by its digest, read again only when the settings
 * it comes from have changed (an invalid single proxy is warned about each
 * time it is read). */
function proxyIndex(): (env: NodeJS.ProcessEnv) => Map<string, string> {
  let key: string | undefined;
  let byDigest = new Map<string, string>();
  return (env) => {
    const settings = [
      env.VIDEO_INGEST_PROXY_URL,
      env.VIDEO_INGEST_PROXY_URLS,
      env.OUTBOUND_PROXY_URLS,
    ].join('\n');
    if (settings !== key) {
      key = settings;
      byDigest = new Map(
        configuredYtdlpProxyUrls(env).map((url) => [
          videoProxyDigest(url),
          url,
        ]),
      );
    }
    return byDigest;
  };
}

type RequestListener = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

function isRequestListener(value: unknown): value is RequestListener {
  return typeof value === 'function';
}

/** What the relay answers a tunnel that did not open with, and why. */
function tunnelFailure(error: ProxyTunnelError): {
  status: number;
  reason: string;
} {
  if (error.kind === 'credentials') {
    return { status: 407, reason: 'Proxy Authentication Required' };
  }
  if (error.kind === 'refused') {
    const status = error.status;
    return {
      status:
        status !== undefined &&
        status >= 400 &&
        status <= 599 &&
        status !== 407 &&
        status !== RELAY_PROXY_UNREACHABLE_STATUS &&
        status !== RELAY_REFUSED_STATUS
          ? status
          : 502,
      reason: 'Tunnel Refused',
    };
  }
  return {
    status: RELAY_PROXY_UNREACHABLE_STATUS,
    reason: 'Video Proxy Unreachable',
  };
}

/**
 * Answer what the listener is asked as a proxy: its `CONNECT` requests, and
 * its requests in absolute form, which it takes from the application.
 * Returns what ends the relay: it hands the listener's requests back,
 * stops answering and closes everything it holds, for a listener that is
 * shutting down, since a tunnel is no request the server would wait for or
 * close itself. An HTTP/2 flavour of the server, which is asked for nothing
 * this way, is left alone.
 */
export function installVideoProxyRelay(
  server: ServerType,
  options: VideoProxyRelayOptions = {},
): () => void {
  if (!(server instanceof Server)) return () => {};
  const env = options.env ?? process.env;
  const open = options.open ?? openProxyTunnel;
  const now = options.now ?? Date.now;
  const openTimeoutMs = options.openTimeoutMs ?? RELAY_OPEN_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const maxTunnels = options.maxTunnels ?? RELAY_MAX_TUNNELS;
  const maxTunnelsPerJob =
    options.maxTunnelsPerJob ?? RELAY_MAX_TUNNELS_PER_JOB;
  const proxies = proxyIndex();
  /** Every socket of a request being answered or a tunnel being held, and
   * every request being passed to a proxy. */
  const held = new Set<{ destroy(): unknown }>();
  let carried = 0;
  const carriedFor = new Map<string, number>();

  const hold = (socket: net.Socket): void => {
    held.add(socket);
    socket.once('close', () => held.delete(socket));
  };

  /** The token's grant and the proxy it names, for a request the relay
   * carries; `null` for one it refuses. */
  const admit = (
    request: IncomingMessage,
  ): {
    grant: Extract<VideoRelayGrant, { use: 'proxy' }>;
    upstream: VideoProxyUpstream;
  } | null => {
    const token = tokenOf(request.headers['proxy-authorization']);
    const grant =
      token === null ? null : verifyVideoRelayToken(token, env, now());
    if (grant === null || grant.use !== 'proxy') return null;
    const proxyUrl = proxies(env).get(grant.proxy);
    const upstream =
      proxyUrl === undefined ? null : parseVideoProxyUpstream(proxyUrl);
    return upstream === null ? null : { grant, upstream };
  };

  /** A place among what the relay carries for `job`, or `null` where it has
   * none left. The answer gives the place back, once. */
  const takePlace = (job: string): (() => void) | null => {
    const mine = carriedFor.get(job) ?? 0;
    if (carried >= maxTunnels || mine >= maxTunnelsPerJob) return null;
    carried += 1;
    carriedFor.set(job, mine + 1);
    let given = false;
    return () => {
      if (given) return;
      given = true;
      carried -= 1;
      const left = (carriedFor.get(job) ?? 1) - 1;
      if (left <= 0) carriedFor.delete(job);
      else carriedFor.set(job, left);
    };
  };

  const relay = async (
    request: IncomingMessage,
    client: net.Socket,
    head: Buffer,
  ): Promise<void> => {
    hold(client);
    // A client that goes away takes its request with it. The listener's
    // sockets stay open one way when the other side has ended its own, so
    // an end is as much a leaving as a close or an error is.
    const gone = new AbortController();
    const leave = (): void => {
      gone.abort(new Error('the client went away'));
      client.destroy();
    };
    client.once('end', leave);
    client.once('close', leave);
    client.on('error', leave);

    const admitted = admit(request);
    if (admitted === null) {
      refuse(client, RELAY_REFUSED_STATUS, 'Relay Token Refused');
      return;
    }
    const { grant, upstream } = admitted;
    const target = connectTarget(request.url ?? '');
    if (target === null) {
      refuse(client, 400, 'Bad Request');
      return;
    }
    const giveBack = takePlace(grant.job);
    if (giveBack === null) {
      refuse(client, 503, 'Service Unavailable');
      return;
    }

    let tunnel: ProxyTunnel;
    try {
      tunnel = await open(upstream, target.host, target.port, {
        timeoutMs: openTimeoutMs,
        signal: gone.signal,
      });
    } catch (error) {
      giveBack();
      if (client.destroyed) return;
      if (!(error instanceof ProxyTunnelError)) {
        console.error('[video-relay] opening a tunnel failed:', error);
        refuse(client, 500, 'Internal Server Error');
        return;
      }
      // The job and the kind of failure: no host, no credential, no token.
      console.warn(
        `[video-relay] job ${grant.job}: ${error.message} (${error.kind})`,
      );
      const { status, reason } = tunnelFailure(error);
      refuse(client, status, reason);
      return;
    }

    const proxy = tunnel.socket;
    hold(proxy);
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearTimeout(expiry);
      giveBack();
      client.destroy();
      proxy.destroy();
    };
    // Nothing is carried for a token that has run out.
    const expiry = setTimeout(close, Math.max(0, grant.exp - now()));
    expiry.unref();
    if (client.destroyed) {
      close();
      return;
    }
    client.off('end', leave);
    for (const socket of [client, proxy]) {
      socket.setTimeout(idleTimeoutMs, close);
      socket.once('close', close);
      socket.on('error', close);
    }
    // A side that has ended is done with the tunnel: what it had sent is
    // passed on to the other, and then the tunnel is closed both ways. Left
    // half open, it would hold its place until the other side ended too,
    // which a peer need not do.
    const done = (other: net.Socket) => (): void => {
      if (other.destroyed || other.writableFinished) close();
      else other.end(close);
    };
    client.once('end', done(proxy));
    proxy.once('end', done(client));
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    // What either side sent ahead of the tunnel belongs to the other.
    if (tunnel.head.length > 0) client.write(tunnel.head);
    if (head.length > 0) proxy.write(head);
    client.pipe(proxy, { end: false });
    proxy.pipe(client, { end: false });
  };

  /**
   * A plain request, passed to the token's proxy: whole and in absolute
   * form to a proxy that speaks HTTP, which is how such a proxy is asked for
   * a page that is not behind TLS; and as the origin's own request, through
   * a tunnel, to a SOCKS proxy.
   */
  const forward = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    /** An answer of the relay's own. A request it does not carry is not
     * read either: its connection goes with the answer. */
    const answer = (status: number, reason: string): void => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(status, reason, {
        'content-length': '0',
        connection: 'close',
      });
      response.end(() => request.socket.destroy());
    };

    const admitted = admit(request);
    if (admitted === null) {
      answer(RELAY_REFUSED_STATUS, 'Relay Token Refused');
      return;
    }
    const { grant, upstream } = admitted;
    let url: URL | null;
    try {
      url = new URL(request.url ?? '');
    } catch {
      // No URL at all: answered as any target the relay cannot name.
      url = null;
    }
    // A page behind TLS is asked for through a tunnel, and nothing but plain
    // HTTP in the open. Credentials in a URL are no part of a request.
    const target =
      url !== null &&
      url.protocol === 'http:' &&
      url.username === '' &&
      url.password === ''
        ? connectTarget(`${url.hostname}:${url.port === '' ? '80' : url.port}`)
        : null;
    if (url === null || target === null) {
      answer(400, 'Bad Request');
      return;
    }
    const giveBack = takePlace(grant.job);
    if (giveBack === null) {
      answer(503, 'Service Unavailable');
      return;
    }

    const gone = new AbortController();
    let outgoing: http.ClientRequest | undefined;
    response.once('close', () => {
      gone.abort(new Error('the client went away'));
      outgoing?.destroy();
      giveBack();
    });

    const headers = { ...endToEnd(request.headers), host: url.host };
    const path = `${url.pathname}${url.search}`;
    try {
      if (upstream.scheme === 'http' || upstream.scheme === 'https') {
        outgoing = (upstream.scheme === 'https' ? https : http).request({
          host: upstream.host,
          port: upstream.port,
          method: request.method,
          path: `${url.origin}${path}`,
          headers: { ...headers, ...proxyAuthorization(upstream) },
          agent: false,
          // The certificate is the proxy's own (see `proxy_tunnel.ts`).
          ...(upstream.scheme === 'https'
            ? { servername: isIP(upstream.host) === 0 ? upstream.host : '' }
            : {}),
          ...(options.ca === undefined ? {} : { ca: options.ca }),
        });
      } else {
        const tunnel = await open(upstream, target.host, target.port, {
          timeoutMs: openTimeoutMs,
          signal: gone.signal,
        });
        if (response.destroyed) {
          tunnel.socket.destroy();
          return;
        }
        outgoing = http.request({
          // No agent is named: Node takes a request's own connection only
          // then, and a new agent's default one otherwise.
          createConnection: () => tunnel.socket,
          method: request.method,
          path,
          headers,
        });
      }
    } catch (error) {
      if (response.destroyed) return;
      if (!(error instanceof ProxyTunnelError)) {
        console.error('[video-relay] passing a request on failed:', error);
        answer(500, 'Internal Server Error');
        return;
      }
      console.warn(
        `[video-relay] job ${grant.job}: ${error.message} (${error.kind})`,
      );
      const { status, reason } = tunnelFailure(error);
      answer(status, reason);
      return;
    }

    const passing = outgoing;
    held.add(passing);
    passing.once('close', () => held.delete(passing));
    passing.setTimeout(idleTimeoutMs, () => passing.destroy());
    // Nothing is carried for a token that has run out.
    const expiry = setTimeout(
      () => response.destroy(),
      Math.max(0, grant.exp - now()),
    );
    expiry.unref();
    response.once('close', () => clearTimeout(expiry));
    passing.once('response', (incoming) => {
      response.writeHead(
        incoming.statusCode ?? 502,
        incoming.statusMessage,
        endToEnd(incoming.headers),
      );
      incoming.once('error', () => response.destroy());
      // An answer that ends before its end is no answer to finish.
      incoming.once('close', () => {
        if (!incoming.complete) response.destroy();
      });
      incoming.pipe(response);
    });
    passing.once('error', (error) => {
      if (response.destroyed) return;
      // The job and the code of the failure: no host, no credential.
      console.warn(
        `[video-relay] job ${grant.job}: a plain request could not be passed to its proxy (${
          Reflect.get(error, 'code') ?? 'no answer'
        })`,
      );
      answer(RELAY_PROXY_UNREACHABLE_STATUS, 'Video Proxy Unreachable');
    });
    request.once('error', () => passing.destroy());
    request.pipe(passing);
  };

  const onConnect = (
    request: IncomingMessage,
    client: net.Socket,
    head: Buffer,
  ): void => {
    relay(request, client, head).catch((error: unknown) => {
      console.error('[video-relay] a tunnel request failed:', error);
      client.destroy();
    });
  };
  server.on('connect', onConnect);

  // The application's own listeners answer what is asked of this listener
  // itself, in origin form. What names another host is asked of a proxy.
  const application = server.listeners('request').filter(isRequestListener);
  const onRequest: RequestListener = (request, response) => {
    const target = request.url ?? '';
    if (target.startsWith('/') || target === '*') {
      for (const listener of application) {
        listener.call(server, request, response);
      }
      return;
    }
    forward(request, response).catch((error: unknown) => {
      console.error('[video-relay] a plain request failed:', error);
      response.destroy();
    });
  };
  server.removeAllListeners('request');
  server.on('request', onRequest);

  return () => {
    server.off('connect', onConnect);
    server.off('request', onRequest);
    for (const listener of application) server.on('request', listener);
    for (const one of held) one.destroy();
  };
}
