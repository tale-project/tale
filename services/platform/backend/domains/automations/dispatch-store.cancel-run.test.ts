// @vitest-environment node

/**
 * Unit lock for the engine door's `cancelRun`: a store failure (audit write,
 * session stop, the database) must reach the MCP caller as the real error.
 * Regression: a `.catch(() => null)` around the store call laundered every
 * failure into a fake "no run" answer, so a broken cancel looked like a
 * missing run to the caller and left the run running.
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

const { cancelRun } = vi.hoisted(() => ({ cancelRun: vi.fn() }));

vi.mock('./store.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store.ts')>();
  return { ...actual, cancelRun };
});

import { pgAutomationStore } from './dispatch-store.ts';

/** Scripted root handle: the actor is an org owner; nothing else is read. */
const sql = ((strings: TemplateStringsArray): Promise<unknown[]> =>
  Promise.resolve(
    strings.join('?').includes('FROM "member"') ? [{ role: 'owner' }] : [],
  )) as unknown as Sql;

const scope = { organizationId: 'org_1', actor: 'user_1' };

describe('pgAutomationStore.cancelRun', () => {
  it('surfaces a store failure instead of answering "no run"', async () => {
    cancelRun.mockRejectedValueOnce(new Error('audit write failed'));
    const store = pgAutomationStore(sql, scope);
    // The door is optional on the DispatchStore contract; the pg store has it.
    expect(typeof store.cancelRun).toBe('function');
    await expect(store.cancelRun?.('run_1')).rejects.toThrow(
      'audit write failed',
    );
  });

  it('passes the store answer through for a missing or terminal run', async () => {
    cancelRun.mockResolvedValueOnce({ cancelled: false });
    const store = pgAutomationStore(sql, scope);
    await expect(store.cancelRun?.('run_1')).resolves.toEqual({
      cancelled: false,
    });
    expect(cancelRun).toHaveBeenCalledWith(sql, 'org_1', 'run_1');
  });
});
