// @vitest-environment node

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchAutomationEvent } from '../automations/triggers.ts';
import { emitEvent } from './emit.ts';

vi.mock('../automations/triggers.ts', () => ({
  dispatchAutomationEvent: vi.fn(),
}));

const dispatch = vi.mocked(dispatchAutomationEvent);

/**
 * A `postgres` transaction stand-in that models the one thing this seam
 * depends on: `savepoint(fn)` hands `fn` a nested handle and, when `fn`
 * rejects, rolls back to the savepoint and rethrows — the outer transaction
 * stays usable. Without the savepoint the real driver would have left the
 * transaction aborted (every later statement fails with 25P02).
 */
function fakeTx(): {
  tx: TransactionSql;
  savepointHandle: TransactionSql;
  rolledBack: number;
} {
  const state = { rolledBack: 0 };
  const savepointHandle = { kind: 'savepoint' } as unknown as TransactionSql;
  const tx = {
    kind: 'outer',
    savepoint: async (fn: (sp: TransactionSql) => Promise<unknown>) => {
      try {
        return await fn(savepointHandle);
      } catch (error) {
        state.rolledBack += 1;
        throw error;
      }
    },
  } as unknown as TransactionSql;
  return {
    tx,
    savepointHandle,
    get rolledBack() {
      return state.rolledBack;
    },
  };
}

describe('emitEvent', () => {
  beforeEach(() => {
    dispatch.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('dispatches inside a savepoint on the producing transaction', async () => {
    dispatch.mockResolvedValue({ started: ['run-1'], refused: false });
    const fake = fakeTx();

    await emitEvent(fake.tx, {
      organizationId: 'org-1',
      eventType: 'task.created',
      eventData: { taskId: 't-1' },
    });

    expect(dispatch).toHaveBeenCalledOnce();
    // The dispatch must run on the SAVEPOINT handle, never on the outer tx:
    // that is what lets a SQL fault roll back only the dispatch.
    expect(dispatch.mock.calls[0]?.[0]).toBe(fake.savepointHandle);
    expect(dispatch.mock.calls[0]?.[1]).toEqual({
      organizationId: 'org-1',
      event: 'task.created',
      payload: { taskId: 't-1' },
      origin: 'platform',
    });
    expect(fake.rolledBack).toBe(0);
  });

  it('rolls a failed dispatch back to the savepoint and keeps the producer alive', async () => {
    dispatch.mockRejectedValue(
      Object.assign(
        new Error('duplicate key value violates unique constraint'),
        {
          code: '23505',
        },
      ),
    );
    const fake = fakeTx();

    // The producer's contract: emitting never throws.
    await expect(
      emitEvent(fake.tx, {
        organizationId: 'org-1',
        eventType: 'contact.created',
      }),
    ).resolves.toBeUndefined();

    // ... and the fault was contained to the savepoint, so the outer
    // transaction is still valid for the producer's commit.
    expect(fake.rolledBack).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('automation dispatch failed for contact.created'),
      expect.any(Error),
    );
  });

  it('omits the payload key when the event carries no data', async () => {
    dispatch.mockResolvedValue({ started: [], refused: false });
    const fake = fakeTx();
    await emitEvent(fake.tx, {
      organizationId: 'org-1',
      eventType: 'task.deleted',
    });
    expect(dispatch.mock.calls[0]?.[1]).not.toHaveProperty('payload');
  });
});
