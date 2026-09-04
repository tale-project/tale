import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { pgTaskStore } from './task-store.ts';

/**
 * `task.get` answers `null` for exactly one thing — the task does not exist
 * in the org. Regression: the store wrapped the load in `catch { return
 * null }`, so a lost connection or an exhausted pool read as "task not
 * found" and a workflow acted on a phantom miss.
 */

/** A `Sql` stand-in for the one read `get` performs: the tagged-template
 * call answers `rows`, or rejects with `failure`. */
function sqlStub(outcome: { rows?: unknown[]; failure?: Error }): Sql {
  const call = (): Promise<unknown[]> =>
    outcome.failure
      ? Promise.reject(outcome.failure)
      : Promise.resolve(outcome.rows ?? []);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the store touches only the tagged call and `unsafe` on this path
  return Object.assign(call, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
}

describe('pgTaskStore.get', () => {
  it('answers null when the org holds no such task', async () => {
    const store = pgTaskStore(sqlStub({ rows: [] }));
    await expect(
      store.get({ organizationId: 'org-1', taskId: 'missing' }),
    ).resolves.toBeNull();
  });

  it('answers the task view when the row exists', async () => {
    const store = pgTaskStore(
      sqlStub({
        rows: [
          {
            id: 'task-1',
            title: 'Ship it',
            status: 'todo',
            description: null,
            projectId: 'project-1',
          },
        ],
      }),
    );
    await expect(
      store.get({ organizationId: 'org-1', taskId: 'task-1' }),
    ).resolves.toEqual({
      taskId: 'task-1',
      title: 'Ship it',
      status: 'todo',
      projectId: 'project-1',
    });
  });

  it('propagates a database failure instead of calling it "not found"', async () => {
    const failure = Object.assign(new Error('connection terminated'), {
      code: '57P01',
    });
    const store = pgTaskStore(sqlStub({ failure }));
    await expect(
      store.get({ organizationId: 'org-1', taskId: 'task-1' }),
    ).rejects.toBe(failure);
  });
});
