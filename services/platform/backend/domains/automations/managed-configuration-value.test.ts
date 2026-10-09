import { describe, expect, it } from 'vitest';

import {
  managedConfigurationHash,
  managedScheduleValue,
} from './managed-configuration-value';

const row = {
  kind: 'schedule',
  cron: '*/30 * * * *',
  timezone: 'Europe/Zurich',
  enabled: true,
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
