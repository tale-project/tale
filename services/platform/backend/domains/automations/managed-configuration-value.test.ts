// @vitest-environment node

/**
 * The managed value of a schedule — what `tale` compares a declaration
 * with, by hash. A cron schedule keeps exactly the keys it always had, so
 * a schedule applied before repeat rules existed reads as unchanged and no
 * operator sees a drift that is not there. A rule schedule reads as its
 * rule and start day; either adds `catchUp` only when it is `skip` and a
 * fixed input only when it has one.
 */

import { describe, expect, it } from 'vitest';

import {
  managedConfigurationHash,
  managedScheduleValue,
  type ManagedScheduleSource,
} from './managed-configuration-value';

const cronRow: ManagedScheduleSource = {
  kind: 'schedule',
  cron: '0 6 * * *',
  timezone: 'UTC',
  enabled: true,
  repeat: null,
  startDate: null,
  catchUp: 'latest',
  input: null,
};

describe('managedScheduleValue', () => {
  it('hashes a cron schedule exactly as before repeat rules (golden)', () => {
    const value = managedScheduleValue('proj_1', 'ops/nightly', cronRow);
    expect(value).toEqual({
      projectId: 'proj_1',
      name: 'ops/nightly',
      cron: '0 6 * * *',
      timezone: 'UTC',
      enabled: true,
    });
    // The hash an apply recorded before this change.
    expect(managedConfigurationHash(value)).toBe(
      'c952e1036d1f0d47b2f926aa0a3e80f3b549ed8d6b166240ec6eac4f882f8eff',
    );
  });

  it('reads a rule schedule as its rule, its start day and its zone', () => {
    expect(
      managedScheduleValue('proj_1', 'ops/nightly', {
        ...cronRow,
        cron: null,
        timezone: 'Europe/Zurich',
        repeat: { frequency: 'daily', interval: 1, times: ['09:00'] },
        startDate: '2026-10-08',
        catchUp: 'skip',
        input: { owner: 'tale' },
      }),
    ).toEqual({
      projectId: 'proj_1',
      name: 'ops/nightly',
      repeat: { frequency: 'daily', interval: 1, times: ['09:00'] },
      startDate: '2026-10-08',
      timezone: 'Europe/Zurich',
      enabled: true,
      catchUp: 'skip',
      input: { owner: 'tale' },
    });
  });

  it('reads a row with both as its cron, which is what runs', () => {
    const value = managedScheduleValue('proj_1', 'ops/nightly', {
      ...cronRow,
      repeat: { frequency: 'daily', interval: 1, times: ['09:00'] },
      startDate: '2026-10-08',
    });
    expect(value).toMatchObject({ cron: '0 6 * * *' });
    expect(value).not.toHaveProperty('repeat');
  });

  it('refuses a webhook or an event as an ownership conflict', () => {
    expect(() =>
      managedScheduleValue('proj_1', 'ops/nightly', {
        ...cronRow,
        kind: 'webhook',
      }),
    ).toThrow('Managed trigger is not a schedule');
  });
});

const row: ManagedScheduleSource = {
  kind: 'schedule',
  cron: '*/30 * * * *',
  timezone: 'Europe/Zurich',
  enabled: true,
  repeat: null,
  startDate: null,
  catchUp: null,
  input: null,
};

describe('managedScheduleValue — the slot-wake opt-in readback (#4540)', () => {
  it('reads the opt-in back only when it is on', () => {
    expect(
      managedScheduleValue('project-a', 'fleet/dispatch', {
        ...row,
        wakeOnSlotFreed: true,
      }),
    ).toMatchObject({ wakeOnSlotFreed: true });
    expect(
      managedScheduleValue('project-a', 'fleet/dispatch', {
        ...row,
        wakeOnSlotFreed: false,
      }),
    ).not.toHaveProperty('wakeOnSlotFreed');
  });

  it('keeps the hash of a schedule that never opted in', () => {
    // Existing managed schedules must not read as drifted after the column
    // lands: off and absent are the same declaration.
    expect(
      managedConfigurationHash(
        managedScheduleValue('project-a', 'fleet/dispatch', {
          ...row,
          wakeOnSlotFreed: false,
        }),
      ),
    ).toBe(
      managedConfigurationHash(
        managedScheduleValue('project-a', 'fleet/dispatch', row),
      ),
    );
  });
});
