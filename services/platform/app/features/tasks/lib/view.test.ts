import { createMemoryHistory } from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';

import {
  closeTaskNavigation,
  dismissTaskSheet,
  openTaskNavigation,
  taskSheetBackSteps,
} from './view';

const BOARD = '/dashboard/o/projects/p/tasks/board';

describe('openTaskNavigation', () => {
  it('pushes a history entry when opening a task, keeping other search', () => {
    const nav = openTaskNavigation('task-b', undefined);
    expect(nav.replace).toBe(false);
    expect(nav.state).toEqual({ taskSheetDepth: 1 });
    expect(nav.search({ projects: 'all' as const, task: 'task-a' })).toEqual({
      projects: 'all',
      task: 'task-b',
    });
  });

  it('deepens the chain when stepping from a task into its subtask', () => {
    expect(openTaskNavigation('sub', { taskSheetDepth: 1 }).state).toEqual({
      taskSheetDepth: 2,
    });
  });
});

describe('closeTaskNavigation', () => {
  it('replaces the entry, dropping ?task', () => {
    const nav = closeTaskNavigation();
    expect(nav.replace).toBe(true);
    expect(nav.search({ projects: 'all' as const, task: 'task-a' })).toEqual({
      projects: 'all',
    });
  });
});

describe('dismissTaskSheet', () => {
  it('walks back over the open so the history is what it was before', () => {
    const history = createMemoryHistory({ initialEntries: [BOARD] });
    const lengthBefore = history.length;
    const open = openTaskNavigation('task-a', history.location.state);
    history.push(`${BOARD}?task=task-a`, open.state);
    expect(history.length).toBe(lengthBefore + 1);

    const navigate = vi.fn();
    dismissTaskSheet(history, navigate);

    expect(navigate).not.toHaveBeenCalled();
    expect(history.location.href).toBe(BOARD);
    // The next push replaces the stale forward entry, so there is nothing
    // dead for Back to step over.
    history.push(`${BOARD}?task=task-b`, { taskSheetDepth: 1 });
    expect(history.length).toBe(lengthBefore + 1);
  });

  it('walks back over the whole task → subtask chain', () => {
    const history = createMemoryHistory({ initialEntries: [BOARD] });
    const first = openTaskNavigation('task-a', history.location.state);
    history.push(`${BOARD}?task=task-a`, first.state);
    const second = openTaskNavigation('sub', history.location.state);
    history.push(`${BOARD}?task=sub`, second.state);
    expect(history.location.state.taskSheetDepth).toBe(2);

    const navigate = vi.fn();
    dismissTaskSheet(history, navigate);

    expect(navigate).not.toHaveBeenCalled();
    expect(history.location.href).toBe(BOARD);
  });

  it('replaces the entry when the sheet was reached by a deep link', () => {
    const history = createMemoryHistory({
      initialEntries: [`${BOARD}?task=task-a`],
    });
    const navigate = vi.fn();
    dismissTaskSheet(history, navigate);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]?.[0]?.replace).toBe(true);
    expect(history.location.href).toBe(`${BOARD}?task=task-a`);
  });

  it('never walks further back than the history holds', () => {
    expect(
      taskSheetBackSteps({ state: { taskSheetDepth: 3, __TSR_index: 1 } }),
    ).toBe(1);
    expect(
      taskSheetBackSteps({ state: { taskSheetDepth: 1, __TSR_index: 0 } }),
    ).toBe(0);
    expect(taskSheetBackSteps({ state: { __TSR_index: 4 } })).toBe(0);
  });
});
