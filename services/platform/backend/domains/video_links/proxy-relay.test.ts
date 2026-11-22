// @vitest-environment node

import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  closedPort,
  HttpProxy,
  selfSignedCertificate,
  Socks5Proxy,
  startOrigin,
  startTcpServer,
} from '../../../../session-manager/backend/testing/local-proxies.ts';
import {
  ProxyTunnelError,
  type ProxyTunnel,
} from '../../core/video_links/proxy_tunnel.ts';
import { relayProxyUrl } from '../../core/video_links/relay.ts';
import {
  signVideoRelayToken,
  VIDEO_RELAY_GRANT_TTL_MS,
} from '../../core/video_links/relay_token.ts';
import {
  connectTarget,
  installVideoProxyRelay,
  RELAY_MAX_TUNNELS,
  RELAY_MAX_TUNNELS_PER_JOB,
  type VideoProxyRelayOptions,
} from './proxy-relay.ts';

/**
 * A sandbox session's yt-dlp is given the API listener as its proxy and a
 * token for its job; the listener opens each tunnel through the one
 * configured proxy the token names (tale-project/tale#4942). These drive a
 * real listener with a real HTTP client, against real proxies.
 */

const KEY = { WEBDAV_APP_PASSWORD_HMAC_KEY: 'k'.repeat(64) };

interface Relay {
  readonly port: number;
  readonly env: NodeJS.ProcessEnv;
  /** What the application behind the listener was asked, by request target. */
  readonly asked: string[];
  /** The connections the listener holds. */
  connections(): Promise<number>;
  end(): void;
}

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

/** A listener with the relay on it, and the settings it reads. */
async function relayWith(
  settings: NodeJS.ProcessEnv,
  options: Omit<VideoProxyRelayOptions, 'env'> = {},
): Promise<Relay> {
  const asked: string[] = [];
  const server = http.createServer((request, response) => {
    asked.push(request.url ?? '');
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a server listening on a TCP port answers its address as one
  const { port } = server.address() as AddressInfo;
  const env = {
    ...KEY,
    SANDBOX_HTTP_API_BASE_URL: `http://127.0.0.1:${port}`,
    ...settings,
  };
  const end = installVideoProxyRelay(server, { env, ...options });
  closers.push(async () => {
    end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    port,
    env,
    asked,
    connections: () =>
      new Promise((resolve, reject) => {
        server.getConnections((error, count) =>
          error === null ? resolve(count) : reject(error),
        );
      }),
    end,
  };
}

interface Answer {
  readonly status: number;
  readonly reason: string;
  /** The tunnel, when it opened. */
  readonly socket: net.Socket | null;
  readonly head: Buffer;
}

/** Ask the relay for a tunnel the way yt-dlp does. */
function tunnel(
  relay: Relay,
  target: string,
  authorization: string | null,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: relay.port,
      method: 'CONNECT',
      path: target,
      agent: false,
      headers: {
        host: target,
        ...(authorization === null
          ? {}
          : { 'proxy-authorization': authorization }),
      },
    });
    request.once('connect', (response, socket, head) => {
      const opened = response.statusCode === 200;
      if (opened) closers.push(() => void socket.destroy());
      else socket.destroy();
      resolve({
        status: response.statusCode ?? 0,
        reason: response.statusMessage ?? '',
        socket: opened ? socket : null,
        head,
      });
    });
    request.once('error', reject);
    request.end();
  });
}

/** The header yt-dlp sends for a relay proxy URL. */
function authorizationOf(proxyUrl: string | null): string {
  const url = new URL(proxyUrl ?? '');
  return `Basic ${Buffer.from(
    `${url.username}:${decodeURIComponent(url.password)}`,
  ).toString('base64')}`;
}

/** The header for a tunnel through `proxy`, one of the relay's settings. */
function grantFor(relay: Relay, proxy: string, job = 'job-1'): string {
  return authorizationOf(relayProxyUrl(proxy, job, relay.env));
}

/** Ask an origin for `/` through an open tunnel and answer what it said. */
function ask(answer: Answer): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = answer.socket;
    if (socket === null) {
      reject(new Error(`no tunnel: ${answer.status} ${answer.reason}`));
      return;
    }
    let said = answer.head.toString('utf8');
    socket.on('data', (chunk: Buffer) => {
      said += chunk.toString('utf8');
    });
    socket.once('end', () => resolve(said));
    socket.once('error', reject);
    socket.write('GET / HTTP/1.1\r\nhost: video.test\r\n\r\n');
  });
}

describe('connectTarget — what a tunnel request may name', () => {
  it.each([
    ['video.example:443', { host: 'video.example', port: 443 }],
    ['203.0.113.7:8443', { host: '203.0.113.7', port: 8443 }],
    ['[2001:db8::7]:443', { host: '2001:db8::7', port: 443 }],
    ['r3---sn-4g5e6nzl.googlevideo.com:443', { port: 443 }],
  ])('reads %s', (target, expected) => {
    expect(connectTarget(target)).toMatchObject(expected);
  });

  it.each([
    '',
    'video.example',
    'video.example:',
    'video.example:0',
    'video.example:65536',
    'video.example:443 HTTP/1.1',
    'video.example:443\r\nx-injected: 1',
    'http://video.example:443/',
    'user@video.example:443',
    '[]:443',
  ])('refuses %j', (target) => {
    expect(connectTarget(target)).toBeNull();
  });
});

describe('the video proxy relay', () => {
  it('opens a tunnel through the proxy the token names, with the credentials of its entry', async () => {
    const origin = await startOrigin();
    const proxy = await new HttpProxy({
      username: 'user-1',
      password: 'p@ss:w/rd',
      hosts: { 'video.test': '127.0.0.1' },
    }).start();
    const relay = await relayWith({
      VIDEO_INGEST_PROXY_URLS: proxy.urlWithAuth,
    });

    const answer = await tunnel(
      relay,
      `video.test:${origin.port}`,
      grantFor(relay, proxy.urlWithAuth),
    );

    expect(answer.status).toBe(200);
    expect(await ask(answer)).toContain('hello');
    expect(
      proxy.saw('video.test', origin.port, { kind: 'CONNECT', ok: true }),
    ).toBe(true);
  });

  it.each([
    ['a list of its own', 'VIDEO_INGEST_PROXY_URLS'],
    ['its one proxy', 'VIDEO_INGEST_PROXY_URL'],
    ["the deployment's outbound proxies", 'OUTBOUND_PROXY_URLS'],
  ])('dials a proxy video ingestion has from %s', async (_name, setting) => {
    const origin = await startOrigin();
    const proxy = await new HttpProxy({
      username: 'u',
      password: 'p',
    }).start();
    const relay = await relayWith({ [setting]: proxy.urlWithAuth });

    const answer = await tunnel(
      relay,
      `127.0.0.1:${origin.port}`,
      grantFor(relay, proxy.urlWithAuth),
    );

    expect(await ask(answer)).toContain('hello');
  });

  it('dials a SOCKS proxy in its own protocol', async () => {
    const origin = await startOrigin();
    const proxy = await new Socks5Proxy({
      username: 'user-1',
      password: 'secret',
      hosts: { 'video.test': '127.0.0.1' },
    }).start();
    const entry = proxy.urlWithAuth.replace(/^socks5:/, 'socks5h:');
    const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: entry });

    const answer = await tunnel(
      relay,
      `video.test:${origin.port}`,
      grantFor(relay, entry),
    );

    expect(await ask(answer)).toContain('hello');
    expect(proxy.saw('video.test', origin.port, { ok: true })).toBe(true);
  });

  it('carries what the client sent ahead of the answer, and each side as fast as the other takes it', async () => {
    // An origin that speaks first, and echoes after.
    const origin = await startTcpServer((socket) => {
      socket.write('greeting;');
      socket.on('data', (chunk: Buffer) => socket.write(chunk));
    });
    const proxy = await new HttpProxy().start();
    const relay = await relayWith({ OUTBOUND_PROXY_URLS: proxy.url });

    const answer = await tunnel(
      relay,
      `127.0.0.1:${origin.port}`,
      grantFor(relay, proxy.url),
    );
    const socket = answer.socket;
    if (socket === null) throw new Error('no tunnel');
    let said = answer.head.toString('utf8');
    socket.on('data', (chunk: Buffer) => {
      said += chunk.toString('utf8');
    });
    const sent = 'x'.repeat(4 * 1024 * 1024);
    socket.write(sent);

    await vi.waitFor(
      () => expect(said.length).toBe('greeting;'.length + sent.length),
      { timeout: 10_000 },
    );
    expect(said.startsWith('greeting;xxx')).toBe(true);
  });

  describe('gives no tunnel, and no reason, to a request that', () => {
    const cases: [string, (relay: Relay, proxy: string) => string | null][] = [
      ['shows no token', () => null],
      [
        'shows a token under another user name',
        (relay, proxy) => {
          const url = new URL(relayProxyUrl(proxy, 'job-1', relay.env) ?? '');
          return `Basic ${Buffer.from(`someone:${url.password}`).toString('base64')}`;
        },
      ],
      [
        'shows a token signed with another key',
        (relay, proxy) =>
          authorizationOf(
            relayProxyUrl(proxy, 'job-1', {
              ...relay.env,
              WEBDAV_APP_PASSWORD_HMAC_KEY: 'z'.repeat(64),
            }),
          ),
      ],
      [
        'shows a token that has expired',
        (relay, proxy) =>
          authorizationOf(relayProxyUrl(proxy, 'job-1', relay.env, 1_000)),
      ],
      [
        'shows a token for the PO-token provider',
        (relay) =>
          `Basic ${Buffer.from(
            `tale:${signVideoRelayToken(
              { use: 'pot', job: 'job-1', exp: Date.now() + 60_000 },
              relay.env,
            )}`,
          ).toString('base64')}`,
      ],
      [
        'names a proxy that is not in the settings',
        (relay) => grantFor(relay, 'http://user:pass@elsewhere.example:8080'),
      ],
      ['is not Basic at all', () => 'Bearer v1.x.y'],
    ];

    it.each(cases)('%s', async (_name, authorization) => {
      const proxy = await new HttpProxy().start();
      const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: proxy.url });

      const answer = await tunnel(
        relay,
        'video.test:443',
        authorization(relay, proxy.url),
      );

      // The relay's own refusal, in a status and words no proxy and no
      // platform uses.
      expect(answer.status).toBe(531);
      expect(answer.reason).toBe('Relay Token Refused');
      // Nothing was dialed for it.
      expect(proxy.events).toEqual([]);
    });
  });

  // Nothing reads a client the relay refused, so the client's own end would
  // never be heard: left to it, the socket is held for as long as the client
  // cares to keep it, and a tunnel request needs no token to be refused.
  it.each([
    ['says nothing more', ''],
    ['goes on sending', 'x'.repeat(64)],
  ])(
    'lets go of a request it refused whose client %s and does not hang up',
    async (_name, more) => {
      const proxy = await new HttpProxy().start();
      const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: proxy.url });
      const client = net.connect({
        host: '127.0.0.1',
        port: relay.port,
        // A client that keeps its side open when the relay has ended its own.
        allowHalfOpen: true,
      });
      closers.push(() => void client.destroy());
      client.on('error', () => {});
      let said = '';
      client.on('data', (chunk: Buffer) => {
        said += chunk.toString('latin1');
      });

      client.write(
        `CONNECT video.test:443 HTTP/1.1\r\nhost: video.test:443\r\n\r\n${more}`,
      );

      await vi.waitFor(() =>
        expect(said).toContain('HTTP/1.1 531 Relay Token Refused'),
      );
      await vi.waitFor(async () => expect(await relay.connections()).toBe(0), {
        timeout: 4_000,
      });
      // The client never hung up: the relay did.
      expect(client.destroyed).toBe(false);
    },
  );

  it('refuses a target that is no host and port before anything is dialed', async () => {
    const proxy = await new HttpProxy().start();
    const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: proxy.url });

    const answer = await tunnel(
      relay,
      'http://video.test/',
      grantFor(relay, proxy.url),
    );

    expect(answer.status).toBe(400);
    expect(proxy.events).toEqual([]);
  });

  it('never dials the host a request names: without its proxy there is no way out', async () => {
    // The origin is right there; the token's proxy is gone.
    const origin = await startOrigin();
    const gone = `http://127.0.0.1:${await closedPort()}`;
    const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: gone });

    const answer = await tunnel(
      relay,
      `127.0.0.1:${origin.port}`,
      grantFor(relay, gone),
    );

    expect(answer.status).toBe(530);
    expect(origin.heads).toEqual([]);
  });

  describe('tells yt-dlp what its proxy did', () => {
    it('with 530 for a proxy that could not be used', async () => {
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const gone = `http://user-1:hunter2@127.0.0.1:${await closedPort()}`;
      const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: gone });

      const answer = await tunnel(
        relay,
        'video.test:443',
        grantFor(relay, gone, 'job-7'),
      );

      expect(answer.status).toBe(530);
      expect(answer.reason).toBe('Video Proxy Unreachable');
      // The log names the job and what happened: no host, no credential.
      expect(warned).toHaveBeenCalledWith(
        '[video-relay] job job-7: the video proxy could not be reached (ECONNREFUSED) (unreachable)',
      );
    });

    it('with 530 for a proxy that does not answer in time', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const silent = await startTcpServer(() => {});
      const entry = `http://127.0.0.1:${silent.port}`;
      const relay = await relayWith(
        { VIDEO_INGEST_PROXY_URLS: entry },
        { openTimeoutMs: 60 },
      );

      expect(
        (await tunnel(relay, 'video.test:443', grantFor(relay, entry))).status,
      ).toBe(530);
    });

    it("with the proxy's own 407 for credentials it refused", async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const proxy = await new HttpProxy({
        username: 'user-1',
        password: 'right',
      }).start();
      const entry = proxy.urlWithAuth.replace('right', 'wrong');
      const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: entry });

      const answer = await tunnel(
        relay,
        'video.test:443',
        grantFor(relay, entry),
      );

      expect(answer.status).toBe(407);
    });

    it("with the proxy's own status where it would not carry this one request", async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const proxy = await new HttpProxy().start();
      const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: proxy.url });

      const answer = await tunnel(
        relay,
        `127.0.0.1:${await closedPort()}`,
        grantFor(relay, proxy.url),
      );

      // The proxy answered 502: that is no fault of the proxy.
      expect(answer.status).toBe(502);
      expect(answer.reason).toBe('Tunnel Refused');
    });

    // A proxy's refusal is passed on as it is, except where its status would
    // read as one of the relay's own verdicts on the proxy.
    it.each([
      [503, 503],
      [403, 403],
      [407, 502],
      [530, 502],
      [302, 502],
      [undefined, 502],
    ])('passing a refusal with %s on as %s', async (given, passed) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const entry = 'http://gateway.example:80';
      const relay = await relayWith(
        { VIDEO_INGEST_PROXY_URLS: entry },
        {
          open: () =>
            Promise.reject(new ProxyTunnelError('refused', 'refused', given)),
        },
      );

      expect(
        (await tunnel(relay, 'video.test:443', grantFor(relay, entry))).status,
      ).toBe(passed);
    });

    it('with 500 for a failure that is none of a proxy', async () => {
      const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
      const entry = 'http://gateway.example:80';
      const relay = await relayWith(
        { VIDEO_INGEST_PROXY_URLS: entry },
        { open: () => Promise.reject(new TypeError('a bug')) },
      );

      expect(
        (await tunnel(relay, 'video.test:443', grantFor(relay, entry))).status,
      ).toBe(500);
      expect(failed).toHaveBeenCalled();
    });
  });

  it('holds no more tunnels than it is given room for, and takes the next when one has closed', async () => {
    // An origin that never ends its side: the room is freed all the same.
    const origin = await startTcpServer(() => {});
    const proxy = await new HttpProxy().start();
    const relay = await relayWith(
      { VIDEO_INGEST_PROXY_URLS: proxy.url },
      { maxTunnels: 2 },
    );
    const open = () =>
      tunnel(relay, `127.0.0.1:${origin.port}`, grantFor(relay, proxy.url));

    const first = await open();
    const second = await open();
    expect([first.status, second.status]).toEqual([200, 200]);
    expect((await open()).status).toBe(503);

    first.socket?.destroy();
    await vi.waitFor(async () => expect((await open()).status).toBe(200));
  });

  it('holds no more for one job than a job may have, whatever room is left for others', async () => {
    const origin = await startTcpServer(() => {});
    const proxy = await new HttpProxy().start();
    const relay = await relayWith(
      { VIDEO_INGEST_PROXY_URLS: proxy.url },
      { maxTunnelsPerJob: 2 },
    );
    const target = `127.0.0.1:${origin.port}`;
    const forJob = (job: string) => grantFor(relay, proxy.url, job);

    const first = await tunnel(relay, target, forJob('job-1'));
    expect((await tunnel(relay, target, forJob('job-1'))).status).toBe(200);
    expect((await tunnel(relay, target, forJob('job-1'))).status).toBe(503);
    // Another job's room is its own.
    expect((await tunnel(relay, target, forJob('job-2'))).status).toBe(200);

    first.socket?.destroy();
    await vi.waitFor(async () =>
      expect((await tunnel(relay, target, forJob('job-1'))).status).toBe(200),
    );
    expect(RELAY_MAX_TUNNELS_PER_JOB).toBe(16);
    // Room for every job a worker runs at once to have its own in full.
    expect(RELAY_MAX_TUNNELS).toBe(128);
    expect(RELAY_MAX_TUNNELS).toBeGreaterThanOrEqual(
      5 * RELAY_MAX_TUNNELS_PER_JOB,
    );
  });

  // A token is minted for a run and outlives it; nothing is carried for one
  // that has run out, however busy its tunnel is kept.
  it('closes a tunnel when its token runs out', async () => {
    const origin = await startTcpServer((socket) => {
      socket.on('data', (chunk: Buffer) => socket.write(chunk));
    });
    const proxy = await new HttpProxy().start();
    const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: proxy.url });
    // A token with 300 ms left.
    const authorization = authorizationOf(
      relayProxyUrl(
        proxy.url,
        'job-1',
        relay.env,
        Date.now() - VIDEO_RELAY_GRANT_TTL_MS + 300,
      ),
    );

    const answer = await tunnel(
      relay,
      `127.0.0.1:${origin.port}`,
      authorization,
    );
    const socket = answer.socket;
    if (socket === null) throw new Error(`no tunnel: ${answer.status}`);
    const closed = new Promise<void>((resolve) =>
      socket.once('close', () => resolve()),
    );
    // Kept busy all the while: no idle limit closes it.
    const busy = setInterval(() => socket.write('x'), 20);
    closers.push(() => clearInterval(busy));
    socket.on('data', () => {});
    socket.on('error', () => {});

    await closed;
    clearInterval(busy);
    await vi.waitFor(async () => expect(await relay.connections()).toBe(0));
  });

  it('ends the far side when its client is done, with what the client had sent', async () => {
    const got: string[] = [];
    const origin = await startTcpServer((socket) => {
      socket.on('data', (chunk: Buffer) => got.push(chunk.toString('utf8')));
      socket.once('end', () => got.push('<end>'));
    });
    const proxy = await new HttpProxy().start();
    const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: proxy.url });

    const answer = await tunnel(
      relay,
      `127.0.0.1:${origin.port}`,
      grantFor(relay, proxy.url),
    );
    answer.socket?.end('the last words');

    await vi.waitFor(() => expect(got.join('')).toBe('the last words<end>'));
  });

  it('ends its client when the far side is done, with what the far side had sent', async () => {
    const origin = await startTcpServer((socket) => {
      socket.end('the whole answer');
    });
    const proxy = await new HttpProxy().start();
    const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: proxy.url });

    const answer = await tunnel(
      relay,
      `127.0.0.1:${origin.port}`,
      grantFor(relay, proxy.url),
    );
    const socket = answer.socket;
    if (socket === null) throw new Error('no tunnel');
    let said = answer.head.toString('utf8');
    socket.on('data', (chunk: Buffer) => {
      said += chunk.toString('utf8');
    });
    await new Promise<void>((resolve) => socket.once('close', () => resolve()));

    expect(said).toBe('the whole answer');
  });

  it('closes a tunnel that carries nothing for too long, and frees its room', async () => {
    const origin = await startTcpServer(() => {});
    const proxy = await new HttpProxy().start();
    const relay = await relayWith(
      { VIDEO_INGEST_PROXY_URLS: proxy.url },
      { idleTimeoutMs: 80, maxTunnels: 1 },
    );
    const open = () =>
      tunnel(relay, `127.0.0.1:${origin.port}`, grantFor(relay, proxy.url));

    const idle = await open();
    const closed = new Promise<void>((resolve) => {
      idle.socket?.once('close', () => resolve());
      idle.socket?.resume();
    });

    await closed;
    expect((await open()).status).toBe(200);
  });

  // A tunnel is a connection the server neither waits for as a request nor
  // closes when forced: only the relay's own end closes it, and without that
  // a listener with a tunnel open never finishes closing.
  it('closes every tunnel when it is ended, so that its listener can close', async () => {
    const origin = await startTcpServer(() => {});
    const proxy = await new HttpProxy().start();
    const server = http.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a server listening on a TCP port answers its address as one
    const { port } = server.address() as AddressInfo;
    const env = {
      ...KEY,
      SANDBOX_HTTP_API_BASE_URL: `http://127.0.0.1:${port}`,
      VIDEO_INGEST_PROXY_URLS: proxy.url,
    };
    const end = installVideoProxyRelay(server, { env });
    const relay: Relay = {
      port,
      env,
      asked: [],
      connections: () => Promise.resolve(0),
      end,
    };
    const answer = await tunnel(
      relay,
      `127.0.0.1:${origin.port}`,
      grantFor(relay, proxy.url),
    );
    const clientClosed = new Promise<void>((resolve) => {
      answer.socket?.once('close', () => resolve());
      answer.socket?.resume();
    });
    let listenerClosed = false;
    const closing = new Promise<void>((resolve) =>
      server.close(() => {
        listenerClosed = true;
        resolve();
      }),
    );
    // With the tunnel open the listener does not finish closing.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(listenerClosed).toBe(false);

    end();

    await clientClosed;
    await closing;
    expect(listenerClosed).toBe(true);
  });

  it('gives an attempt up when its client leaves, and frees its room', async () => {
    let attempts = 0;
    const gaveUp: unknown[] = [];
    const entry = 'http://gateway.example:80';
    // A proxy that never answers: only the client leaving ends an attempt.
    const relay = await relayWith(
      { VIDEO_INGEST_PROXY_URLS: entry },
      {
        maxTunnels: 1,
        open: (_upstream, _host, _port, options) =>
          new Promise<ProxyTunnel>((_resolve, reject) => {
            attempts += 1;
            options.signal.addEventListener('abort', () => {
              gaveUp.push(options.signal.reason);
              reject(options.signal.reason);
            });
          }),
      },
    );
    const leave = (): http.ClientRequest => {
      const request = http.request({
        host: '127.0.0.1',
        port: relay.port,
        method: 'CONNECT',
        path: 'video.test:443',
        agent: false,
        headers: { 'proxy-authorization': grantFor(relay, entry) },
      });
      // The request is destroyed below: that is its error.
      request.on('error', () => {});
      request.end();
      return request;
    };

    const first = leave();
    await vi.waitFor(() => expect(attempts).toBe(1));
    first.destroy();

    await vi.waitFor(() => expect(gaveUp).toHaveLength(1));
    expect(String(gaveUp[0])).toContain('the client went away');
    // Its room is free: the next request is tried, not turned away.
    const second = leave();
    await vi.waitFor(() => expect(attempts).toBe(2));
    second.destroy();
    await vi.waitFor(() => expect(gaveUp).toHaveLength(2));
  });
});

/**
 * yt-dlp asks its proxy for a page that is not behind TLS with the whole
 * request, in absolute form. The listener is the application's too, which
 * would answer such a request with a route of its own that shares the path,
 * for whatever host the request names: the relay takes every one of them.
 */
describe('a plain request to the video proxy relay', () => {
  interface Plain {
    readonly status: number;
    readonly reason: string;
    readonly headers: http.IncomingHttpHeaders;
    readonly body: string;
  }

  /** Ask the relay for `url` the way a client asks its HTTP proxy. */
  function plain(
    relay: Relay,
    url: string,
    authorization: string | null,
    send: {
      method?: string;
      body?: string;
      headers?: http.OutgoingHttpHeaders;
    } = {},
  ): Promise<Plain> {
    return new Promise((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1',
        port: relay.port,
        method: send.method ?? 'GET',
        path: url,
        agent: false,
        headers: {
          host: URL.canParse(url) ? new URL(url).host : 'video.test',
          ...(authorization === null
            ? {}
            : { 'proxy-authorization': authorization }),
          ...send.headers,
        },
      });
      request.once('response', (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            reason: response.statusMessage ?? '',
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.once('error', reject);
      });
      request.once('error', reject);
      request.end(send.body);
    });
  }

  it('is passed whole to the proxy the token names, with the credentials of its entry', async () => {
    const origin = await startOrigin();
    const proxy = await new HttpProxy({
      username: 'user-1',
      password: 'p@ss:w/rd',
      hosts: { 'video.test': '127.0.0.1' },
    }).start();
    const relay = await relayWith({
      VIDEO_INGEST_PROXY_URLS: proxy.urlWithAuth,
    });

    const answer = await plain(
      relay,
      `http://video.test:${origin.port}/watch?v=1`,
      grantFor(relay, proxy.urlWithAuth),
    );

    expect(answer.status).toBe(200);
    expect(answer.body).toBe('hello');
    // The proxy was asked for the page as a proxy is, and took its own
    // credentials: the token is the relay's alone.
    expect(
      proxy.saw('video.test', origin.port, { kind: 'HTTP', ok: true }),
    ).toBe(true);
    expect(proxy.events[0]?.username).toBe('user-1');
    expect(origin.heads).toHaveLength(1);
    expect(origin.heads[0]).toContain('GET /watch?v=1 HTTP/1.1');
    expect(origin.heads[0]?.toLowerCase()).not.toContain('proxy-authorization');
    // The application was never asked.
    expect(relay.asked).toEqual([]);
  });

  it('is passed to a proxy that is reached over TLS', async () => {
    const origin = await startOrigin();
    const certificate = await selfSignedCertificate();
    const proxy = await new HttpProxy({ tls: certificate }).start();
    const relay = await relayWith(
      { VIDEO_INGEST_PROXY_URLS: proxy.url },
      { ca: certificate.cert },
    );

    const answer = await plain(
      relay,
      `http://127.0.0.1:${origin.port}/a`,
      grantFor(relay, proxy.url),
    );

    expect(answer.status).toBe(200);
    expect(answer.body).toBe('hello');
    expect(proxy.url.startsWith('https://')).toBe(true);
  });

  it("goes to a SOCKS proxy as the origin's own request, through a tunnel", async () => {
    const origin = await startOrigin();
    const proxy = await new Socks5Proxy({
      username: 'user-1',
      password: 'secret',
      hosts: { 'video.test': '127.0.0.1' },
    }).start();
    const entry = proxy.urlWithAuth.replace(/^socks5:/, 'socks5h:');
    const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: entry });

    const answer = await plain(
      relay,
      `http://video.test:${origin.port}/a/b?c=d`,
      grantFor(relay, entry),
    );

    expect(answer.body).toBe('hello');
    expect(proxy.saw('video.test', origin.port, { ok: true })).toBe(true);
    expect(origin.heads[0]).toContain('GET /a/b?c=d HTTP/1.1');
    expect(origin.heads[0]?.toLowerCase()).toContain(
      `host: video.test:${origin.port}`,
    );
    expect(origin.heads[0]?.toLowerCase()).not.toContain('proxy-authorization');
  });

  it("carries a request's body out and an answer's status and headers back", async () => {
    let received = '';
    const origin = await startTcpServer((socket) => {
      socket.on('data', (chunk: Buffer) => {
        received += chunk.toString('latin1');
        if (received.endsWith('the body')) {
          socket.end(
            'HTTP/1.1 418 Short And Stout\r\nx-origin: yes\r\nconnection: close\r\ncontent-length: 3\r\n\r\npot',
          );
        }
      });
    });
    const proxy = await new HttpProxy().start();
    const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: proxy.url });

    const answer = await plain(
      relay,
      `http://127.0.0.1:${origin.port}/brew`,
      grantFor(relay, proxy.url),
      {
        method: 'POST',
        body: 'the body',
        headers: { 'content-type': 'text/plain', 'x-session': 'kept' },
      },
    );

    expect(answer.status).toBe(418);
    expect(answer.reason).toBe('Short And Stout');
    expect(answer.headers['x-origin']).toBe('yes');
    expect(answer.body).toBe('pot');
    expect(received).toContain('POST /brew HTTP/1.1');
    expect(received.toLowerCase()).toContain('x-session: kept');
    expect(received.endsWith('the body')).toBe(true);
  });

  describe('is refused, and never answered by the application, when it', () => {
    it.each([
      ['shows no token', () => null],
      ['is not Basic at all', () => 'Bearer v1.x.y'],
      [
        'shows a token for the PO-token provider',
        (relay: Relay) =>
          `Basic ${Buffer.from(
            `tale:${signVideoRelayToken(
              { use: 'pot', job: 'job-1', exp: Date.now() + 60_000 },
              relay.env,
            )}`,
          ).toString('base64')}`,
      ],
      [
        'names a proxy that is not in the settings',
        (relay: Relay) =>
          grantFor(relay, 'http://user:pass@elsewhere.example:8080'),
      ],
    ])('%s', async (_name, authorization) => {
      const proxy = await new HttpProxy().start();
      const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: proxy.url });

      // A path the application has a route of its own for.
      const answer = await plain(
        relay,
        'http://anywhere.example/metrics',
        authorization(relay),
      );

      expect(answer.status).toBe(531);
      expect(answer.reason).toBe('Relay Token Refused');
      expect(answer.body).toBe('');
      expect(proxy.events).toEqual([]);
      expect(relay.asked).toEqual([]);
      await vi.waitFor(async () => expect(await relay.connections()).toBe(0));
    });
  });

  it.each([
    [
      'is for a page behind TLS, which is asked for through a tunnel',
      'https://video.test/a',
    ],
    ['carries credentials in its address', 'http://user:pass@video.test/a'],
    ['is of another scheme', 'ftp://video.test/a'],
    ['names no host a tunnel could', 'http://video_test!/a'],
  ])('is refused with 400 when it %s', async (_name, url) => {
    const proxy = await new HttpProxy().start();
    const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: proxy.url });

    const answer = await plain(relay, url, grantFor(relay, proxy.url));

    expect(answer.status).toBe(400);
    expect(proxy.events).toEqual([]);
    expect(relay.asked).toEqual([]);
  });

  it('is answered 530 where its proxy cannot be reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entry = `http://user:secret@127.0.0.1:${await closedPort()}`;
    const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: entry });

    const answer = await plain(
      relay,
      'http://video.test/a',
      grantFor(relay, entry),
    );

    expect(answer.status).toBe(530);
    expect(answer.reason).toBe('Video Proxy Unreachable');
    // What is logged names the job and a code: no host, no credential.
    const logged = vi.mocked(console.warn).mock.calls.flat().join(' ');
    expect(logged).toContain('job job-1');
    expect(logged).not.toContain('secret');
    expect(logged).not.toContain('user:');
  });

  it("is given the proxy's own answer where the proxy refuses the credentials of its entry", async () => {
    const proxy = await new HttpProxy({
      username: 'user-1',
      password: 'right',
    }).start();
    const entry = proxy.urlWithAuth.replace('right', 'wrong');
    const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: entry });

    const answer = await plain(
      relay,
      'http://video.test/a',
      grantFor(relay, entry),
    );

    expect(answer.status).toBe(407);
    // What a proxy asks of its own client is not passed on to the session.
    expect(answer.headers['proxy-authenticate']).toBeUndefined();
  });

  it('takes its place among what one job may have carried at once', async () => {
    const origin = await startTcpServer(() => {});
    const proxy = await new HttpProxy().start();
    const relay = await relayWith(
      { VIDEO_INGEST_PROXY_URLS: proxy.url },
      { maxTunnelsPerJob: 1 },
    );

    const held = await tunnel(
      relay,
      `127.0.0.1:${origin.port}`,
      grantFor(relay, proxy.url),
    );
    expect(held.status).toBe(200);
    const refused = await plain(
      relay,
      `http://127.0.0.1:${origin.port}/a`,
      grantFor(relay, proxy.url),
    );

    expect(refused.status).toBe(503);
    expect(relay.asked).toEqual([]);
  });

  it('leaves what is asked of the listener itself to the application', async () => {
    const proxy = await new HttpProxy().start();
    const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: proxy.url });

    const own = await plain(relay, '/api/health?probe=1', null);
    const any = await plain(relay, '*', null, { method: 'OPTIONS' });

    expect(own.status).toBe(404);
    expect(any.status).toBe(404);
    expect(relay.asked).toEqual(['/api/health?probe=1', '*']);
  });

  it("hands the listener's requests back to the application when it is ended", async () => {
    const proxy = await new HttpProxy().start();
    const relay = await relayWith({ VIDEO_INGEST_PROXY_URLS: proxy.url });

    relay.end();
    const answer = await plain(relay, '/api/health', null);

    expect(answer.status).toBe(404);
    expect(relay.asked).toEqual(['/api/health']);
  });

  // The backend's application is a Hono app behind the node adapter, which
  // builds a request's URL from whatever target it was sent and routes on
  // its path: left to it, `GET http://anywhere/metrics` is answered with the
  // application's own `/metrics`.
  it('is taken from an application served as the backend serves its own', async () => {
    const asked: string[] = [];
    const app = new Hono();
    app.all('*', (c) => {
      asked.push(c.req.path);
      return c.text('the application');
    });
    const port = await new Promise<number>((resolve) => {
      const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
        const env = {
          ...KEY,
          SANDBOX_HTTP_API_BASE_URL: `http://127.0.0.1:${info.port}`,
        };
        const end = installVideoProxyRelay(server, { env });
        closers.push(async () => {
          end();
          await new Promise<void>((done) => server.close(() => done()));
        });
        resolve(info.port);
      });
    });
    const relay: Relay = {
      port,
      env: { ...KEY },
      asked: [],
      connections: () => Promise.resolve(0),
      end: () => {},
    };

    const own = await plain(relay, '/metrics', null);
    const other = await plain(relay, 'http://anywhere.example/metrics', null);

    expect(own.status).toBe(200);
    expect(own.body).toBe('the application');
    expect(other.status).toBe(531);
    expect(other.body).toBe('');
    expect(asked).toEqual(['/metrics']);
  });
});
