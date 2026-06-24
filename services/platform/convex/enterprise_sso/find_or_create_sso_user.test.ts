import { describe, expect, it } from 'vitest';

import { shouldSyncMemberRole } from './find_or_create_sso_user';

/**
 * "Auto-assign roles from the IdP" must keep an EXISTING member's role in sync
 * on every login (a promotion/demotion in the IdP should propagate), not just at
 * first provision — but it must never demote the org owner.
 */
describe('shouldSyncMemberRole', () => {
  it('promotes an existing member when the mapped role differs', () => {
    expect(shouldSyncMemberRole(true, 'member', 'admin')).toBe(true);
  });

  it('demotes an existing member when the mapped role drops', () => {
    expect(shouldSyncMemberRole(true, 'admin', 'member')).toBe(true);
  });

  it('is a no-op when the role is unchanged', () => {
    expect(shouldSyncMemberRole(true, 'admin', 'admin')).toBe(false);
  });

  it('never touches the owner (would orphan the org)', () => {
    expect(shouldSyncMemberRole(true, 'owner', 'admin')).toBe(false);
  });

  it('does nothing when auto-assign is off', () => {
    expect(shouldSyncMemberRole(false, 'member', 'admin')).toBe(false);
    expect(shouldSyncMemberRole(undefined, 'member', 'admin')).toBe(false);
  });
});
