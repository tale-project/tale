import { describe, expect, it } from 'vitest';

import {
  canEditSkill,
  canViewSkill,
  filterVisibleSkills,
  type SkillAccessSubject,
} from './visibility';

const alice = { userId: 'user_alice' };
const bob = { userId: 'user_bob' };
const admin = { userId: 'user_admin', isOrgAdmin: true };

const alicesPrivate: SkillAccessSubject = {
  visibility: 'private',
  owner: 'user_alice',
};
const shared: SkillAccessSubject = { visibility: 'org', owner: 'user_alice' };
const ownerless: SkillAccessSubject = { visibility: 'org' };

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

  it('shows an org skill to every member', () => {
    expect(canViewSkill(shared, alice)).toBe(true);
    expect(canViewSkill(shared, bob)).toBe(true);
    expect(canViewSkill(ownerless, bob)).toBe(true);
  });
});

describe('canEditSkill', () => {
  it('lets the owner edit their own skill in either visibility', () => {
    expect(canEditSkill(alicesPrivate, alice)).toBe(true);
    expect(canEditSkill(shared, alice)).toBe(true);
  });

  it('refuses a member who neither owns the skill nor administers the org', () => {
    expect(canEditSkill(alicesPrivate, bob)).toBe(false);
    expect(canEditSkill(shared, bob)).toBe(false);
  });

  it('lets an admin curate a shared skill but not a private one', () => {
    expect(canEditSkill(shared, admin)).toBe(true);
    expect(canEditSkill(ownerless, admin)).toBe(true);
    expect(canEditSkill(alicesPrivate, admin)).toBe(false);
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
});
