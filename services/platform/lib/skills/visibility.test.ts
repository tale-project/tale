import { describe, expect, it } from 'vitest';

import {
  canEditSkill,
  canViewSkill,
  filterVisibleSkills,
  matchesSkillSurface,
  type SkillAccessSubject,
  type SkillViewer,
} from './visibility';

function user(
  userId: string,
  opts: { teamIds?: string[]; isOrgAdmin?: boolean } = {},
): SkillViewer {
  return {
    kind: 'user',
    userId,
    teamIds: opts.teamIds ?? [],
    isOrgAdmin: opts.isOrgAdmin ?? false,
  };
}

const alice = user('user_alice', { teamIds: ['team_red'] });
const bob = user('user_bob');
const carol = user('user_carol', { teamIds: ['team_blue'] });
const admin = user('user_admin', { isOrgAdmin: true });

const redProject: SkillViewer = { kind: 'project', teamIds: ['team_red'] };
const blueProject: SkillViewer = { kind: 'project', teamIds: ['team_blue'] };
const orgWideProject: SkillViewer = { kind: 'project', teamIds: [] };
const orgMachinery: SkillViewer = { kind: 'org' };

const alicesPrivate: SkillAccessSubject = {
  visibility: 'private',
  owner: 'user_alice',
};
const shared: SkillAccessSubject = { visibility: 'org', owner: 'user_alice' };
const ownerless: SkillAccessSubject = { visibility: 'org' };
const redTeamSkill: SkillAccessSubject = {
  visibility: 'team',
  teams: ['team_red'],
  owner: 'user_alice',
};
const blueTeamSkill: SkillAccessSubject = {
  visibility: 'team',
  teams: ['team_blue'],
  owner: 'user_carol',
};

describe('canViewSkill', () => {
  it('hides a private skill from another member of the same org', () => {
    expect(canViewSkill(alicesPrivate, alice)).toBe(true);
    expect(canViewSkill(alicesPrivate, bob)).toBe(false);
  });

  it('hides a private skill even from an org admin', () => {
    // Administering shared configuration is not a licence to read a
    // colleague's personal notes.
    expect(canViewSkill(alicesPrivate, admin)).toBe(false);
  });

  it('never shows a private skill to a project or org viewer', () => {
    // A project is not a person; `private` means the owner alone.
    expect(canViewSkill(alicesPrivate, redProject)).toBe(false);
    expect(canViewSkill(alicesPrivate, orgMachinery)).toBe(false);
  });

  it('shows an org skill to every viewer kind', () => {
    expect(canViewSkill(shared, alice)).toBe(true);
    expect(canViewSkill(shared, bob)).toBe(true);
    expect(canViewSkill(ownerless, bob)).toBe(true);
    expect(canViewSkill(shared, redProject)).toBe(true);
    expect(canViewSkill(shared, orgWideProject)).toBe(true);
    expect(canViewSkill(shared, orgMachinery)).toBe(true);
  });

  it('shows a team skill to members of its teams and hides it otherwise', () => {
    expect(canViewSkill(redTeamSkill, alice)).toBe(true);
    expect(canViewSkill(redTeamSkill, carol)).toBe(false);
    expect(canViewSkill(redTeamSkill, bob)).toBe(false);
  });

  it('shows a team skill to its owner even outside the teams', () => {
    // Alice shared her skill with blue only; she still sees her own file.
    const detached: SkillAccessSubject = {
      visibility: 'team',
      teams: ['team_blue'],
      owner: 'user_alice',
    };
    expect(canViewSkill(detached, alice)).toBe(true);
  });

  it('shows every team skill to an org admin', () => {
    // Team skills are shared configuration — an admin curates them all.
    expect(canViewSkill(redTeamSkill, admin)).toBe(true);
    expect(canViewSkill(blueTeamSkill, admin)).toBe(true);
  });

  it('resolves a team skill for a project by team overlap', () => {
    expect(canViewSkill(redTeamSkill, redProject)).toBe(true);
    expect(canViewSkill(redTeamSkill, blueProject)).toBe(false);
  });

  it('hides team skills from an org-wide project', () => {
    // An org-wide project runs for every member; staging a team skill there
    // would hand team knowledge to non-members the moment anyone runs it.
    expect(canViewSkill(redTeamSkill, orgWideProject)).toBe(false);
  });

  it('hides team skills from org machinery', () => {
    expect(canViewSkill(redTeamSkill, orgMachinery)).toBe(false);
  });
});

describe('canEditSkill', () => {
  it('lets the owner edit their own skill in every visibility', () => {
    expect(canEditSkill(alicesPrivate, alice)).toBe(true);
    expect(canEditSkill(shared, alice)).toBe(true);
    expect(canEditSkill(redTeamSkill, alice)).toBe(true);
  });

  it('refuses a member who neither owns the skill nor administers the org', () => {
    expect(canEditSkill(alicesPrivate, bob)).toBe(false);
    expect(canEditSkill(shared, bob)).toBe(false);
    // Team membership grants reading, never editing.
    expect(
      canEditSkill(redTeamSkill, user('user_dave', { teamIds: ['team_red'] })),
    ).toBe(false);
  });

  it('lets an admin curate shared skills but not a private one', () => {
    expect(canEditSkill(shared, admin)).toBe(true);
    expect(canEditSkill(ownerless, admin)).toBe(true);
    expect(canEditSkill(redTeamSkill, admin)).toBe(true);
    expect(canEditSkill(alicesPrivate, admin)).toBe(false);
  });

  it('never lets a project or org viewer edit', () => {
    expect(canEditSkill(shared, redProject)).toBe(false);
    expect(canEditSkill(shared, orgMachinery)).toBe(false);
  });
});

describe('filterVisibleSkills', () => {
  it('keeps org skills and the viewer’s own private ones, in order', () => {
    const skills: SkillAccessSubject[] = [
      shared,
      alicesPrivate,
      { visibility: 'private', owner: 'user_bob' },
      ownerless,
    ];

    expect(filterVisibleSkills(skills, alice)).toEqual([
      shared,
      alicesPrivate,
      ownerless,
    ]);
    expect(filterVisibleSkills(skills, bob)).toEqual([
      shared,
      { visibility: 'private', owner: 'user_bob' },
      ownerless,
    ]);
  });

  it('resolves team skills per viewer teams', () => {
    const skills: SkillAccessSubject[] = [redTeamSkill, blueTeamSkill, shared];
    expect(filterVisibleSkills(skills, carol)).toEqual([blueTeamSkill, shared]);
    expect(filterVisibleSkills(skills, redProject)).toEqual([
      redTeamSkill,
      shared,
    ]);
    expect(filterVisibleSkills(skills, orgWideProject)).toEqual([shared]);
  });
});

describe('matchesSkillSurface', () => {
  it('reads an absent usage mode as usable everywhere', () => {
    expect(matchesSkillSurface({}, 'chat')).toBe(true);
    expect(matchesSkillSurface({}, 'agent')).toBe(true);
    expect(matchesSkillSurface({}, 'any')).toBe(true);
  });

  it('narrows chat-only and agent-only skills to their surface', () => {
    expect(matchesSkillSurface({ usageMode: 'chat' }, 'chat')).toBe(true);
    expect(matchesSkillSurface({ usageMode: 'chat' }, 'agent')).toBe(false);
    expect(matchesSkillSurface({ usageMode: 'agent' }, 'agent')).toBe(true);
    expect(matchesSkillSurface({ usageMode: 'agent' }, 'chat')).toBe(false);
    expect(matchesSkillSurface({ usageMode: 'all' }, 'chat')).toBe(true);
    expect(matchesSkillSurface({ usageMode: 'all' }, 'agent')).toBe(true);
  });

  it('applies no narrowing on the management surface', () => {
    expect(matchesSkillSurface({ usageMode: 'chat' }, 'any')).toBe(true);
    expect(matchesSkillSurface({ usageMode: 'agent' }, 'any')).toBe(true);
  });
});
