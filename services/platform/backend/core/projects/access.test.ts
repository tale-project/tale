import { describe, it, expect } from 'vitest';

import {
  checkProjectAccess,
  getProjectTeamIds,
  hasProjectAccess,
  isOrgWideProject,
  normalizeSharing,
} from './access';

describe('getProjectTeamIds', () => {
  it('returns empty array when project is null', () => {
    expect(getProjectTeamIds(null)).toEqual([]);
  });

  it('returns empty array when project has no teams', () => {
    expect(getProjectTeamIds({})).toEqual([]);
  });

  it('returns teamId when only teamId is set', () => {
    expect(getProjectTeamIds({ teamId: 'team-1' })).toEqual(['team-1']);
  });

  it('returns sharedWithTeamIds when only sharedWithTeamIds is set', () => {
    expect(
      getProjectTeamIds({ sharedWithTeamIds: ['team-1', 'team-2'] }),
    ).toEqual(['team-1', 'team-2']);
  });

  it('deduplicates teamId and sharedWithTeamIds', () => {
    const result = getProjectTeamIds({
      teamId: 'team-1',
      sharedWithTeamIds: ['team-1', 'team-2'],
    });
    expect(result).toHaveLength(2);
    expect(result).toContain('team-1');
    expect(result).toContain('team-2');
  });

  it('merges teamId with sharedWithTeamIds', () => {
    const result = getProjectTeamIds({
      teamId: 'team-1',
      sharedWithTeamIds: ['team-2', 'team-3'],
    });
    expect(result).toHaveLength(3);
  });

  it('ignores null teamId', () => {
    expect(getProjectTeamIds({ teamId: null })).toEqual([]);
  });
});

describe('isOrgWideProject', () => {
  it('returns true when project has no teams', () => {
    expect(isOrgWideProject({})).toBe(true);
    expect(isOrgWideProject(null)).toBe(true);
    expect(isOrgWideProject({ teamId: null })).toBe(true);
    expect(isOrgWideProject({ sharedWithTeamIds: [] })).toBe(true);
  });

  it('returns false when project has any team', () => {
    expect(isOrgWideProject({ teamId: 'team-1' })).toBe(false);
    expect(isOrgWideProject({ sharedWithTeamIds: ['team-2'] })).toBe(false);
  });
});

describe('normalizeSharing', () => {
  it('clears shared teams when going org-wide (no owning team)', () => {
    // The bug: switching the owning team to "Org-wide" used to keep
    // `sharedWithTeamIds`, leaving the project restricted to those teams while
    // the UI showed "Org-wide".
    expect(normalizeSharing(null, ['team-b'])).toEqual({
      teamId: null,
      sharedWithTeamIds: [],
    });
  });

  it('leaves an already org-wide project org-wide', () => {
    expect(normalizeSharing(null, [])).toEqual({
      teamId: null,
      sharedWithTeamIds: [],
    });
  });

  it('preserves shared teams when an owning team is set', () => {
    expect(normalizeSharing('team-a', ['team-b', 'team-c'])).toEqual({
      teamId: 'team-a',
      sharedWithTeamIds: ['team-b', 'team-c'],
    });
  });

  it('keeps an owning team with no shares unchanged', () => {
    expect(normalizeSharing('team-a', [])).toEqual({
      teamId: 'team-a',
      sharedWithTeamIds: [],
    });
  });

  it('result is genuinely org-wide per isOrgWideProject', () => {
    const normalized = normalizeSharing(null, ['team-b']);
    expect(isOrgWideProject(normalized)).toBe(true);
    expect(getProjectTeamIds(normalized)).toEqual([]);
  });
});

describe('hasProjectAccess', () => {
  it('grants access to org admins regardless of team membership', () => {
    expect(hasProjectAccess({ teamId: 'team-1' }, [], 'admin')).toBe(true);
    expect(hasProjectAccess({ teamId: 'team-1' }, [], 'owner')).toBe(true);
  });

  it('grants access to org-wide projects for any member', () => {
    expect(hasProjectAccess({}, [], 'member')).toBe(true);
    expect(hasProjectAccess(null, ['team-1'], 'member')).toBe(true);
  });

  it('denies access to team-scoped project when user is in no matching team', () => {
    expect(hasProjectAccess({ teamId: 'team-1' }, ['team-2'], 'member')).toBe(
      false,
    );
  });

  it('grants access via owning team', () => {
    expect(hasProjectAccess({ teamId: 'team-1' }, ['team-1'], 'member')).toBe(
      true,
    );
  });

  it('grants access via shared team', () => {
    expect(
      hasProjectAccess({ sharedWithTeamIds: ['team-2'] }, ['team-2'], 'member'),
    ).toBe(true);
  });

  it('denies disabled role regardless of team membership', () => {
    expect(hasProjectAccess({ teamId: 'team-1' }, ['team-1'], 'disabled')).toBe(
      false,
    );
  });
});

describe('checkProjectAccess', () => {
  describe('admin users', () => {
    it('grants full access to org owners', () => {
      const result = checkProjectAccess(null, [], 'owner');
      expect(result).toEqual({
        canRead: true,
        canEdit: true,
        canAdminister: true,
      });
    });

    it('grants full access to org admins', () => {
      const result = checkProjectAccess(null, [], 'admin');
      expect(result).toEqual({
        canRead: true,
        canEdit: true,
        canAdminister: true,
      });
    });

    it('grants admin full access to team-scoped projects regardless of membership', () => {
      const result = checkProjectAccess(
        { teamId: 'team-x' },
        ['team-other'],
        'admin',
      );
      expect(result.canRead).toBe(true);
      expect(result.canEdit).toBe(true);
      expect(result.canAdminister).toBe(true);
    });
  });

  describe('org-wide projects (no team)', () => {
    it('grants read+edit to editor in org-wide project', () => {
      const result = checkProjectAccess(null, [], 'editor');
      expect(result).toEqual({
        canRead: true,
        canEdit: true,
        canAdminister: false,
      });
    });

    it('grants read+edit to developer in org-wide project', () => {
      const result = checkProjectAccess({}, [], 'developer');
      expect(result).toEqual({
        canRead: true,
        canEdit: true,
        canAdminister: false,
      });
    });

    it('grants read-only to member in org-wide project', () => {
      const result = checkProjectAccess(null, [], 'member');
      expect(result).toEqual({
        canRead: true,
        canEdit: false,
        canAdminister: false,
      });
    });
  });

  describe('team-scoped projects', () => {
    it('grants read+edit to editor in owning team', () => {
      const result = checkProjectAccess(
        { teamId: 'team-1' },
        ['team-1'],
        'editor',
      );
      expect(result.canRead).toBe(true);
      expect(result.canEdit).toBe(true);
      expect(result.canAdminister).toBe(false);
    });

    it('grants read+edit to editor in shared team', () => {
      const result = checkProjectAccess(
        { sharedWithTeamIds: ['team-2'] },
        ['team-2'],
        'editor',
      );
      expect(result.canRead).toBe(true);
      expect(result.canEdit).toBe(true);
    });

    it('grants read-only to member in shared team', () => {
      const result = checkProjectAccess(
        { sharedWithTeamIds: ['team-2'] },
        ['team-2'],
        'member',
      );
      expect(result).toEqual({
        canRead: true,
        canEdit: false,
        canAdminister: false,
      });
    });

    it('denies all access to user outside the project teams', () => {
      const result = checkProjectAccess(
        { teamId: 'team-1' },
        ['team-other'],
        'editor',
      );
      expect(result).toEqual({
        canRead: false,
        canEdit: false,
        canAdminister: false,
      });
    });
  });
});
