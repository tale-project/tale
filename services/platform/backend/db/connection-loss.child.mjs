// Child process of connection-loss.test.ts: one postgres.js scenario against the
// test's fake PostgreSQL server, whose server process "dies" (the socket closes with
// no message, as after a kill -9) at a point the statement text names, or for
// authentication the connection's application_name. It runs in its own process
// because the defect it pins (postgres.js writing to the closed socket, #4041) is an
// uncaught TypeError that ends the process. So there is deliberately no
// uncaughtException handler here: the parent reads the exit code and stderr.
//
//   node connection-loss.child.mjs <scenario> <esm|cjs>     (FAKE_PG_PORT in env)
//
// `postgres` is resolved by its bare name from this directory, through the package's
// own `exports`: `esm` takes the `import` condition (src/), `cjs` the `require`
// condition (cjs/src/), so each build the patch carries is the one exercised.
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

const [scenario, entry] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const postgres =
  entry === 'cjs' ? require('postgres') : (await import('postgres')).default;
const resolved =
  entry === 'cjs'
    ? require.resolve('postgres')
    : fileURLToPath(import.meta.resolve('postgres'));

const emit = (event, detail = {}) =>
  process.stdout.write(`${JSON.stringify({ event, ...detail })}\n`);
// A settled outcome as data: `ok` with the value, or the failure's name/code/message.
const settle = (promise) =>
  promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({
      ok: false,
      code: error?.code ?? null,
      message: String(error?.message ?? error),
    }),
  );
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const connect = (max, options = {}) =>
  postgres({
    host: '127.0.0.1',
    port: Number(process.env.FAKE_PG_PORT),
    user: 'tale',
    database: 'tale',
    max,
    // fetch_types stays on, as in the platform: the fake server answers the
    // array-type catalog query with no rows.
    connect_timeout: 5,
    ...options,
  });
// A pool whose `closed` settles once one of its connections has closed and settled
// what it held (postgres.js's `onclose`), so a case waits on the close itself rather
// than on a guess at how long the fake server takes to close.
const watched = (max, options = {}) => {
  let close;
  const closed = new Promise((resolve) => (close = resolve));
  return { sql: connect(max, { ...options, onclose: () => close() }), closed };
};
// The pool must still serve a statement after the loss: it reconnects.
const after = (sql) => settle(sql`select 'after'`);
// Ends with a timeout, timed: a pool that closes by itself is done well before it.
const end = async (sql) => {
  const started = performance.now();
  const outcome = await settle(sql.end({ timeout: 1 }));
  return { ...outcome, tookMs: Math.round(performance.now() - started) };
};

// A `for await` loop over a cursor, a row a batch, whose connection the server ends
// while the loop holds the first batch: the loop must fail, not end as if it had
// read every row.
async function iterateThroughLoss({ sql, closed }, query) {
  let rows = 0;
  emit(
    'cursor',
    await settle(
      (async () => {
        for await (const batch of query.cursor(1)) {
          rows += batch.length;
          await closed;
        }
        return 'FALSE SUCCESS';
      })(),
    ),
  );
  emit('rows', { count: rows });
  emit('after', await after(sql));
  emit('end', await end(sql));
}

const scenarios = {
  // The server process running a transaction's statement dies: the statement and the
  // transaction reject, and begin()'s ROLLBACK is then written to the closed socket.
  async 'transaction-cut'() {
    const sql = connect(1);
    emit(
      'transaction',
      await settle(
        sql.begin(async (tx) => {
          await tx`select 'cut_now'`;
          return 'FALSE SUCCESS';
        }),
      ),
    );
    // The unpatched driver throws one immediate later; give it the chance.
    await sleep(100);
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
  // The server process dies while the transaction is idle between statements; its
  // next statement (parameterised, so written describe-first) goes to the closed
  // connection. One connection: a connection stranded outside the pool would hang.
  async 'idle-transaction-cut'() {
    const { sql, closed } = watched(1);
    let next = null;
    emit(
      'transaction',
      await settle(
        sql.begin(async (tx) => {
          await tx`select 'cut_after'`;
          await closed;
          next = settle(tx`select ${'x'.repeat(2000)}::text as big`);
          emit('next', await next);
          return 'FALSE SUCCESS';
        }),
      ),
    );
    await sleep(300);
    if (next === null) emit('next', { ok: false, code: 'NOT_ISSUED' });
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
  // The same idle loss, but before the transaction's next statement the pool has
  // reconnected the very connection for another caller: the statement must not run
  // on that new session, where it would commit on its own outside the transaction.
  async 'idle-transaction-reconnected'() {
    const sql = connect(1);
    let reconnected;
    const otherDone = new Promise((resolve) => (reconnected = resolve));
    let next = null;
    emit(
      'transaction',
      await settle(
        sql.begin(async (tx) => {
          await tx`select 'cut_after'`;
          await otherDone;
          next = settle(tx`select 'stray_statement'`);
          emit('next', await next);
          return 'FALSE SUCCESS';
        }),
      ),
    );
    // Another caller right after the transaction failed: the pool reconnects.
    emit('other', await settle(sql`select 'other'`));
    reconnected();
    await sleep(100);
    if (next === null) emit('next', { ok: false, code: 'NOT_ISSUED' });
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
  // The same for a reservation: its connection dies while it idles, and the pool
  // reconnects the very connection for another caller's transaction. The dead
  // reservation's next statement, issued while that transaction holds the
  // connection, must not run inside it.
  async 'idle-reservation-reconnected'() {
    const { sql, closed } = watched(1);
    const reserved = await sql.reserve();
    await reserved`select 'cut_after'`;
    await closed;
    let stray = null;
    emit(
      'transaction',
      await settle(
        sql.begin(async (tx) => {
          await tx`select 'tx_one'`;
          stray = settle(reserved`select 'stray_reserved'`);
          await tx`select 'tx_two'`;
          emit('stray', await stray);
          return 'committed';
        }),
      ),
    );
    if (stray === null) emit('stray', { ok: false, code: 'NOT_ISSUED' });
    reserved.release();
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
  // A statement in flight when the server process dies, then end() with no statement
  // in between that would reconnect the closed connection: it must not still count
  // the settled statement as running, which held end() open until its timeout.
  async 'cut-then-end'() {
    const sql = connect(1);
    emit('pending', await settle(sql`select 'cut_now'`));
    emit('end', await end(sql));
  },
  // The server process dies while a cursor's callback holds a batch, and the
  // callback returns once the next caller's statement waits for the reconnect. The
  // cursor rejects; nothing may then read the settled cursor or write for it, on
  // the closed connection or on the reconnected one, and the next caller is served.
  async 'cursor-cut'() {
    const { sql, closed } = watched(1);
    let batches = 0;
    let issue;
    const next = new Promise((resolve) => (issue = resolve));
    emit(
      'cursor',
      await settle(
        sql`select 'rows_3 cut_after'`.cursor(1, async () => {
          batches += 1;
          await closed;
          issue(settle(sql`select 'next'`));
        }),
      ),
    );
    emit('batches', { count: batches });
    // A crash would come from the callback's continuation, one turn later.
    await sleep(100);
    issue({ ok: false, code: 'NOT_ISSUED' });
    emit('next', await next);
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
  // The same loss, but the callback then fails, with the next caller's statement
  // already waiting for the reconnect: the failed callback's Sync must not reach that
  // connection, nor reject that statement.
  async 'cursor-cut-callback-throws'() {
    const { sql, closed } = watched(1);
    let issue;
    const next = new Promise((resolve) => (issue = resolve));
    emit(
      'cursor',
      await settle(
        sql`select 'rows_3 cut_after'`.cursor(1, async () => {
          await closed;
          issue(settle(sql`select 'next'`));
          throw new Error('callback failed');
        }),
      ),
    );
    await sleep(100);
    issue({ ok: false, code: 'NOT_ISSUED' });
    emit('next', await next);
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
  // The loss while a `for await` loop over a cursor holds a batch.
  async 'cursor-iterator-cut'() {
    const pool = watched(1);
    await iterateThroughLoss(pool, pool.sql`select 'rows_3 cut_after'`);
  },
  // The same with an administrator's termination (FATAL 57P01, then the close): the
  // loop fails with the server's error, the first one, as the callback form does.
  async 'cursor-iterator-terminated'() {
    const pool = watched(1);
    await iterateThroughLoss(pool, pool.sql`select 'rows_3 fatal_after'`);
  },
  // The server ends the connection during authentication (FATAL, then the close)
  // while an asynchronous password (a token fetched per connection) is still
  // pending: its answer is written after the socket is gone.
  async 'password-after-close'() {
    const { sql, closed } = watched(1, {
      // The fake server's marker: the first connection that carries it is ended.
      connection: { application_name: 'fatal_auth' },
      pass: async () => {
        await closed;
        return 'secret';
      },
    });
    emit('first', await settle(sql`select 'first'`));
    await closed;
    // The password's answer is written on the next Immediate; a throw there ends
    // the process before this timer fires.
    await sleep(20);
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
  // The connection closes while a statement's write still waits for its Immediate:
  // one Immediate issues the statement and destroys the socket, and the close
  // callback runs at the end of that loop turn, before the Immediate that would
  // write the statement. The next connection must still send its startup message,
  // and send it first. A reservation writes its statement on the connection it
  // holds, so the write is certain to be the pending one.
  async 'closed-with-a-write-pending'() {
    const sockets = [];
    const sql = connect(1, {
      socket: () => {
        const socket = createConnection(
          Number(process.env.FAKE_PG_PORT),
          '127.0.0.1',
        );
        sockets.push(socket);
        return socket;
      },
    });
    const reserved = await sql.reserve();
    const pending = await new Promise((resolve) =>
      setImmediate(() => {
        resolve(settle(reserved`select 'pending'`));
        sockets.at(-1).destroy();
      }),
    );
    emit('pending', pending);
    reserved.release();
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
  // Statements on a transaction that has ended (after its COMMIT, after a manual
  // COMMIT inside it, and after the connection it ran on later closed under another
  // caller) are refused as misuse, never as a lost connection, and never run. Each
  // waits for a pool statement first: that runs only once the connection is back in
  // the pool, after the COMMIT's ReadyForQuery.
  async 'transaction-ended'() {
    const { sql, closed } = watched(1);
    // The transaction's handle, kept past its end.
    let kept;
    emit(
      'transaction',
      await settle(
        sql.begin(async (tx) => {
          kept = tx;
          await tx`select 'inside'`;
          return 'committed';
        }),
      ),
    );
    emit('pooled', await settle(sql`select 'pooled'`));
    emit('after-commit', await settle(kept`select 'after_commit'`));
    emit('cut', await settle(sql`select 'cut_now'`));
    await closed;
    emit('after-loss', await settle(kept`select 'after_loss'`));
    emit(
      'manual-commit',
      await settle(
        sql.begin(async (tx) => {
          await tx`commit`;
          await sql`select 'pooled_after_manual_commit'`;
          await tx`select 'after_manual_commit'`;
          return 'FALSE SUCCESS';
        }),
      ),
    );
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
  // A statement on a released reservation is refused as misuse, and never runs.
  async 'reservation-released'() {
    const sql = connect(1);
    const reserved = await sql.reserve();
    emit('reserved', await settle(reserved`select 'reserved'`));
    reserved.release();
    emit('released', await settle(reserved`select 'after_release'`));
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
  // A reserved connection whose server process dies: its pending statement, then the
  // next statement on the same reservation (porsager/postgres#1208), then release().
  // One connection: a released dead connection reused by the pool would fail every
  // later statement.
  async 'reserved-cut'() {
    const sql = connect(1);
    const reserved = await sql.reserve();
    emit('pending', await settle(reserved`select 'cut_now'`));
    emit('next', await settle(reserved`select 'next'`));
    await sleep(100);
    reserved.release();
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
  // The connection is reset instead of closed: the error event comes first, and
  // begin()'s ROLLBACK is written before the close. One connection: whatever the
  // reset left pending would answer for the reconnected connection's statements.
  async 'transaction-reset'() {
    const sql = connect(1);
    emit(
      'transaction',
      await settle(
        sql.begin(async (tx) => {
          await tx`select 'reset_now'`;
          return 'FALSE SUCCESS';
        }),
      ),
    );
    await sleep(100);
    emit('after', await after(sql));
    emit('after-2', await settle(sql`select 'after-2'`));
    emit('end', await end(sql));
  },
  // A statement in flight (parameterised, so written describe-first: the connection
  // counts as busy) with a second one queued behind it, when the server process is
  // terminated: the queued one must settle too, for a reservation and a transaction.
  async 'queued-terminated'() {
    const sql = connect(1);
    const reserved = await sql.reserve();
    const [first, queued] = await Promise.all([
      settle(reserved`select ${1}::int as fatal_now`),
      settle(reserved`select 'queued'`),
    ]);
    emit('reserved-first', first);
    emit('reserved-queued', queued);
    reserved.release();
    await settle(
      sql.begin(async (tx) => {
        const [one, two] = await Promise.all([
          settle(tx`select ${1}::int as fatal_now`),
          settle(tx`select 'queued'`),
        ]);
        emit('transaction-first', one);
        emit('transaction-queued', two);
      }),
    );
    await sleep(100);
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
  // Control: an administrator's termination (FATAL 57P01, then the close).
  async 'transaction-terminated'() {
    const sql = connect(1);
    emit(
      'transaction',
      await settle(
        sql.begin(async (tx) => {
          await tx`select 'fatal_now'`;
          return 'FALSE SUCCESS';
        }),
      ),
    );
    await sleep(100);
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
  // A burst of plain statements pipelines onto busy connections, up to
  // `max_pipeline` each. With two connections and a pipeline of three, the seventh
  // statement is the one that fills a pipeline: here it is a begin(). postgres.js
  // only tells begin() which connection it got once the connection can take more
  // statements, so that statement, written all the same, ran as a BEGIN nobody
  // owned: UNSAFE_TRANSACTION, and the connection back in the pool inside it.
  async 'begin-fills-the-pipeline'() {
    const sql = connect(2, { max_pipeline: 3 });
    // Both connections open and idle, so the burst below pipelines instead of connecting.
    await Promise.all([
      settle(sql`select 'warm-1'`),
      settle(sql`select 'warm-2'`),
    ]);
    const plain = [
      settle(sql`select 'plain-1'`),
      settle(sql`select 'plain-2'`),
      settle(sql`select 'plain-3'`),
      settle(sql`select 'plain-4'`),
      settle(sql`select 'plain-5'`),
      settle(sql`select 'plain-6'`),
    ];
    const transaction = settle(
      sql.begin(async (tx) => {
        await tx`select 'in-transaction'`;
        return 'committed';
      }),
    );
    emit('transaction', await transaction);
    emit('plain', {
      ok: (await Promise.all(plain)).every((outcome) => outcome.ok),
    });
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
  // Control: a healthy transaction commits, and a failing one rolls back.
  async healthy() {
    const sql = connect(2);
    emit(
      'transaction',
      await settle(
        sql.begin(async (tx) => {
          await tx`select 'first'`;
          await tx`select ${'second'}::text as v`;
          return 'committed';
        }),
      ),
    );
    emit(
      'rollback',
      await settle(
        sql.begin(async (tx) => {
          await tx`select 'doomed'`;
          throw new Error('deliberate');
        }),
      ),
    );
    emit('after', await after(sql));
    emit('end', await end(sql));
  },
};

// A hang must fail the parent's assertions rather than outlive it.
const watchdog = setTimeout(() => {
  emit('hang', { scenario });
  process.exit(3);
}, 10_000);
emit('loaded', { entry, resolved });
await scenarios[scenario]();
clearTimeout(watchdog);
// No process.exit: the child must also EXIT on its own, which it cannot while a
// socket or timer of the ended pool is still alive.
emit('done', { scenario });
