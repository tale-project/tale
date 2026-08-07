import { describe, expect, it } from 'vitest';

import { resolveDateNotifyAudience } from './date_notification_recipients';

describe('resolveDateNotifyAudience', () => {
  it('prefers the human assignee', () => {
    expect(
      resolveDateNotifyAudience({
        assigneeType: 'user',
        assigneeId: 'user_assignee',
        taskCreatorId: 'user_creator',
        projectCreatorId: 'user_project',
      }),
    ).toBe('task_assignee');
  });

  it('falls back to the human task creator when unassigned', () => {
    expect(
      resolveDateNotifyAudience({
        taskCreatorId: 'user_creator',
        projectCreatorId: 'user_project',
      }),
    ).toBe('task_creator');
  });

  it('treats agent assignees as unassigned for inbox purposes', () => {
    expect(
      resolveDateNotifyAudience({
        assigneeType: 'agent',
        assigneeId: 'agent_slug',
        taskCreatorId: 'user_creator',
        projectCreatorId: 'user_project',
      }),
    ).toBe('task_creator');
  });

  it('falls back to the project creator when the task has no human creator', () => {
    expect(
      resolveDateNotifyAudience({
        projectCreatorId: 'user_project',
      }),
    ).toBe('project_creator');
  });

  it('returns null when no human recipient can be resolved', () => {
    expect(resolveDateNotifyAudience({})).toBeNull();
  });
});
