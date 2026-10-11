// @vitest-environment node

import {
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from 'node:net';

import pg from 'pg';
import { PgBoss, type WipData } from 'pg-boss';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createBootDatabaseWait } from '../db/boot-wait.ts';
import { createBoss, startBoss } from './boss.ts';
import { TASK_QUEUE_OPTIONS } from './tasks.ts';

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

/** 57P01, what PostgreSQL sends every session as it shuts down — fast or
 * smart — and what an administrator's `pg_terminate_backend` sends. */
const TERMINATED = fatal(
  '57P01',
  'terminating connection due to administrator command',
);
const BAD_PASSWORD = fatal(
  '28P01',
  'password authentication failed for user "tale"',
);

/** AuthenticationOk, then ReadyForQuery: a session the server accepted. */
const ACCEPTED = Buffer.from([
  0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49,
]);

/**
 * A database shutting down under a booting process: it accepts each
 * connection, then terminates it at its first statement with 57P01, as
 * PostgreSQL does a session whose statement is in flight when the stop
 * begins. Once `refuseWith` is called, it refuses every startup with that
 * FATAL instead.
 */
async function shuttingDownServer(): Promise<{
  url: string;
  refuseWith: (answer: Buffer) => void;
  openSockets: () => number;
  close: () => void;
}> {
  let refusal: Buffer | null = null;
  const sockets = new Set<Socket>();
  const { server, port } = await listen((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.once('data', () => {
      if (refusal !== null) {
        socket.end(refusal);
        return;
      }
      socket.write(ACCEPTED);
      socket.once('data', () => {
        socket.end(TERMINATED);
      });
    });
  });
  return {
    url: `postgres://tale:pw@127.0.0.1:${port}/tale`,
    refuseWith: (answer) => {
      refusal = answer;
    },
    openSockets: () => sockets.size,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

describe('startBoss, while the database restarts', () => {
  const closers: (() => void)[] = [];
  afterEach(() => {
    for (const close of closers.splice(0)) close();
    vi.restoreAllMocks();
  });

  it('meets a stop that cuts pg-boss’s start with the error GlitchTip titles “error: terminating connection due to administrator command”', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = await shuttingDownServer();
    closers.push(server.close);
    // What the boot awaited before the job engine's start was waited out.
    const boss = createBoss(server.url, { supervise: false });

    const failure = await boss.start().then(
      () => new Error('the start was expected to fail'),
      (error: unknown) => error,
    );
    await boss.stop({ graceful: false });

    // node-postgres names its server errors `error`: the event's type, and
    // so the first half of its title.
    expect(failure).toBeInstanceOf(pg.DatabaseError);
    expect(failure).toMatchObject({ code: '57P01' });
    expect(String(failure)).toBe(
      'error: terminating connection due to administrator command',
    );
  });

  it('waits out a stop that cuts pg-boss’s start, on a fresh instance each attempt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stop = vi.spyOn(PgBoss.prototype, 'stop');
    const server = await shuttingDownServer();
    closers.push(server.close);
    // The database terminates the start until the second pause, then answers
    // again — with a refusal no wait can fix, so the start stops there and
    // the test needs no server that hosts pg-boss's schema.
    const sleep = vi.fn(async () => {
      if (sleep.mock.calls.length === 2) server.refuseWith(BAD_PASSWORD);
    });

    const failure = await startBoss(server.url, {
      supervise: false,
      wait: createBootDatabaseWait({ sleep }),
    }).then(
      () => new Error('the start was expected to fail'),
      (caught: unknown) => caught,
    );

    // Two cut starts waited out, 1 s then 2 s apart, then the real failure —
    // rejected at once, as the boot reports it.
    expect(failure).toMatchObject({ code: '28P01' });
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'retrying in 1000ms: terminating connection due to administrator command',
      ),
    );
    expect(error).not.toHaveBeenCalled();
    // Every failed start's instance was stopped, so none is left with a pool
    // or a connection beside the next attempt's.
    expect(stop).toHaveBeenCalledTimes(3);
    await vi.waitFor(() => {
      expect(server.openSockets()).toBe(0);
    });
  });

  it('still fails the boot once the outage outlasts the wait', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = await shuttingDownServer();
    closers.push(server.close);
    let now = 0;
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });

    const failure = await startBoss(server.url, {
      supervise: false,
      wait: createBootDatabaseWait({ waitMs: 20_000, sleep, now: () => now }),
    }).then(
      () => new Error('the start was expected to fail'),
      (error: unknown) => error,
    );

    // Starts cut at 0, 1, 3, 7, 12, 17 and 22 s; the last is past the wait,
    // and that error is what the boot reports.
    expect(String(failure)).toBe(
      'error: terminating connection due to administrator command',
    );
    expect(sleep.mock.calls).toEqual([
      [1000],
      [2000],
      [4000],
      [5000],
      [5000],
      [5000],
    ]);
  });

  it('creates the queues again when the stop cuts their creation', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A start the database answered (a local server cannot host pg-boss's
    // schema), then a stop that cuts the first queue's creation and the
    // check that a concurrent boot created it.
    vi.spyOn(PgBoss.prototype, 'start').mockImplementation(
      async function started(this: PgBoss) {
        return this;
      },
    );
    const shutdown = new pg.DatabaseError(
      'terminating connection due to administrator command',
      0,
      'error',
    );
    shutdown.code = '57P01';
    const createQueue = vi
      .spyOn(PgBoss.prototype, 'createQueue')
      .mockRejectedValueOnce(shutdown)
      .mockResolvedValue(undefined);
    const getQueue = vi
      .spyOn(PgBoss.prototype, 'getQueue')
      .mockRejectedValueOnce(shutdown);
    const sleep = vi.fn(async () => {});

    await startBoss('postgres://tale:pw@127.0.0.1:1/tale', {
      supervise: false,
      wait: createBootDatabaseWait({ sleep }),
    });

    expect(sleep.mock.calls).toEqual([[1000]]);
    expect(getQueue).toHaveBeenCalledTimes(1);
    expect(createQueue).toHaveBeenCalledTimes(
      Object.keys(TASK_QUEUE_OPTIONS).length + 1,
    );
  });
});
