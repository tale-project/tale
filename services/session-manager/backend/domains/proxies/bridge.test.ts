import net from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { eventually } from '../../testing/eventually.ts';
import {
  HttpProxy,
  Socks5Proxy,
  SocketReader,
  closedPort,
  connectThrough,
  rawHttp,
  readAll,
  selfSignedCertificate,
  startOrigin,
  startTcpServer,
} from '../../testing/local-proxies.ts';
import type { RawResponse } from '../../testing/local-proxies.ts';
import { HEAD_TIMEOUT_MS, ProxyBridge } from './bridge.ts';
import type { ProxyBridgeOptions } from './bridge.ts';
import { parseProxy } from './parsing.ts';
import type { ProxyConfig } from './types.ts';

const HOSTS = { 'site.test': '127.0.0.1' }; // the upstream proxies route this fake name to the local origin
const CRLF2 = Buffer.from('\r\n\r\n');

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function started<T extends HttpProxy | Socks5Proxy>(
  proxy: T,
): Promise<T> {
  cleanups.push(() => proxy.stop());
  await proxy.start();
  return proxy;
}

/** The bridge, with its log collected instead of printed. */
async function bridgeTo(
  upstream: ProxyConfig | string,
  options: ProxyBridgeOptions = {},
): Promise<ProxyBridge & { lines: string[] }> {
  const lines: string[] = [];
  const config = typeof upstream === 'string' ? parseProxy(upstream) : upstream;
  const bridge = await ProxyBridge.start(config, {
    log: (line) => lines.push(line),
    ...options,
  });
  cleanups.push(() => bridge.close());
  return Object.assign(bridge, { lines });
}

/** An origin server (see `startOrigin`), stopped after the test. */
async function origin(respond?: (head: string, socket: net.Socket) => void) {
  const server = await startOrigin(respond);
  cleanups.push(() => server.stop());
  return server;
}

/** A plain-HTTP request through the bridge, as a browser sends it. */
function through(
  bridge: ProxyBridge,
  url: string,
  extraHeaders: string[] = [],
  method = 'GET',
  body = '',
): Promise<RawResponse> {
  const host = new URL(url).host;
  const length =
    body === '' ? [] : [`Content-Length: ${Buffer.byteLength(body)}`];
  return rawHttp(
    bridge.port,
    `${method} ${url} HTTP/1.1\r\nHost: ${host}\r\n${[...extraHeaders, ...length].map((h) => `${h}\r\n`).join('')}\r\n${body}`,
  );
}

/** Open a CONNECT tunnel through the bridge. */
function connect(bridge: ProxyBridge, target: string) {
  return connectThrough(bridge.port, target, ['User-Agent: test']);
}

async function getThroughTunnel(
  bridge: ProxyBridge,
  target: string,
): Promise<string> {
  const { socket, head, reader } = await connect(bridge, target);
  expect(head.startsWith('HTTP/1.1 200 ')).toBe(true);
  socket.write('GET / HTTP/1.1\r\nHost: site.test\r\n\r\n');
  const response = (await reader.readToEnd()).toString();
  socket.destroy();
  return response;
}

/** The status line of what the bridge answers to a CONNECT, and the error page. */
async function statusOfConnect(
  bridge: ProxyBridge,
  target: string,
): Promise<string> {
  const { socket, head, reader } = await connect(bridge, target);
  const body = (await reader.readToEnd()).toString();
  socket.destroy();
  return `${head.split('\r\n', 1)[0]} | ${body}`;
}

describe('an HTTP upstream', () => {
  it('gets the credentials for CONNECT and plain http', async () => {
    const site = await origin();
    const upstream = await started(
      new HttpProxy({ username: 'alice', password: 'p:w@d#', hosts: HOSTS }),
    );
    const bridge = await bridgeTo(
      `http://alice:p%3Aw%40d%23@127.0.0.1:${upstream.port}`,
    );
    expect(bridge.playwrightProxy).toEqual({
      server: `http://127.0.0.1:${bridge.port}`,
    }); // no credentials

    // The browser's own Proxy-Authorization (if any) is replaced, never forwarded.
    const response = await through(
      bridge,
      `http://site.test:${site.port}/x?y=1`,
      [
        `Proxy-Authorization: Basic ${Buffer.from('intruder:x').toString('base64')}`,
      ],
    );
    expect([response.status, response.body]).toEqual([200, 'hello']);
    expect(response.headers.connection).toBe('close'); // one request per bridge connection
    expect(await getThroughTunnel(bridge, `site.test:${site.port}`)).toMatch(
      /hello$/,
    );

    expect(
      upstream.events.map((e) => [e.kind, e.target, e.username, e.status]),
    ).toEqual([
      ['HTTP', `http://site.test:${site.port}/x?y=1`, 'alice', 200],
      ['CONNECT', `site.test:${site.port}`, 'alice', 200],
    ]);
    expect(site.heads[0]).toBe(
      `GET /x?y=1 HTTP/1.1\r\nHost: site.test:${site.port}\r\nConnection: close\r\n\r\n`,
    );
  });

  it('sends the upstream the browser end-to-end headers, not the hop-by-hop ones', async () => {
    const site = await origin();
    const upstream = await started(new HttpProxy({ hosts: HOSTS }));
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    const response = await through(bridge, `http://site.test:${site.port}/`, [
      'User-Agent: test-agent',
      'Connection: keep-alive, X-Secret',
      'X-Secret: hidden',
      'Keep-Alive: timeout=5',
      'Proxy-Connection: keep-alive',
      'X-Kept: yes',
    ]);
    expect(response.status).toBe(200);
    expect(site.heads[0]).toBe(
      `GET / HTTP/1.1\r\nHost: site.test:${site.port}\r\nUser-Agent: test-agent\r\nX-Kept: yes\r\nConnection: close\r\n\r\n`,
    );
  });

  it('forwards a request body and streams a chunked answer', async () => {
    const received: string[] = [];
    const sink = await startTcpServer((socket) => {
      let data = '';
      socket.on('data', (chunk) => {
        data += chunk.toString('latin1');
        if (data.endsWith('payload-bytes')) {
          received.push(data);
          socket.write(
            'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n',
          );
          socket.write('5\r\nhello\r\n');
          setTimeout(() => socket.end('6\r\n world\r\n0\r\n\r\n'), 20);
        }
      });
    });
    cleanups.push(() => sink.stop());
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    const response = await through(
      bridge,
      `http://127.0.0.1:${sink.port}/up`,
      [],
      'POST',
      'payload-bytes',
    );
    expect(response.status).toBe(200);
    expect(response.headers['transfer-encoding']).toBe('chunked');
    expect(response.body).toBe('5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n');
    expect(received[0]).toContain('POST /up HTTP/1.1');
    expect(received[0]?.endsWith('\r\n\r\npayload-bytes')).toBe(true);
  });

  it('passes interim responses on and drops the hop-by-hop headers of the answer', async () => {
    const site = await origin((_head, socket) => {
      socket.write('HTTP/1.1 100 Continue\r\n\r\n');
      socket.end(
        'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nKeep-Alive: timeout=5\r\nProxy-Authenticate: Basic\r\nX-Kept: 1\r\nConnection: keep-alive\r\n\r\nok',
      );
    });
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    const response = await through(bridge, `http://127.0.0.1:${site.port}/`);
    expect(response.raw).toBe(
      'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 2\r\nX-Kept: 1\r\nConnection: close\r\n\r\nok',
    );
  });

  it('turns a 407 from the origin into an error page that cannot ask for credentials', async () => {
    const site = await origin((_head, socket) => {
      socket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\nContent-Length: 0\r\n\r\n',
      );
    });
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    const response = await through(bridge, `http://127.0.0.1:${site.port}/`);
    expect(response.status).toBe(502);
    expect(response.body).toContain(
      'the upstream proxy rejected the credentials (HTTP 407)',
    );
    expect(response.headers['proxy-authenticate']).toBeUndefined();
  });

  it('answers 502 when the upstream sends something that is not a response', async () => {
    const site = await origin((_head, socket) =>
      socket.end('nonsense\r\n\r\n'),
    );
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    const response = await through(bridge, `http://127.0.0.1:${site.port}/`);
    expect(response.status).toBe(502);
    expect(response.body).toContain(
      'the upstream closed the connection or sent an invalid response',
    );

    const silent = await origin((_head, socket) => socket.end());
    const closed = await through(bridge, `http://127.0.0.1:${silent.port}/`);
    expect(closed.status).toBe(502);
    expect(closed.body).toContain('closed the connection');
  });

  it('answers 502 when the response head is larger than a head can be', async () => {
    const site = await origin((_head, socket) => {
      socket.end(`HTTP/1.1 200 OK\r\nX-Big: ${'a'.repeat(300_000)}\r\n\r\n`);
    });
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    const response = await through(bridge, `http://127.0.0.1:${site.port}/`);
    expect(response.status).toBe(502);
  });
});

describe('an HTTPS upstream', () => {
  it('is reached over verified TLS', async () => {
    const certificate = await selfSignedCertificate();
    const site = await origin();
    const upstream = await started(
      new HttpProxy({
        username: 'tls',
        password: 'pw',
        hosts: HOSTS,
        tls: certificate,
      }),
    );
    const config = parseProxy(`https://tls:pw@127.0.0.1:${upstream.port}`);

    const bridge = await bridgeTo(config, { ca: certificate.cert });
    const response = await through(bridge, `http://site.test:${site.port}/`);
    expect([response.status, response.body]).toEqual([200, 'hello']);
    expect(await getThroughTunnel(bridge, `site.test:${site.port}`)).toMatch(
      /hello$/,
    );
    expect(
      new Set(
        upstream.events.map((e) => [e.kind, e.username, e.status].join(' ')),
      ),
    ).toEqual(new Set(['HTTP tls 200', 'CONNECT tls 200']));

    // The default trust store does not hold a self-signed certificate.
    const untrusting = await bridgeTo(config);
    const status = await statusOfConnect(untrusting, `site.test:${site.port}`);
    expect(status.startsWith('HTTP/1.1 502 Bad Gateway | ')).toBe(true);
    expect(status).toContain('TLS connection to the upstream proxy failed');
    expect(untrusting.lines[0]).toContain(
      'TLS connection to the upstream proxy failed',
    );
  });

  it('is refused when the certificate is for another name', async () => {
    const certificate = await selfSignedCertificate({ dns: ['proxy.example'] });
    const upstream = await started(new HttpProxy({ tls: certificate }));
    const bridge = await bridgeTo(`https://127.0.0.1:${upstream.port}`, {
      ca: certificate.cert,
    });
    const status = await statusOfConnect(bridge, 'site.test:443');
    expect(status).toContain('502 Bad Gateway');
    expect(status).toContain('TLS connection to the upstream proxy failed');
  });
});

describe('a SOCKS5 upstream', () => {
  it('gets the credentials, and resolves names itself', async () => {
    const site = await origin();
    const socks = await started(
      new Socks5Proxy({ username: 'su', password: 's:p@w', hosts: HOSTS }),
    );
    const bridge = await bridgeTo(
      `socks5://su:s%3Ap%40w@127.0.0.1:${socks.port}`,
    );

    const response = await through(bridge, `http://site.test:${site.port}/x`);
    expect([response.status, response.body]).toEqual([200, 'hello']);
    expect(await getThroughTunnel(bridge, `site.test:${site.port}`)).toMatch(
      /hello$/,
    );
    expect(
      socks.events.map((e) => [e.host, e.addrType, e.username, e.ok]),
    ).toEqual([
      ['site.test', 'domain', 'su', true],
      ['site.test', 'domain', 'su', true],
    ]);
    // The origin server at the end of the tunnel gets an origin-form request.
    expect(site.heads[0]).toBe(
      `GET /x HTTP/1.1\r\nHost: site.test:${site.port}\r\nConnection: close\r\n\r\n`,
    );
  });

  it('hands over IP literals as addresses, IPv6 ones too', async () => {
    const socks = await started(new Socks5Proxy());
    const bridge = await bridgeTo(`socks5://127.0.0.1:${socks.port}`);
    await statusOfConnect(bridge, '[::1]:9');
    const { socket } = await connect(bridge, '127.0.0.1:9');
    socket.destroy();
    expect(socks.events.map((e) => [e.host, e.addrType])).toEqual([
      ['0:0:0:0:0:0:0:1', 'ipv6'],
      ['127.0.0.1', 'ipv4'],
    ]);
  });

  it('says why the SOCKS5 proxy could not connect', async () => {
    const closed = await closedPort();
    const socks = await started(new Socks5Proxy({ hosts: HOSTS }));
    const bridge = await bridgeTo(`socks5://127.0.0.1:${socks.port}`);
    expect(await statusOfConnect(bridge, `site.test:${closed}`)).toBe(
      `HTTP/1.1 502 Bad Gateway | 502 Bad Gateway: the upstream proxy could not connect to site.test:${closed}: connection refused\n`,
    );
  });

  it('answers a TTL that expired as a gateway timeout', async () => {
    const script = await startTcpServer(async (socket) => {
      const reader = new SocketReader(socket);
      await reader.readExactly(3); // 05 01 00
      socket.write(Buffer.from([5, 0]));
      const header = await reader.readExactly(5); // VER CMD RSV ATYP LEN
      await reader.readExactly((header[4] ?? 0) + 2);
      socket.write(Buffer.from([5, 6, 0, 1, 0, 0, 0, 0, 0, 0]));
      socket.end();
    });
    cleanups.push(() => script.stop());
    const bridge = await bridgeTo(`socks5://127.0.0.1:${script.port}`);
    expect(
      (await statusOfConnect(bridge, 'site.test:443')).startsWith(
        'HTTP/1.1 504 Gateway Timeout | ',
      ),
    ).toBe(true);
  });
});

describe.each(['http', 'socks5'] as const)(
  'a %s upstream with the wrong credentials',
  (scheme) => {
    it('gives the browser a 502 with the reason, for CONNECT and plain http', async () => {
      const upstream = await started(
        scheme === 'http'
          ? new HttpProxy({ username: 'u', password: 'right' })
          : new Socks5Proxy({ username: 'u', password: 'right' }),
      );
      const bridge = await bridgeTo(
        `${scheme}://u:WRONG-hunter2@127.0.0.1:${upstream.port}`,
      );

      const status = await statusOfConnect(bridge, 'example.test:443');
      expect(status.startsWith('HTTP/1.1 502 Bad Gateway | ')).toBe(true);
      expect(status).toContain('the upstream proxy rejected the credentials');

      const response = await through(bridge, 'http://example.test/');
      expect(response.status).toBe(502);
      expect(response.body).toContain('rejected the credentials');
      expect(response.headers['proxy-authenticate']).toBeUndefined();

      // Nothing the browser or the log gets contains the password.
      for (const text of [status, response.raw, ...bridge.lines]) {
        expect(text).not.toContain('hunter2');
        expect(text).not.toContain('WRONG');
      }
      expect(bridge.lines).toHaveLength(2);
      expect(bridge.lines[0]).toContain(
        `via ${scheme}://u@127.0.0.1:${upstream.port}`,
      );
    });
  },
);

describe('an upstream that cannot be used', () => {
  it('gives 502 when it refuses and 504 when it does not answer', async () => {
    const port = await closedPort();
    const refusing = await bridgeTo(`http://u:p@127.0.0.1:${port}`);
    const status = await statusOfConnect(refusing, 'example.test:443');
    expect(status.startsWith('HTTP/1.1 502 Bad Gateway | ')).toBe(true);
    expect(status).toContain('refused the connection');

    const silent = await startTcpServer(() => undefined); // accepts, never answers
    cleanups.push(() => silent.stop());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${silent.port}`, {
      connectTimeoutMs: 300,
    });
    const waited = Date.now();
    const timedOut = await statusOfConnect(bridge, 'example.test:443');
    expect(timedOut.startsWith('HTTP/1.1 504 Gateway Timeout | ')).toBe(true);
    expect(timedOut).toContain('did not answer in time');
    expect(Date.now() - waited).toBeLessThan(3000);
  }, 15_000);

  it('passes the error status of a refused tunnel on', async () => {
    const closed = await closedPort(); // the upstream proxy cannot reach it
    const upstream = await started(
      new HttpProxy({ username: 'u', password: 'p', hosts: HOSTS }),
    );
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    const status = await statusOfConnect(bridge, `site.test:${closed}`);
    expect(status.startsWith('HTTP/1.1 502 Bad Gateway | ')).toBe(true);
    expect(status).toContain('refused the tunnel: 502');

    const forbidding = await startTcpServer((socket) => {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
    });
    cleanups.push(() => forbidding.stop());
    const strict = await bridgeTo(`http://127.0.0.1:${forbidding.port}`);
    const forbidden = await statusOfConnect(strict, 'example.test:443');
    expect(forbidden.startsWith('HTTP/1.1 403 Forbidden | ')).toBe(true);
    expect(forbidden).toContain('refused the tunnel: 403 Forbidden');

    const weird = await startTcpServer((socket) => {
      socket.end(
        'HTTP/1.1 302 Found\r\nLocation: /\r\nContent-Length: 0\r\n\r\n',
      );
    });
    cleanups.push(() => weird.stop());
    const redirecting = await bridgeTo(`http://127.0.0.1:${weird.port}`);
    expect(
      (await statusOfConnect(redirecting, 'example.test:443')).startsWith(
        'HTTP/1.1 502 ',
      ),
    ).toBe(true);
  });

  it('answers 502 when the upstream is not a proxy at all', async () => {
    const mute = await startTcpServer((socket) => socket.end());
    cleanups.push(() => mute.stop());
    const bridge = await bridgeTo(`http://127.0.0.1:${mute.port}`);
    expect(await statusOfConnect(bridge, 'example.test:443')).toContain(
      'the upstream proxy closed the connection or sent an invalid answer',
    );
  });
});

describe('the bridge', () => {
  it('logs the requests the upstream did not carry with console.info, unless told otherwise', async () => {
    const port = await closedPort();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const bridge = await ProxyBridge.start(
      parseProxy(`http://u:hunter2@127.0.0.1:${port}`),
    );
    cleanups.push(() => bridge.close());
    await statusOfConnect(bridge, 'example.test:443');
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]?.[0]);
    // What the browser asked for is where a person browses: not in the log.
    expect(line).toBe(
      `proxy bridge: CONNECT via http://u@127.0.0.1:${port} failed: the upstream proxy refused the connection`,
    );
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('example.test');
  });

  it('says where the failed request was going to whoever asks for the debug lines, and no one else', async () => {
    const port = await closedPort();
    const debug = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => undefined);
    vi.stubEnv('DEBUG', '');
    const bridge = await bridgeTo(`http://u:hunter2@127.0.0.1:${port}`);
    await statusOfConnect(bridge, 'quiet.example:443');
    expect(JSON.stringify(debug.mock.calls)).not.toContain('quiet.example');

    vi.stubEnv('DEBUG', 'session-manager');
    await statusOfConnect(bridge, 'asked.example:443');
    const lines = debug.mock.calls.map((call) => String(call[0]));
    expect(lines).toContainEqual(
      `[proxies] CONNECT asked.example:443 via http://u@127.0.0.1:${port} failed: the upstream proxy refused the connection`,
    );
    expect(lines.join('\n')).not.toContain('hunter2');
  });

  it('does not say where the failed request was going in the line of a plain HTTP request either', async () => {
    const port = await closedPort();
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${port}`);
    await through(bridge, 'http://secret-site.example/private?token=1');
    expect(bridge.lines).toHaveLength(1);
    expect(bridge.lines.join('\n')).not.toContain('secret-site');
    expect(bridge.lines.join('\n')).not.toContain('token');
  });

  it('sends an origin server behind SOCKS5 a request line it can read', async () => {
    const site = await origin();
    const socks = await started(new Socks5Proxy({ hosts: HOSTS }));
    const bridge = await bridgeTo(`socks5://127.0.0.1:${socks.port}`);
    await through(bridge, `http://site.test:${site.port}`); // no path at all
    await through(bridge, `http://site.test:${site.port}?q=1#fragment`);
    await through(bridge, `http://user:pw@SITE.test:${site.port}/a/b?c=d%20e`);
    expect(site.heads.map((head) => head.split('\r\n', 1)[0])).toEqual([
      'GET / HTTP/1.1',
      'GET /?q=1 HTTP/1.1',
      'GET /a/b?c=d%20e HTTP/1.1',
    ]);
    expect(socks.events.map((e) => e.host)).toEqual([
      'site.test',
      'site.test',
      'site.test',
    ]);
  });

  it('reads an IPv6 address in an absolute-form request', async () => {
    const closed = await closedPort();
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    await through(bridge, `http://[::1]:${closed}/x`);
    expect(upstream.events[0]).toMatchObject({
      kind: 'HTTP',
      host: '::1',
      port: closed,
    });
  });

  it('lets go of both sides when one of them is reset', async () => {
    const server = await startTcpServer((socket) => {
      socket.write('hello');
      setTimeout(() => socket.resetAndDestroy(), 50);
    });
    cleanups.push(() => server.stop());
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    const { socket, reader } = await connect(
      bridge,
      `127.0.0.1:${server.port}`,
    );
    expect((await reader.readExactly(5)).toString()).toBe('hello');
    await new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await eventually(() => upstream.connections === 0);
  });

  it('passes the end of a request on as a half-close, and drops the upstream when the browser resets', async () => {
    const waiting = new Set<net.Socket>();
    const finished = new Set<net.Socket>(); // the bridge stopped sending: it ended or closed its side
    const silent = await origin((_head, socket) => {
      waiting.add(socket);
      socket.on('end', () => finished.add(socket));
      socket.on('close', () => finished.add(socket));
    });
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    const request = `GET http://127.0.0.1:${silent.port}/ HTTP/1.1\r\nHost: x\r\n\r\n`;

    // A browser that has sent its request and finished sending may still be waiting for the answer:
    // the origin hears the end of the request, and the connection stays open for the answer.
    const done = net.connect({ host: '127.0.0.1', port: bridge.port });
    await new Promise<void>((resolve) => done.once('connect', resolve));
    done.end(request);
    await eventually(() => finished.size === 1);
    const [first] = [...waiting];
    expect(first?.destroyed).toBe(false);
    done.destroy();

    // One that resets the connection is gone.
    const gone = net.connect({ host: '127.0.0.1', port: bridge.port });
    await new Promise<void>((resolve) => gone.once('connect', resolve));
    gone.write(request);
    await eventually(() => waiting.size === 2);
    expect(finished.size).toBe(1);
    gone.resetAndDestroy();
    await eventually(() => finished.size === 2);
    expect(bridge.lines).toEqual([]);
  });
});

describe('the head of a request', () => {
  /** A client that connects to the bridge and sends `first`, then nothing. */
  async function connectAnd(bridge: ProxyBridge, first = '') {
    const socket = net.connect({ host: '127.0.0.1', port: bridge.port });
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.on('error', () => undefined);
    if (first !== '') socket.write(first);
    return socket;
  }

  const closed = (socket: net.Socket) =>
    new Promise<void>((resolve) => socket.once('close', () => resolve()));

  it('is waited for 30 seconds by default', () => {
    expect(HEAD_TIMEOUT_MS).toBe(30_000);
  });

  it('is waited for only so long: a client that connects and says nothing is let go of', async () => {
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`, {
      headTimeoutMs: 50,
    });
    const silent = await connectAnd(bridge);
    await closed(silent);
    expect(upstream.events).toEqual([]);
    expect(bridge.lines).toEqual([]);
  });

  it('is waited for only so long when half of it came', async () => {
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`, {
      headTimeoutMs: 50,
    });
    const slow = await connectAnd(
      bridge,
      'CONNECT site.test:443 HTTP/1.1\r\nHost: site.test:443\r\n', // no blank line
    );
    await closed(slow);
    expect(upstream.events).toEqual([]);
  });

  it('leaves no connection behind', async () => {
    const bridge = await bridgeTo('http://u:p@127.0.0.1:1', {
      headTimeoutMs: 20,
    });
    const sockets = await Promise.all(
      Array.from({ length: 20 }, () => connectAnd(bridge)),
    );
    await Promise.all(sockets.map(closed));
  });

  it('is not an idle timeout: a tunnel lives on long after, and so does a request that was answered', async () => {
    const site = await startTcpServer((socket) => {
      socket.on('data', (chunk) => socket.write(chunk)); // echo
    });
    cleanups.push(() => site.stop());
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`, {
      headTimeoutMs: 50,
    });
    const { socket, head, reader } = await connect(
      bridge,
      `127.0.0.1:${site.port}`,
    );
    expect(head.startsWith('HTTP/1.1 200 ')).toBe(true);
    // Well past the time the head had.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(socket.destroyed).toBe(false);
    socket.write('still here');
    expect((await reader.readExactly(10)).toString()).toBe('still here');
    socket.destroy();
  });
});

describe('what is not a proxy request', () => {
  it('is refused with 400 and never reaches the upstream', async () => {
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    for (const request of [
      'GET /relative HTTP/1.1\r\n\r\n',
      'GET https://site.test/ HTTP/1.1\r\n\r\n',
      'GET ftp://site.test/ HTTP/1.1\r\n\r\n',
      'GET http://site.test:99999/ HTTP/1.1\r\n\r\n',
      'GET http://site.test:abc/ HTTP/1.1\r\n\r\n',
      'GET http://:80/ HTTP/1.1\r\n\r\n',
      'GET http://[::1/ HTTP/1.1\r\n\r\n',
      'GET http://site.test/ HTTP/1.1 extra\r\n\r\n',
      'GET http://site.test/\r\n\r\n',
      'GET http://site.test/ SPDY/3\r\n\r\n',
      'CONNECT site.test HTTP/1.1\r\n\r\n',
      'CONNECT site.test:abc HTTP/1.1\r\n\r\n',
      'CONNECT site.test:0 HTTP/1.1\r\n\r\n',
      'CONNECT site.test:70000 HTTP/1.1\r\n\r\n',
      'CONNECT :443 HTTP/1.1\r\n\r\n',
      'GET http://site.test/ HTTP/1.1\r\nX-Bad: a\rb\r\n\r\n',
    ]) {
      const response = await rawHttp(bridge.port, request);
      expect([request, response.status]).toEqual([request, 400]);
      expect(response.body).toBe('400 Bad Request: malformed proxy request\n');
    }
    expect(upstream.events).toEqual([]);
  });

  it('is dropped without an answer when it never ends or comes to nothing', async () => {
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    // A head larger than a head can be.
    const big = net.connect({ host: '127.0.0.1', port: bridge.port });
    await new Promise<void>((resolve) => big.once('connect', resolve));
    big.on('error', () => undefined); // the bridge may reset the connection
    big.write(`GET http://site.test/ HTTP/1.1\r\nX: ${'a'.repeat(300_000)}`);
    const answered: Buffer[] = [];
    big.on('data', (chunk) => answered.push(chunk));
    await new Promise<void>((resolve) => big.once('close', () => resolve()));
    expect(Buffer.concat(answered).length).toBe(0);
    // A connection that closes without a request.
    const socket = net.connect({ host: '127.0.0.1', port: bridge.port });
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.end();
    expect((await readAll(socket)).length).toBe(0);
    expect(upstream.events).toEqual([]);
  });
});

describe('tunnels', () => {
  it('relay what the other side says first, and big transfers', async () => {
    const payload = Buffer.alloc(3_000_000, 'abcdefghij');
    const server = await startTcpServer((socket) => {
      socket.write('BANNER\n');
      const received: Buffer[] = [];
      socket.on('data', (chunk) => received.push(chunk));
      socket.once('end', () => socket.end(payload));
    });
    cleanups.push(() => server.stop());
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    const { socket, head, reader } = await connect(
      bridge,
      `127.0.0.1:${server.port}`,
    );
    expect(head).toBe('HTTP/1.1 200 Connection Established\r\n\r\n');
    expect((await reader.readExactly(7)).toString()).toBe('BANNER\n');
    socket.write('request');
    socket.end(); // a half-close: the answer is still to come
    const rest = await reader.readToEnd(15_000);
    expect(rest.equals(payload)).toBe(true);
    socket.destroy();
  });

  it('send all of a big answer to browsers that half-closed and read slowly', async () => {
    // The upstream is its own origin and ends cleanly: what a browser misses, the
    // bridge lost.
    const payload = Buffer.alloc(3_000_000, 'abcdefghij');
    const upstream = await startTcpServer(async (socket) => {
      const reader = new SocketReader(socket);
      await reader.readUntil(CRLF2);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      await reader.readToEnd();
      socket.end(payload);
    });
    cleanups.push(() => upstream.stop());
    const bridge = await bridgeTo(`http://127.0.0.1:${upstream.port}`);
    // One at a time, each pausing after every chunk it reads: the bridge then
    // still holds the end of the answer when the upstream is done with it.
    const whole: boolean[] = [];
    for (let i = 0; i < 6; i += 1) {
      const { socket, reader } = await connect(bridge, 'site.test:443');
      socket.end('request'); // a half-close: the answer is still to come
      const answer = Buffer.concat([
        reader.release(),
        await readAll(socket, 5000, 20),
      ]);
      socket.destroy();
      whole.push(answer.equals(payload));
    }
    expect(whole).toEqual([true, true, true, true, true, true]);
  });

  it('serve many connections at once', async () => {
    const echo = await startTcpServer((socket) => socket.pipe(socket));
    cleanups.push(() => echo.stop());
    const socks = await started(
      new Socks5Proxy({ username: 'u', password: 'p' }),
    );
    const bridge = await bridgeTo(`socks5://u:p@127.0.0.1:${socks.port}`);
    const results = await Promise.all(
      Array.from({ length: 25 }, async (_, i) => {
        const { socket, head, reader } = await connect(
          bridge,
          `127.0.0.1:${echo.port}`,
        );
        socket.write(`message ${i}`);
        const echoed = (
          await reader.readExactly(`message ${i}`.length)
        ).toString();
        socket.destroy();
        return [head.startsWith('HTTP/1.1 200 '), echoed];
      }),
    );
    expect(results).toEqual(
      Array.from({ length: 25 }, (_, i) => [true, `message ${i}`]),
    );
  });

  it('relay bytes the browser sends right behind the CONNECT head', async () => {
    const echo = await startTcpServer((socket) => socket.pipe(socket));
    cleanups.push(() => echo.stop());
    const upstream = await started(new HttpProxy());
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    const socket = net.connect({ host: '127.0.0.1', port: bridge.port });
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\n\r\npipelined`);
    const reader = new SocketReader(socket);
    await reader.readUntil(CRLF2);
    expect((await reader.readExactly(9)).toString()).toBe('pipelined');
    socket.destroy();
  });

  it('are closed when the bridge closes, and the port with them', async () => {
    const echo = await startTcpServer(() => undefined);
    cleanups.push(() => echo.stop());
    const upstream = await started(new HttpProxy());
    const bridge = await ProxyBridge.start(
      parseProxy(`http://u:p@127.0.0.1:${upstream.port}`),
    );
    const { socket, head, reader } = await connect(
      bridge,
      `127.0.0.1:${echo.port}`,
    );
    expect(head.startsWith('HTTP/1.1 200 ')).toBe(true);
    await bridge.close();
    expect((await reader.readToEnd()).length).toBe(0);
    socket.destroy();
    await expect(
      rawHttp(bridge.port, 'GET http://x/ HTTP/1.1\r\n\r\n'),
    ).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
    await bridge.close(); // and again
  });
});

describe('closing', () => {
  it('stops a connection that is still being made, and the browser behind it', async () => {
    let accepted = 0;
    const silent = await startTcpServer(() => {
      accepted += 1;
    });
    cleanups.push(() => silent.stop());
    const bridge = await ProxyBridge.start(
      parseProxy(`http://u:p@127.0.0.1:${silent.port}`),
      {
        connectTimeoutMs: 60_000,
      },
    );
    const pending = connect(bridge, 'example.test:443').catch(
      (error: unknown) => error,
    );
    // The bridge has connected to the upstream, which never answers its CONNECT.
    await eventually(() => accepted === 1);
    const waited = Date.now();
    await bridge.close();
    expect(Date.now() - waited).toBeLessThan(2000);
    const outcome = await pending;
    expect(outcome instanceof Error).toBe(true);
  });

  it('does not start for a scheme it cannot speak', async () => {
    const odd = {
      scheme: 'ftp',
      host: '127.0.0.1',
      port: 21,
      username: null,
      password: null,
    };
    // @ts-expect-error a scheme the type does not allow, as bad data from outside could carry
    await expect(ProxyBridge.start(odd)).rejects.toThrow(
      "unsupported upstream proxy scheme 'ftp'",
    );
  });
});

describe('a real HTTP client', () => {
  it('can use the bridge as its proxy', async () => {
    const site = await origin((_head, socket) => {
      socket.end(
        'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 11\r\nConnection: close\r\n\r\nhello world',
      );
    });
    const upstream = await started(
      new HttpProxy({ username: 'u', password: 'p', hosts: HOSTS }),
    );
    const bridge = await bridgeTo(`http://u:p@127.0.0.1:${upstream.port}`);
    const response = await fetch(`http://site.test:${site.port}/real`, {
      proxy: bridge.playwrightProxy.server,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello world');
    expect(upstream.events[0]).toMatchObject({
      kind: 'HTTP',
      username: 'u',
      status: 200,
    });
  });
});
