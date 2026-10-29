// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBootDatabaseWait } from '../db/boot-wait.ts';
import { createBoss, startBoss } from './boss.ts';

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
