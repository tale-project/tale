// @vitest-environment node

import net from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

// The session manager's in-process proxies: real sockets, a real handshake.
import {
  closedPort,
  HttpProxy,
  selfSignedCertificate,
  Socks5Proxy,
  startOrigin,
  startTcpServer,
} from '../../../../session-manager/backend/testing/local-proxies.ts';
import {
  openProxyTunnel,
  parseVideoProxyUpstream,
  ProxyTunnelError,
  type ProxyTunnel,
  type VideoProxyUpstream,
} from './proxy_tunnel';

/**
 * A yt-dlp in a sandbox session reaches its proxy through the platform,
 * which opens the tunnel in the scheme the proxy's entry is written in
 * (tale-project/tale#4942). These dial real proxies on real sockets.
 */

const opened: net.Socket[] = [];
afterEach(() => {
  for (const socket of opened.splice(0)) socket.destroy();
});

function upstreamOf(url: string): VideoProxyUpstream {
  const upstream = parseVideoProxyUpstream(url);
  if (upstream === null) throw new Error(`no proxy URL: ${url}`);
  return upstream;
}

async function open(
  url: string,
  host: string,
  port: number,
  options: { timeoutMs?: number; signal?: AbortSignal; ca?: string } = {},
): Promise<ProxyTunnel> {
  const tunnel = await openProxyTunnel(upstreamOf(url), host, port, {
    timeoutMs: 5_000,
    ...options,
  });
  opened.push(tunnel.socket);
  return tunnel;
}

/** What a tunnel refused with, for one that must not open. */
async function refusal(attempt: Promise<unknown>): Promise<ProxyTunnelError> {
  const error = await attempt.then(
    () => new Error('the tunnel opened'),
    (caught: unknown) => caught,
  );
  if (!(error instanceof ProxyTunnelError)) throw error;
  return error;
}

/** Ask an origin for `/` through an open tunnel and answer what it said. */
function ask(tunnel: ProxyTunnel): Promise<string> {
  return new Promise((resolve, reject) => {
    let answer = tunnel.head.toString('utf8');
    tunnel.socket.on('data', (chunk: Buffer) => {
      answer += chunk.toString('utf8');
    });
    tunnel.socket.once('end', () => resolve(answer));
    tunnel.socket.once('error', reject);
    tunnel.socket.write('GET / HTTP/1.1\r\nhost: video.test\r\n\r\n');
  });
}

describe('parseVideoProxyUpstream — a proxy entry as the relay dials it', () => {
  it.each([
    [
      'http://gateway.example',
      { scheme: 'http', host: 'gateway.example', port: 80 },
    ],
    [
      'https://gateway.example',
      { scheme: 'https', host: 'gateway.example', port: 443 },
    ],
    ['socks4://203.0.113.7', { scheme: 'socks4', port: 1080 }],
    ['socks4a://gateway.example', { scheme: 'socks4a', port: 1080 }],
    ['socks5://gateway.example', { scheme: 'socks5', port: 1080 }],
    ['socks5h://gateway.example:9050', { scheme: 'socks5h', port: 9050 }],
    ['http://[2001:db8::7]:3128', { host: '2001:db8::7', port: 3128 }],
  ])('reads %s', (url, expected) => {
    expect(parseVideoProxyUpstream(url)).toMatchObject({
      ...expected,
      username: null,
      password: null,
    });
  });

  it('decodes the credentials an entry escapes', () => {
    expect(
      parseVideoProxyUpstream('socks5h://user-1:p%40ss%3Aw%2Frd@gw.example'),
    ).toMatchObject({ username: 'user-1', password: 'p@ss:w/rd' });
    // A user name alone is one with an empty password.
    expect(parseVideoProxyUpstream('http://only@gw.example')).toMatchObject({
      username: 'only',
      password: '',
    });
  });

  it.each([
    'gateway.example:3128',
    'ftp://gateway.example',
    'http://',
    'not a url',
    'http://user:%zz@gateway.example',
  ])('takes %s for no proxy', (url) => {
    expect(parseVideoProxyUpstream(url)).toBeNull();
  });
});

describe('openProxyTunnel — through an HTTP proxy', () => {
  it('opens a tunnel with the credentials of its entry, and carries bytes both ways', async () => {
    const origin = await startOrigin();
    const proxy = await new HttpProxy({
      username: 'user-1',
      password: 'p@ss:w/rd',
      hosts: { 'video.test': '127.0.0.1' },
    }).start();

    const tunnel = await open(proxy.urlWithAuth, 'video.test', origin.port);

    expect(await ask(tunnel)).toContain('hello');
    // The name reached the proxy as a name: the proxy resolves it.
    expect(
      proxy.saw('video.test', origin.port, { kind: 'CONNECT', ok: true }),
    ).toBe(true);
  });

  it('tells a proxy that refuses its credentials apart', async () => {
    const proxy = await new HttpProxy({
      username: 'user-1',
      password: 'right',
    }).start();
    const url = proxy.urlWithAuth.replace('right', 'wrong');

    const error = await refusal(open(url, 'video.test', 443));

    expect(error.kind).toBe('credentials');
    expect(error.message).toBe(
      'the video proxy refused its credentials (HTTP 407)',
    );
  });

  it("tells a proxy that would not carry this one request, with the proxy's own status", async () => {
    const proxy = await new HttpProxy().start();
    const port = await closedPort();

    const error = await refusal(open(proxy.url, '127.0.0.1', port));

    expect(error.kind).toBe('refused');
    expect(error.status).toBe(502);
  });

  it('tells a proxy that cannot be reached apart', async () => {
    const port = await closedPort();

    const error = await refusal(
      open(`http://127.0.0.1:${port}`, 'video.test', 443),
    );

    expect(error.kind).toBe('unreachable');
    expect(error.message).toBe(
      'the video proxy could not be reached (ECONNREFUSED)',
    );
  });

  it('gives up on a proxy that does not answer in time', async () => {
    // Takes the connection and says nothing.
    const silent = await startTcpServer(() => {});

    const error = await refusal(
      open(`http://127.0.0.1:${silent.port}`, 'video.test', 443, {
        timeoutMs: 80,
      }),
    );

    expect(error.kind).toBe('timeout');
  });

  it("gives up when its caller does, with the caller's reason", async () => {
    const silent = await startTcpServer(() => {});
    const caller = new AbortController();
    const attempt = open(`http://127.0.0.1:${silent.port}`, 'video.test', 443, {
      signal: caller.signal,
    });
    setTimeout(() => caller.abort(new Error('the client went away')), 30);

    await expect(attempt).rejects.toThrow('the client went away');
    await expect(
      open(`http://127.0.0.1:${silent.port}`, 'video.test', 443, {
        signal: caller.signal,
      }),
    ).rejects.toThrow('the client went away');
  });

  it('names no credential in what it says of a failure', async () => {
    const port = await closedPort();

    const error = await refusal(
      open(`http://user-1:hunter2@127.0.0.1:${port}`, 'video.test', 443),
    );

    expect(`${error.message} ${error.stack ?? ''}`).not.toContain('hunter2');
  });
});

describe('openProxyTunnel — through an HTTPS proxy', () => {
  it('speaks TLS to the proxy and verifies its certificate', async () => {
    const certificate = await selfSignedCertificate();
    const origin = await startOrigin();
    const proxy = await new HttpProxy({
      tls: certificate,
      username: 'user-1',
      password: 'secret',
      hosts: { 'video.test': '127.0.0.1' },
    }).start();
    const url = proxy.urlWithAuth;
    expect(url.startsWith('https://')).toBe(true);

    const tunnel = await open(url, 'video.test', origin.port, {
      ca: certificate.cert,
    });
    expect(await ask(tunnel)).toContain('hello');

    // A proxy whose certificate nothing vouches for is not one to tunnel
    // through.
    const untrusted = await refusal(open(url, 'video.test', origin.port));
    expect(untrusted.kind).toBe('unreachable');
  });
});

describe('openProxyTunnel — through a SOCKS proxy', () => {
  it.each(['socks5', 'socks5h'])(
    'opens a %s tunnel with a user name and password, the host by name',
    async (scheme) => {
      const origin = await startOrigin();
      const proxy = await new Socks5Proxy({
        username: 'user-1',
        password: 'p@ss:w/rd',
        hosts: { 'video.test': '127.0.0.1' },
      }).start();
      const url = proxy.urlWithAuth.replace(/^socks5h?:/, `${scheme}:`);

      const tunnel = await open(url, 'video.test', origin.port);

      expect(await ask(tunnel)).toContain('hello');
      expect(proxy.saw('video.test', origin.port, { ok: true })).toBe(true);
    },
  );

  it('opens a tunnel through a proxy that asks for no credentials', async () => {
    const origin = await startOrigin();
    const proxy = await new Socks5Proxy({
      hosts: { 'video.test': '127.0.0.1' },
    }).start();

    const tunnel = await open(proxy.url, 'video.test', origin.port);

    expect(await ask(tunnel)).toContain('hello');
  });

  it('tells a SOCKS proxy that refuses its credentials apart', async () => {
    const proxy = await new Socks5Proxy({
      username: 'user-1',
      password: 'right',
    }).start();

    const error = await refusal(
      open(proxy.urlWithAuth.replace('right', 'wrong'), 'video.test', 443),
    );

    expect(error.kind).toBe('credentials');
  });

  it('tells a SOCKS proxy that would not connect apart from one that is gone', async () => {
    const proxy = await new Socks5Proxy().start();
    const port = await closedPort();

    expect((await refusal(open(proxy.url, '127.0.0.1', port))).kind).toBe(
      'refused',
    );
    expect(
      (await refusal(open(`socks5://127.0.0.1:${port}`, 'video.test', 443)))
        .kind,
    ).toBe('unreachable');
  });

  it('refuses a host name a SOCKS request cannot carry, before it is sent', async () => {
    const proxy = await new Socks5Proxy().start();

    const error = await refusal(open(proxy.url, 'a'.repeat(256), 443));

    expect(error.kind).toBe('refused');
    expect(proxy.events).toEqual([]);
  });

  // SOCKS4a: the request carries the host as a name after a placeholder
  // address, and the reply is eight bytes.
  it.each(['socks4', 'socks4a'])(
    'opens a %s tunnel, the host by name and the user as its id',
    async (scheme) => {
      const origin = await startOrigin();
      const requests: { user: string; host: string; port: number }[] = [];
      const proxy = await startTcpServer((client) => {
        let buffered = Buffer.alloc(0);
        const onData = (chunk: Buffer): void => {
          buffered = Buffer.concat([buffered, chunk]);
          // VN CD DSTPORT(2) DSTIP(4) USERID NUL HOST NUL
          const userEnd = buffered.indexOf(0, 8);
          const hostEnd = userEnd < 0 ? -1 : buffered.indexOf(0, userEnd + 1);
          if (hostEnd < 0) return;
          client.off('data', onData);
          requests.push({
            user: buffered.subarray(8, userEnd).toString('utf8'),
            host: buffered.subarray(userEnd + 1, hostEnd).toString('utf8'),
            port: buffered.readUInt16BE(2),
          });
          const target = net.connect(origin.port, '127.0.0.1', () => {
            client.write(Buffer.from([0, 0x5a, 0, 0, 0, 0, 0, 0]));
            client.pipe(target);
            target.pipe(client);
          });
          target.on('error', () => client.destroy());
          client.on('error', () => target.destroy());
        };
        client.on('data', onData);
      });

      const tunnel = await open(
        `${scheme}://user-1@127.0.0.1:${proxy.port}`,
        'video.test',
        origin.port,
      );

      expect(await ask(tunnel)).toContain('hello');
      expect(requests).toEqual([
        { user: 'user-1', host: 'video.test', port: origin.port },
      ]);
    },
  );
});
