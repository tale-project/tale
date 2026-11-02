// HttpExitIpChecker against a fake IP-echo service behind the local test proxies (no internet).

import http from 'node:http';
import https from 'node:https';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventually } from '../../testing/eventually.ts';
import {
  HttpProxy,
  Socks5Proxy,
  closedPort,
  portOf,
  selfSignedCertificate,
  startTcpServer,
} from '../../testing/local-proxies.ts';
import type { SelfSignedCertificate } from '../../testing/local-proxies.ts';
import {
  DEFAULT_ENDPOINTS,
  HttpExitIpChecker,
  explainFailure,
} from './exit-ip.ts';
import type { Endpoint, ExitIpCheckerOptions } from './exit-ip.ts';
import { parseProxy } from './parsing.ts';
import { ExitIpError } from './types.ts';

const HOSTS = { 'ip-echo.test': '127.0.0.1' };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

beforeEach(() => {
  // undici says once per process that its SOCKS5 support is experimental.
  const emit = process.emitWarning.bind(process);
  vi.spyOn(process, 'emitWarning').mockImplementation((warning, ...rest) => {
    if (
      typeof warning === 'string' &&
      warning.startsWith('SOCKS5 proxy support is experimental')
    ) {
      return;
    }
    Reflect.apply(emit, process, [warning, ...rest]);
  });
});

interface Echo {
  port: number;
  endpoint(path: string, jsonKey?: string): Endpoint;
  secureEndpoint(path: string, jsonKey?: string): Endpoint;
}

/**
 * Answers with the caller's address: /json, /text, /broken (500), /garbage, /slow (never answers),
 * and more for the odd cases below. Plain on one port, TLS on another.
 */
async function ipEcho(certificate?: SelfSignedCertificate): Promise<Echo> {
  const handler = (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => {
    const peer = request.socket.remoteAddress ?? '';
    const path = request.url ?? '/';
    const send = (
      status: number,
      body: string,
      headers: Record<string, string> = {},
    ) => {
      response.writeHead(status, {
        'content-length': Buffer.byteLength(body),
        ...headers,
      });
      response.end(body);
    };
    if (path === '/json') return send(200, JSON.stringify({ ip: peer }));
    if (path === '/text') return send(200, `${peer}\n`);
    if (path === '/broken') return send(500, 'oops');
    if (path === '/garbage') return send(200, '<html>not an ip</html>');
    if (path === '/slow') return undefined;
    if (path === '/ipv6') return send(200, '2001:DB8:0:0::1\n');
    if (path === '/number') return send(200, JSON.stringify({ ip: 12345 }));
    if (path === '/redirect') return send(302, '', { location: '/text' });
    if (path === '/huge') return send(200, 'x'.repeat(100_000));
    if (path === '/delayed') {
      setTimeout(() => send(200, `${peer}\n`), 150);
      return undefined;
    }
    if (path === '/chunked') {
      response.writeHead(200, { 'transfer-encoding': 'chunked' });
      response.write(peer.slice(0, 3));
      response.end(`${peer.slice(3)}\n`);
      return undefined;
    }
    return send(404, 'not found');
  };
  const plain = http.createServer(handler);
  const secure =
    certificate === undefined ? null : https.createServer(certificate, handler);
  for (const server of [plain, secure]) {
    if (server === null) continue;
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    );
  }
  const port = portOf(plain);
  const securePort = secure === null ? 0 : portOf(secure);
  return {
    port,
    endpoint: (path, jsonKey) => ({
      url: `http://ip-echo.test:${port}${path}`,
      jsonKey,
    }),
    secureEndpoint: (path, jsonKey) => ({
      url: `https://ip-echo.test:${securePort}${path}`,
      jsonKey,
    }),
  };
}

function checker(
  endpoints: Endpoint[],
  options: Partial<ExitIpCheckerOptions> = {},
): HttpExitIpChecker {
  return new HttpExitIpChecker({
    endpoints,
    totalTimeoutMs: 5000,
    connectTimeoutMs: 2000,
    countryLookup: () => 'ZZ',
    ...options,
  });
}

async function started<T extends HttpProxy | Socks5Proxy>(
  proxy: T,
): Promise<T> {
  cleanups.push(() => proxy.stop());
  await proxy.start();
  return proxy;
}

/** The message of the ExitIpError a check ends with. */
async function failure(check: Promise<unknown>): Promise<string> {
  try {
    await check;
  } catch (error) {
    if (error instanceof ExitIpError) return error.message;
    throw error;
  }
  throw new Error('the check passed');
}

describe('an HTTP proxy', () => {
  it('finds the exit IP through a proxy with credentials', async () => {
    const echo = await ipEcho();
    const proxy = await started(
      new HttpProxy({ username: 'u', password: 'p@ss:w/rd', hosts: HOSTS }),
    );
    const config = parseProxy(
      `http://u:p%40ss%3Aw%2Frd@127.0.0.1:${proxy.port}`,
    );
    const result = await checker([echo.endpoint('/json', 'ip')]).check(config);
    expect(result.ip).toBe('127.0.0.1');
    expect(result.country).toBe('ZZ');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    // The proxy got the plain-http request as it is, with the name unresolved.
    expect(proxy.events).toHaveLength(1);
    expect(proxy.events[0]).toMatchObject({
      kind: 'HTTP',
      host: 'ip-echo.test',
      port: echo.port,
      username: 'u',
      status: 200,
    });
  });

  it('reads a plain-text answer, a chunked one and an IPv6 one', async () => {
    const echo = await ipEcho();
    const proxy = await started(new HttpProxy({ hosts: HOSTS }));
    const config = parseProxy(proxy.url);
    expect((await checker([echo.endpoint('/text')]).check(config)).ip).toBe(
      '127.0.0.1',
    );
    expect((await checker([echo.endpoint('/chunked')]).check(config)).ip).toBe(
      '127.0.0.1',
    );
    expect((await checker([echo.endpoint('/ipv6')]).check(config)).ip).toBe(
      '2001:db8::1',
    );
  });

  it('falls back over bad endpoints and names what was wrong with each', async () => {
    const echo = await ipEcho();
    const proxy = await started(new HttpProxy({ hosts: HOSTS }));
    const bad = [
      echo.endpoint('/broken'),
      echo.endpoint('/garbage'),
      echo.endpoint('/json', 'nope'),
      echo.endpoint('/text', 'ip'),
      echo.endpoint('/number', 'ip'),
      echo.endpoint('/redirect'),
      echo.endpoint('/huge'),
      echo.endpoint('/missing'),
    ];
    const result = await checker([...bad, echo.endpoint('/text')]).check(
      parseProxy(proxy.url),
    );
    expect(result.ip).toBe('127.0.0.1');
    expect(proxy.events).toHaveLength(9);

    const message = await failure(checker(bad).check(parseProxy(proxy.url)));
    const url = (path: string) => echo.endpoint(path).url;
    expect(message).toBe(
      'no IP echo service answered through the proxy: ' +
        [
          `${url('/broken')}: unexpected answer (HTTP 500)`,
          `${url('/garbage')}: unexpected answer (not an IP address)`,
          `${url('/json')}: unexpected answer (no "nope" field)`,
          `${url('/text')}: unexpected answer (not JSON)`,
          `${url('/number')}: unexpected answer (not an IP address)`,
          `${url('/redirect')}: unexpected answer (HTTP 302)`,
          `${url('/huge')}: unexpected answer (answer too large)`,
          `${url('/missing')}: unexpected answer (HTTP 404)`,
        ].join('; '),
    );
  });

  it('says what is missing from a JSON answer', async () => {
    const echo = await ipEcho();
    const proxy = await started(new HttpProxy({ hosts: HOSTS }));
    const endpoint = { ...echo.endpoint('/json'), jsonKey: 'nope' };
    expect(
      await failure(checker([endpoint]).check(parseProxy(proxy.url))),
    ).toBe(
      `no IP echo service answered through the proxy: ${endpoint.url}: unexpected answer (no "nope" field)`,
    );
  });

  it('aborts at once when the credentials are wrong', async () => {
    const echo = await ipEcho();
    const proxy = await started(
      new HttpProxy({ username: 'u', password: 'p', hosts: HOSTS }),
    );
    const config = parseProxy(`u:wrong@127.0.0.1:${proxy.port}`);
    // A plain-http endpoint gets a 407 response, an https one a refused CONNECT.
    const cases: Array<[Endpoint, string]> = [
      [echo.endpoint('/text'), 'the proxy rejected the credentials (HTTP 407)'],
      [{ url: 'https://ip-echo.test/' }, 'the proxy rejected the credentials'],
    ];
    for (const [first, message] of cases) {
      proxy.clear();
      expect(
        await failure(checker([first, echo.endpoint('/text')]).check(config)),
      ).toBe(message);
      expect(proxy.events).toHaveLength(1);
    }
  });

  it('does not put the password in any message', async () => {
    const echo = await ipEcho();
    const proxy = await started(
      new HttpProxy({ username: 'u', password: 'right', hosts: HOSTS }),
    );
    for (const endpoint of [
      echo.endpoint('/text'),
      { url: 'https://ip-echo.test/' },
    ]) {
      const message = await failure(
        checker([endpoint]).check(
          parseProxy(`http://u:hunter2-secret@127.0.0.1:${proxy.port}`),
        ),
      );
      expect(message).not.toContain('hunter2');
    }
  });

  it('cannot connect to a proxy that refuses', async () => {
    const port = await closedPort();
    const message = await failure(
      checker([{ url: 'https://ip-echo.test/' }]).check(
        parseProxy(`127.0.0.1:${port}`),
      ),
    );
    expect(message).toMatch(
      /^cannot connect to the proxy \(.*ECONNREFUSED.*\)$/,
    );
  });

  it('tries the next endpoint when the proxy cannot open the tunnel', async () => {
    const echo = await ipEcho();
    const closed = await closedPort();
    const proxy = await started(new HttpProxy({ hosts: HOSTS }));
    const refusing = { url: `https://ip-echo.test:${closed}/` };
    const result = await checker([refusing, echo.endpoint('/text')]).check(
      parseProxy(proxy.url),
    );
    expect(result.ip).toBe('127.0.0.1');
    expect(
      await failure(checker([refusing]).check(parseProxy(proxy.url))),
    ).toBe(
      `no IP echo service answered through the proxy: ${refusing.url}: the proxy refused the tunnel (HTTP 502)`,
    );
  });

  it('gives up after the total timeout and lets go of the connection', async () => {
    const echo = await ipEcho();
    const proxy = await started(new HttpProxy({ hosts: HOSTS }));
    const started_ = Date.now();
    const message = await failure(
      checker([echo.endpoint('/slow')], { totalTimeoutMs: 500 }).check(
        parseProxy(proxy.url),
      ),
    );
    expect(message).toBe('no answer through the proxy within 0.5 s');
    expect(Date.now() - started_).toBeLessThan(2000);
    await eventually(() => proxy.connections === 0);
  });

  it('gives up on a proxy that takes the connection and never answers a CONNECT', async () => {
    const silent = await startTcpServer(() => undefined);
    cleanups.push(() => silent.stop());
    const message = await failure(
      checker([{ url: 'https://ip-echo.test/' }], {
        totalTimeoutMs: 400,
      }).check(parseProxy(`127.0.0.1:${silent.port}`)),
    );
    expect(message).toBe('no answer through the proxy within 0.4 s');
  });

  it('measures the latency of the endpoint that answered', async () => {
    const echo = await ipEcho();
    const proxy = await started(new HttpProxy({ hosts: HOSTS }));
    const result = await checker([
      echo.endpoint('/broken'),
      echo.endpoint('/delayed'),
    ]).check(parseProxy(proxy.url));
    expect(result.latencyMs).toBeGreaterThanOrEqual(140);
    expect(result.latencyMs).toBeLessThan(1500);
  });

  it('closes its connections when it is done', async () => {
    const echo = await ipEcho();
    const proxy = await started(new HttpProxy({ hosts: HOSTS }));
    const config = parseProxy(proxy.url);
    await checker([echo.endpoint('/text')]).check(config);
    await eventually(() => proxy.connections === 0);
    // ... after a failure too.
    await failure(checker([echo.endpoint('/broken')]).check(config));
    await eventually(() => proxy.connections === 0);
  });

  it('reaches a proxy at an IPv6 address', async (context) => {
    const echo = await ipEcho();
    const proxy = new HttpProxy({ host: '::1', hosts: HOSTS });
    try {
      await started(proxy);
    } catch {
      // No IPv6 loopback on this machine: nothing to test.
      context.skip();
    }
    const result = await checker([echo.endpoint('/text')]).check(
      parseProxy(`http://[::1]:${proxy.port}`),
    );
    expect(result.ip).toBe('127.0.0.1');
    expect(proxy.events[0]?.client.startsWith('[::1]:')).toBe(true);
  });

  it('ignores the proxy variables of the environment', async () => {
    const echo = await ipEcho();
    const proxy = await started(new HttpProxy({ hosts: HOSTS }));
    const dead = await closedPort();
    vi.stubEnv('HTTP_PROXY', `http://127.0.0.1:${dead}`);
    vi.stubEnv('HTTPS_PROXY', `http://127.0.0.1:${dead}`);
    vi.stubEnv('http_proxy', `http://127.0.0.1:${dead}`);
    vi.stubEnv('ALL_PROXY', `http://127.0.0.1:${dead}`);
    vi.stubEnv('NO_PROXY', '');
    try {
      const result = await checker([echo.endpoint('/text')]).check(
        parseProxy(proxy.url),
      );
      expect(result.ip).toBe('127.0.0.1');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('TLS', () => {
  it('verifies the echo service through a CONNECT tunnel', async () => {
    const certificate = await selfSignedCertificate({ dns: ['ip-echo.test'] });
    const echo = await ipEcho(certificate);
    const proxy = await started(
      new HttpProxy({ username: 'u', password: 'p', hosts: HOSTS }),
    );
    const config = parseProxy(`http://u:p@127.0.0.1:${proxy.port}`);

    const result = await checker([echo.secureEndpoint('/json', 'ip')], {
      ca: certificate.cert,
    }).check(config);
    expect(result.ip).toBe('127.0.0.1');
    expect(proxy.events.map((e) => [e.kind, e.target, e.status])).toEqual([
      [
        'CONNECT',
        `ip-echo.test:${new URL(echo.secureEndpoint('/').url).port}`,
        200,
      ],
    ]);

    // Without the certificate as a trust anchor, the echo service is not trusted and the next one is tried.
    const message = await failure(
      checker([echo.secureEndpoint('/json', 'ip')]).check(config),
    );
    expect(message).toBe(
      `no IP echo service answered through the proxy: ${echo.secureEndpoint('/json').url}: TLS handshake failed: self signed certificate`,
    );
    const next = await checker([
      echo.secureEndpoint('/text'),
      echo.endpoint('/text'),
    ]).check(config);
    expect(next.ip).toBe('127.0.0.1');
  });

  it('checks an https proxy, and the echo service inside it', async () => {
    const proxyCertificate = await selfSignedCertificate();
    const echoCertificate = await selfSignedCertificate({
      dns: ['ip-echo.test'],
    });
    const echo = await ipEcho(echoCertificate);
    const proxy = await started(
      new HttpProxy({
        username: 'u',
        password: 'p',
        hosts: HOSTS,
        tls: proxyCertificate,
      }),
    );
    const config = parseProxy(`https://u:p@127.0.0.1:${proxy.port}`);
    const ca = [proxyCertificate.cert, echoCertificate.cert];

    const secure = await checker([echo.secureEndpoint('/text')], { ca }).check(
      config,
    );
    expect(secure.ip).toBe('127.0.0.1');
    const plain = await checker([echo.endpoint('/text')], { ca }).check(config);
    expect(plain.ip).toBe('127.0.0.1');

    // An untrusted proxy certificate fails every endpoint the same way.
    const message = await failure(
      checker([echo.endpoint('/text')], { ca: echoCertificate.cert }).check(
        config,
      ),
    );
    expect(message).toBe(
      `no IP echo service answered through the proxy: ${echo.endpoint('/text').url}: TLS handshake failed: self signed certificate`,
    );
    // And wrong credentials are wrong over TLS too.
    const wrong = parseProxy(`https://u:nope@127.0.0.1:${proxy.port}`);
    expect(
      await failure(
        checker([echo.secureEndpoint('/text')], { ca }).check(wrong),
      ),
    ).toBe('the proxy rejected the credentials');
  });

  it('refuses an https proxy whose certificate is for another name', async () => {
    const certificate = await selfSignedCertificate({ dns: ['proxy.example'] });
    const echo = await ipEcho();
    const proxy = await started(
      new HttpProxy({ hosts: HOSTS, tls: certificate }),
    );
    const message = await failure(
      checker([echo.endpoint('/text')], { ca: certificate.cert }).check(
        parseProxy(`https://127.0.0.1:${proxy.port}`),
      ),
    );
    expect(message).toMatch(
      new RegExp(
        `^no IP echo service answered through the proxy: ${echo.endpoint('/text').url.replaceAll('.', '\\.')}: TLS handshake failed: .*altnames`,
      ),
    );
  });

  it('gives up on an https proxy that never finishes the handshake', async () => {
    const silent = await startTcpServer(() => undefined);
    cleanups.push(() => silent.stop());
    const message = await failure(
      checker([{ url: 'https://ip-echo.test/' }], {
        connectTimeoutMs: 300,
        totalTimeoutMs: 5000,
      }).check(parseProxy(`https://127.0.0.1:${silent.port}`)),
    );
    expect(message).toBe('the proxy did not answer within 0.3 s');
  });
});

describe('a SOCKS5 proxy', () => {
  it('finds the exit IP with credentials and lets the proxy resolve the name', async () => {
    const echo = await ipEcho();
    const proxy = await started(
      new Socks5Proxy({ username: 'u', password: 'p', hosts: HOSTS }),
    );
    const result = await checker([echo.endpoint('/text')]).check(
      parseProxy(`socks5://u:p@127.0.0.1:${proxy.port}`),
    );
    expect(result.ip).toBe('127.0.0.1');
    expect(proxy.events.at(-1)?.addrType).toBe('domain');
    expect(proxy.events.at(-1)?.host).toBe('ip-echo.test');

    const wrong = checker([echo.endpoint('/text')]).check(
      parseProxy(`socks5://u:bad@127.0.0.1:${proxy.port}`),
    );
    expect(await failure(wrong)).toBe('the proxy rejected the credentials');
    // A proxy that wants credentials and gets none says so the same way.
    const none = checker([echo.endpoint('/text')]).check(
      parseProxy(`socks5://127.0.0.1:${proxy.port}`),
    );
    expect(await failure(none)).toBe('the proxy rejected the credentials');
  });

  it('verifies an https echo service through the proxy', async () => {
    const certificate = await selfSignedCertificate({ dns: ['ip-echo.test'] });
    const echo = await ipEcho(certificate);
    const proxy = await started(new Socks5Proxy({ hosts: HOSTS }));
    const result = await checker([echo.secureEndpoint('/json', 'ip')], {
      ca: certificate.cert,
    }).check(parseProxy(`socks5://127.0.0.1:${proxy.port}`));
    expect(result.ip).toBe('127.0.0.1');
  });

  it('tries the next endpoint when the proxy cannot reach one', async () => {
    const echo = await ipEcho();
    const closed = await closedPort();
    const proxy = await started(new Socks5Proxy({ hosts: HOSTS }));
    const config = parseProxy(`socks5://127.0.0.1:${proxy.port}`);
    const refusing = { url: `http://ip-echo.test:${closed}/` };
    expect(
      (await checker([refusing, echo.endpoint('/text')]).check(config)).ip,
    ).toBe('127.0.0.1');
    expect(await failure(checker([refusing]).check(config))).toBe(
      `no IP echo service answered through the proxy: ${refusing.url}: SOCKS5 connection failed: Connection refused`,
    );
  });

  it('cannot connect to a SOCKS5 proxy that refuses, and knows an HTTP server is no SOCKS5 proxy', async () => {
    const port = await closedPort();
    expect(
      await failure(
        checker([{ url: 'http://ip-echo.test/' }]).check(
          parseProxy(`socks5://127.0.0.1:${port}`),
        ),
      ),
    ).toMatch(/^cannot connect to the proxy \(.*ECONNREFUSED.*\)$/);

    // A web server answers the SOCKS5 greeting with an HTTP error.
    const web = await startTcpServer((socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
    });
    cleanups.push(() => web.stop());
    const message = await failure(
      checker([{ url: 'http://ip-echo.test/' }]).check(
        parseProxy(`socks5://127.0.0.1:${web.port}`),
      ),
    );
    expect(message).toBe(
      'cannot connect to the proxy (it is not a SOCKS5 proxy)',
    );
  });

  it('reaches a proxy at an IPv6 address', async (context) => {
    const echo = await ipEcho();
    const proxy = new Socks5Proxy({ host: '::1', hosts: HOSTS });
    try {
      await started(proxy);
    } catch {
      // No IPv6 loopback on this machine: nothing to test.
      context.skip();
    }
    const result = await checker([echo.endpoint('/text')]).check(
      parseProxy(`socks5://[::1]:${proxy.port}`),
    );
    expect(result.ip).toBe('127.0.0.1');
    expect(proxy.events[0]?.client.startsWith('[::1]:')).toBe(true);
  });
});

describe('the country', () => {
  it('is looked up by the injected function, which may be async', async () => {
    const echo = await ipEcho();
    const proxy = await started(new HttpProxy({ hosts: HOSTS }));
    const lookup = vi.fn(async (ip: string) =>
      ip === '127.0.0.1' ? 'DE' : null,
    );
    const result = await checker([echo.endpoint('/text')], {
      countryLookup: lookup,
    }).check(parseProxy(proxy.url));
    expect(result.country).toBe('DE');
    expect(lookup).toHaveBeenCalledWith('127.0.0.1');
  });

  it('is unknown without a lookup', async () => {
    const echo = await ipEcho();
    const proxy = await started(new HttpProxy({ hosts: HOSTS }));
    const bare = new HttpExitIpChecker({ endpoints: [echo.endpoint('/text')] });
    expect((await bare.check(parseProxy(proxy.url))).country).toBeNull();
  });

  it('does not make a working proxy fail when the lookup does', async () => {
    const echo = await ipEcho();
    const proxy = await started(new HttpProxy({ hosts: HOSTS }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await checker([echo.endpoint('/text')], {
      countryLookup: () => {
        throw new Error('database missing');
      },
    }).check(parseProxy(proxy.url));
    expect(result.country).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('database missing'),
    );
  });
});

describe('the defaults', () => {
  it('ask ipify, then Amazon, then icanhazip', () => {
    expect(DEFAULT_ENDPOINTS).toEqual([
      { url: 'https://api.ipify.org?format=json', jsonKey: 'ip' },
      { url: 'https://checkip.amazonaws.com' },
      { url: 'https://icanhazip.com' },
    ]);
  });
});

describe('explainFailure', () => {
  const coded = (message: string, code: string, name = 'Error') =>
    Object.assign(new Error(message), { code, name });

  it.each<[string, Error, string, boolean]>([
    [
      'a connect timeout',
      coded(
        'Connect Timeout Error (attempted address: 10.0.0.1:80, timeout: 8000ms)',
        'UND_ERR_CONNECT_TIMEOUT',
      ),
      'the proxy did not answer within 8 s',
      true,
    ],
    [
      'a SOCKS5 handshake that stalls (undici waits 5 s for each step)',
      new Error('SOCKS5 authentication timeout'),
      'the proxy did not answer within 5 s',
      true,
    ],
    [
      'the same while connecting',
      new Error('SOCKS5 connection timeout'),
      'the proxy did not answer within 5 s',
      true,
    ],
    [
      'a refused CONNECT with 407',
      coded(
        'Proxy response (407) !== 200 when HTTP Tunneling',
        'UND_ERR_ABORTED',
        'AbortError',
      ),
      'the proxy rejected the credentials',
      true,
    ],
    [
      'a 407 to a plain request',
      coded(
        'Proxy Authentication Required (407)',
        'UND_ERR_INVALID_ARG',
        'InvalidArgumentError',
      ),
      'the proxy rejected the credentials (HTTP 407)',
      true,
    ],
    [
      'a SOCKS5 login that fails',
      coded(
        'Authentication failed',
        'UND_ERR_SOCKS5_AUTH_FAILED',
        'Socks5ProxyError',
      ),
      'the proxy rejected the credentials',
      true,
    ],
    [
      'a SOCKS5 proxy that accepts no method',
      coded(
        'No acceptable authentication method',
        'UND_ERR_SOCKS5_AUTH_REJECTED',
        'Socks5ProxyError',
      ),
      'the proxy rejected the credentials',
      true,
    ],
    [
      'an answer that is no SOCKS5',
      coded(
        'Invalid SOCKS version: 72',
        'UND_ERR_SOCKS5_VERSION',
        'Socks5ProxyError',
      ),
      'cannot connect to the proxy (it is not a SOCKS5 proxy)',
      true,
    ],
    [
      'a refused connection',
      coded('connect ECONNREFUSED 127.0.0.1:9', 'ECONNREFUSED'),
      'cannot connect to the proxy (connect ECONNREFUSED 127.0.0.1:9)',
      true,
    ],
    [
      'an unknown host, whose code undici may wrap',
      Object.assign(new TypeError('fetch failed'), {
        cause: coded('getaddrinfo ENOTFOUND proxy.invalid', 'ENOTFOUND'),
      }),
      'cannot connect to the proxy (fetch failed)',
      true,
    ],
    [
      'a tunnel the proxy refused',
      coded(
        'Proxy response (502) !== 200 when HTTP Tunneling',
        'UND_ERR_ABORTED',
        'AbortError',
      ),
      'the proxy refused the tunnel (HTTP 502)',
      false,
    ],
    [
      'a certificate that is not trusted',
      coded('self signed certificate', 'DEPTH_ZERO_SELF_SIGNED_CERT'),
      'TLS handshake failed: self signed certificate',
      false,
    ],
    [
      'a certificate for another name',
      coded(
        "Hostname/IP does not match certificate's altnames",
        'ERR_TLS_CERT_ALTNAME_INVALID',
      ),
      "TLS handshake failed: Hostname/IP does not match certificate's altnames",
      false,
    ],
    [
      'a certificate error undici wrapped',
      Object.assign(new Error('Secure Proxy Connection failed'), {
        code: 'UND_ERR_PRX_TLS',
        cause: new Error("Hostname/IP does not match certificate's altnames"),
      }),
      "TLS handshake failed: Hostname/IP does not match certificate's altnames",
      false,
    ],
    [
      'a secure proxy connection that failed',
      coded(
        'Secure Proxy Connection failed',
        'UND_ERR_PRX_TLS',
        'SecureProxyConnectionError',
      ),
      'TLS handshake failed: Secure Proxy Connection failed',
      false,
    ],
    [
      'a target the SOCKS5 proxy could not reach',
      coded(
        'SOCKS5 connection failed: Host unreachable',
        'UND_ERR_SOCKS5_REPLY_4',
        'Socks5ProxyError',
      ),
      'SOCKS5 connection failed: Host unreachable',
      false,
    ],
    [
      'a connection closed in the middle',
      coded('other side closed', 'UND_ERR_SOCKET', 'SocketError'),
      'SocketError other side closed',
      false,
    ],
    [
      'a reset',
      coded('read ECONNRESET', 'ECONNRESET'),
      'Error read ECONNRESET',
      false,
    ],
    [
      'a read timeout',
      coded(
        'Headers Timeout Error',
        'UND_ERR_HEADERS_TIMEOUT',
        'HeadersTimeoutError',
      ),
      'HeadersTimeoutError Headers Timeout Error',
      false,
    ],
  ])('takes %s for %j', (_what, error, words, endsTheCheck) => {
    const verdict = explainFailure(error, 8000);
    expect(verdict instanceof ExitIpError).toBe(endsTheCheck);
    expect(verdict instanceof ExitIpError ? verdict.message : verdict).toBe(
      words,
    );
  });

  it('takes what is not an error for a failure of the endpoint', () => {
    expect(explainFailure('boom', 8000)).toBe('Error boom');
  });
});
