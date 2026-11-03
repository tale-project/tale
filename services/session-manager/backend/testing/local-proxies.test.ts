import net from 'node:net';
import tls from 'node:tls';

import { afterEach, describe, expect, it } from 'vitest';

import { eventually } from './eventually.ts';
import {
  HttpProxy,
  Socks5Proxy,
  SocketReader,
  closedPort,
  connectThrough,
  parseRawResponse,
  rawHttp,
  readAll,
  selfSignedCertificate,
  startOrigin,
  startTcpServer,
} from './local-proxies.ts';
import type { Origin, ProxyEvent } from './local-proxies.ts';

const HOSTS = { 'site.test': '127.0.0.1' };
const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

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

/** An origin server (see `startOrigin`), stopped after the test. */
async function origin(): Promise<Origin> {
  const server = await startOrigin();
  cleanups.push(() => server.stop());
  return server;
}

function summary(events: readonly ProxyEvent[]) {
  return events.map((e) => [e.kind, e.target, e.username, e.status, e.ok]);
}

describe('HttpProxy', () => {
  it('forwards an absolute-form request as an origin-form one', async () => {
    const site = await origin();
    const proxy = await started(new HttpProxy({ hosts: HOSTS }));
    const response = await rawHttp(
      proxy.port,
      `GET http://site.test:${site.port}/x?y=1 HTTP/1.1\r\nHost: site.test:${site.port}\r\nProxy-Connection: keep-alive\r\nX-Kept: yes\r\nConnection: keep-alive\r\n\r\n`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toBe('hello');
    expect(site.heads).toEqual([
      `GET /x?y=1 HTTP/1.1\r\nHost: site.test:${site.port}\r\nX-Kept: yes\r\nConnection: close\r\n\r\n`,
    ]);
    expect(summary(proxy.events)).toEqual([
      ['HTTP', `http://site.test:${site.port}/x?y=1`, null, 200, true],
    ]);
    expect(proxy.events[0]).toMatchObject({
      method: 'GET',
      host: 'site.test',
      port: site.port,
      addrType: null,
    });
  });

  it('opens a CONNECT tunnel and relays both ways', async () => {
    const echo = await startTcpServer((socket) => {
      socket.on('data', (chunk) => socket.write(`echo:${chunk.toString()}`));
    });
    cleanups.push(() => echo.stop());
    const proxy = await started(new HttpProxy({ hosts: HOSTS }));
    const { socket, head, reader } = await connectThrough(
      proxy.port,
      `site.test:${echo.port}`,
    );
    expect(head).toBe('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.write('ping');
    expect((await reader.readExactly(9)).toString()).toBe('echo:ping');
    socket.destroy();
    expect(summary(proxy.events)).toEqual([
      ['CONNECT', `site.test:${echo.port}`, null, 200, true],
    ]);
  });

  it('passes on bytes sent right behind the CONNECT head', async () => {
    const echo = await startTcpServer((socket) => {
      socket.on('data', (chunk) => socket.write(`echo:${chunk.toString()}`));
    });
    cleanups.push(() => echo.stop());
    const proxy = await started(new HttpProxy());
    const socket = net.connect({ port: proxy.port, host: '127.0.0.1' });
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\n\r\nearly`);
    const text = (
      await new Promise<Buffer>((resolve) => {
        let got = Buffer.alloc(0);
        socket.on('data', (chunk) => {
          got = Buffer.concat([got, chunk]);
          if (got.toString().endsWith('echo:early')) resolve(got);
        });
      })
    ).toString();
    expect(text).toBe('HTTP/1.1 200 Connection Established\r\n\r\necho:early');
    socket.destroy();
  });

  it('asks for Basic credentials and checks them', async () => {
    const site = await origin();
    const proxy = await started(
      new HttpProxy({ username: 'u', password: 'p@ss:w/rd', hosts: HOSTS }),
    );
    const request = (auth?: string) =>
      rawHttp(
        proxy.port,
        `GET http://site.test:${site.port}/ HTTP/1.1\r\nHost: site.test\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ''}\r\n`,
      );

    const none = await request();
    expect(none.status).toBe(407);
    expect(none.headers['proxy-authenticate']).toBe(
      'Basic realm="local-proxy"',
    );
    expect((await request(basic('u', 'wrong'))).status).toBe(407);
    expect((await request(basic('x', 'p@ss:w/rd'))).status).toBe(407);
    expect((await request('Bearer abc')).status).toBe(407);
    expect((await request('Basic !!!not-base64')).status).toBe(407);
    expect((await request(basic('u', 'p@ss:w/rd'))).status).toBe(200);

    expect(proxy.events.map((e) => [e.status, e.username, e.ok])).toEqual([
      [407, null, false],
      [407, 'u', false],
      [407, 'x', false],
      [407, null, false],
      [407, null, false],
      [200, 'u', true],
    ]);
    expect(site.heads).toHaveLength(1);
  });

  it('answers a CONNECT without credentials with 407 too', async () => {
    const proxy = await started(
      new HttpProxy({ username: 'u', password: 'p' }),
    );
    const { socket, head } = await connectThrough(proxy.port, 'site.test:443');
    expect(head.startsWith('HTTP/1.1 407 ')).toBe(true);
    socket.destroy();
    expect(proxy.events[0]).toMatchObject({
      kind: 'CONNECT',
      status: 407,
      host: 'site.test',
      port: 443,
    });
  });

  it('refuses what is not a proxy request with 400', async () => {
    const proxy = await started(new HttpProxy());
    for (const request of [
      'GET /relative HTTP/1.1\r\n\r\n',
      'GET https://site.test/ HTTP/1.1\r\n\r\n',
      'GET http://:80/ HTTP/1.1\r\n\r\n',
    ]) {
      expect((await rawHttp(proxy.port, request)).status).toBe(400);
    }
    expect((await rawHttp(proxy.port, 'NONSENSE\r\n\r\n')).status).toBe(400);
    expect(
      (await connectThrough(proxy.port, 'no-port-here')).head.startsWith(
        'HTTP/1.1 400 ',
      ),
    ).toBe(true);
    // The three that parsed as a request are recorded, the one without a request line is not.
    expect(proxy.events.map((e) => [e.status, e.host, e.port])).toEqual([
      [400, '', 0],
      [400, '', 0],
      [400, '', 0],
      [400, '', 0],
    ]);
  });

  it('counts its client connections, and lets go of one that is done', async () => {
    const proxy = await started(
      new HttpProxy({ username: 'u', password: 'p' }),
    );
    expect(proxy.connections).toBe(0);
    await rawHttp(proxy.port, 'GET http://x.test/ HTTP/1.1\r\n\r\n'); // a 407
    await eventually(() => proxy.connections === 0);
    const idle = net.connect({ host: '127.0.0.1', port: proxy.port });
    await new Promise<void>((resolve) => idle.once('connect', resolve));
    await eventually(() => proxy.connections === 1);
    idle.destroy();
    await eventually(() => proxy.connections === 0);
  });

  it('answers 502 when the target refuses', async () => {
    const port = await closedPort();
    const proxy = await started(new HttpProxy());
    expect(
      (
        await rawHttp(
          proxy.port,
          `GET http://127.0.0.1:${port}/ HTTP/1.1\r\n\r\n`,
        )
      ).status,
    ).toBe(502);
    const { head } = await connectThrough(proxy.port, `127.0.0.1:${port}`);
    expect(head.startsWith('HTTP/1.1 502 Bad Gateway')).toBe(true);
    expect(proxy.events.map((e) => [e.kind, e.status, e.ok])).toEqual([
      ['HTTP', 502, false],
      ['CONNECT', 502, false],
    ]);
  });

  it('routes a fake name to its address, and an unmapped name is looked up', async () => {
    const site = await origin();
    const proxy = await started(
      new HttpProxy({ hosts: { 'Site.Test': '127.0.0.1' } }),
    );
    expect(
      (
        await rawHttp(
          proxy.port,
          `GET http://SITE.test:${site.port}/ HTTP/1.1\r\n\r\n`,
        )
      ).status,
    ).toBe(200);
  });

  it('forwards a request body', async () => {
    const received: string[] = [];
    const sink = await startTcpServer((socket) => {
      let data = '';
      socket.on('data', (chunk) => {
        data += chunk.toString();
        if (data.endsWith('payload')) {
          received.push(data);
          socket.end('HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n');
        }
      });
    });
    cleanups.push(() => sink.stop());
    const proxy = await started(new HttpProxy());
    const response = await rawHttp(
      proxy.port,
      `POST http://127.0.0.1:${sink.port}/up HTTP/1.1\r\nHost: x\r\nContent-Length: 7\r\n\r\npayload`,
    );
    expect(response.status).toBe(204);
    expect(received).toEqual([
      'POST /up HTTP/1.1\r\nHost: x\r\nContent-Length: 7\r\nConnection: close\r\n\r\npayload',
    ]);
  });

  it('describes itself', async () => {
    const proxy = await started(
      new HttpProxy({ username: "us er's", password: 'p@ss:w/rd!(*)' }),
    );
    expect(proxy.running).toBe(true);
    expect(proxy.scheme).toBe('http');
    expect(proxy.server).toBe(`http://127.0.0.1:${proxy.port}`);
    expect(proxy.url).toBe(proxy.server);
    expect(proxy.urlWithAuth).toBe(
      `http://us%20er%27s:p%40ss%3Aw%2Frd%21%28%2A%29@127.0.0.1:${proxy.port}`,
    );
    expect(proxy.playwrightProxy).toEqual({
      server: proxy.server,
      username: "us er's",
      password: 'p@ss:w/rd!(*)',
    });
    const open = await started(new HttpProxy());
    expect(open.playwrightProxy).toEqual({ server: open.server });
    expect(open.urlWithAuth).toBe(open.server);
  });

  it('wants both credentials or neither', () => {
    expect(() => new HttpProxy({ username: 'u' })).toThrow(
      'both username and password',
    );
    expect(() => new Socks5Proxy({ password: 'p' })).toThrow(
      'both username and password',
    );
  });

  it('finds events with saw, targets, waitFor and clear, and tells a listener', async () => {
    const site = await origin();
    const seen: ProxyEvent[] = [];
    const proxy = await started(
      new HttpProxy({ hosts: HOSTS, onEvent: (event) => seen.push(event) }),
    );
    const waiting = proxy.waitFor((e) => e.host === 'site.test' && e.ok);
    await rawHttp(
      proxy.port,
      `GET http://site.test:${site.port}/ HTTP/1.1\r\n\r\n`,
    );
    expect((await waiting).kind).toBe('HTTP');
    expect(await proxy.waitFor((e) => e.status === 200)).toBe(seen[0]);

    expect(proxy.saw('SITE.test')).toBe(true);
    expect(proxy.saw('site.test', site.port, { kind: 'HTTP', ok: true })).toBe(
      true,
    );
    expect(proxy.saw('site.test', site.port, { kind: 'CONNECT' })).toBe(false);
    expect(proxy.saw('site.test', site.port, { ok: false })).toBe(false);
    expect(proxy.saw('site.test', 1)).toBe(false);
    expect(proxy.saw('other.test')).toBe(false);
    expect(proxy.targets()).toEqual([`http://site.test:${site.port}/`]);
    expect(proxy.targets('CONNECT')).toEqual([]);

    await expect(proxy.waitFor((e) => e.status === 999, 50)).rejects.toThrow(
      'no matching proxy event',
    );
    proxy.clear();
    expect(proxy.events).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it('closes open tunnels and refuses new connections when it stops', async () => {
    const echo = await startTcpServer(() => undefined);
    cleanups.push(() => echo.stop());
    const proxy = await started(new HttpProxy());
    const { socket } = await connectThrough(
      proxy.port,
      `127.0.0.1:${echo.port}`,
    );
    const closed = new Promise<void>((resolve) =>
      socket.once('close', () => resolve()),
    );
    const pending = proxy.waitFor(() => false, 10_000);
    const rejected = expect(pending).rejects.toThrow('proxy stopped');
    await proxy.stop();
    await closed;
    await rejected;
    expect(proxy.running).toBe(false);
    await expect(
      rawHttp(proxy.port, 'GET http://x/ HTTP/1.1\r\n\r\n'),
    ).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
    await proxy.stop(); // and again
  });

  it('talks TLS to its clients when it has a certificate', async () => {
    const certificate = await selfSignedCertificate();
    const site = await origin();
    const proxy = await started(
      new HttpProxy({ tls: certificate, hosts: HOSTS }),
    );
    expect(proxy.scheme).toBe('https');
    expect(proxy.server).toBe(`https://127.0.0.1:${proxy.port}`);

    const socket = tls.connect({
      host: '127.0.0.1',
      port: proxy.port,
      ca: certificate.cert,
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
    expect(socket.authorized).toBe(true);
    socket.write(`GET http://site.test:${site.port}/ HTTP/1.1\r\n\r\n`);
    socket.end();
    const answer = parseRawResponse((await readAll(socket)).toString('latin1'));
    expect(answer.status).toBe(200);
    expect(answer.body).toBe('hello');

    // Without the certificate as a trust anchor, the handshake fails.
    const untrusting = tls.connect({ host: '127.0.0.1', port: proxy.port });
    const error = await new Promise<NodeJS.ErrnoException>((resolve) =>
      untrusting.once('error', resolve),
    );
    expect(error.code).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
  });
});

/** A SOCKS5 client by hand. */
async function socksClient(port: number) {
  const socket = net.connect({ host: '127.0.0.1', port });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const reader = new SocketReader(socket);
  return {
    socket,
    reader,
    async greet(methods: number[]): Promise<[number, number]> {
      socket.write(Buffer.from([5, methods.length, ...methods]));
      const [version = 0, method = 0] = await reader.readExactly(2);
      return [version, method];
    },
    async login(user: string, password: string): Promise<number> {
      const u = Buffer.from(user);
      const p = Buffer.from(password);
      socket.write(
        Buffer.concat([
          Buffer.from([1, u.length]),
          u,
          Buffer.from([p.length]),
          p,
        ]),
      );
      return (await reader.readExactly(2))[1] ?? -1;
    },
    /** Returns the REP code. */
    async connect(
      target: { domain: string } | { ipv4: number[] } | { raw: number[] },
      targetPort: number,
      command = 1,
    ) {
      let address: Buffer;
      if ('domain' in target) {
        address = Buffer.concat([
          Buffer.from([3, target.domain.length]),
          Buffer.from(target.domain),
        ]);
      } else if ('ipv4' in target) {
        address = Buffer.from([1, ...target.ipv4]);
      } else {
        address = Buffer.from(target.raw);
      }
      const port16 = Buffer.alloc(2);
      port16.writeUInt16BE(targetPort);
      socket.write(
        Buffer.concat([Buffer.from([5, command, 0]), address, port16]),
      );
      const header = await reader.readExactly(4);
      const atyp = header[3];
      await reader.readExactly(atyp === 4 ? 18 : 6);
      return header[1] ?? -1;
    },
  };
}

describe('Socks5Proxy', () => {
  it('connects a host name, resolved by the proxy, and relays', async () => {
    const echo = await startTcpServer((socket) => {
      socket.on('data', (chunk) => socket.write(`echo:${chunk.toString()}`));
    });
    cleanups.push(() => echo.stop());
    const proxy = await started(new Socks5Proxy({ hosts: HOSTS }));
    const client = await socksClient(proxy.port);
    expect(await client.greet([0])).toEqual([5, 0]);
    expect(await client.connect({ domain: 'site.test' }, echo.port)).toBe(0);
    client.socket.write('ping');
    expect((await client.reader.readExactly(9)).toString()).toBe('echo:ping');
    client.socket.destroy();
    expect(proxy.events).toHaveLength(1);
    expect(proxy.events[0]).toMatchObject({
      kind: 'SOCKS5',
      method: 'CONNECT',
      target: `site.test:${echo.port}`,
      host: 'site.test',
      port: echo.port,
      status: 0,
      username: null,
      addrType: 'domain',
      ok: true,
    });
    expect(proxy.scheme).toBe('socks5');
    expect(proxy.server).toBe(`socks5://127.0.0.1:${proxy.port}`);
  });

  it('connects an IPv4 address', async () => {
    const echo = await startTcpServer((socket) => socket.end('bye'));
    cleanups.push(() => echo.stop());
    const proxy = await started(new Socks5Proxy());
    const client = await socksClient(proxy.port);
    await client.greet([0]);
    expect(await client.connect({ ipv4: [127, 0, 0, 1] }, echo.port)).toBe(0);
    // Through the reader that took the reply: a chunk that holds the reply and
    // the "bye" together is in its buffer, not in a listener added now.
    expect((await client.reader.readToEnd()).toString()).toBe('bye');
    expect(proxy.events[0]).toMatchObject({
      target: `127.0.0.1:${echo.port}`,
      addrType: 'ipv4',
    });
  });

  it('reads an IPv6 address', async () => {
    const proxy = await started(new Socks5Proxy());
    const client = await socksClient(proxy.port);
    await client.greet([0]);
    const raw = [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
    // Nothing listens at [::1]:9: refused, or unreachable where IPv6 is off.
    expect([4, 5]).toContain(await client.connect({ raw }, 9));
    expect(proxy.events[0]).toMatchObject({
      host: '0:0:0:0:0:0:0:1',
      port: 9,
      addrType: 'ipv6',
    });
  });

  it('requires and checks user/password when it has them', async () => {
    const echo = await startTcpServer((socket) => socket.end('bye'));
    cleanups.push(() => echo.stop());
    const proxy = await started(
      new Socks5Proxy({ username: 'su', password: 's:p@w' }),
    );

    const good = await socksClient(proxy.port);
    expect(await good.greet([0, 2])).toEqual([5, 2]);
    expect(await good.login('su', 's:p@w')).toBe(0);
    expect(await good.connect({ ipv4: [127, 0, 0, 1] }, echo.port)).toBe(0);
    good.socket.destroy();

    const bad = await socksClient(proxy.port);
    expect(await bad.greet([0, 2])).toEqual([5, 2]);
    expect(await bad.login('su', 'WRONG')).toBe(1);
    bad.socket.destroy();

    const noMethod = await socksClient(proxy.port);
    expect(await noMethod.greet([0])).toEqual([5, 0xff]);
    noMethod.socket.destroy();

    await proxy.waitFor((e) => e.kind === 'AUTH' && e.method === 'METHOD');
    expect(summary(proxy.events)).toEqual([
      ['SOCKS5', `127.0.0.1:${echo.port}`, 'su', 0, true],
      ['AUTH', '', 'su', 1, false],
      ['AUTH', '', null, 0xff, false],
    ]);
    expect(proxy.playwrightProxy).toEqual({
      server: proxy.server,
      username: 'su',
      password: 's:p@w',
    });
  });

  it('replies with the reason when the target cannot be reached', async () => {
    const port = await closedPort();
    const proxy = await started(new Socks5Proxy({ hosts: HOSTS }));
    const client = await socksClient(proxy.port);
    await client.greet([0]);
    expect(await client.connect({ domain: 'site.test' }, port)).toBe(
      Socks5Proxy.CONNECTION_REFUSED,
    );
    expect(proxy.events[0]).toMatchObject({ status: 5, ok: false });
  });

  it('replies "command not supported" to BIND and "address type not supported" to a bad one', async () => {
    const proxy = await started(new Socks5Proxy());
    const bind = await socksClient(proxy.port);
    await bind.greet([0]);
    expect(await bind.connect({ ipv4: [127, 0, 0, 1] }, 80, 2)).toBe(
      Socks5Proxy.COMMAND_NOT_SUPPORTED,
    );
    expect(proxy.events[0]).toMatchObject({
      method: 'BIND',
      status: 7,
      ok: false,
    });

    const odd = await socksClient(proxy.port);
    await odd.greet([0]);
    odd.socket.write(Buffer.from([5, 1, 0, 9, 0, 0, 0, 0]));
    const header = await odd.reader.readExactly(4);
    expect(header[1]).toBe(Socks5Proxy.ADDRESS_TYPE_NOT_SUPPORTED);
  });

  it('ignores a client that does not speak SOCKS5', async () => {
    const proxy = await started(new Socks5Proxy());
    const socket = net.connect({ host: '127.0.0.1', port: proxy.port });
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write('GET / HTTP/1.1\r\n\r\n');
    expect((await readAll(socket)).length).toBe(0);
    expect(proxy.events).toEqual([]);
  });
});

describe('selfSignedCertificate', () => {
  it('is valid for the names it was made for, and for nothing else', async () => {
    const certificate = await selfSignedCertificate({
      ips: ['127.0.0.1'],
      dns: ['ip-echo.test'],
    });
    const server = await startTcpServer((socket) => socket.end('hi'), {
      tls: certificate,
    });
    cleanups.push(() => server.stop());
    const read = async (options: tls.ConnectionOptions) => {
      const socket = tls.connect({
        host: '127.0.0.1',
        port: server.port,
        ca: certificate.cert,
        ...options,
      });
      const outcome = await new Promise<string>((resolve) => {
        socket.once('secureConnect', () => resolve('ok'));
        socket.once('error', (error: NodeJS.ErrnoException) =>
          resolve(error.code ?? error.message),
        );
      });
      socket.destroy();
      return outcome;
    };
    expect(await read({})).toBe('ok');
    expect(await read({ servername: 'ip-echo.test' })).toBe('ok');
    expect(await read({ servername: 'other.test' })).toBe(
      'ERR_TLS_CERT_ALTNAME_INVALID',
    );
  });

  it('is a new key every time', async () => {
    const [a, b] = await Promise.all([
      selfSignedCertificate(),
      selfSignedCertificate(),
    ]);
    expect(a.cert).not.toBe(b.cert);
    expect(a.key).toMatch(
      // nosemgrep: tools.opengrep.ts-no-private-key-literal -- not a key: the pattern the generated PEM of this test run has to match
      /^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\n$/,
    );
  });
});

/** How a connection to `port` on 127.0.0.1 ends: `connected` or its error code. */
function connectionTo(port: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code));
  });
}

describe('startTcpServer', () => {
  it('destroys open connections when stopped', async () => {
    const server = await startTcpServer(() => undefined);
    const socket = net.connect({ host: '127.0.0.1', port: server.port });
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    const closed = new Promise<void>((resolve) =>
      socket.once('close', () => resolve()),
    );
    await server.stop();
    await closed;
    await server.stop();
  });

  it('tells a closed port from an open one', async () => {
    const port = await closedPort();
    expect(await connectionTo(port)).toBe('ECONNREFUSED');
  });

  // Linux only: other systems may hand a port that a connected socket holds to
  // a server that asks for any port (see `closedPort`).
  it.skipIf(process.platform !== 'linux')(
    'keeps the closed port from the servers that start while the test runs',
    async () => {
      const port = await closedPort();
      // Were the port only closed again, one of these 20,000 servers would
      // nearly always get it.
      for (let round = 0; round < 200; round++) {
        const servers = await Promise.all(
          Array.from({ length: 100 }, () => startTcpServer(() => undefined)),
        );
        await Promise.all(servers.map((server) => server.stop()));
        expect(servers.map((server) => server.port)).not.toContain(port);
      }
      expect(await connectionTo(port)).toBe('ECONNREFUSED');
    },
  );
});
