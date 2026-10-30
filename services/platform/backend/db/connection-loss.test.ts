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
 *
 * The same patch fixes a second defect, pinned by `begin-fills-the-pipeline`: a
 * `begin()` that fills a connection's pipeline (`max_pipeline`) was written
 * without ever learning its connection, so the pool took the connection back
 * inside the transaction. A burst of 4,000 users made that happen in production.
 *
 * A cursor that loses its connection while its callback, or a `for await` loop,
 * holds a batch rejects; it neither crashes the process from the callback's
 * continuation nor ends the loop as if every row had been read (#4066). A
 * statement on a transaction that has ended, or on a released reservation, is
 * refused as misuse (UNSAFE_TRANSACTION, as postgres.js 4 does): only a connection
 * that closed under its holder reads as the database going away
 * (`unavailable.ts`). Every change the patch makes is pinned here: without any
 * one of them, a case fails.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isDatabaseUnavailable } from './unavailable';

const CHILD = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'connection-loss.child.mjs',
);

const int16 = (value: number) => {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16BE(value);
  return buffer;
};
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
const terminating = () =>
  message(
    'E',
    Buffer.from('S'),
    cstring('FATAL'),
    Buffer.from('C'),
    cstring('57P01'),
    Buffer.from('M'),
    cstring('terminating connection due to administrator command'),
    Buffer.from([0]),
  );
/** The one text column, `n`, of a statement that returns rows. */
const ROW_DESCRIPTION = message(
  'T',
  int16(1),
  cstring('n'),
  int32(0),
  int16(0),
  int32(25),
  int16(-1),
  int32(-1),
  int16(0),
);
const dataRow = (value: string) =>
  message('D', int16(1), int32(Buffer.byteLength(value)), Buffer.from(value));
/** How many rows a statement returns: `rows_3` in its text, else none. */
const rowsOf = (text: string) => Number(/rows_(\d+)/.exec(text)?.[1] ?? 0);

/**
 * Just enough of the PostgreSQL v3 wire protocol for postgres.js: trust auth,
 * simple and extended queries, transaction status tracked for ReadyForQuery. A
 * statement returns no rows unless its text holds `rows_<n>`; an Execute with a
 * row limit (a cursor's batch) returns that many and then PortalSuspended. A
 * statement whose text holds `cut_now` closes the socket on arrival (the server
 * process killed mid-statement), `reset_now` resets it, `cut_after` closes it just
 * after answering (killed while the transaction idles), `fatal_now` sends FATAL
 * 57P01, then reads nothing more and closes (an administrator's termination), and
 * `fatal_after` does that just after answering. The first connection whose
 * `application_name` is `fatal_auth` is asked for an MD5 password and then
 * terminated the same way, before it can answer. Every statement is logged.
 */
class FakePostgres {
  readonly statements: string[] = [];
  /** Every statement with the connection it arrived on and that connection's transaction status then. */
  readonly arrivals: { connection: number; status: string; text: string }[] =
    [];
  private readonly server = createServer((socket) => this.serve(socket));
  private readonly sockets = new Set<Socket>();
  private connections = 0;
  private authenticationFailed = false;

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
    const connection = (this.connections += 1);
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    let pending = Buffer.alloc(0);
    let started = false;
    // After FATAL a real server process reads nothing more before it exits.
    let dead = false;
    let status = 'I';
    // Prepared statements by name, and the statement the current portal binds.
    const prepared = new Map<string, { text: string; params: number }>();
    let bound = '';
    // The current portal's rows: still to return, and returned so far.
    let remaining = 0;
    let returned = 0;
    const ready = () => message('Z', Buffer.from(status));
    const complete = (text: string, count = 0) => {
      const verb = text.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
      if (verb === 'BEGIN') status = 'T';
      if (verb === 'COMMIT' || verb === 'ROLLBACK') status = 'I';
      return message(
        'C',
        cstring(verb === 'SELECT' ? `SELECT ${count}` : verb),
      );
    };
    // The answers to one chunk of the client's messages go out in one write, as
    // a server flushes its output at ReadyForQuery: a CommandComplete and the
    // ReadyForQuery behind it reach postgres.js together, as from PostgreSQL.
    let out: Buffer[] = [];
    const send = (...messages: Buffer[]) => out.push(...messages);
    const flush = () => {
      if (out.length > 0 && !socket.destroyed) socket.write(Buffer.concat(out));
      out = [];
    };
    const terminate = () => {
      flush();
      dead = true;
      socket.write(terminating());
      setTimeout(() => socket.end(), 20);
    };
    // True when the statement ends the connection instead of being answered.
    const cut = (text: string) => {
      this.statements.push(text);
      this.arrivals.push({ connection, status, text });
      if (text.includes('cut_now')) {
        flush();
        socket.destroy();
        return true;
      }
      // A reset instead of an orderly close (unread data, a proxy): the client
      // sees ECONNRESET first, and the close only later.
      if (text.includes('reset_now')) {
        flush();
        socket.resetAndDestroy();
        return true;
      }
      if (text.includes('fatal_now')) {
        terminate();
        return true;
      }
      if (text.includes('cut_after')) setTimeout(() => socket.destroy(), 20);
      if (text.includes('fatal_after')) setTimeout(terminate, 20);
      return false;
    };
    const answer = () => {
      for (;;) {
        if (!started) {
          if (pending.length < 8 || pending.length < pending.readInt32BE(0)) {
            return;
          }
          // The startup parameters: name, value, … after the protocol version.
          const parameters = pending
            .toString('utf8', 8, pending.readInt32BE(0))
            .split('\0');
          pending = pending.subarray(pending.readInt32BE(0));
          started = true;
          if (
            parameters[parameters.indexOf('application_name') + 1] ===
              'fatal_auth' &&
            !this.authenticationFailed
          ) {
            this.authenticationFailed = true;
            // AuthenticationMD5Password, then the termination before any answer.
            send(message('R', int32(5), Buffer.from([1, 2, 3, 4])));
            terminate();
            return;
          }
          send(
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
        if (socket.destroyed || dead) return;
        if (type === 'Q') {
          const text = body.toString('utf8', 0, body.length - 1);
          if (cut(text)) return;
          send(Buffer.concat([complete(text), ready()]));
        } else if (type === 'P') {
          const nameEnd = body.indexOf(0);
          const textEnd = body.indexOf(0, nameEnd + 1);
          const text = body.toString('utf8', nameEnd + 1, textEnd);
          if (cut(text)) return;
          prepared.set(body.toString('utf8', 0, nameEnd), {
            text,
            params: body.readInt16BE(textEnd + 1),
          });
          send(message('1'));
        } else if (type === 'D') {
          // 'S' describes a statement: its parameters (all text), then its row
          // (RowDescription) or NoData.
          const name = body.toString('utf8', 1, body.length - 1);
          const statement = prepared.get(name);
          const params = statement?.params ?? 0;
          const row = rowsOf(statement?.text ?? '')
            ? ROW_DESCRIPTION
            : message('n');
          send(
            body[0] === 83
              ? Buffer.concat([
                  message(
                    't',
                    Buffer.from([params >> 8, params & 255]),
                    ...Array.from({ length: params }, () => int32(25)),
                  ),
                  row,
                ])
              : row,
          );
        } else if (type === 'B') {
          const portalEnd = body.indexOf(0);
          const name = body.toString(
            'utf8',
            portalEnd + 1,
            body.indexOf(0, portalEnd + 1),
          );
          bound = prepared.get(name)?.text ?? '';
          remaining = rowsOf(bound);
          returned = 0;
          send(message('2'));
        } else if (type === 'E') {
          // Up to the row limit (0: no limit), then PortalSuspended while rows
          // remain, or CommandComplete.
          const limit = body.readInt32BE(body.indexOf(0) + 1);
          const count = limit > 0 ? Math.min(limit, remaining) : remaining;
          const rows = Array.from({ length: count }, () =>
            dataRow(String((returned += 1))),
          );
          remaining -= count;
          send(
            Buffer.concat([
              ...rows,
              limit > 0 && remaining > 0
                ? message('s')
                : complete(bound, returned),
            ]),
          );
        } else if (type === 'S') {
          send(ready());
        } else if (type === 'C') {
          send(message('3'));
        } else if (type === 'X') {
          flush();
          socket.end();
          return;
        }
      }
    };
    socket.on('data', (chunk: Buffer) => {
      if (dead) return;
      pending = Buffer.concat([pending, chunk]);
      answer();
      flush();
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

/** A loss of the connection: the platform answers it as the database being
 * unavailable (a retryable 503, no error report). */
function expectLost(outcome: Event | undefined) {
  expect(outcome).toMatchObject(CLOSED);
  expect(isDatabaseUnavailable(outcome)).toBe(true);
}

/** The caller's own misuse of a handle whose connection lived on, refused as
 * postgres.js 4 refuses it: it must reach the error reports, not pass for the
 * database going away. */
function expectMisuse(
  outcome: Event | undefined,
  handle: 'transaction' | 'reserve',
) {
  expect(outcome).toMatchObject({
    ok: false,
    code: 'UNSAFE_TRANSACTION',
    message: `UNSAFE_TRANSACTION: The ${handle} has ended`,
  });
  expect(isDatabaseUnavailable(outcome)).toBe(false);
}

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
      // The ended pool closed by itself, not by its 1 s timeout: no connection
      // was left holding a settled statement.
      expect(result.events.get('end')).toMatchObject({ ok: true });
      expect(result.events.get('end')?.tookMs).toBeLessThan(900);
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

    it('does not run a dead reservation’s statement inside the transaction its reconnected connection now holds', async () => {
      const events = await run('idle-reservation-reconnected');
      expect(events.get('transaction')).toEqual({
        event: 'transaction',
        ok: true,
        value: 'committed',
      });
      expectLost(events.get('stray'));
      // Run there, it would have become part of another caller's transaction:
      // begin, tx_one, stray_reserved, tx_two, commit.
      expect(server.statements).not.toContain("select 'stray_reserved'");
      expect(server.statements).toEqual(
        expect.arrayContaining([
          "select 'tx_one'",
          "select 'tx_two'",
          'commit',
        ]),
      );
      expect(events.get('after')).toMatchObject({ ok: true });
    });

    it('ends the pool at once when the cut statement’s connection was never reconnected', async () => {
      // run() holds end() well under its 1 s timeout: the closed connection no
      // longer counts the settled statement as running.
      const events = await run('cut-then-end');
      expectLost(events.get('pending'));
    });

    it('rejects a reserved connection’s statements, and release() does not hand the dead connection back', async () => {
      const events = await run('reserved-cut');
      expect(events.get('pending')).toMatchObject(CLOSED);
      expect(events.get('next')).toMatchObject(CLOSED);
      // One connection: the next pool statement reconnects instead of failing on it.
      expect(events.get('after')).toMatchObject({ ok: true });
      expect(events.get('end')).toMatchObject({ ok: true });
    });

    it('settles a transaction whose connection was reset, and the next connection answers its own statements', async () => {
      const events = await run('transaction-reset');
      expect(events.get('transaction')).toMatchObject({ ok: false });
      // A ROLLBACK left pending on the reset connection would take this answer.
      expect(events.get('after')).toMatchObject({ ok: true });
      expect(events.get('after-2')).toMatchObject({ ok: true });
    });

    it('rejects the statements queued behind a busy connection when it closes', async () => {
      const events = await run('queued-terminated');
      expect(events.get('reserved-first')).toMatchObject({ ok: false });
      expect(events.get('reserved-queued')).toMatchObject(CLOSED);
      expect(events.get('transaction-first')).toMatchObject({ ok: false });
      expect(events.get('transaction-queued')).toMatchObject(CLOSED);
      expect(events.get('after')).toMatchObject({ ok: true });
    });

    it('settles a transaction an administrator terminated (FATAL 57P01)', async () => {
      const events = await run('transaction-terminated');
      expect(events.get('transaction')).toMatchObject({ ok: false });
      expect(events.get('after')).toMatchObject({ ok: true });
      expect(events.get('end')).toMatchObject({ ok: true });
      expect(server.statements).not.toContain('commit');
    });

    it('rejects a cursor whose connection died while its callback held a batch, and serves the next caller', async () => {
      const events = await run('cursor-cut');
      expectLost(events.get('cursor'));
      expect(events.get('batches')).toMatchObject({ count: 1 });
      // Neither the cursor's next batch nor its Sync went to the reconnect.
      expect(events.get('next')).toMatchObject({ ok: true });
      expect(events.get('after')).toMatchObject({ ok: true });
    });

    it('lets a cursor’s callback fail after the loss without disturbing the next caller', async () => {
      const events = await run('cursor-cut-callback-throws');
      expectLost(events.get('cursor'));
      expect(events.get('next')).toMatchObject({ ok: true });
      expect(events.get('after')).toMatchObject({ ok: true });
    });

    it('fails a for-await loop over a cursor whose connection died while it held a batch', async () => {
      const events = await run('cursor-iterator-cut');
      expectLost(events.get('cursor'));
      expect(events.get('rows')).toMatchObject({ count: 1 });
      expect(events.get('after')).toMatchObject({ ok: true });
    });

    it('fails that loop with the server’s own error when an administrator terminated its connection', async () => {
      const events = await run('cursor-iterator-terminated');
      expect(events.get('cursor')).toMatchObject({ ok: false, code: '57P01' });
      expect(events.get('rows')).toMatchObject({ count: 1 });
      expect(events.get('after')).toMatchObject({ ok: true });
    });

    it('survives a password answered after the server ended the connection during authentication', async () => {
      const events = await run('password-after-close');
      expect(events.get('first')).toMatchObject({ ok: false, code: '57P01' });
      expect(events.get('after')).toMatchObject({ ok: true });
    });

    it('starts the next connection cleanly after one closed with a write still pending', async () => {
      const events = await run('closed-with-a-write-pending');
      expectLost(events.get('pending'));
      // The reconnected connection's startup message went out, and first.
      expect(events.get('after')).toMatchObject({ ok: true });
    });

    it('runs a begin() that fills a connection’s pipeline as a transaction of its own', async () => {
      const events = await run('begin-fills-the-pipeline');
      expect(events.get('transaction')).toEqual({
        event: 'transaction',
        ok: true,
        value: 'committed',
      });
      expect(events.get('plain')).toMatchObject({ ok: true });
      // The BEGIN was written either way. Unpatched, begin() never learned its
      // connection (UNSAFE_TRANSACTION), the connection went back to the pool
      // inside the transaction, and the next caller's statement ran in it.
      const inside = server.arrivals.filter(
        (arrival) => arrival.text === "select 'in-transaction'",
      );
      expect(inside).toHaveLength(1);
      expect(inside[0]).toMatchObject({ status: 'T' });
      const outside = server.arrivals.filter((arrival) =>
        /^select '(plain|after)/.test(arrival.text),
      );
      expect(outside.length).toBeGreaterThan(0);
      expect(outside.filter((arrival) => arrival.status !== 'I')).toEqual([]);
      expect(server.statements.filter((s) => s === 'commit')).toHaveLength(1);
      expect(events.get('after')).toMatchObject({ ok: true });
      expect(events.get('end')).toMatchObject({ ok: true });
    });

    it('refuses a statement on a transaction that has ended as misuse, not as a lost connection', async () => {
      const events = await run('transaction-ended');
      expect(events.get('transaction')).toEqual({
        event: 'transaction',
        ok: true,
        value: 'committed',
      });
      expect(events.get('pooled')).toMatchObject({ ok: true });
      expectMisuse(events.get('after-commit'), 'transaction');
      // The connection it ran on closed later, under another caller: still misuse.
      expectLost(events.get('cut'));
      expectMisuse(events.get('after-loss'), 'transaction');
      // A manual COMMIT inside sql.begin() ends the transaction too, and hands the
      // connection back to the pool.
      expectMisuse(events.get('manual-commit'), 'transaction');
      expect(server.statements).toContain(
        "select 'pooled_after_manual_commit'",
      );
      for (const statement of [
        "select 'after_commit'",
        "select 'after_loss'",
        "select 'after_manual_commit'",
      ]) {
        expect(server.statements).not.toContain(statement);
      }
      expect(events.get('after')).toMatchObject({ ok: true });
    });

    it('refuses a statement on a released reservation as misuse, not as a lost connection', async () => {
      const events = await run('reservation-released');
      expect(events.get('reserved')).toMatchObject({ ok: true });
      expectMisuse(events.get('released'), 'reserve');
      expect(server.statements).not.toContain("select 'after_release'");
      expect(events.get('after')).toMatchObject({ ok: true });
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
