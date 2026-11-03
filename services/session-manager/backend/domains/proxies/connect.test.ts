import type net from 'node:net';

import { SocksClientError } from 'socks';
import { afterEach, describe, expect, it } from 'vitest';

import {
  HttpProxy,
  Socks5Proxy,
  SocketReader,
  closedPort,
  selfSignedCertificate,
  startOrigin,
  startTcpServer,
} from '../../testing/local-proxies.ts';
import {
  UpstreamError,
  connectFailure,
  openTunnel,
  openUpstream,
  proxyAuthorization,
  tunnelFailure,
} from './connect.ts';
import type { UpstreamErrorKind } from './connect.ts';
import { HeadError } from './http-head.ts';
import { parseProxy } from './parsing.ts';

const HOSTS = { 'site.test': '127.0.0.1' };
const CRLF2 = Buffer.from('\r\n\r\n');

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function started<T extends HttpProxy | Socks5Proxy>(
  proxy: T,
): Promise<T> {
  cleanups.push(() => proxy.stop());
  await proxy.start();
  return proxy;
}

/** A TCP echo server, stopped after the test. */
async function echo() {
  const server = await startTcpServer((socket) => socket.pipe(socket));
  cleanups.push(() => server.stop());
  return server;
}

/** The sockets a test opens are destroyed after it. */
function owned(socket: net.Socket): net.Socket {
  cleanups.push(async () => {
    socket.destroy();
  });
  return socket;
}

/** What the tunnel carries once you resume it. */
async function read(socket: net.Socket, length: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  return await new Promise((resolve) => {
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= length) resolve(Buffer.concat(chunks).toString());
    });
    socket.resume();
  });
}

async function refusal(attempt: Promise<net.Socket>): Promise<UpstreamError> {
  try {
    owned(await attempt);
  } catch (error) {
    if (error instanceof UpstreamError) return error;
    throw error;
  }
  throw new Error('the tunnel was opened');
}

function shape(error: UpstreamError): [UpstreamErrorKind, number, string] {
  return [error.kind, error.status, error.message];
}

describe('proxyAuthorization', () => {
  it('is Basic with the credentials, for http and https proxies only', () => {
    const header = proxyAuthorization(
      parseProxy('http://us%C3%A9r:p%3Aw@1.2.3.4:80'),
    );
    expect(header).toBe(
      `Proxy-Authorization: Basic ${Buffer.from('usér:p:w').toString('base64')}`,
    );
    expect(proxyAuthorization(parseProxy('https://u:p@1.2.3.4:443'))).toMatch(
      /^Proxy-Authorization: Basic /,
    );
    expect(proxyAuthorization(parseProxy('http://u@1.2.3.4:80'))).toBe(
      `Proxy-Authorization: Basic ${Buffer.from('u:').toString('base64')}`,
    );
    expect(proxyAuthorization(parseProxy('http://1.2.3.4:80'))).toBeNull();
    expect(
      proxyAuthorization(parseProxy('socks5://u:p@1.2.3.4:1080')),
    ).toBeNull();
  });
});

describe('openTunnel through an HTTP proxy', () => {
  it('opens a tunnel that carries bytes both ways, sending the credentials', async () => {
    const target = await echo();
    const proxy = await started(
      new HttpProxy({ username: 'alice', password: 'p:w@d#', hosts: HOSTS }),
    );
    const socket = owned(
      await openTunnel(
        parseProxy(`http://alice:p%3Aw%40d%23@127.0.0.1:${proxy.port}`),
        'site.test',
        target.port,
      ),
    );
    socket.write('ping');
    expect(await read(socket, 4)).toBe('ping');
    expect(
      proxy.events.map((e) => [e.kind, e.target, e.username, e.status]),
    ).toEqual([['CONNECT', `site.test:${target.port}`, 'alice', 200]]);
  });

  it('sends the end-to-end headers it is given, and not the hop-by-hop ones', async () => {
    const heads: string[] = [];
    const upstream = await startTcpServer((socket) => {
      const reader = new SocketReader(socket);
      void reader.readUntil(CRLF2).then((head) => {
        heads.push(head.toString('latin1'));
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        return undefined;
      });
    });
    cleanups.push(() => upstream.stop());
    await openTunnel(
      parseProxy(`http://u:p@127.0.0.1:${upstream.port}`),
      'example.test',
      443,
      {
        headers: [
          ['Host', 'ignored.example'],
          ['User-Agent', 'test-agent'],
          ['Proxy-Authorization', 'Basic aW50cnVkZXI6eA=='],
          ['Connection', 'keep-alive, X-Secret'],
          ['X-Secret', 'hidden'],
        ],
      },
    ).then(owned);
    expect(heads).toEqual([
      `CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\nUser-Agent: test-agent\r\nProxy-Authorization: Basic ${Buffer.from('u:p').toString('base64')}\r\n\r\n`,
    ]);
  });

  it('writes an IPv6 target in brackets and a name in punycode', async () => {
    const closed = await closedPort();
    const proxy = await started(
      new HttpProxy({
        hosts: { '::1': '127.0.0.1', 'xn--bcher-kva.example': '127.0.0.1' },
      }),
    );
    const config = parseProxy(proxy.url);
    // Nothing listens there: what matters is what the proxy was asked for.
    for (const host of ['::1', 'bücher.example']) {
      expect((await refusal(openTunnel(config, host, closed))).kind).toBe(
        'tunnel',
      );
    }
    expect(proxy.events.map((e) => e.target)).toEqual([
      `[::1]:${closed}`,
      `xn--bcher-kva.example:${closed}`,
    ]);
  });

  it('says the proxy rejected the credentials', async () => {
    const proxy = await started(
      new HttpProxy({ username: 'u', password: 'right' }),
    );
    const error = await refusal(
      openTunnel(
        parseProxy(`http://u:WRONG-hunter2@127.0.0.1:${proxy.port}`),
        'example.test',
        443,
      ),
    );
    expect(shape(error)).toEqual([
      'auth',
      502,
      'the upstream proxy rejected the credentials (HTTP 407)',
    ]);
    expect(error.message).not.toContain('hunter2');
  });

  it('passes on what the proxy answers when it cannot open the tunnel', async () => {
    const closed = await closedPort();
    const proxy = await started(new HttpProxy({ hosts: HOSTS }));
    const unreachable = await refusal(
      openTunnel(parseProxy(proxy.url), 'site.test', closed),
    );
    expect(shape(unreachable)).toEqual([
      'tunnel',
      502,
      'the upstream proxy refused the tunnel: 502 Bad Gateway',
    ]);

    const answers: Array<[string, number]> = [
      ['HTTP/1.1 403 Forbidden', 403],
      ['HTTP/1.1 503 Service Unavailable', 503],
      ['HTTP/1.1 302 Found', 502],
      ['HTTP/1.1 100 Continue', 502],
    ];
    for (const [line, status] of answers) {
      const server = await startTcpServer((socket) =>
        socket.end(`${line}\r\nContent-Length: 0\r\n\r\n`),
      );
      cleanups.push(() => server.stop());
      const error = await refusal(
        openTunnel(
          parseProxy(`http://127.0.0.1:${server.port}`),
          'example.test',
          443,
        ),
      );
      expect([error.kind, error.status]).toEqual(['tunnel', status]);
      expect(error.message).toBe(
        `the upstream proxy refused the tunnel: ${line.slice('HTTP/1.1 '.length)}`,
      );
    }
  });

  it('keeps what the proxy sends right behind its answer', async () => {
    const upstream = await startTcpServer((socket) => {
      const reader = new SocketReader(socket);
      void reader.readUntil(CRLF2).then(() => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\nBANNER');
        return undefined;
      });
    });
    cleanups.push(() => upstream.stop());
    const socket = owned(
      await openTunnel(
        parseProxy(`http://127.0.0.1:${upstream.port}`),
        'example.test',
        22,
      ),
    );
    expect(await read(socket, 6)).toBe('BANNER');
  });

  it('answers an invalid or missing answer with a message about the connection', async () => {
    const garbage = [
      'nonsense\r\n\r\n',
      'HTTP/1.1 20 OK\r\n\r\n',
      '',
      'HTTP/1.1 200 OK\r\nX: unfinished',
    ];
    for (const bytes of garbage) {
      const server = await startTcpServer((socket) => socket.end(bytes));
      cleanups.push(() => server.stop());
      const error = await refusal(
        openTunnel(
          parseProxy(`http://127.0.0.1:${server.port}`),
          'example.test',
          443,
        ),
      );
      expect(shape(error)).toEqual([
        'tunnel',
        502,
        'the upstream proxy closed the connection or sent an invalid answer',
      ]);
    }
  });

  it('refuses an answer whose head is too large', async () => {
    const server = await startTcpServer((socket) => {
      socket.end(`HTTP/1.1 200 OK\r\nX-Big: ${'a'.repeat(300_000)}\r\n\r\n`);
    });
    cleanups.push(() => server.stop());
    const error = await refusal(
      openTunnel(
        parseProxy(`http://127.0.0.1:${server.port}`),
        'example.test',
        443,
      ),
    );
    expect(error.kind).toBe('tunnel');
  });
});

describe('openTunnel through a SOCKS5 proxy', () => {
  it('opens a tunnel with the credentials, and the proxy resolves the name', async () => {
    const target = await echo();
    const proxy = await started(
      new Socks5Proxy({ username: 'su', password: 's:p@w', hosts: HOSTS }),
    );
    const socket = owned(
      await openTunnel(
        parseProxy(`socks5://su:s%3Ap%40w@127.0.0.1:${proxy.port}`),
        'site.test',
        target.port,
      ),
    );
    socket.write('ping');
    expect(await read(socket, 4)).toBe('ping');
    expect(
      proxy.events.map((e) => [e.host, e.addrType, e.username, e.ok]),
    ).toEqual([['site.test', 'domain', 'su', true]]);
  });

  it('works without credentials, and with an IP address', async () => {
    const target = await echo();
    const proxy = await started(new Socks5Proxy());
    const socket = owned(
      await openTunnel(
        parseProxy(`socks5://127.0.0.1:${proxy.port}`),
        '127.0.0.1',
        target.port,
      ),
    );
    socket.write('ok');
    expect(await read(socket, 2)).toBe('ok');
    expect(proxy.events[0]).toMatchObject({ addrType: 'ipv4', username: null });
  });

  it('says the proxy rejected the credentials, or wants some', async () => {
    const proxy = await started(
      new Socks5Proxy({ username: 'u', password: 'right' }),
    );
    const wrong = await refusal(
      openTunnel(
        parseProxy(`socks5://u:WRONG@127.0.0.1:${proxy.port}`),
        'example.test',
        443,
      ),
    );
    expect(shape(wrong)).toEqual([
      'auth',
      502,
      'the upstream proxy rejected the credentials',
    ]);
    const none = await refusal(
      openTunnel(
        parseProxy(`socks5://127.0.0.1:${proxy.port}`),
        'example.test',
        443,
      ),
    );
    expect(shape(none)).toEqual([
      'auth',
      502,
      'the upstream SOCKS5 proxy accepted none of the offered authentication methods',
    ]);
  });

  it('says why the proxy could not connect', async () => {
    const closed = await closedPort();
    const proxy = await started(new Socks5Proxy({ hosts: HOSTS }));
    const error = await refusal(
      openTunnel(
        parseProxy(`socks5://127.0.0.1:${proxy.port}`),
        'site.test',
        closed,
      ),
    );
    expect(shape(error)).toEqual([
      'tunnel',
      502,
      `the upstream proxy could not connect to site.test:${closed}: connection refused`,
    ]);
  });

  it.each([
    [1, 502, 'general SOCKS server failure'],
    [2, 502, 'connection not allowed by ruleset'],
    [3, 502, 'network unreachable'],
    [4, 502, 'host unreachable'],
    [5, 502, 'connection refused'],
    [6, 504, 'TTL expired'],
    [7, 502, 'command not supported'],
    [8, 502, 'address type not supported'],
    [9, 502, 'unknown reply'],
  ])('knows the SOCKS5 reply %i', async (rep, status, text) => {
    const server = await startTcpServer(async (socket) => {
      const reader = new SocketReader(socket);
      await reader.readExactly(3);
      socket.write(Buffer.from([5, 0]));
      const header = await reader.readExactly(5);
      await reader.readExactly((header[4] ?? 0) + 2);
      socket.write(Buffer.from([5, rep, 0, 1, 0, 0, 0, 0, 0, 0]));
      socket.end();
    });
    cleanups.push(() => server.stop());
    const error = await refusal(
      openTunnel(
        parseProxy(`socks5://127.0.0.1:${server.port}`),
        'a.test',
        443,
      ),
    );
    expect(shape(error)).toEqual([
      'tunnel',
      status,
      `the upstream proxy could not connect to a.test:443: ${text}`,
    ]);
  });

  it('keeps what the target says first', async () => {
    const proxy = await started(new Socks5Proxy());
    const server = await startTcpServer((socket) => socket.write('BANNER'));
    cleanups.push(() => server.stop());
    const socket = owned(
      await openTunnel(
        parseProxy(`socks5://127.0.0.1:${proxy.port}`),
        '127.0.0.1',
        server.port,
      ),
    );
    expect(await read(socket, 6)).toBe('BANNER');
  });

  it('keeps what the target sent in the same segment as the proxy reply', async () => {
    const server = await startTcpServer(async (socket) => {
      const reader = new SocketReader(socket);
      await reader.readExactly(3);
      socket.write(Buffer.from([5, 0]));
      const header = await reader.readExactly(5);
      await reader.readExactly((header[4] ?? 0) + 2);
      // The reply and the first bytes of the target, in one write.
      socket.write(
        Buffer.concat([
          Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
          Buffer.from('BANNER'),
        ]),
      );
    });
    cleanups.push(() => server.stop());
    const socket = owned(
      await openTunnel(
        parseProxy(`socks5://127.0.0.1:${server.port}`),
        'a.test',
        22,
      ),
    );
    expect(socket.isPaused()).toBe(true);
    expect(await read(socket, 6)).toBe('BANNER');
  });

  it('knows an HTTP server is no SOCKS5 proxy', async () => {
    const server = await startTcpServer((socket) =>
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'),
    );
    cleanups.push(() => server.stop());
    const error = await refusal(
      openTunnel(
        parseProxy(`socks5://127.0.0.1:${server.port}`),
        'a.test',
        443,
      ),
    );
    expect(shape(error)).toEqual([
      'connect',
      502,
      'the upstream proxy is not a SOCKS5 proxy',
    ]);
  });

  it('refuses what the protocol cannot carry before it sends anything', async () => {
    const proxy = await started(new Socks5Proxy());
    const config = parseProxy(`socks5://127.0.0.1:${proxy.port}`);
    const tooLong = await refusal(
      openTunnel(config, `${'a'.repeat(300)}.test`, 443),
    );
    expect(shape(tooLong)).toEqual([
      'tunnel',
      502,
      'the target host name is too long',
    ]);
    // A stored proxy can carry what the parser would have refused.
    const long = { ...config, username: 'u'.repeat(256), password: 'p' };
    const credentials = await refusal(openTunnel(long, 'a.test', 443));
    expect(credentials.kind).toBe('auth');
    expect(proxy.events).toEqual([]);
  });
});

describe('openTunnel through an HTTPS proxy', () => {
  it('verifies the proxy certificate against the trust anchors it is given', async () => {
    const certificate = await selfSignedCertificate();
    const target = await echo();
    const proxy = await started(
      new HttpProxy({
        username: 'u',
        password: 'p',
        hosts: HOSTS,
        tls: certificate,
      }),
    );
    const config = parseProxy(`https://u:p@127.0.0.1:${proxy.port}`);

    const socket = owned(
      await openTunnel(config, 'site.test', target.port, {
        ca: certificate.cert,
      }),
    );
    socket.write('ping');
    expect(await read(socket, 4)).toBe('ping');
    expect(proxy.events.map((e) => [e.kind, e.username, e.status])).toEqual([
      ['CONNECT', 'u', 200],
    ]);

    // Anything else is not trusted (the default store holds no self-signed certificate).
    const untrusted = await refusal(
      openTunnel(config, 'site.test', target.port),
    );
    expect(untrusted.kind).toBe('connect');
    expect(untrusted.status).toBe(502);
    expect(untrusted.message).toBe(
      'TLS connection to the upstream proxy failed (self signed certificate)',
    );
  });

  it('refuses a certificate that does not name the proxy', async () => {
    const certificate = await selfSignedCertificate({ dns: ['proxy.example'] });
    const proxy = await started(new HttpProxy({ tls: certificate }));
    const error = await refusal(
      openTunnel(parseProxy(`https://127.0.0.1:${proxy.port}`), 'a.test', 443, {
        ca: certificate.cert,
      }),
    );
    expect(error.kind).toBe('connect');
    expect(error.message).toMatch(
      /^TLS connection to the upstream proxy failed \(.*altnames.*\)$/,
    );
  });

  it('says so when the proxy does not speak TLS', async () => {
    // A web server answers the TLS greeting with an HTTP error.
    const plain = await startTcpServer((socket) => {
      socket.once('data', () =>
        socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n'),
      );
    });
    cleanups.push(() => plain.stop());
    const error = await refusal(
      openTunnel(parseProxy(`https://127.0.0.1:${plain.port}`), 'a.test', 443),
    );
    expect(error.kind).toBe('connect');
    expect(error.message).toMatch(
      /^TLS connection to the upstream proxy failed \(.+\)$/,
    );
  });
});

describe('when the proxy cannot be reached', () => {
  it('says the connection was refused', async () => {
    const port = await closedPort();
    for (const scheme of ['http', 'https', 'socks5']) {
      const error = await refusal(
        openTunnel(parseProxy(`${scheme}://127.0.0.1:${port}`), 'a.test', 443),
      );
      expect(shape(error)).toEqual([
        'connect',
        502,
        'the upstream proxy refused the connection',
      ]);
    }
    const open = await refusal(
      openUpstream(parseProxy(`http://127.0.0.1:${port}`)),
    );
    expect(open.message).toBe('the upstream proxy refused the connection');
  });

  it('gives up on a proxy that takes the connection and never answers', async () => {
    const silent = await startTcpServer(() => undefined);
    cleanups.push(() => silent.stop());
    for (const scheme of ['http', 'socks5']) {
      const waited = Date.now();
      const error = await refusal(
        openTunnel(
          parseProxy(`${scheme}://127.0.0.1:${silent.port}`),
          'a.test',
          443,
          { timeoutMs: 250 },
        ),
      );
      expect(shape(error)).toEqual([
        'timeout',
        504,
        'the upstream proxy did not answer in time',
      ]);
      expect(Date.now() - waited).toBeLessThan(2000);
    }
    // An https proxy that never finishes the handshake runs into the connect timeout.
    const tls = await refusal(
      openTunnel(
        parseProxy(`https://127.0.0.1:${silent.port}`),
        'a.test',
        443,
        { connectTimeoutMs: 250 },
      ),
    );
    expect(tls.kind).toBe('timeout');
  });

  it('counts the connect timeout and the whole timeout separately', async () => {
    const slowAnswer = await startTcpServer((socket) => {
      const reader = new SocketReader(socket);
      void reader.readUntil(CRLF2).then(() => {
        setTimeout(
          () => socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'),
          300,
        );
        return undefined;
      });
    });
    cleanups.push(() => slowAnswer.stop());
    const config = parseProxy(`http://127.0.0.1:${slowAnswer.port}`);
    // The connection is quick, the answer is slow: only the whole timeout cares.
    owned(await openTunnel(config, 'a.test', 443, { connectTimeoutMs: 100 }));
    const error = await refusal(
      openTunnel(config, 'a.test', 443, { timeoutMs: 100 }),
    );
    expect(error.kind).toBe('timeout');
  });

  it('stops when its signal fires, with the signal reason', async () => {
    const silent = await startTcpServer(() => undefined);
    cleanups.push(() => silent.stop());
    const config = parseProxy(`socks5://127.0.0.1:${silent.port}`);
    const controller = new AbortController();
    const attempt = openTunnel(config, 'a.test', 443, {
      signal: controller.signal,
    });
    const outcome = attempt.then(
      () => 'opened',
      (error: unknown) => error,
    );
    setTimeout(() => controller.abort(new Error('closing')), 100);
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : '').toBe('closing');

    const aborted = AbortSignal.abort(new Error('already'));
    await expect(
      openTunnel(config, 'a.test', 443, { signal: aborted }),
    ).rejects.toThrow('already');
    await expect(openUpstream(config, { signal: aborted })).rejects.toThrow(
      'already',
    );
  });

  it('refuses a target name that cannot be sent', async () => {
    const proxy = await started(new HttpProxy());
    const config = parseProxy(proxy.url);
    for (const host of ['', 'a b', 'a\r\nHost: x', 'a\u0000b', 'é\u0000']) {
      const error = await refusal(openTunnel(config, host, 443));
      expect(shape(error)).toEqual([
        'tunnel',
        502,
        'the target host name is invalid',
      ]);
    }
    expect(proxy.events).toEqual([]);
  });
});

describe('openUpstream', () => {
  it('connects to the proxy and nothing else', async () => {
    const proxy = await started(new HttpProxy());
    const socket = owned(await openUpstream(parseProxy(proxy.url)));
    expect(socket.remotePort).toBe(proxy.port);
    expect(proxy.events).toEqual([]);
  });

  it('is plain http origin server friendly: the proxy forwards what is written to it', async () => {
    const site = await startOrigin();
    cleanups.push(() => site.stop());
    const proxy = await started(new HttpProxy());
    const socket = owned(await openUpstream(parseProxy(proxy.url)));
    socket.write(
      `GET http://127.0.0.1:${site.port}/ HTTP/1.1\r\nHost: x\r\n\r\n`,
    );
    expect(await read(socket, 20)).toMatch(/^HTTP\/1\.1 200 OK/);
  });
});

describe('connectFailure', () => {
  const failing = (code: string | undefined, message = 'boom') =>
    Object.assign(new Error(message), { code });

  it.each<[string, string | undefined, UpstreamErrorKind, number, string]>([
    [
      'a refused connection',
      'ECONNREFUSED',
      'connect',
      502,
      'the upstream proxy refused the connection',
    ],
    [
      'a connect that timed out',
      'ETIMEDOUT',
      'timeout',
      504,
      'the upstream proxy did not answer in time',
    ],
    [
      'a reset',
      'ECONNRESET',
      'connect',
      502,
      'the upstream proxy closed the connection or sent an invalid answer',
    ],
    [
      'a broken pipe',
      'EPIPE',
      'connect',
      502,
      'the upstream proxy closed the connection or sent an invalid answer',
    ],
    [
      'an unknown host',
      'ENOTFOUND',
      'connect',
      502,
      'cannot reach the upstream proxy',
    ],
    [
      'no route',
      'EHOSTUNREACH',
      'connect',
      502,
      'cannot reach the upstream proxy',
    ],
    [
      'an error without a code',
      undefined,
      'connect',
      502,
      'cannot reach the upstream proxy',
    ],
  ])('maps %s', (_what, code, kind, status, message) => {
    expect(shape(connectFailure(failing(code), false))).toEqual([
      kind,
      status,
      message,
    ]);
  });

  it('puts the reason of a failed TLS handshake in the message', () => {
    expect(
      shape(
        connectFailure(
          failing('DEPTH_ZERO_SELF_SIGNED_CERT', 'self signed certificate'),
          true,
        ),
      ),
    ).toEqual([
      'connect',
      502,
      'TLS connection to the upstream proxy failed (self signed certificate)',
    ]);
    for (const code of ['ECONNRESET', undefined]) {
      expect(connectFailure(failing(code), true).message).toBe(
        'TLS connection to the upstream proxy failed (the connection was closed during the handshake)',
      );
    }
  });
});

describe('tunnelFailure', () => {
  const socksError = (message: string) =>
    new SocksClientError(message, {
      command: 'connect',
      destination: { host: 'a', port: 1 },
      proxy: { host: 'b', port: 2, type: 5 },
    });

  it.each<[string, Error, UpstreamErrorKind, number, string]>([
    [
      'a closed socket',
      socksError('Socket closed'),
      'tunnel',
      502,
      'the upstream proxy closed the connection or sent an invalid answer',
    ],
    [
      'a SOCKS5 timeout',
      socksError('Proxy connection timed out'),
      'timeout',
      504,
      'the upstream proxy did not answer in time',
    ],
    [
      'a SOCKS5 login that failed',
      socksError('Socks5 Authentication failed'),
      'auth',
      502,
      'the upstream proxy rejected the credentials',
    ],
    [
      'a SOCKS5 proxy with an unknown login method',
      socksError(
        'Received invalid Socks5 initial handshake (unknown authentication type)',
      ),
      'auth',
      502,
      'the upstream SOCKS5 proxy accepted none of the offered authentication methods',
    ],
    [
      'a head that never ended',
      new HeadError('head too large'),
      'tunnel',
      502,
      'the upstream proxy closed the connection or sent an invalid answer',
    ],
    [
      'a socket that timed out',
      Object.assign(new Error('x'), { code: 'ETIMEDOUT' }),
      'timeout',
      504,
      'the upstream proxy did not answer in time',
    ],
    [
      'a socket that was reset',
      Object.assign(new Error('x'), { code: 'ECONNRESET' }),
      'tunnel',
      502,
      'the upstream proxy closed the connection or sent an invalid answer',
    ],
  ])('maps %s', (_what, error, kind, status, message) => {
    expect(shape(tunnelFailure(error))).toEqual([kind, status, message]);
  });

  it('passes an UpstreamError on and does not hide a bug behind a plausible message', () => {
    const own = new UpstreamError('auth', 502, 'x');
    expect(tunnelFailure(own)).toBe(own);
    const bug = new TypeError('undefined is not a function');
    expect(() => tunnelFailure(bug)).toThrow(bug);
  });
});
