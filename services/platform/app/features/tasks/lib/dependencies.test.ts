import { describe, expect, it } from 'vitest';

import { computeBlockedTaskIds } from './dependencies';
import type { TaskStatus } from './display';

const task = (id: string, status: TaskStatus) => ({ _id: id, status });
const edge = (blockerTaskId: string, blockedTaskId: string) => ({
  blockerTaskId,
  blockedTaskId,
});

describe('computeBlockedTaskIds', () => {
  it('marks a task blocked while its blocker is non-terminal', () => {
    const tasks = [task('a', 'in_progress'), task('b', 'todo')];
    const blocked = computeBlockedTaskIds(tasks, [edge('a', 'b')]);
    expect(blocked.has('b')).toBe(true);
    expect(blocked.has('a')).toBe(false);
  });

  it('treats a done or cancelled blocker as resolved', () => {
    const tasks = [
      task('a', 'done'),
      task('b', 'todo'),
      task('c', 'cancelled'),
      task('d', 'todo'),
    ];
    const blocked = computeBlockedTaskIds(tasks, [
      edge('a', 'b'),
      edge('c', 'd'),
    ]);
    expect(blocked.size).toBe(0);
  });

  it('stays blocked if any one blocker is still open', () => {
    const tasks = [
      task('a', 'done'),
      task('b', 'in_progress'),
      task('c', 'todo'),
    ];
    const blocked = computeBlockedTaskIds(tasks, [
      edge('a', 'c'),
      edge('b', 'c'),
    ]);
    expect(blocked.has('c')).toBe(true);
  });

  it('ignores edges whose blocker is missing from the set', () => {
    const tasks = [task('b', 'todo')];
    const blocked = computeBlockedTaskIds(tasks, [edge('ghost', 'b')]);
    expect(blocked.size).toBe(0);
  });

  it('keeps a live blocker blocking outside the filtered rows', () => {
    const tasks = [task('b', 'todo')];
    const edges = [{ ...edge('a', 'b'), blockerResolved: false }];
    expect(computeBlockedTaskIds(tasks, edges).has('b')).toBe(true);
  });

  it('honors server resolution even if an archived blocker is visible', () => {
    const tasks = [task('a', 'todo'), task('b', 'todo')];
    const edges = [{ ...edge('a', 'b'), blockerResolved: true }];
    expect(computeBlockedTaskIds(tasks, edges).size).toBe(0);
  });

  it.each(['done', 'cancelled', 'archived', 'deleted'])(
    'keeps a hidden %s blocker resolved',
    () => {
      const edges = [{ ...edge('a', 'b'), blockerResolved: true }];
      expect(computeBlockedTaskIds([task('b', 'todo')], edges).size).toBe(0);
    },
  );

  it('uses current server state rather than an outdated visible status', () => {
    const edges = [{ ...edge('a', 'b'), blockerResolved: false }];
    expect(
      computeBlockedTaskIds([task('a', 'done'), task('b', 'todo')], edges).has(
        'b',
      ),
    ).toBe(true);
  });
});
