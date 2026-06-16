import { afterEach, describe, expect, test } from 'bun:test';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
} from 'node:http';
import {
  connect,
  createServer as createTcpServer,
  type Server as TcpServer,
  type Socket,
} from 'node:net';

import {
  getActiveScreencasts,
  handleScreencastUpgrade,
} from './screencast-tunnel.ts';

// NOTE on the test driver: runnerd runs under Node (the daemon is built with
// `bun build --target=node` and executed by the image's Node 24). Under the
// `bun test` runtime, Bun's node:http server drops writes made to an upgrade
// socket *after* the synchronous 'upgrade' event tick (verified: a 101 written
// from the vnc 'connect' callback never reaches the client), so we cannot drive
// the handler through a Bun http server. We instead feed handleScreencastUpgrade
// a real accepted net.Socket (whose writes DO flush under Bun) plus a minimal
// fake IncomingMessage — exercising every line of the handler (auth, dial-first,
// 101/401/502, full-duplex pipe, teardown, counting) without the Bun http quirk.

const TOKEN_HEADER = 'x-tale-runnerd-token';
const TOKEN = 'unit-test-token';

// Token check mirroring main.ts tokenOk (empty TOKEN = dev-mode allow).
function tokenOk(req: IncomingMessage): boolean {
  const got = req.headers[TOKEN_HEADER];
  const value = Array.isArray(got) ? (got[0] ?? '') : (got ?? '');
  return value === TOKEN;
}

function fakeReq(token?: string): IncomingMessage {
  const headers: Record<string, string> = { host: 'runnerd' };
  if (token !== undefined) headers[TOKEN_HEADER] = token;
  // The handler only reads url + headers off the request; a partial stub is
  // sufficient (same convention as k8s-backend.test.ts's partial fixtures).
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
  return { url: '/screencast', headers } as unknown as IncomingMessage;
}

/** Bound-port of a listening server, narrowed without an assertion (the repo
 * convention — see spawn-staging.test.ts). */
function boundPort(server: TcpServer | HttpServer): number {
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('server is not bound to a TCP port');
  }
  return addr.port;
}

// --- fake x11vnc ------------------------------------------------------------

interface FakeVnc {
  server: TcpServer;
  port: number;
  conns: Socket[];
  /** Resolve with the next accepted socket past index `from`. */
  nextConn: (from: number) => Promise<Socket>;
}

function startFakeVnc(): Promise<FakeVnc> {
  return new Promise((resolve) => {
    const conns: Socket[] = [];
    const server = createTcpServer((sock) => conns.push(sock));
    server.listen(0, '127.0.0.1', () => {
      const port = boundPort(server);
      resolve({
        server,
        port,
        conns,
        nextConn: (from: number) =>
          new Promise<Socket>((res, rej) => {
            const deadline = Date.now() + 1_000;
            const check = () => {
              const sock = conns[from];
              if (sock !== undefined) {
                res(sock);
                return;
              }
              if (Date.now() > deadline) {
                rej(new Error('no x11vnc connection accepted'));
                return;
              }
              setTimeout(check, 5);
            };
            check();
          }),
      });
    });
  });
}

// --- client-side driver -----------------------------------------------------
//
// A tiny TCP listener whose ACCEPTED socket is handed to the handler as the
// "client socket" (where it writes 101/401/502 + relays bytes). The CONNECTING
// end is the test's view of the client — it reads the response preamble and the
// relayed stream, and writes client→server bytes.

interface ClientDriver {
  /** Test-side socket (the "browser" end). */
  client: Socket;
  /** Server-side accepted socket (handed to the handler). */
  accepted: Socket;
  close: () => void;
}

function makeClientPair(): Promise<ClientDriver> {
  return new Promise((resolve) => {
    const listener = createTcpServer((accepted) => {
      const close = () => {
        client.destroy();
        accepted.destroy();
        listener.close();
      };
      resolve({ client, accepted, close });
    });
    let client: Socket;
    listener.listen(0, '127.0.0.1', () => {
      client = connect(boundPort(listener), '127.0.0.1');
    });
  });
}

/** Read the HTTP preamble (status line + headers) off the client end. Returns
 * the status code and any bytes that followed the header terminator. */
function readPreamble(
  client: Socket,
): Promise<{ statusCode: number; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let done = false;
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const sep = buf.indexOf('\r\n\r\n');
      if (sep === -1) return;
      done = true;
      client.off('data', onData);
      const header = buf.subarray(0, sep).toString('latin1');
      const statusLine = header.split('\r\n')[0] ?? '';
      const statusCode = Number(statusLine.split(' ')[1] ?? '0') || 0;
      resolve({ statusCode, rest: buf.subarray(sep + 4) });
    };
    client.on('data', onData);
    client.on('close', () => {
      if (!done) reject(new Error('client closed before any response'));
    });
    setTimeout(() => {
      if (!done) reject(new Error('no preamble received'));
    }, 1_000);
  });
}

function waitFor(pred: () => boolean, timeoutMs = 1_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (pred()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitFor timed out'));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

let toCleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of toCleanup) fn();
  toCleanup = [];
  delete process.env.TALE_SCREENCAST_TARGET_HOST;
  delete process.env.TALE_SCREENCAST_TARGET_PORT;
});

describe('screencast tunnel', () => {
  test('valid token + stub up → 101, full-duplex relay, count 1 then 0', async () => {
    const vnc = await startFakeVnc();
    const pair = await makeClientPair();
    toCleanup.push(() => vnc.server.close());
    toCleanup.push(() => pair.close());
    process.env.TALE_SCREENCAST_TARGET_HOST = '127.0.0.1';
    process.env.TALE_SCREENCAST_TARGET_PORT = String(vnc.port);

    const before = vnc.conns.length;
    expect(getActiveScreencasts()).toBe(0);

    let touched = 0;
    const preamble = readPreamble(pair.client);
    handleScreencastUpgrade(fakeReq(TOKEN), pair.accepted, Buffer.alloc(0), {
      tokenOk,
      touch: () => {
        touched += 1;
      },
    });

    const { statusCode } = await preamble;
    expect(statusCode).toBe(101);

    const vncSock = await vnc.nextConn(before);
    await waitFor(() => getActiveScreencasts() === 1);
    expect(touched).toBe(1);

    // client → stub
    const fromClient: Buffer[] = [];
    vncSock.on('data', (d: Buffer) => fromClient.push(d));
    pair.client.write(Buffer.from('hello-vnc'));
    await waitFor(() => Buffer.concat(fromClient).toString() === 'hello-vnc');

    // stub → client
    const fromStub: Buffer[] = [];
    pair.client.on('data', (d: Buffer) => fromStub.push(d));
    vncSock.write(Buffer.from('RFB-003'));
    await waitFor(() => Buffer.concat(fromStub).toString() === 'RFB-003');

    // client closes → count back to 0
    pair.client.destroy();
    await waitFor(() => getActiveScreencasts() === 0);
  });

  test('buffered head bytes are forwarded to x11vnc before the live pipe', async () => {
    const vnc = await startFakeVnc();
    const pair = await makeClientPair();
    toCleanup.push(() => vnc.server.close());
    toCleanup.push(() => pair.close());
    process.env.TALE_SCREENCAST_TARGET_HOST = '127.0.0.1';
    process.env.TALE_SCREENCAST_TARGET_PORT = String(vnc.port);

    const before = vnc.conns.length;
    const preamble = readPreamble(pair.client);
    handleScreencastUpgrade(
      fakeReq(TOKEN),
      pair.accepted,
      Buffer.from('HEAD-BYTES'),
      { tokenOk, touch: () => {} },
    );
    expect((await preamble).statusCode).toBe(101);

    const vncSock = await vnc.nextConn(before);
    const fromClient: Buffer[] = [];
    vncSock.on('data', (d: Buffer) => fromClient.push(d));
    pair.client.write(Buffer.from('LIVE'));
    await waitFor(
      () => Buffer.concat(fromClient).toString() === 'HEAD-BYTESLIVE',
    );

    pair.client.destroy();
    await waitFor(() => getActiveScreencasts() === 0);
  });

  test('bad token → 401, no dial to stub, count stays 0', async () => {
    const vnc = await startFakeVnc();
    const pair = await makeClientPair();
    toCleanup.push(() => vnc.server.close());
    toCleanup.push(() => pair.close());
    process.env.TALE_SCREENCAST_TARGET_HOST = '127.0.0.1';
    process.env.TALE_SCREENCAST_TARGET_PORT = String(vnc.port);

    const before = vnc.conns.length;
    const preamble = readPreamble(pair.client);
    handleScreencastUpgrade(fakeReq('wrong'), pair.accepted, Buffer.alloc(0), {
      tokenOk,
      touch: () => {},
    });
    expect((await preamble).statusCode).toBe(401);

    // No dial reached the stub; the count never moved.
    await waitFor(() => true, 50).catch(() => {});
    expect(vnc.conns.length).toBe(before);
    expect(getActiveScreencasts()).toBe(0);
  });

  test('missing token → 401', async () => {
    const pair = await makeClientPair();
    toCleanup.push(() => pair.close());

    const preamble = readPreamble(pair.client);
    handleScreencastUpgrade(
      fakeReq(undefined),
      pair.accepted,
      Buffer.alloc(0),
      {
        tokenOk,
        touch: () => {},
      },
    );
    expect((await preamble).statusCode).toBe(401);
    expect(getActiveScreencasts()).toBe(0);
  });

  test('stub DOWN (closed port) → 502, socket closed, count 0', async () => {
    const pair = await makeClientPair();
    toCleanup.push(() => pair.close());
    // Bind then close a TCP server to obtain a definitely-closed port.
    const dead = await startFakeVnc();
    const deadPort = dead.port;
    await new Promise<void>((res) => dead.server.close(() => res()));
    process.env.TALE_SCREENCAST_TARGET_HOST = '127.0.0.1';
    process.env.TALE_SCREENCAST_TARGET_PORT = String(deadPort);

    let clientClosed = false;
    pair.client.on('close', () => {
      clientClosed = true;
    });

    const preamble = readPreamble(pair.client);
    handleScreencastUpgrade(fakeReq(TOKEN), pair.accepted, Buffer.alloc(0), {
      tokenOk,
      touch: () => {},
    });
    expect((await preamble).statusCode).toBe(502);
    await waitFor(() => clientClosed);
    expect(getActiveScreencasts()).toBe(0);
  });

  test('client closes → stub-side socket closes (teardown propagates)', async () => {
    const vnc = await startFakeVnc();
    const pair = await makeClientPair();
    toCleanup.push(() => vnc.server.close());
    toCleanup.push(() => pair.close());
    process.env.TALE_SCREENCAST_TARGET_HOST = '127.0.0.1';
    process.env.TALE_SCREENCAST_TARGET_PORT = String(vnc.port);

    const before = vnc.conns.length;
    const preamble = readPreamble(pair.client);
    handleScreencastUpgrade(fakeReq(TOKEN), pair.accepted, Buffer.alloc(0), {
      tokenOk,
      touch: () => {},
    });
    expect((await preamble).statusCode).toBe(101);

    const vncSock = await vnc.nextConn(before);
    await waitFor(() => getActiveScreencasts() === 1);

    let stubClosed = false;
    vncSock.on('close', () => {
      stubClosed = true;
    });

    pair.client.destroy();
    await waitFor(() => stubClosed);
    expect(stubClosed).toBe(true);
    await waitFor(() => getActiveScreencasts() === 0);
  });

  test('getActiveScreencasts reflects a live tunnel (the value /healthz reports)', async () => {
    const vnc = await startFakeVnc();
    const pair = await makeClientPair();
    toCleanup.push(() => vnc.server.close());
    toCleanup.push(() => pair.close());
    process.env.TALE_SCREENCAST_TARGET_HOST = '127.0.0.1';
    process.env.TALE_SCREENCAST_TARGET_PORT = String(vnc.port);

    expect(getActiveScreencasts()).toBe(0); // the field /healthz serializes

    const before = vnc.conns.length;
    const preamble = readPreamble(pair.client);
    handleScreencastUpgrade(fakeReq(TOKEN), pair.accepted, Buffer.alloc(0), {
      tokenOk,
      touch: () => {},
    });
    expect((await preamble).statusCode).toBe(101);
    await vnc.nextConn(before);
    await waitFor(() => getActiveScreencasts() === 1);

    pair.client.destroy();
    await waitFor(() => getActiveScreencasts() === 0);
  });

  test('/healthz body includes activeScreencasts (the field main.ts serializes)', async () => {
    // Plain GET /healthz — no upgrade, so unaffected by Bun's upgrade-socket
    // quirk. Mirrors the body main.ts writes; asserts the field rides through.
    const server = createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            bootedAtMs: 0,
            lastActivityAtMs: 0,
            liveExecs: 0,
            activeScreencasts: getActiveScreencasts(),
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((res) =>
      server.listen(0, '127.0.0.1', () => res()),
    );
    const port = boundPort(server);
    toCleanup.push(() => server.close());

    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body: unknown = await res.json();
    const activeScreencasts =
      typeof body === 'object' && body !== null && 'activeScreencasts' in body
        ? body.activeScreencasts
        : undefined;
    expect(typeof activeScreencasts).toBe('number');
    expect(activeScreencasts).toBe(0);
  });
});
