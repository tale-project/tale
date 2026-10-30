import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  request as httpRequest,
  type Server,
} from 'node:http';
import {
  createServer as createTcpServer,
  type AddressInfo,
  type Socket,
} from 'node:net';

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { resetOutboundProxiesForTests } from './outbound-proxy';
import {
  safeFetch,
  safeFetchBinary,
  SafeFetchError,
  setSafeFetchResolverForTests,
} from './safe-fetch';

// A real undici ProxyAgent against real local servers: a target, and HTTP
// proxies that check the credentials, note what they were asked for, and
// either forward a plain request to the target or answer a CONNECT with a
// status of the case's choosing. The resolver seam makes `example.test`
// public and `intranet.test` private, so the routing decision is exercised
// without touching the network.

const CREDENTIALS = `Basic ${Buffer.from('alice:p@ss:w%rd').toString('base64')}`;

interface Asked {
  line: string;
  authorization: string | undefined;
}

let target: Server;
let targetPort = 0;

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

/** Tunnels a stand-in proxy holds open without relaying a byte. */
const heldTunnels: Socket[] = [];

/** A forward proxy on a free port. `connectStatus` answers a CONNECT;
 * `'hold'` opens the tunnel and then relays nothing, as a destination that
 * never answers its TLS handshake would look. */
async function startProxy(connectStatus: number | 'hold' = 200): Promise<{
  server: Server;
  port: number;
  asked: Asked[];
}> {
  const asked: Asked[] = [];
  const authorized = (req: IncomingMessage): boolean => {
    asked.push({
      line: `${req.method} ${req.url}`,
      authorization: req.headers['proxy-authorization'],
    });
    return req.headers['proxy-authorization'] === CREDENTIALS;
  };
  const server = createServer((req, res) => {
    if (!authorized(req)) {
      res.writeHead(407).end();
      return;
    }
    // Whatever host the request names, the target answers it.
    const path = new URL(req.url ?? '/').pathname;
    const upstream = httpRequest(
      { host: '127.0.0.1', port: targetPort, path, headers: req.headers },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.end();
  });
  server.on('connect', (req: IncomingMessage, socket: Socket) => {
    if (!authorized(req)) {
      socket.end('HTTP/1.1 407 Proxy Says So\r\n\r\n');
    } else if (connectStatus === 'hold') {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      heldTunnels.push(socket);
    } else {
      socket.end(`HTTP/1.1 ${connectStatus} Proxy Says So\r\n\r\n`);
    }
  });
  return { server, port: await listen(server), asked };
}

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const probe = createTcpServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
}

const proxyUrl = (port: number) =>
  `http://alice:p%40ss%3Aw%25rd@127.0.0.1:${port}`;

const servers: Server[] = [];

beforeAll(async () => {
  target = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`target saw ${req.headers.host ?? '?'}${req.url ?? ''}`);
  });
  targetPort = await listen(target);
});

afterAll(() => {
  target.close();
});

afterEach(() => {
  for (const socket of heldTunnels.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) server.close();
  delete process.env.OUTBOUND_PROXY_URLS;
  resetOutboundProxiesForTests();
  setSafeFetchResolverForTests(null);
  vi.restoreAllMocks();
});

async function useProxies(...statuses: Array<number | 'hold' | 'closed'>) {
  const proxies = [];
  const urls = [];
  for (const status of statuses) {
    if (status === 'closed') {
      urls.push(proxyUrl(await closedPort()));
      proxies.push(null);
      continue;
    }
    const proxy = await startProxy(status);
    servers.push(proxy.server);
    urls.push(proxyUrl(proxy.port));
    proxies.push(proxy);
  }
  process.env.OUTBOUND_PROXY_URLS = urls.join(', ');
  resetOutboundProxiesForTests();
  setSafeFetchResolverForTests(async (hostname) =>
    hostname === 'intranet.test'
      ? [{ address: '127.0.0.1', family: 4 }]
      : [{ address: '93.184.216.34', family: 4 }],
  );
  return proxies;
}

describe('safeFetch through the outbound proxies', () => {
  it('sends a public destination through the next proxy, with its decoded credentials', async () => {
    const [proxy] = await useProxies(200);
    const response = await safeFetch('http://example.test/page', {
      credentialless: true,
      outboundProxy: true,
    });
    expect(response.status).toBe(200);
    expect(response.body).toBe('target saw example.test/page');
    expect(proxy?.asked).toEqual([
      { line: 'GET http://example.test/page', authorization: CREDENTIALS },
    ]);
  });

  it('takes the proxies in turn, request by request', async () => {
    const [first, second] = await useProxies(200, 200);
    for (let i = 0; i < 4; i += 1) {
      await safeFetch(`http://example.test/${i}`, {
        credentialless: true,
        outboundProxy: true,
      });
    }
    expect(first?.asked.map((ask) => ask.line)).toEqual([
      'GET http://example.test/0',
      'GET http://example.test/2',
    ]);
    expect(second?.asked.map((ask) => ask.line)).toEqual([
      'GET http://example.test/1',
      'GET http://example.test/3',
    ]);
  });

  it('names the proxy each response came through by its entry, never its credentials', async () => {
    const [first, second] = await useProxies(200, 200);
    const viaFirst = await safeFetch('http://example.test/0', {
      credentialless: true,
      outboundProxy: true,
    });
    const viaSecond = await safeFetchBinary('http://example.test/1', {
      credentialless: true,
      outboundProxy: true,
    });
    expect(viaFirst.outboundProxy).toEqual({
      label: `http://127.0.0.1:${first?.port}`,
      entry: 1,
    });
    expect(viaSecond.outboundProxy).toEqual({
      label: `http://127.0.0.1:${second?.port}`,
      entry: 2,
    });
    expect(JSON.stringify(viaFirst.outboundProxy)).not.toContain('alice');
  });

  it('tunnels an https destination by name, so the proxy resolves it', async () => {
    const [proxy] = await useProxies(200);
    // The stand-in proxy closes the tunnel at once: the TLS handshake fails,
    // after the CONNECT it was asked for.
    await expect(
      safeFetch('https://example.test/', { outboundProxy: true }),
    ).rejects.toBeInstanceOf(SafeFetchError);
    expect(proxy?.asked).toEqual([
      { line: 'CONNECT example.test:443', authorization: CREDENTIALS },
    ]);
  });

  it('dials a destination that resolves to a private address directly', async () => {
    const [proxy] = await useProxies(200);
    const response = await safeFetch(`http://intranet.test:${targetPort}/`, {
      credentialless: true,
      allowPrivateAddresses: true,
      outboundProxy: true,
    });
    expect(response.body).toBe(`target saw intranet.test:${targetPort}/`);
    expect(response.outboundProxy).toBeUndefined();
    expect(proxy?.asked).toEqual([]);
  });

  it('leaves a request that did not ask for the proxies direct', async () => {
    const [proxy] = await useProxies(200);
    const response = await safeFetch(`http://intranet.test:${targetPort}/`, {
      credentialless: true,
      allowPrivateAddresses: true,
    });
    expect(response.status).toBe(200);
    expect(proxy?.asked).toEqual([]);
  });

  it('goes direct when no proxy is configured', async () => {
    setSafeFetchResolverForTests(async () => [
      { address: '127.0.0.1', family: 4 },
    ]);
    const response = await safeFetch(`http://intranet.test:${targetPort}/`, {
      credentialless: true,
      allowPrivateAddresses: true,
      outboundProxy: true,
    });
    expect(response.status).toBe(200);
  });

  it('moves to the next proxy when one cannot be reached, and passes over it afterwards', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [, live] = await useProxies('closed', 200);
    const first = await safeFetchBinary('http://example.test/a', {
      credentialless: true,
      outboundProxy: true,
    });
    expect(first.status).toBe(200);
    expect(first.outboundProxy?.entry).toBe(2);
    await safeFetch('http://example.test/b', {
      credentialless: true,
      outboundProxy: true,
    });
    expect(live?.asked.map((ask) => ask.line)).toEqual([
      'GET http://example.test/a',
      'GET http://example.test/b',
    ]);
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('ECONNREFUSED');
    expect(logged).toMatch(/http:\/\/127\.0\.0\.1:\d+ failed/);
    expect(logged).not.toContain('alice');
  });

  it('does not hold a 407 to a forwarded request against the proxy, since a destination can answer one too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [refusing, next] = await useProxies(200, 200);
    // The first proxy is told another password than the one it expects.
    process.env.OUTBOUND_PROXY_URLS = (process.env.OUTBOUND_PROXY_URLS ?? '')
      .split(', ')
      .map((url, index) => (index === 0 ? url.replace('p%40ss', 'wrong') : url))
      .join(', ');
    resetOutboundProxiesForTests();
    const failure = await safeFetch('http://example.test/x', {
      credentialless: true,
      outboundProxy: true,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ kind: 'network_error' });
    expect(failure instanceof Error ? failure.message : '').toContain(
      'through the outbound proxy http://127.0.0.1:',
    );
    expect(refusing?.asked).toHaveLength(1);
    expect(next?.asked).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('moves to the next proxy when one refuses the credentials of a tunnel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [refusing, next] = await useProxies(407, 200);
    // The next proxy opens the tunnel and closes it: the handshake fails
    // there, after the request moved on.
    await expect(
      safeFetch('https://example.test/', { outboundProxy: true }),
    ).rejects.toBeInstanceOf(SafeFetchError);
    expect(refusing?.asked.map((ask) => ask.line)).toEqual([
      'CONNECT example.test:443',
    ]);
    expect(next?.asked.map((ask) => ask.line)).toEqual([
      'CONNECT example.test:443',
    ]);
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
      'credentials refused (407)',
    );
  });

  it('does not hold a destination that never finishes its TLS handshake against the proxy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [holding, next] = await useProxies('hold', 200);
    // undici gives a connection 10 s, the TLS handshake inside the tunnel
    // included; the request's own deadline is longer.
    const failure = await safeFetch('https://example.test/', {
      outboundProxy: true,
      timeoutMs: 20_000,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ kind: 'network_error' });
    expect(failure instanceof Error ? failure.message : '').toContain(
      'example.test:443',
    );
    expect(holding?.asked.map((ask) => ask.line)).toEqual([
      'CONNECT example.test:443',
    ]);
    expect(next?.asked).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  }, 30_000);

  it('names the proxy, never its credentials, when the request fails through it', async () => {
    await useProxies(502);
    const failure = await safeFetch('https://example.test/', {
      outboundProxy: true,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SafeFetchError);
    const message = failure instanceof Error ? failure.message : '';
    expect(message).toMatch(
      /through the outbound proxy http:\/\/127\.0\.0\.1:\d+\)$/,
    );
    expect(message).toContain(
      'The proxy answered 502 instead of opening a tunnel',
    );
    expect(message).not.toContain('alice');
    expect(message).not.toContain('p%40ss');
  });

  it('still refuses what the policy refuses before any proxy is asked', async () => {
    const [proxy] = await useProxies(200);
    await expect(
      safeFetch('http://example.test/', { outboundProxy: true }),
    ).rejects.toMatchObject({ kind: 'insecure_public_http' });
    setSafeFetchResolverForTests(async () => [
      { address: '10.0.0.5', family: 4 },
    ]);
    await expect(
      safeFetch('https://example.test/', { outboundProxy: true }),
    ).rejects.toMatchObject({ kind: 'private_ip' });
    expect(proxy?.asked).toEqual([]);
  });
});
