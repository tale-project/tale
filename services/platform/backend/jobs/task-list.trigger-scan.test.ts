import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scanScheduledTriggers } = vi.hoisted(() => ({
  scanScheduledTriggers: vi.fn(),
}));

vi.mock('../domains/automations/triggers.ts', () => ({
  scanScheduledTriggers,
}));

import { createTaskList } from './task-list.ts';

const SQL = {} as Sql;

describe('automation.trigger_scan completion evidence', () => {
  beforeEach(() => vi.resetAllMocks());

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
});
