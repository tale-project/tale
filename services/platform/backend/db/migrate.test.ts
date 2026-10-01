// @vitest-environment node

import {
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runBootMigrations } from './migrate.ts';

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

const SHUTTING_DOWN = fatal('57P03', 'the database system is shutting down');
const BAD_PASSWORD = fatal(
  '28P01',
  'password authentication failed for user "tale"',
);

/**
 * A server that refuses every connection's startup with `answer()`'s FATAL
 * — what PostgreSQL does while it shuts down, or when it rejects the
 * credentials — and counts the connections it saw.
 */
async function refusingServer(
  answer: () => Buffer,
): Promise<{ url: string; connections: () => number; close: () => void }> {
  let connections = 0;
  const server: Server = createServer((socket: Socket) => {
    connections += 1;
    socket.once('data', () => {
      socket.end(answer());
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `postgres://tale:pw@127.0.0.1:${port}/tale_app`,
    connections: () => connections,
    close: () => server.close(),
  };
}

describe('runBootMigrations, while the database is unavailable', () => {
  const closers: (() => void)[] = [];
  afterEach(() => {
    for (const close of closers.splice(0)) close();
    vi.restoreAllMocks();
  });

  it('waits out a database that is shutting down instead of failing the boot', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The database refuses as it shuts down until the second pause, then
    // answers again — with a refusal no wait can fix, so the step stops
    // there and the test needs no server that speaks the whole protocol.
    let answer = SHUTTING_DOWN;
    const server = await refusingServer(() => answer);
    closers.push(server.close);
    const sleep = vi.fn(async () => {
      if (sleep.mock.calls.length === 2) answer = BAD_PASSWORD;
    });

    const failure = await runBootMigrations({
      databaseUrl: server.url,
      log: () => undefined,
      sleep,
    }).then(
      () => new Error('the step was expected to fail'),
      (error: unknown) => error,
    );

    // Two refusals waited out, 1 s then 2 s apart, then the real failure —
    // rejected at once, as before.
    expect(failure).toMatchObject({ code: '28P01' });
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
    // One connection per attempt: a lock never taken is not unlocked over a
    // second one.
    expect(server.connections()).toBe(3);
  });

  it('still fails the boot once the outage outlasts the wait', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let now = 0;
    const server = await refusingServer(() => SHUTTING_DOWN);
    closers.push(server.close);
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });

    const failure = await runBootMigrations({
      databaseUrl: server.url,
      log: () => undefined,
      databaseWaitMs: 20_000,
      sleep,
      now: () => now,
    }).then(
      () => new Error('the step was expected to fail'),
      (error: unknown) => error,
    );

    // Refusals at 0, 1, 3, 7, 12, 17 and 22 s — the pause stops doubling at
    // 5 s — and the last one comes after the 20 s wait, so it is what the
    // boot reports.
    expect(failure).toMatchObject({
      code: '57P03',
      message: 'the database system is shutting down',
    });
    expect(sleep.mock.calls).toEqual([
      [1000],
      [2000],
      [4000],
      [5000],
      [5000],
      [5000],
    ]);
    expect(server.connections()).toBe(7);
  });

  it('times the outage from its first refusal, not from the start of the step', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let now = 0;
    // The first refusal arrives 55 s into the step — the time a process can
    // spend queued behind another's migration lock before the database goes
    // away under both.
    let refusals = 0;
    const server = await refusingServer(() => {
      refusals += 1;
      if (refusals === 1) now += 55_000;
      return SHUTTING_DOWN;
    });
    closers.push(server.close);
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });

    const failure = await runBootMigrations({
      databaseUrl: server.url,
      log: () => undefined,
      databaseWaitMs: 20_000,
      sleep,
      now: () => now,
    }).then(
      () => new Error('the step was expected to fail'),
      (error: unknown) => error,
    );

    // The whole 20 s wait, counted from the refusal at 55 s.
    expect(failure).toMatchObject({ code: '57P03' });
    expect(sleep.mock.calls).toEqual([
      [1000],
      [2000],
      [4000],
      [5000],
      [5000],
      [5000],
    ]);
    expect(server.connections()).toBe(7);
  });

  it('keeps its clock off the wall clock, so a time step at boot cannot cut the wait short', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The wall clock leaps an hour on every read — what a host syncing its
    // time at boot can do. The wait must not notice.
    let wall = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (wall += 3_600_000));
    let refusals = 0;
    const server = await refusingServer(() => {
      refusals += 1;
      return refusals <= 3 ? SHUTTING_DOWN : BAD_PASSWORD;
    });
    closers.push(server.close);
    const sleep = vi.fn(async (_ms: number) => undefined);

    const failure = await runBootMigrations({
      databaseUrl: server.url,
      log: () => undefined,
      databaseWaitMs: 20_000,
      sleep,
    }).then(
      () => new Error('the step was expected to fail'),
      (error: unknown) => error,
    );

    // All three refusals waited out, then the real failure.
    expect(failure).toMatchObject({ code: '28P01' });
    expect(sleep.mock.calls).toEqual([[1000], [2000], [4000]]);
  });

  it('fails at once, over a single connection, on an error a wait cannot fix', async () => {
    const server = await refusingServer(() => BAD_PASSWORD);
    closers.push(server.close);
    const sleep = vi.fn(async () => undefined);

    await expect(
      runBootMigrations({
        databaseUrl: server.url,
        log: () => undefined,
        sleep,
      }),
    ).rejects.toMatchObject({ code: '28P01' });
    expect(sleep).not.toHaveBeenCalled();
    expect(server.connections()).toBe(1);
  });
});
