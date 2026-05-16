import { describe, it, expect } from 'vitest';

import { checkAgentAccess, getAgentTeamIds } from './access';

describe('getAgentTeamIds', () => {
  it('returns empty array when binding is null', () => {
    expect(getAgentTeamIds(null)).toEqual([]);
  });

  it('returns empty array when binding has no teams', () => {
    expect(getAgentTeamIds({})).toEqual([]);
  });

  it('returns teamId when only teamId is set', () => {
    expect(getAgentTeamIds({ teamId: 'team-1' })).toEqual(['team-1']);
  });

  it('returns sharedWithTeamIds when only sharedWithTeamIds is set', () => {
    expect(
      getAgentTeamIds({ sharedWithTeamIds: ['team-1', 'team-2'] }),
    ).toEqual(['team-1', 'team-2']);
  });

  it('deduplicates teamId and sharedWithTeamIds', () => {
    const result = getAgentTeamIds({
      teamId: 'team-1',
      sharedWithTeamIds: ['team-1', 'team-2'],
    });
    expect(result).toHaveLength(2);
    expect(result).toContain('team-1');
    expect(result).toContain('team-2');
  });

  it('merges teamId with sharedWithTeamIds', () => {
    const result = getAgentTeamIds({
      teamId: 'team-1',
      sharedWithTeamIds: ['team-2', 'team-3'],
    });
    expect(result).toHaveLength(3);
    expect(result).toContain('team-1');
    expect(result).toContain('team-2');
    expect(result).toContain('team-3');
  });

  it('ignores null teamId', () => {
    expect(getAgentTeamIds({ teamId: null })).toEqual([]);
  });
});

describe('checkAgentAccess', () => {
  describe('admin users', () => {
    it('grants full access to org owners', () => {
      const result = checkAgentAccess(null, [], 'owner');
      expect(result).toEqual({ canUse: true, canEdit: true });
    });

    it('grants full access to org admins', () => {
      const result = checkAgentAccess(null, [], 'admin');
      expect(result).toEqual({ canUse: true, canEdit: true });
    });

    it('ignores role restriction for admins', () => {
      const result = checkAgentAccess(null, [], 'admin', 'admin_developer');
      expect(result).toEqual({ canUse: true, canEdit: true });
    });

    it('grants full access even for team-scoped agents', () => {
      const result = checkAgentAccess(
        { sharedWithTeamIds: ['team-1'] },
        [],
        'owner',
      );
      expect(result).toEqual({ canUse: true, canEdit: true });
    });
  });

  describe('role restriction', () => {
    it('denies access when roleRestriction is admin_developer and user is member', () => {
      const result = checkAgentAccess(null, [], 'member', 'admin_developer');
      expect(result).toEqual({ canUse: false, canEdit: false });
    });

    it('does not apply role restriction to admins', () => {
      const result = checkAgentAccess(null, [], 'admin', 'admin_developer');
      expect(result).toEqual({ canUse: true, canEdit: true });
    });
  });

  describe('org-wide agents (no team assignment)', () => {
    it('grants use access to regular members', () => {
      const result = checkAgentAccess(null, ['team-1'], 'member');
      expect(result).toEqual({ canUse: true, canEdit: false });
    });

    it('grants use access when binding exists but has no teams', () => {
      const result = checkAgentAccess({}, ['team-1'], 'member');
      expect(result).toEqual({ canUse: true, canEdit: false });
    });

    it('grants use access to members with no teams', () => {
      const result = checkAgentAccess(null, [], 'member');
      expect(result).toEqual({ canUse: true, canEdit: false });
    });
  });

  describe('owning team', () => {
    it('grants use + edit to owning team members', () => {
      const result = checkAgentAccess(
        { teamId: 'team-1' },
        ['team-1'],
        'member',
      );
      expect(result).toEqual({ canUse: true, canEdit: true });
    });

    it('denies access when user is not in owning team', () => {
      const result = checkAgentAccess(
        { teamId: 'team-1' },
        ['team-2'],
        'member',
      );
      expect(result).toEqual({ canUse: false, canEdit: false });
    });

    it('denies access when user has no team memberships', () => {
      const result = checkAgentAccess({ teamId: 'team-1' }, [], 'member');
      expect(result).toEqual({ canUse: false, canEdit: false });
    });
  });

  describe('shared teams', () => {
    it('grants use-only access to shared team members', () => {
      const result = checkAgentAccess(
        { teamId: 'team-1', sharedWithTeamIds: ['team-2', 'team-3'] },
        ['team-2'],
        'member',
      );
      expect(result).toEqual({ canUse: true, canEdit: false });
    });

    it('denies access when user is not in any shared team', () => {
      const result = checkAgentAccess(
        { teamId: 'team-1', sharedWithTeamIds: ['team-2'] },
        ['team-3'],
        'member',
      );
      expect(result).toEqual({ canUse: false, canEdit: false });
    });

    it('prefers owning team (canEdit) over shared team', () => {
      const result = checkAgentAccess(
        { teamId: 'team-1', sharedWithTeamIds: ['team-1', 'team-2'] },
        ['team-1'],
        'member',
      );
      expect(result).toEqual({ canUse: true, canEdit: true });
    });

    it('grants use-only when only sharedWithTeamIds is set (no owning team)', () => {
      const result = checkAgentAccess(
        { sharedWithTeamIds: ['team-1', 'team-2'] },
        ['team-1'],
        'member',
      );
      expect(result).toEqual({ canUse: true, canEdit: false });
    });

    it('denies access when user has no team memberships', () => {
      const result = checkAgentAccess(
        { sharedWithTeamIds: ['team-1'] },
        [],
        'member',
      );
      expect(result).toEqual({ canUse: false, canEdit: false });
    });
  });

  describe('edge cases', () => {
    it('handles empty sharedWithTeamIds as org-wide', () => {
      const result = checkAgentAccess({ sharedWithTeamIds: [] }, [], 'member');
      expect(result).toEqual({ canUse: true, canEdit: false });
    });

    it('handles binding with null teamId and empty sharedWithTeamIds', () => {
      const result = checkAgentAccess(
        { teamId: null, sharedWithTeamIds: [] },
        ['team-1'],
        'member',
      );
      expect(result).toEqual({ canUse: true, canEdit: false });
    });
  });
});
