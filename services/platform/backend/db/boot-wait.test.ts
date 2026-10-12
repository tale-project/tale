// @vitest-environment node

import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBootDatabaseWait, waitOutDatabaseOutage } from './boot-wait.ts';

/** What node-postgres — pg-boss's and Better Auth's driver — rejects a
 * statement with when the server terminates its session as it shuts down. */
function terminated(): Error {
  const error = new pg.DatabaseError(
    'terminating connection due to administrator command',
    0,
    'error',
  );
  error.code = '57P01';
  return error;
}

function withCode(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** A step that fails with `failures` in turn, then answers `value`. */
function flakyStep<T>(failures: Error[], value: T) {
  let calls = 0;
  const step = vi.fn(async (): Promise<T> => {
    const failure = failures[calls];
    calls += 1;
    if (failure !== undefined) throw failure;
    return value;
  });
  return step;
}

describe('createBootDatabaseWait', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs a step again while the database is away, 1 s and then 2 s apart', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sleep = vi.fn(async () => {});
    const wait = createBootDatabaseWait({ sleep });
    const step = flakyStep(
      [terminated(), withCode('57P03', 'the database system is starting up')],
      'started',
    );

    await expect(wait(step)).resolves.toBe('started');

    expect(step).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
    // One warning per attempt that is run again, never an error.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toContain(
      'terminating connection due to administrator command',
    );
  });

  it('times every step of one boot on one clock, from its first refusal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let now = 0;
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    const wait = createBootDatabaseWait({ sleep, now: () => now });

    // The migrations meet a restart at 0 s and finish once it is over.
    await expect(wait(flakyStep([terminated()], 'migrated'))).resolves.toBe(
      'migrated',
    );
    // The next step is still inside the minute: waited out.
    now = 30_000;
    await expect(wait(flakyStep([terminated()], 'started'))).resolves.toBe(
      'started',
    );
    // A third outage 70 s into the boot is past the minute that began at the
    // first refusal: it fails at once, and the boot reports it.
    now = 70_000;
    const failure = await wait(flakyStep([terminated()], 'scheduled')).then(
      () => new Error('the step was expected to fail'),
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ code: '57P01' });
    expect(sleep.mock.calls).toEqual([[1000], [1000]]);
  });

  it('gives up once the outage outlasts the wait, the pause capped at 5 s', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let now = 0;
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    const wait = createBootDatabaseWait({
      waitMs: 20_000,
      sleep,
      now: () => now,
    });
    const step = vi.fn(async (): Promise<never> => {
      throw terminated();
    });

    const failure = await wait(step).then(
      () => new Error('the step was expected to fail'),
      (error: unknown) => error,
    );

    // Refusals at 0, 1, 3, 7, 12, 17 and 22 s; the last is past the wait.
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
    expect(step).toHaveBeenCalledTimes(7);
  });

  it('fails at once on a failure no wait fixes', async () => {
    const sleep = vi.fn(async () => {});
    const wait = createBootDatabaseWait({ sleep });

    await expect(
      wait(
        flakyStep(
          [withCode('28P01', 'password authentication failed for user "tale"')],
          'never',
        ),
      ),
    ).rejects.toMatchObject({ code: '28P01' });
    await expect(
      wait(flakyStep([new TypeError('a defect')], 'never')),
    ).rejects.toBeInstanceOf(TypeError);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('counts a bare refused socket as the database being away', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sleep = vi.fn(async () => {});
    const wait = createBootDatabaseWait({ sleep });

    // node-postgres raises a refused connection with no mark of where it came
    // from; a boot step's every client is a database client.
    await expect(
      wait(
        flakyStep(
          [withCode('ECONNREFUSED', 'connect ECONNREFUSED 172.19.0.4:5432')],
          'started',
        ),
      ),
    ).resolves.toBe('started');
    expect(sleep.mock.calls).toEqual([[1000]]);
  });
});

describe('waitOutDatabaseOutage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs a write again until the restarted database answers it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sleeps: number[] = [];
    const write = flakyStep(
      [terminated(), withCode('57P03', 'the database system is starting up')],
      'settled',
    );

    await expect(
      waitOutDatabaseOutage(write, {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    ).resolves.toBe('settled');

    expect(write).toHaveBeenCalledTimes(3);
    // Backing off from a second, so a restart is noticed within seconds.
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it('gives each write an outage clock of its own', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let now = 0;
    const options = {
      waitMs: 10_000,
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    };

    // One write waits out a restart of about eight seconds ...
    now = 0;
    const first = flakyStep(
      [terminated(), terminated(), terminated(), terminated()],
      'first',
    );
    await expect(waitOutDatabaseOutage(first, options)).resolves.toBe('first');

    // ... and a second, long after, is timed from ITS first refusal, not the first's.
    now = 1_000_000;
    const second = flakyStep([terminated(), terminated()], 'second');
    await expect(waitOutDatabaseOutage(second, options)).resolves.toBe(
      'second',
    );
  });

  it('rejects at once for anything but an unavailable database', async () => {
    const constraint = withCode('23505', 'duplicate key value');
    const write = flakyStep([constraint], 'never');

    await expect(waitOutDatabaseOutage(write)).rejects.toBe(constraint);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('gives up with the last error once the outage outlasts the wait', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let now = 0;
    const failure = terminated();
    const write = vi.fn(async () => {
      throw failure;
    });

    await expect(
      waitOutDatabaseOutage(write, {
        waitMs: 5_000,
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
      }),
    ).rejects.toBe(failure);
    // 1 s, 2 s, then 4 s would pass the five-second wait.
    expect(now).toBeLessThanOrEqual(5_000 + 5_000);
  });
});
