import { describe, expect, it } from 'vitest';

import { checkProjectAccess } from '../projects/access.ts';
import {
  canControlLiveRun,
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

  it('work rights run down the subtask tree', () => {
    const reader = { canEdit: false, canCreate: true };
    // An agent broke the member's task down: the subtask is nobody's own,
    // but it sits under the member's task, at any depth.
    const subtask = task({ createdBy: 'agent-1', createdByType: 'agent' });
    const own = task({ createdBy: 'user-1' });
    expect(canWorkTask(reader, subtask, 'user-1')).toBe(false);
    expect(canWorkTask(reader, subtask, 'user-1', [own])).toBe(true);
    expect(canWorkTask(reader, subtask, 'user-1', [task(), own])).toBe(true);
    // Someone else's parent passes nothing down.
    expect(canWorkTask(reader, subtask, 'user-1', [task()])).toBe(false);
    // Nor does the tree widen what a stranger to the project may do.
    expect(
      canWorkTask({ canEdit: false, canCreate: false }, subtask, 'user-1', [
        own,
      ]),
    ).toBe(false);
  });

  it('the starter of a live run may stop and steer it on a task no longer theirs', () => {
    const reader = { canEdit: false, canCreate: true };
    // The member handed their assigned task to an agent: it is the agent's
    // now, but the run is theirs.
    const handedOver = task({ assigneeType: 'agent', assigneeId: 'agent-1' });
    expect(canWorkTask(reader, handedOver, 'user-1')).toBe(false);
    expect(canControlLiveRun(reader, handedOver, 'user-1', 'user-1')).toBe(
      true,
    );
    expect(canControlLiveRun(reader, handedOver, 'user-1', 'user-2')).toBe(
      false,
    );
    expect(canControlLiveRun(reader, handedOver, 'user-1', null)).toBe(false);
    // Losing read access ends it.
    expect(
      canControlLiveRun(
        { canEdit: false, canCreate: false },
        handedOver,
        'user-1',
        'user-1',
      ),
    ).toBe(false);
  });
});
