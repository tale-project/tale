import { describe, expect, it } from 'vitest';

import {
  evaluateCredentialResetAuthority,
  roleRank,
  type OrgMembership,
} from './membership.ts';

/**
 * The credential-reset authority model (finding: "Org admin can reset the
 * OWNER's password" + its cross-org twin). The email/password credential is a
 * single global row per user, so the admin door must prove authority across
 * the target's ENTIRE membership set: strict outrank in every org, never self.
 */

const org = (organizationId: string, role: string): OrgMembership => ({
  organizationId,
  role,
});

describe('roleRank', () => {
  it('orders the role ladder and floors unknowns at 0', () => {
    expect(roleRank('owner')).toBeGreaterThan(roleRank('admin'));
    expect(roleRank('admin')).toBeGreaterThan(roleRank('developer'));
    expect(roleRank('developer')).toBeGreaterThan(roleRank('editor'));
    expect(roleRank('editor')).toBeGreaterThan(roleRank('member'));
    expect(roleRank('member')).toBeGreaterThan(roleRank('disabled'));
    expect(roleRank('DISABLED')).toBe(0);
    expect(roleRank('nonsense')).toBe(0);
  });
});

describe('evaluateCredentialResetAuthority', () => {
  it('refuses resetting yourself (self-service proves the current password)', () => {
    expect(
      evaluateCredentialResetAuthority({
        actorUserId: 'u1',
        targetUserId: 'u1',
        actorMemberships: [org('a', 'owner')],
        targetMemberships: [org('a', 'owner')],
      }),
    ).toEqual({ allowed: false, reason: 'self' });
  });

  it('allows an owner or admin to reset a lower-ranked member in one org', () => {
    expect(
      evaluateCredentialResetAuthority({
        actorUserId: 'owner',
        targetUserId: 'target',
        actorMemberships: [org('a', 'owner')],
        targetMemberships: [org('a', 'member')],
      }),
    ).toEqual({ allowed: true });
    expect(
      evaluateCredentialResetAuthority({
        actorUserId: 'admin',
        targetUserId: 'target',
        actorMemberships: [org('a', 'admin')],
        targetMemberships: [org('a', 'developer')],
      }),
    ).toEqual({ allowed: true });
  });

  it('NEVER lets an admin seize an owner', () => {
    expect(
      evaluateCredentialResetAuthority({
        actorUserId: 'admin',
        targetUserId: 'owner',
        actorMemberships: [org('a', 'admin')],
        targetMemberships: [org('a', 'owner')],
      }),
    ).toEqual({ allowed: false, reason: 'insufficient_rank' });
  });

  it('refuses admin-on-peer-admin (equal rank is not "strictly below")', () => {
    expect(
      evaluateCredentialResetAuthority({
        actorUserId: 'admin1',
        targetUserId: 'admin2',
        actorMemberships: [org('a', 'admin')],
        targetMemberships: [org('a', 'admin')],
      }),
    ).toEqual({ allowed: false, reason: 'insufficient_rank' });
  });

  it('refuses cross-org takeover: target belongs to an org the actor does not administer', () => {
    // One org's admin resets a member shared with org "b" — actor is not in b.
    expect(
      evaluateCredentialResetAuthority({
        actorUserId: 'admin',
        targetUserId: 'shared',
        actorMemberships: [org('a', 'admin')],
        targetMemberships: [org('a', 'member'), org('b', 'member')],
      }),
    ).toEqual({ allowed: false, reason: 'cross_org_authority' });
  });

  it('refuses when the actor is only a low-privilege member in one of the target orgs', () => {
    // Actor outranks in "a" (owner) but is a mere member in "b" where the
    // target is also a member — cannot strictly outrank there.
    expect(
      evaluateCredentialResetAuthority({
        actorUserId: 'actor',
        targetUserId: 'target',
        actorMemberships: [org('a', 'owner'), org('b', 'member')],
        targetMemberships: [org('a', 'member'), org('b', 'member')],
      }),
    ).toEqual({ allowed: false, reason: 'insufficient_rank' });
  });

  it('allows a reset when the actor outranks the target in EVERY shared org', () => {
    expect(
      evaluateCredentialResetAuthority({
        actorUserId: 'actor',
        targetUserId: 'target',
        actorMemberships: [org('a', 'owner'), org('b', 'admin')],
        targetMemberships: [org('a', 'member'), org('b', 'editor')],
      }),
    ).toEqual({ allowed: true });
  });

  it('treats a dormant (disabled) target seat as still requiring authority', () => {
    // The global credential governs identity even where a seat is disabled, so
    // an org the actor does not administer still blocks the reset.
    expect(
      evaluateCredentialResetAuthority({
        actorUserId: 'admin',
        targetUserId: 'target',
        actorMemberships: [org('a', 'admin')],
        targetMemberships: [org('a', 'member'), org('b', 'disabled')],
      }),
    ).toEqual({ allowed: false, reason: 'cross_org_authority' });
  });

  it('fails closed when the target has no memberships', () => {
    expect(
      evaluateCredentialResetAuthority({
        actorUserId: 'admin',
        targetUserId: 'ghost',
        actorMemberships: [org('a', 'admin')],
        targetMemberships: [],
      }),
    ).toEqual({ allowed: false, reason: 'cross_org_authority' });
  });
});
