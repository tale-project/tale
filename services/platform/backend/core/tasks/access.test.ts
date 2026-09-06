import { describe, it, expect } from 'vitest';

import { ASSIGNABLE_STATUSES, canClaimTask } from './access';

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
