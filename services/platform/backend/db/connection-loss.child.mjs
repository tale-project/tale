// Child process of connection-loss.test.ts: one postgres.js scenario against the
// test's fake PostgreSQL server, whose server process "dies" (the socket closes with
// no message, as after a kill -9) at a point the statement text names. It runs in its
// own process because the defect it pins (postgres.js writing to the closed socket,
// #4041) is an uncaught TypeError that ends the process. So there is deliberately no
// uncaughtException handler here: the parent reads the exit code and stderr.
//
//   node connection-loss.child.mjs <scenario> <esm|cjs>     (FAKE_PG_PORT in env)
//
// `postgres` is resolved by its bare name from this directory, through the package's
// own `exports`: `esm` takes the `import` condition (src/), `cjs` the `require`
// condition (cjs/src/), so each build the patch carries is the one exercised.
import { createRequire } from 'node:module';
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
const connect = (max) =>
  postgres({
    host: '127.0.0.1',
    port: Number(process.env.FAKE_PG_PORT),
    user: 'tale',
    database: 'tale',
    max,
    // fetch_types stays on, as in the platform: the fake server answers the
    // array-type catalog query with no rows.
    connect_timeout: 5,
  });
// The pool must still serve a statement after the loss: it reconnects.
const after = (sql) => settle(sql`select 'after'`);
// Ends with a timeout, timed: a pool that closes by itself is done well before it.
const end = async (sql) => {
  const started = performance.now();
  const outcome = await settle(sql.end({ timeout: 1 }));
  return { ...outcome, tookMs: Math.round(performance.now() - started) };
};

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
    const sql = connect(1);
    let next = null;
    emit(
      'transaction',
      await settle(
        sql.begin(async (tx) => {
          await tx`select 'cut_after'`;
          await sleep(100);
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
