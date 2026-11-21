// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBootDatabaseWait } from '../db/boot-wait.ts';
import { bossOptionsForRole, createBoss, startBoss } from './boss.ts';

/**
 * Whether a pg-boss instance runs its cron clock is fixed by the config it is
 * made with, which it does not expose: so pg-boss is replaced here by a class
 * that keeps that config, and answers what `createBoss` and `startBoss` ask.
 */
const { configs } = vi.hoisted(() => ({ configs: [] as unknown[] }));
vi.mock('pg-boss', () => ({
  PgBoss: class {
    constructor(config: unknown) {
      configs.push(config);
    }
    on(): this {
      return this;
    }
    start(): Promise<this> {
      return Promise.resolve(this);
    }
    stop(): Promise<void> {
      return Promise.resolve();
    }
    createQueue(): Promise<void> {
      return Promise.resolve();
    }
    getQueue(): Promise<null> {
      return Promise.resolve(null);
    }
  },
}));

const DATABASE_URL = 'postgres://tale:pw@127.0.0.1:1/tale';

afterEach(() => {
  configs.length = 0;
  vi.unstubAllEnvs();
});

describe('createBoss — the pool and the listener', () => {
  it('gives pg-boss the application pool’s size and a listener unless the caller says otherwise', () => {
    createBoss(DATABASE_URL, { supervise: true });
    vi.stubEnv('DATABASE_POOL_MAX', '4');
    createBoss(DATABASE_URL, { supervise: true });

    expect(configs).toMatchObject([
      { max: 10, useListenNotify: true },
      { max: 4, useListenNotify: true },
    ]);
  });

  // The api role: it sends jobs and works none, so nothing there is woken
  // by a notification, and a send needs no pool of ten.
  it('opens the pool it is asked for, and no listener for a process that works no queue', () => {
    createBoss(DATABASE_URL, { supervise: false, poolMax: 2, listen: false });

    expect(configs).toMatchObject([{ max: 2, useListenNotify: false }]);
  });

  it('lets the api role send through two connections, with no maintenance and no listener', () => {
    expect(bossOptionsForRole('api', {})).toEqual({
      supervise: false,
      listen: false,
      poolMax: 2,
    });
  });

  it.each(['worker', 'all'] as const)(
    'lets the %s role maintain its queues and be woken, on a pool the size of the application’s',
    (role) => {
      expect(bossOptionsForRole(role, {})).toEqual({
        supervise: true,
        listen: true,
        poolMax: 10,
      });
      expect(bossOptionsForRole(role, { DATABASE_POOL_MAX: '4' }).poolMax).toBe(
        4,
      );
      expect(
        bossOptionsForRole(role, {
          DATABASE_POOL_MAX: '4',
          JOBS_DATABASE_POOL_MAX: '3',
        }).poolMax,
      ).toBe(3);
    },
  );

  it('starts pg-boss with the pool and the listener its caller asks for', async () => {
    await startBoss(DATABASE_URL, {
      supervise: false,
      poolMax: 2,
      listen: false,
      wait: createBootDatabaseWait(),
    });
    await startBoss(DATABASE_URL, {
      supervise: true,
      poolMax: 3,
      wait: createBootDatabaseWait(),
    });

    expect(configs).toMatchObject([
      { max: 2, useListenNotify: false },
      { max: 3, useListenNotify: true },
    ]);
  });
});

describe('createBoss — the cron clock', () => {
  it('runs pg-boss’s cron clock unless the caller turns it off', () => {
    createBoss(DATABASE_URL, { supervise: true });
    createBoss(DATABASE_URL, { supervise: false });
    createBoss(DATABASE_URL, { supervise: true, schedule: false });

    expect(configs).toMatchObject([
      { supervise: true, schedule: true },
      { supervise: false, schedule: true },
      { supervise: true, schedule: false },
    ]);
  });

  // pg-boss keeps a `schedule` key it is handed, `undefined` included, and
  // runs no clock for it: every role of a deployment would stop ticking.
  it('never hands pg-boss an undefined schedule', () => {
    createBoss(DATABASE_URL, { supervise: true, schedule: undefined });

    expect(configs).toEqual([expect.objectContaining({ schedule: true })]);
  });

  it('starts pg-boss with the clock its caller asks for', async () => {
    await startBoss(DATABASE_URL, {
      supervise: true,
      wait: createBootDatabaseWait(),
    });
    await startBoss(DATABASE_URL, {
      supervise: true,
      schedule: false,
      wait: createBootDatabaseWait(),
    });

    expect(configs).toMatchObject([
      { supervise: true, schedule: true },
      { supervise: true, schedule: false },
    ]);
  });
});
