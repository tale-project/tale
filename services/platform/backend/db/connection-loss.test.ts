/**
 * A PostgreSQL server process that dies under an open transaction must not crash
 * the backend (#4041). postgres.js 3.4.7 nulls a closed connection's socket and
 * then lets begin()'s ROLLBACK, or a reserved connection's next statement, write to
 * it from an Immediate: an uncaught `TypeError: Cannot read properties of null
 * (reading 'write')` that ends the process. The pinned postgres.js is patched
 * (`patches/postgres@3.4.7.patch`, through the root `patchedDependencies`) so the
 * write settles the pending statements with CONNECTION_CLOSED instead, and the pool
 * reconnects rather than keep or strand the closed connection.
 *
 * Each case runs postgres.js in a child process (connection-loss.child.mjs), once
 * through each build the platform resolves (ESM `import`, CommonJS `require`),
 * against a fake server here that closes the socket with no message, the way the
 * kernel does when a server process is killed. Only the patch makes them pass.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CHILD = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'connection-loss.child.mjs',
);

const int32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
};
const cstring = (value: string) => Buffer.from(`${value}\0`);
const message = (type: string, ...body: Buffer[]) => {
  const payload = Buffer.concat(body);
  return Buffer.concat([Buffer.from(type), int32(payload.length + 4), payload]);
};

/**
 * Just enough of the PostgreSQL v3 wire protocol for postgres.js: trust auth,
 * simple and extended queries answered with no rows, transaction status tracked
 * for ReadyForQuery. A statement whose text holds `cut_now` closes the socket on
 * arrival (the server process killed mid-statement), `cut_after` closes it just
 * after answering (killed while the transaction idles), and `fatal_now` sends
 * FATAL 57P01 first (an administrator's termination). Every statement is logged.
 */
class FakePostgres {
  readonly statements: string[] = [];
  private readonly server = createServer((socket) => this.serve(socket));
  private readonly sockets = new Set<Socket>();

  async listen(): Promise<number> {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    return (this.server.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.server.close();
    await once(this.server, 'close');
  }

  private serve(socket: Socket) {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    let pending = Buffer.alloc(0);
    let started = false;
    let status = 'I';
    // Prepared statements by name, and the statement the current portal binds.
    const prepared = new Map<string, { text: string; params: number }>();
    let bound = '';
    const ready = () => message('Z', Buffer.from(status));
    const complete = (text: string) => {
      const verb = text.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
      if (verb === 'BEGIN') status = 'T';
      if (verb === 'COMMIT' || verb === 'ROLLBACK') status = 'I';
      return message('C', cstring(verb === 'SELECT' ? 'SELECT 0' : verb));
    };
    // True when the statement ends the connection instead of being answered.
    const cut = (text: string) => {
      this.statements.push(text);
      if (text.includes('cut_now')) {
        socket.destroy();
        return true;
      }
      if (text.includes('fatal_now')) {
        socket.write(
          message(
            'E',
            Buffer.from('S'),
            cstring('FATAL'),
            Buffer.from('C'),
            cstring('57P01'),
            Buffer.from('M'),
            cstring('terminating connection due to administrator command'),
            Buffer.from([0]),
          ),
        );
        setTimeout(() => socket.end(), 20);
        return true;
      }
      if (text.includes('cut_after')) setTimeout(() => socket.destroy(), 20);
      return false;
    };
    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        if (!started) {
          if (pending.length < 8 || pending.length < pending.readInt32BE(0)) {
            return;
          }
          pending = pending.subarray(pending.readInt32BE(0));
          started = true;
          socket.write(
            Buffer.concat([
              message('R', int32(0)),
              message('K', int32(4041), int32(1)),
              ready(),
            ]),
          );
          continue;
        }
        if (pending.length < 5 || pending.length < 1 + pending.readInt32BE(1)) {
          return;
        }
        const type = String.fromCharCode(pending[0] ?? 0);
        const body = pending.subarray(5, 1 + pending.readInt32BE(1));
        pending = pending.subarray(1 + pending.readInt32BE(1));
        if (socket.destroyed) return;
        if (type === 'Q') {
          const text = body.toString('utf8', 0, body.length - 1);
          if (cut(text)) return;
          socket.write(Buffer.concat([complete(text), ready()]));
        } else if (type === 'P') {
          const nameEnd = body.indexOf(0);
          const textEnd = body.indexOf(0, nameEnd + 1);
          const text = body.toString('utf8', nameEnd + 1, textEnd);
          if (cut(text)) return;
          prepared.set(body.toString('utf8', 0, nameEnd), {
            text,
            params: body.readInt16BE(textEnd + 1),
          });
          socket.write(message('1'));
        } else if (type === 'D') {
          // 'S' describes a statement: its parameters (all text), then NoData.
          const name = body.toString('utf8', 1, body.length - 1);
          const params = prepared.get(name)?.params ?? 0;
          socket.write(
            body[0] === 83
              ? Buffer.concat([
                  message(
                    't',
                    Buffer.from([params >> 8, params & 255]),
                    ...Array.from({ length: params }, () => int32(25)),
                  ),
                  message('n'),
                ])
              : message('n'),
          );
        } else if (type === 'B') {
          const portalEnd = body.indexOf(0);
          const name = body.toString(
            'utf8',
            portalEnd + 1,
            body.indexOf(0, portalEnd + 1),
          );
          bound = prepared.get(name)?.text ?? '';
          socket.write(message('2'));
        } else if (type === 'E') {
          socket.write(complete(bound));
        } else if (type === 'S') {
          socket.write(ready());
        } else if (type === 'C') {
          socket.write(message('3'));
        } else if (type === 'X') {
          socket.end();
          return;
        }
      }
    });
  }
}

type Event = { event: string } & Record<string, unknown>;

interface ChildRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  events: Map<string, Event>;
}

function runChild(
  scenario: string,
  entry: 'esm' | 'cjs',
  port: number,
): Promise<ChildRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHILD, scenario, entry], {
      env: { ...process.env, FAKE_PG_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    // The child's own watchdog fires at 10 s; this is the backstop for a child
    // that settles everything yet cannot exit (a leaked socket or timer).
    const backstop = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(backstop);
      const events = new Map<string, Event>();
      for (const line of stdout.split('\n').filter(Boolean)) {
        const parsed = JSON.parse(line) as Event;
        events.set(parsed.event, parsed);
      }
      resolve({ code, signal, stderr, events });
    });
  });
}

const CLOSED = { ok: false, code: 'CONNECTION_CLOSED' };

/**
 * postgres.js schedules a reconnect at `closedAt + backoff - now`, which is
 * negative once the backoff has passed; Node 23+ warns and runs it after 1 ms.
 * Benign and unrelated, so only that warning is dropped from the child's stderr.
 */
function withoutNegativeTimeoutWarning(stderr: string): string {
  return stderr
    .replace(
      /\(node:\d+\) TimeoutNegativeWarning: .*\n(?:Timeout duration was set to 1\.\n)?(?:\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n)?/g,
      '',
    )
    .trim();
}

describe.each(['esm', 'cjs'] as const)(
  'postgres.js through its %s build, when the server process dies',
  (entry) => {
    let server: FakePostgres;
    let port: number;

    beforeEach(async () => {
      server = new FakePostgres();
      port = await server.listen();
    });
    afterEach(() => server.close());

    async function run(scenario: string) {
      const result = await runChild(scenario, entry, port);
      // No uncaught exception, no hang and no leaked handle: the child printed
      // nothing on stderr, finished every step and exited 0 on its own.
      expect(withoutNegativeTimeoutWarning(result.stderr)).toBe('');
      expect(result.signal).toBeNull();
      expect(result.code).toBe(0);
      expect(result.events.get('done')).toEqual({ event: 'done', scenario });
      const loaded = result.events.get('loaded');
      expect(loaded?.resolved).toMatch(
        entry === 'esm'
          ? /[\\/]node_modules[\\/]postgres[\\/]src[\\/]index\.js$/
          : /[\\/]node_modules[\\/]postgres[\\/]cjs[\\/]src[\\/]index\.js$/,
      );
      return result.events;
    }

    it('rejects the transaction, survives its rollback, and the pool reconnects', async () => {
      const events = await run('transaction-cut');
      expect(events.get('transaction')).toMatchObject(CLOSED);
      expect(events.get('after')).toMatchObject({ ok: true });
      expect(events.get('end')).toMatchObject({ ok: true });
      // The cut statement never committed anything.
      expect(server.statements).not.toContain('commit');
    });

    it('rejects the next statement of a transaction that lost its connection while idle', async () => {
      const events = await run('idle-transaction-cut');
      expect(events.get('transaction')).toMatchObject(CLOSED);
      expect(events.get('next')).toMatchObject(CLOSED);
      // One connection: it was not stranded, the pool reconnected it.
      expect(events.get('after')).toMatchObject({ ok: true });
      expect(events.get('end')).toMatchObject({ ok: true });
      expect(server.statements).not.toContain('commit');
    });

    it('does not run a dead transaction’s statement on the connection the pool reconnected', async () => {
      const events = await run('idle-transaction-reconnected');
      expect(events.get('transaction')).toMatchObject(CLOSED);
      expect(events.get('other')).toMatchObject({ ok: true });
      // Outside its transaction the statement would have committed on its own.
      expect(events.get('next')).toMatchObject(CLOSED);
      expect(server.statements).not.toContain("select 'stray_statement'");
      expect(events.get('after')).toMatchObject({ ok: true });
      expect(events.get('end')).toMatchObject({ ok: true });
    });

    it('rejects a reserved connection’s statements, and release() does not hand the dead connection back', async () => {
      const events = await run('reserved-cut');
      expect(events.get('pending')).toMatchObject(CLOSED);
      expect(events.get('next')).toMatchObject(CLOSED);
      // One connection: the next pool statement reconnects instead of failing on it.
      expect(events.get('after')).toMatchObject({ ok: true });
      expect(events.get('end')).toMatchObject({ ok: true });
    });

    it('settles a transaction an administrator terminated (FATAL 57P01)', async () => {
      const events = await run('transaction-terminated');
      expect(events.get('transaction')).toMatchObject({ ok: false });
      expect(events.get('after')).toMatchObject({ ok: true });
      expect(events.get('end')).toMatchObject({ ok: true });
      expect(server.statements).not.toContain('commit');
    });

    it('still commits a healthy transaction and rolls back a failing one', async () => {
      const events = await run('healthy');
      expect(events.get('transaction')).toEqual({
        event: 'transaction',
        ok: true,
        value: 'committed',
      });
      expect(events.get('rollback')).toMatchObject({
        ok: false,
        message: 'deliberate',
      });
      expect(events.get('after')).toMatchObject({ ok: true });
      expect(events.get('end')).toMatchObject({ ok: true });
      expect(server.statements.filter((s) => s === 'commit')).toHaveLength(1);
      expect(server.statements.filter((s) => s === 'rollback')).toHaveLength(1);
    });
  },
);
