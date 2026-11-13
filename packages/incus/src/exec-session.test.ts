// Exec mode 3, the websocket session: against the fake's websocket server
// (stdin of any size, both output streams, signals, a kill by closing the
// control socket, the bounds of a run), and against a TLS server that
// demands the client certificate, so the websockets ride the same pinned
// mutual TLS as a request.

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import { createHash } from 'node:crypto';

import { IncusClient } from './client.ts';
import { execOverWebSocket, openExecSession } from './exec-session.ts';
import { FakeIncus } from './fake.ts';
import {
  makeTestCertificates,
  type TestCertificates,
} from './test-certificates.ts';

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`rejected with a non-Error: ${String(error)}`, {
      cause: error,
    });
  }
  throw new Error('expected the promise to reject');
}

const fakes: FakeIncus[] = [];
afterEach(() => {
  for (const fake of fakes.splice(0)) fake.close();
});

function running(): FakeIncus {
  const fake = new FakeIncus({ project: 'stack' });
  fake.seedInstance('db', {}, { ephemeral: false });
  fakes.push(fake);
  return fake;
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('a session against the fake', () => {
  test('stdin over 1 MiB arrives whole; stdout, stderr and the code come back', async () => {
    const fake = running();
    fake.exec = async (call, io) => {
      const input = await io.stdin();
      io.write(1, createHash('sha256').update(input).digest('hex'));
      io.write(2, `as ${call.user}`);
      return 7;
    };
    const stdin = new Uint8Array(3 * 1024 * 1024 + 17);
    crypto.getRandomValues(stdin.subarray(0, 65536));
    const result = await execOverWebSocket(fake.client(), 'db', ['sha256sum'], {
      stdin,
      user: 70,
      maxOutputBytes: 4096,
      deadlineMs: 10_000,
    });
    expect(result.exitCode).toBe(7);
    expect(text(result.stdout)).toBe(
      createHash('sha256').update(stdin).digest('hex'),
    );
    expect(text(result.stderr)).toBe('as 70');
    const [request] = fake.seen('POST /1.0/instances/db/exec');
    expect(request?.body).toMatchObject({
      command: ['sha256sum'],
      'wait-for-websocket': true,
      'record-output': false,
      interactive: false,
      user: 70,
    });
    // Nothing went through the file API: a websocket exec writes no file.
    expect(fake.seen('POST /1.0/instances/db/files')).toEqual([]);
  });

  test('a held session answers line by line until its stdin ends', async () => {
    const fake = running();
    fake.exec = async (_call, io) => {
      for await (const chunk of io.stdinChunks())
        io.write(1, `>${text(chunk)}`);
      return 0;
    };
    const seen: string[] = [];
    let wake: () => void = () => undefined;
    const session = await openExecSession(fake.client(), 'db', ['psql'], {
      onOutput: (fd, chunk) => {
        if (fd === 1) seen.push(text(chunk));
        wake();
      },
    });
    for (const line of ['SELECT 1;', 'SELECT 2;']) {
      const answered = new Promise<void>((resolve) => {
        wake = resolve;
      });
      session.write(line);
      await answered;
    }
    session.closeStdin();
    expect(await session.exit).toBe(0);
    expect(seen).toEqual(['>SELECT 1;', '>SELECT 2;']);
  });

  test('a signal reaches the command over the control socket', async () => {
    const fake = running();
    fake.exec = async (_call, io) => {
      while (io.signals.length === 0) await Bun.sleep(5);
      return 128 + (io.signals[0] ?? 0);
    };
    const session = await openExecSession(fake.client(), 'db', ['sleep', '9']);
    session.signal(15);
    expect(await session.exit).toBe(143);
    expect(() => session.signal(0)).toThrow('Not a signal');
  });

  test('closing the session kills the command', async () => {
    const fake = running();
    fake.exec = (_call, io) =>
      new Promise<number>((resolve) => {
        io.killed.addEventListener('abort', () => resolve(137));
      });
    const session = await openExecSession(fake.client(), 'db', ['sleep', '9']);
    session.close();
    expect(await session.exit).toBe(137);
    expect(() => session.write('x')).toThrow('closed');
  });

  test('a run past its deadline is killed and throws', async () => {
    const fake = running();
    fake.exec = () => new Promise<number>(() => undefined);
    const error = await rejection(
      execOverWebSocket(fake.client(), 'db', ['sleep', '9'], {
        maxOutputBytes: 10,
        deadlineMs: 100,
      }),
    );
    expect(error.message).toBe('Command exceeded its time limit.');
  });

  test('output past the cap is killed and throws', async () => {
    const fake = running();
    fake.exec = async (_call, io) => {
      io.write(1, 'x'.repeat(100));
      await new Promise<void>((resolve) =>
        io.killed.addEventListener('abort', () => resolve()),
      );
      return 137;
    };
    const error = await rejection(
      execOverWebSocket(fake.client(), 'db', ['yes'], {
        maxOutputBytes: 10,
        deadlineMs: 5_000,
      }),
    );
    expect(error.message).toBe('Command output exceeded its byte limit.');
  });

  test('stdin connects last, once stdout and stderr are open on the client', async () => {
    const fake = running();
    const client = fake.client();
    const sockets: WebSocket[] = [];
    const stdinSockets = new Set<WebSocket>();
    const openWebSocket = client.openWebSocket.bind(client);
    client.openWebSocket = (path, query) => {
      const ws = openWebSocket(path, query);
      const send = ws.send.bind(ws);
      ws.send = (data) => {
        if (typeof data !== 'string') stdinSockets.add(ws);
        send(data);
      };
      sockets.push(ws);
      return ws;
    };
    let openWhenStarted: boolean[] = [];
    fake.exec = async (_call, io) => {
      openWhenStarted = sockets.map((ws) => ws.readyState === WebSocket.OPEN);
      await io.stdin();
      io.write(1, 'x'.repeat(100));
      return 0;
    };
    const error = await rejection(
      execOverWebSocket(client, 'db', ['yes'], {
        stdin: 'in',
        maxOutputBytes: 10,
        deadlineMs: 5_000,
      }),
    );
    expect(error.message).toBe('Command output exceeded its byte limit.');
    expect(sockets).toHaveLength(4);
    // The socket stdin went over is the last one opened, and the command
    // started only after every other socket was open on the client.
    expect([...stdinSockets]).toEqual(sockets.slice(3));
    expect(openWhenStarted.slice(0, 3)).toEqual([true, true, true]);
  });

  test('a stopped instance runs nothing', async () => {
    const fake = running();
    const db = fake.instances.get('db');
    if (db !== undefined) db.status = 'Stopped';
    const error = await rejection(openExecSession(fake.client(), 'db', ['x']));
    expect(error.message).toContain('not running');
  });
});

describe('the websockets ride the pinned mutual TLS', () => {
  let made: TestCertificates | undefined;
  let server: ReturnType<typeof Bun.serve<{ fd: string }>> | undefined;
  const upgrades: string[] = [];

  beforeAll(async () => {
    made = await makeTestCertificates();
    const certs = made;
    const sockets = new Map<
      string,
      { send(data: string | Uint8Array): unknown; close(): void }
    >();
    let exited: (code: number) => void = () => undefined;
    const exit = new Promise<number>((resolve) => {
      exited = resolve;
    });
    const envelope = (type: string, metadata: unknown, status = 200) =>
      new Response(JSON.stringify({ type, status_code: status, metadata }), {
        status: type === 'async' ? 202 : 200,
        headers: { 'content-type': 'application/json' },
      });
    const fds = { '0': 's0', '1': 's1', '2': 's2', control: 'sc' };
    server = Bun.serve<{ fd: string }>({
      port: 0,
      hostname: '127.0.0.1',
      tls: {
        cert: certs.server.cert,
        key: certs.server.key,
        ca: certs.client.cert,
        requestCert: true,
        rejectUnauthorized: true,
      },
      fetch: async (req, srv) => {
        const url = new URL(req.url);
        if (url.pathname.endsWith('/exec')) {
          return envelope(
            'async',
            {
              id: 'op-tls',
              status: 'Running',
              status_code: 103,
              metadata: { fds },
            },
            100,
          );
        }
        if (url.pathname.endsWith('/wait')) {
          const code = await exit;
          return envelope('sync', {
            id: 'op-tls',
            status: 'Success',
            status_code: 200,
            metadata: { fds, return: code },
          });
        }
        const fd = Object.entries(fds).find(
          ([, secret]) => secret === url.searchParams.get('secret'),
        )?.[0];
        upgrades.push(
          `${url.pathname} ${fd ?? '?'} ${url.searchParams.get('project')}`,
        );
        if (fd !== undefined && srv.upgrade(req, { data: { fd } }))
          return undefined;
        return new Response('no', { status: 404 });
      },
      websocket: {
        open(ws) {
          sockets.set(ws.data.fd, ws);
        },
        message(ws, message) {
          if (ws.data.fd !== '0') return;
          if (message === '') {
            sockets.get('1')?.send('');
            sockets.get('2')?.send('');
            exited(0);
            return;
          }
          sockets
            .get('1')
            ?.send(
              typeof message === 'string'
                ? new TextEncoder().encode(message)
                : message,
            );
        },
      },
    });
  });

  afterAll(() => {
    void server?.stop(true);
    made?.dispose();
  });

  test('a pinned client with its certificate opens the four sockets and runs', async () => {
    if (made === undefined || server === undefined)
      throw new Error('no server');
    const client = new IncusClient({
      endpoint: `https://127.0.0.1:${server.port}`,
      project: 'stack',
      tls: {
        ca: made.server.cert,
        cert: made.client.cert,
        key: made.client.key,
      },
      signal: () => undefined,
      sleep: async () => undefined,
    });
    const result = await execOverWebSocket(client, 'db', ['cat'], {
      stdin: 'over mTLS',
      maxOutputBytes: 100,
      deadlineMs: 10_000,
    });
    expect(text(result.stdout)).toBe('over mTLS');
    expect(result.exitCode).toBe(0);
    expect(upgrades[0]).toBe('/1.0/operations/op-tls/websocket control stack');
    expect(upgrades.slice(1).sort()).toEqual([
      '/1.0/operations/op-tls/websocket 0 stack',
      '/1.0/operations/op-tls/websocket 1 stack',
      '/1.0/operations/op-tls/websocket 2 stack',
    ]);
  });

  test('a client the server does not know cannot open a socket', async () => {
    if (made === undefined || server === undefined)
      throw new Error('no server');
    const client = new IncusClient({
      endpoint: `https://127.0.0.1:${server.port}`,
      project: 'stack',
      tls: {
        ca: made.server.cert,
        cert: made.otherClient.cert,
        key: made.otherClient.key,
      },
      signal: () => undefined,
      sleep: async () => undefined,
    });
    const ws = client.openWebSocket('/1.0/operations/op-tls/websocket', {
      secret: 'sc',
    });
    const outcome = await new Promise<string>((resolve) => {
      ws.addEventListener('open', () => resolve('open'));
      ws.addEventListener('error', () => resolve('error'));
      ws.addEventListener('close', () => resolve('close'));
    });
    expect(outcome).not.toBe('open');
  });
});
