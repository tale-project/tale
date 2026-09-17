import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setThreadArchived, trashThread, cancelDeferredSendsForThread } =
  vi.hoisted(() => ({
    setThreadArchived: vi.fn(),
    trashThread: vi.fn(),
    cancelDeferredSendsForThread: vi.fn(),
  }));
vi.mock('./threads.ts', () => ({ setThreadArchived, trashThread }));
vi.mock('./deferred-sends.ts', () => ({ cancelDeferredSendsForThread }));

import { bulkUpdateThreads } from './bulk.ts';

const auth = {
  organizationId: 'org1',
  userId: 'user1',
  email: 'owner@example.invalid',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setThreadArchived.mockResolvedValue({ archived: true });
  trashThread.mockResolvedValue(true);
  cancelDeferredSendsForThread.mockResolvedValue(0);
});

describe('account bulk chat actions', () => {
  it('enumerates only the caller’s visible active history in the current organization', async () => {
    const sql = vi.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    const result = await bulkUpdateThreads(
      sql as unknown as Sql,
      auth,
      'archive',
    );
    const [strings, ...values] = sql.mock.calls[0]!;
    expect(strings.join('?')).toContain('t.org_id = ? AND t.user_id = ?');
    expect(strings.join('?')).toContain(
      "tm.status = 'active' AND tm.hidden IS NOT true",
    );
    expect(strings.join('?')).toContain("? = 'trash' OR tm.archived = false");
    expect(values).toEqual(['org1', 'user1', 'archive']);
    expect(setThreadArchived).toHaveBeenCalledWith(sql, auth, 't1', true);
    expect(setThreadArchived).toHaveBeenCalledWith(sql, auth, 't2', true);
    expect(trashThread).not.toHaveBeenCalled();
    expect(result).toEqual({ changedIds: ['t1', 't2'], failed: 0 });
  });

  it('keeps legal-hold and running-thread refusals separate from successful trash operations', async () => {
    const sql = vi
      .fn()
      .mockResolvedValue([{ id: 'held' }, { id: 'busy' }, { id: 'archived' }]);
    trashThread
      .mockRejectedValueOnce(new Error('LEGAL_HOLD_ACTIVE'))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const result = await bulkUpdateThreads(
      sql as unknown as Sql,
      auth,
      'trash',
    );
    expect(result).toEqual({ changedIds: ['archived'], failed: 2 });
    expect(cancelDeferredSendsForThread).toHaveBeenCalledExactlyOnceWith(sql, {
      ...auth,
      threadId: 'archived',
    });
    expect(setThreadArchived).not.toHaveBeenCalled();
  });

  it('does not issue writes for an empty history', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    expect(
      await bulkUpdateThreads(sql as unknown as Sql, auth, 'trash'),
    ).toEqual({ changedIds: [], failed: 0 });
    expect(trashThread).not.toHaveBeenCalled();
  });

  it('reports committed trash changes even if deferred-send cleanup fails', async () => {
    const sql = vi.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    cancelDeferredSendsForThread.mockRejectedValueOnce(new Error('offline'));
    expect(
      await bulkUpdateThreads(sql as unknown as Sql, auth, 'trash'),
    ).toEqual({ changedIds: ['t1', 't2'], failed: 0 });
    expect(trashThread).toHaveBeenCalledTimes(2);
    expect(cancelDeferredSendsForThread).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(
      '[chat] bulk trash deferred-send cleanup failed',
      expect.objectContaining({ threadId: 't1' }),
    );
  });
});
