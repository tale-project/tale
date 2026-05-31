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
});
