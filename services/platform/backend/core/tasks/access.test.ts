import { describe, it, expect } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import {
  ASSIGNABLE_STATUSES,
  canClaimTask,
  checkProjectAccess,
  isSelfAssignment,
  normalizeAssignee,
} from './access';

describe('canClaimTask', () => {
  it('is claimable when unassigned and in an assignable status', () => {
    for (const status of ASSIGNABLE_STATUSES) {
      expect(canClaimTask({ status })).toBe(true);
    }
  });

  it('is not claimable when already assigned', () => {
    expect(
      canClaimTask({
        status: 'todo',
        assigneeType: 'agent',
        assigneeId: 'researcher',
      }),
    ).toBe(false);
  });

  it('is not claimable in terminal states', () => {
    expect(canClaimTask({ status: 'done' })).toBe(false);
    expect(canClaimTask({ status: 'cancelled' })).toBe(false);
  });

  it('is not claimable when archived', () => {
    expect(canClaimTask({ status: 'todo', archivedAt: 123 })).toBe(false);
  });
});

describe('normalizeAssignee', () => {
  it('returns null when both fields are absent (unassigned)', () => {
    expect(normalizeAssignee({})).toBeNull();
    expect(
      normalizeAssignee({ assigneeType: null, assigneeId: null }),
    ).toBeNull();
    expect(normalizeAssignee({ assigneeId: '' })).toBeNull();
  });

  it('returns the normalized pair when both are set', () => {
    expect(
      normalizeAssignee({ assigneeType: 'user', assigneeId: 'user-1' }),
    ).toEqual({ assigneeType: 'user', assigneeId: 'user-1' });
    expect(
      normalizeAssignee({ assigneeType: 'agent', assigneeId: 'researcher' }),
    ).toEqual({ assigneeType: 'agent', assigneeId: 'researcher' });
  });

  it('throws when only one of the pair is set', () => {
    expect(() => normalizeAssignee({ assigneeType: 'user' })).toThrow();
    expect(() => normalizeAssignee({ assigneeId: 'user-1' })).toThrow();
  });
});

describe('isSelfAssignment', () => {
  it('is true when the actor matches the current assignee', () => {
    expect(
      isSelfAssignment(
        { status: 'todo', assigneeType: 'agent', assigneeId: 'researcher' },
        'agent',
        'researcher',
      ),
    ).toBe(true);
  });

  it('is false for a different actor', () => {
    expect(
      isSelfAssignment(
        { status: 'todo', assigneeType: 'user', assigneeId: 'user-1' },
        'user',
        'user-2',
      ),
    ).toBe(false);
  });
});

describe('checkProjectAccess (re-exported)', () => {
  it('grants full access to org admins', () => {
    const access = checkProjectAccess({ teamId: 'team-1' }, [], 'admin');
    expect(access).toEqual({
      canRead: true,
      canEdit: true,
      canAdminister: true,
    });
  });

  it('denies disabled members', () => {
    const access = checkProjectAccess(null, [], 'disabled');
    expect(access.canRead).toBe(false);
  });

  it('grants read+edit to an editor on an org-wide project', () => {
    const access = checkProjectAccess({}, [], 'editor');
    expect(access.canRead).toBe(true);
    expect(access.canEdit).toBe(true);
    expect(access.canAdminister).toBe(false);
  });
});

/**
 * The half-set assignee pair must surface a coded AppError (#2049[58]) so
 * production returns the `task_assignee_invalid` code instead of a redacted
 * generic "Server Error".
 */
describe('normalizeAssignee coded errors', () => {
  it('throws on a half-set pair', () => {
    expect(() => normalizeAssignee({ assigneeType: 'user' })).toThrow();
    expect(() => normalizeAssignee({ assigneeId: 'user-1' })).toThrow();
  });

  it('throws a AppError carrying the task_assignee_invalid code', () => {
    let thrown: unknown;
    try {
      normalizeAssignee({ assigneeType: 'user' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError<{ code: string }>).data.code).toBe(
      'task_assignee_invalid',
    );
  });

  it('returns null when both fields are cleared', () => {
    expect(
      normalizeAssignee({ assigneeType: null, assigneeId: null }),
    ).toBeNull();
  });

  it('returns the normalized pair when both fields are set', () => {
    expect(
      normalizeAssignee({ assigneeType: 'agent', assigneeId: 'researcher' }),
    ).toEqual({ assigneeType: 'agent', assigneeId: 'researcher' });
  });
});
