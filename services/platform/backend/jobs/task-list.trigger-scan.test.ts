import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scanScheduledTriggers, fireDueProjectWakes } = vi.hoisted(() => ({
  scanScheduledTriggers: vi.fn(),
  fireDueProjectWakes: vi.fn(),
}));

vi.mock('../domains/automations/triggers.ts', () => ({
  scanScheduledTriggers,
}));
vi.mock('../domains/automations/wakes.ts', () => ({
  fireDueProjectWakes,
}));

const NO_WAKES = { examined: 0, fired: 0, waiting: 0, busy: 0, failed: 0 };

import { createTaskList } from './task-list.ts';

const SQL = {} as Sql;

describe('automation.trigger_scan completion evidence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fireDueProjectWakes.mockResolvedValue(NO_WAKES);
  });

  it('certifies a finished scan even when no trigger is due', async () => {
    scanScheduledTriggers.mockResolvedValue({ pages: 1, fired: 0 });
    const result = await createTaskList({ sql: SQL })[
      'automation.trigger_scan'
    ]?.({});
    expect(scanScheduledTriggers).toHaveBeenCalledWith(SQL);
    expect(result).toEqual({ output: { triggerScanCompleted: true } });
  });

  it('does not certify a scan whose organization table is unavailable', async () => {
    scanScheduledTriggers.mockResolvedValue({ pages: 0, fired: 0 });
    await expect(
      createTaskList({ sql: SQL })['automation.trigger_scan']?.({}),
    ).resolves.toBeUndefined();
  });

  it('waits for the scan and propagates failure without success evidence', async () => {
    let refuse: ((error: Error) => void) | undefined;
    scanScheduledTriggers.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          refuse = reject;
        }),
    );
    const result = createTaskList({ sql: SQL })['automation.trigger_scan']?.(
      {},
    );
    const assertion = expect(result).rejects.toThrow('scan interrupted');
    refuse?.(new Error('scan interrupted'));
    await assertion;
  });

  it('fires due wakes after the schedule walk', async () => {
    const order: string[] = [];
    scanScheduledTriggers.mockImplementation(async () => {
      order.push('schedules');
      return { pages: 1, fired: 0 };
    });
    fireDueProjectWakes.mockImplementation(async () => {
      order.push('wakes');
      return NO_WAKES;
    });
    await createTaskList({ sql: SQL })['automation.trigger_scan']?.({});
    expect(order).toEqual(['schedules', 'wakes']);
    expect(fireDueProjectWakes).toHaveBeenCalledWith(SQL);
  });

  it('keeps the scan marker when the wake fire fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    scanScheduledTriggers.mockResolvedValue({ pages: 1, fired: 0 });
    fireDueProjectWakes.mockRejectedValue(new Error('wake table busy'));
    const result = await createTaskList({ sql: SQL })[
      'automation.trigger_scan'
    ]?.({});
    expect(result).toEqual({ output: { triggerScanCompleted: true } });
    expect(logged).toHaveBeenCalledWith(
      '[wakes] wake scan failed:',
      expect.any(Error),
    );
    logged.mockRestore();
  });
});
