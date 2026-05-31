import { describe, it, expect } from 'vitest';

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
