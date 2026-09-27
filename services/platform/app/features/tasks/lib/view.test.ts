import { describe, expect, it } from 'vitest';

import { openTaskNavigation } from './view';

describe('openTaskNavigation', () => {
  it('pushes a history entry when opening a task, keeping other search', () => {
    const nav = openTaskNavigation('task-b');
    expect(nav.replace).toBe(false);
    expect(nav.search({ projects: 'all' as const, task: 'task-a' })).toEqual({
      projects: 'all',
      task: 'task-b',
    });
  });

  it('replaces the entry when closing, dropping ?task', () => {
    const nav = openTaskNavigation(null);
    expect(nav.replace).toBe(true);
    expect(nav.search({ projects: 'all' as const, task: 'task-a' })).toEqual({
      projects: 'all',
    });
  });
});
