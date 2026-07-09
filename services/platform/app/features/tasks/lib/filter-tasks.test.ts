import { describe, expect, it } from 'vitest';

import type { TaskRow } from '../components/task-card';
import {
  ALL_ASSIGNEE_FILTER,
  ALL_PRIORITY_FILTER,
  ASSIGNEE_FILTER_ME,
  ASSIGNEE_FILTER_UNASSIGNED,
  filterTasksByFacets,
  resolveAssigneeQueryFilter,
} from './filter-tasks';

const task = (
  overrides: Partial<Omit<TaskRow, '_id'>> & { _id?: string } = {},
): TaskRow =>
  ({
    _id: 'task-1',
    assigneeId: undefined,
    priority: undefined,
    ...overrides,
  }) as TaskRow;

describe('resolveAssigneeQueryFilter', () => {
  it('returns undefined for all and unassigned', () => {
    expect(resolveAssigneeQueryFilter(ALL_ASSIGNEE_FILTER, 'user-1')).toBe(
      undefined,
    );
    expect(
      resolveAssigneeQueryFilter(ASSIGNEE_FILTER_UNASSIGNED, 'user-1'),
    ).toBe(undefined);
  });

  it('maps me to the current user id', () => {
    expect(resolveAssigneeQueryFilter(ASSIGNEE_FILTER_ME, 'user-1')).toBe(
      'user-1',
    );
    expect(resolveAssigneeQueryFilter(ASSIGNEE_FILTER_ME)).toBe(undefined);
  });

  it('passes through a concrete assignee id', () => {
    expect(resolveAssigneeQueryFilter('agent-1', 'user-1')).toBe('agent-1');
  });
});

describe('filterTasksByFacets', () => {
  const tasks = [
    task({ _id: 'a', assigneeId: 'user-1', priority: 'p0' }),
    task({ _id: 'b', assigneeId: 'agent-1', priority: 'p2' }),
    task({ _id: 'c', assigneeId: undefined, priority: undefined }),
  ];

  it('filters by assignee me', () => {
    const filtered = filterTasksByFacets(tasks, {
      assignee: ASSIGNEE_FILTER_ME,
      priority: ALL_PRIORITY_FILTER,
      currentUserId: 'user-1',
    });
    expect(filtered.map((row) => row._id)).toEqual(['a']);
  });

  it('filters by unassigned', () => {
    const filtered = filterTasksByFacets(tasks, {
      assignee: ASSIGNEE_FILTER_UNASSIGNED,
      priority: ALL_PRIORITY_FILTER,
    });
    expect(filtered.map((row) => row._id)).toEqual(['c']);
  });

  it('filters by priority and no priority', () => {
    expect(
      filterTasksByFacets(tasks, {
        assignee: ALL_ASSIGNEE_FILTER,
        priority: 'p2',
      }).map((row) => row._id),
    ).toEqual(['b']);

    expect(
      filterTasksByFacets(tasks, {
        assignee: ALL_ASSIGNEE_FILTER,
        priority: 'none',
      }).map((row) => row._id),
    ).toEqual(['c']);
  });
});
