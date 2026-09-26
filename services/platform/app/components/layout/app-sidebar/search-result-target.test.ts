import { describe, expect, it } from 'vitest';

import {
  parseTasksRouteContext,
  searchResultTarget,
} from './sidebar-search-command';

const ORG = 'org-1';

function taskHit(id: string, projectId: string) {
  return { id, title: 'A task', data: { kind: 'task', projectId } };
}

describe('searchResultTarget', () => {
  it('opens a task on its own page from anywhere but its board', () => {
    expect(
      searchResultTarget(
        taskHit('t-1', 'p-1'),
        ORG,
        parseTasksRouteContext('/dashboard/org-1/chat', {}),
      ),
    ).toEqual({
      to: '/dashboard/$id/tasks/$taskId',
      params: { id: ORG, taskId: 't-1' },
    });
    // Another project's board is not this task's board.
    expect(
      searchResultTarget(
        taskHit('t-1', 'p-1'),
        ORG,
        parseTasksRouteContext('/dashboard/org-1/projects/p-2/tasks/list', {}),
      ).to,
    ).toBe('/dashboard/$id/tasks/$taskId');
  });

  it('opens the task dialog in place on its own board, keeping the view', () => {
    expect(
      searchResultTarget(
        taskHit('t-1', 'p-1'),
        ORG,
        parseTasksRouteContext('/dashboard/org-1/projects/p-1/tasks/list', {}),
      ),
    ).toEqual({
      to: '/dashboard/$id/projects/$projectId/tasks/list',
      params: { id: ORG, projectId: 'p-1' },
      search: { task: 't-1' },
    });
  });

  it('routes the other kinds to their pages', () => {
    const route = parseTasksRouteContext('/dashboard/org-1/chat', {});
    expect(
      searchResultTarget(
        { id: 'p-1', title: 'Project', data: { kind: 'project' } },
        ORG,
        route,
      ).to,
    ).toBe('/dashboard/$id/projects/$projectId');
    expect(
      searchResultTarget(
        { id: 'c-1', title: 'A chat', data: { kind: 'chat' } },
        ORG,
        route,
      ),
    ).toEqual({
      to: '/dashboard/$id/chat/$threadId',
      params: { id: ORG, threadId: 'c-1' },
    });
  });
});
