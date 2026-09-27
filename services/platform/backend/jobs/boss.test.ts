// @vitest-environment node

import {
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from 'node:net';

import pg from 'pg';
import type { PgBoss, WipData } from 'pg-boss';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createBoss } from './boss.ts';

/** A local server; `answer` gets each connection. */
async function listen(
  answer: (socket: Socket) => void,
): Promise<{ server: Server; port: number }> {
  const server = createServer(answer);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { server, port };
}

/** A FATAL ErrorResponse, as PostgreSQL sends one before it hangs up. */
function fatal(code: string, message: string): Buffer {
  const fields = Buffer.concat([
    ...[
      ['S', 'FATAL'],
      ['V', 'FATAL'],
      ['C', code],
      ['M', message],
    ].map(([key, value]) => Buffer.from(`${key}${value}\0`)),
    Buffer.from([0]),
  ]);
  const header = Buffer.alloc(5);
  header.write('E', 0);
  header.writeInt32BE(fields.length + 4, 1);
  return Buffer.concat([header, fields]);
}

/** What node-postgres — pg-boss's driver — rejects a connection with. */
async function connectError(port: number): Promise<Error> {
  const client = new pg.Client({
    connectionString: `postgres://tale:pw@127.0.0.1:${port}/tale`,
  });
  try {
    await client.connect();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  await client.end();
  throw new Error('the connection was expected to fail');
}

/**
 * What a pg-boss 12 worker emits for a failed poll: it appends its queue and
 * id to the error's message, then re-emits a plain copy of the error's own
 * fields with `queue` and `worker` beside them (`pg-boss/dist/worker.js`,
 * `manager.js`).
 */
function failedPoll(error: Error, queue: string): object {
  const worker = `worker-${queue}`;
  return {
    ...copy(error),
    message: `${error.message} (Queue: ${queue}, Worker: ${worker})`,
    stack: error.stack,
    queue,
    worker,
  };
}

/** An error's own enumerable fields — what pg-boss's `{ ...error }` keeps:
 * `code` and the rest, never the prototype or `cause`. */
function copy(error: Error): Record<string, unknown> {
  return Object.fromEntries(Object.entries(error));
}

/** Emit what pg-boss emits. Its event map types the `error` event as an
 * `Error`, yet a worker's failed poll arrives as a plain copy of one. */
function emitError(boss: PgBoss, failure: object): void {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg-boss's event map calls its plain copies Error
  boss.emit('error', failure as Error);
}

/** One pg-boss worker as `getWipData` reports it. */
function wipWorker(lastFetchedOn: number | null): WipData {
  return {
    id: 'worker-1',
    workId: 'worker-1',
    name: '__pgboss__send-it',
    options: {},
    state: 'active',
    count: 0,
    createdOn: 0,
    lastFetchedOn,
    lastJobStartedOn: null,
    lastJobEndedOn: null,
    lastJobDuration: null,
    lastError: null,
    lastErrorOn: null,
  };
}

const OUTAGE_LINE =
  '[backend] pg-boss: database unavailable, polls fail quietly until one succeeds:';

/** What a restart says, in turn: the server is going away, it is gone, a
 * connection dropped mid-handshake, it is starting up. */
interface Restart {
  shutdown: Error;
  refused: Error;
  hungUp: Error;
  startingUp: Error;
}

describe('createBoss error log', () => {
  let restart: Restart;
  let closedPort: number;

  beforeAll(async () => {
    const startingUp = await listen((socket) => {
      socket.once('data', () => {
        socket.end(fatal('57P03', 'the database system is starting up'));
      });
    });
    const hangUp = await listen((socket) => {
      socket.end();
    });
    const startingUpError = await connectError(startingUp.port);
    const hungUpError = await connectError(hangUp.port);
    startingUp.server.close();
    hangUp.server.close();
    closedPort = hangUp.port;
    const shutdown = new pg.DatabaseError(
      'terminating connection due to administrator command',
      0,
      'error',
    );
    shutdown.code = '57P01';
    restart = {
      shutdown,
      refused: await connectError(closedPort),
      hungUp: hungUpError,
      startingUp: startingUpError,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function bossWithSpies() {
    // Constructing pg-boss opens nothing; `start` would.
    const boss: PgBoss = createBoss(
      `postgres://tale:pw@127.0.0.1:${closedPort}/tale`,
      { supervise: false },
    );
    const wip = vi.spyOn(boss, 'getWipData').mockReturnValue([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    return { boss, warn, error, wip };
  }

  it('logs a restart’s burst of failed polls as one warning, then any other error in full', () => {
    const { boss, warn, error } = bossWithSpies();

    // The pool's idle clients hear the shutdown first, and pass it on as is.
    emitError(boss, restart.shutdown);
    // Then ten rounds of sixty queues' workers polling a database that is
    // going, gone and coming back: a 20 s restart.
    const kinds = [
      restart.shutdown,
      restart.refused,
      restart.hungUp,
      restart.startingUp,
    ];
    for (let round = 0; round < 10; round++) {
      for (let queue = 0; queue < 60; queue++) {
        const kind = kinds[(round + queue) % kinds.length] ?? restart.refused;
        emitError(boss, failedPoll(kind, `queue-${queue}`));
      }
    }
    // The queue cache's refresh re-emits a copy with no queue.
    emitError(boss, {
      ...copy(restart.refused),
      message: restart.refused.message,
      stack: restart.refused.stack,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      `${OUTAGE_LINE} 57P01 terminating connection due to administrator command`,
    );
    expect(error).not.toHaveBeenCalled();

    const missingTable = new pg.DatabaseError(
      'relation "pgboss.job" does not exist',
      0,
      'error',
    );
    missingTable.code = '42P01';
    const failure = failedPoll(missingTable, 'queue-0');
    emitError(boss, failure);

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[backend] pg-boss error:', failure);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reads node-postgres’s code-less hang-up through the worker’s suffix', () => {
    const { boss, warn, error } = bossWithSpies();

    emitError(boss, failedPoll(restart.hungUp, 'queue-0'));

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      `${OUTAGE_LINE} Connection terminated unexpectedly`,
    );
  });

  it('keeps logging in full what is not an unavailable database', () => {
    const { boss, warn, error } = bossWithSpies();
    // A pool with no free client is capacity, and rejected credentials are
    // an operator's to fix — neither is a restart.
    const exhausted = failedPoll(
      new Error('timeout exceeded when trying to connect'),
      'queue-0',
    );
    const rejected = failedPoll(
      Object.assign(new Error('password authentication failed'), {
        code: '28P01',
      }),
      'queue-1',
    );

    emitError(boss, exhausted);
    emitError(boss, rejected);

    expect(warn).not.toHaveBeenCalled();
    expect(error.mock.calls).toEqual([
      ['[backend] pg-boss error:', exhausted],
      ['[backend] pg-boss error:', rejected],
    ]);
  });

  it('is re-armed once a poll succeeds, so the next outage logs again', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1_000_000 });
    const { boss, warn, wip } = bossWithSpies();
    const fail = () => {
      emitError(boss, failedPoll(restart.refused, 'queue-0'));
    };

    fail();
    expect(warn).toHaveBeenCalledTimes(1);

    // Polls that last succeeded before the outage do not end it.
    wip.mockReturnValue([wipWorker(null), wipWorker(999_000)]);
    vi.advanceTimersByTime(30_000);
    fail();
    expect(warn).toHaveBeenCalledTimes(1);
    // The api role runs no queue's worker; the cron clock's is internal.
    expect(wip).toHaveBeenCalledWith({ includeInternal: true });

    // The database is back: a poll succeeds.
    wip.mockReturnValue([wipWorker(Date.now())]);
    vi.advanceTimersByTime(60_000);
    fail();
    fail();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
