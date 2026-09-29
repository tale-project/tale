import { describe, expect, it } from 'vitest';

import { checkProjectAccess } from '../projects/access.ts';
import {
  canWorkTask,
  isOwnTask,
  type TaskOwnership,
  taskAccessFrom,
} from './access.ts';

const task = (overrides: Partial<TaskOwnership> = {}): TaskOwnership => ({
  createdBy: 'user-2',
  createdByType: 'user',
  assigneeType: null,
  assigneeId: null,
  ...overrides,
});

describe('the task access rule', () => {
  it('grants creating to every reader and editing to the editor roles', () => {
    for (const role of ['owner', 'admin', 'developer', 'editor', 'member']) {
      const access = taskAccessFrom(checkProjectAccess(null, [], role));
      expect(access.canCreate).toBe(true);
      expect(access.canEdit).toBe(role !== 'member');
    }
    expect(taskAccessFrom(checkProjectAccess(null, [], 'disabled'))).toEqual({
      canEdit: false,
      canCreate: false,
    });
  });

  it('a member reads, and so creates in, a team project only through the team', () => {
    const restricted = { teamIds: ['team-1'] };
    expect(
      taskAccessFrom(checkProjectAccess(restricted, [], 'member')).canCreate,
    ).toBe(false);
    expect(
      taskAccessFrom(checkProjectAccess(restricted, ['team-1'], 'member'))
        .canCreate,
    ).toBe(true);
  });

  it('a task is one’s own when one created it or is its person assignee', () => {
    expect(isOwnTask(task({ createdBy: 'user-1' }), 'user-1')).toBe(true);
    expect(
      isOwnTask(task({ assigneeType: 'user', assigneeId: 'user-1' }), 'user-1'),
    ).toBe(true);
    expect(isOwnTask(task(), 'user-1')).toBe(false);
  });

  it('an agent, automation or import author makes a task nobody’s own', () => {
    for (const createdByType of ['agent', 'app']) {
      expect(
        isOwnTask(task({ createdBy: 'user-1', createdByType }), 'user-1'),
      ).toBe(false);
    }
    expect(
      isOwnTask(
        task({ assigneeType: 'agent', assigneeId: 'user-1' }),
        'user-1',
      ),
    ).toBe(false);
  });

  it('an editor works every task; a reader works their own', () => {
    const editor = { canEdit: true, canCreate: true };
    const reader = { canEdit: false, canCreate: true };
    expect(canWorkTask(editor, task(), 'user-1')).toBe(true);
    expect(canWorkTask(reader, task(), 'user-1')).toBe(false);
    expect(canWorkTask(reader, task({ createdBy: 'user-1' }), 'user-1')).toBe(
      true,
    );
  });

  it('works nothing without read access, or before the viewer is known', () => {
    const none = { canEdit: false, canCreate: false };
    expect(canWorkTask(none, task({ createdBy: 'user-1' }), 'user-1')).toBe(
      false,
    );
    expect(
      canWorkTask(
        { canEdit: false, canCreate: true },
        task({ createdBy: 'user-1' }),
        undefined,
      ),
    ).toBe(false);
  });
});
