import { describe, expect, it } from 'vitest';

import type { BetterAuthMember, BetterAuthUser } from '../../members/types';
import {
  assessAuthUserMergeSafety,
  groupAuthUsersByNormalizedEmail,
  mergeCanonicalUserFields,
  pickHigherMemberRole,
  resolveEmailGroupAction,
  selectCanonicalAuthUser,
} from './merge_auth_email_duplicates';

function user(
  partial: Partial<BetterAuthUser> & Pick<BetterAuthUser, '_id' | 'email'>,
): BetterAuthUser {
  return {
    name: partial.name ?? partial.email,
    emailVerified: partial.emailVerified ?? false,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    ...partial,
  };
}

describe('selectCanonicalAuthUser', () => {
  it('prefers already-lowercased email', () => {
    const lower = user({
      _id: 'b',
      email: 'a@example.com',
      emailVerified: false,
      createdAt: 2,
    });
    const mixed = user({
      _id: 'a',
      email: 'A@Example.com',
      emailVerified: true,
      createdAt: 1,
    });
    expect(selectCanonicalAuthUser([mixed, lower])?._id).toBe('b');
  });

  it('falls back to verified then older createdAt', () => {
    const older = user({
      _id: 'old',
      email: 'x@y.z',
      emailVerified: true,
      createdAt: 1,
    });
    const newer = user({
      _id: 'new',
      email: 'x@y.z',
      emailVerified: true,
      createdAt: 9,
    });
    expect(selectCanonicalAuthUser([newer, older])?._id).toBe('old');
  });
});

describe('assessAuthUserMergeSafety', () => {
  it('skips when two owners share an org', () => {
    const memberships = new Map<string, BetterAuthMember[]>([
      [
        'u1',
        [
          {
            _id: 'm1',
            organizationId: 'org1',
            userId: 'u1',
            role: 'owner',
            createdAt: 1,
          },
        ],
      ],
      [
        'u2',
        [
          {
            _id: 'm2',
            organizationId: 'org1',
            userId: 'u2',
            role: 'owner',
            createdAt: 2,
          },
        ],
      ],
    ]);
    expect(assessAuthUserMergeSafety(memberships, ['u1', 'u2']).safe).toBe(
      false,
    );
  });
});

describe('resolveEmailGroupAction', () => {
  it('renames a lone mixed-case user', () => {
    const only = [user({ _id: 'a', email: 'A@b.com' })];
    expect(resolveEmailGroupAction(only, { safe: true })).toBe('rename');
  });

  it('merges duplicate groups when safe', () => {
    const group = [
      user({ _id: 'a', email: 'a@b.com' }),
      user({ _id: 'b', email: 'A@b.com' }),
    ];
    expect(resolveEmailGroupAction(group, { safe: true })).toBe('merge');
  });
});

describe('pickHigherMemberRole', () => {
  it('never demotes owner', () => {
    expect(pickHigherMemberRole('owner', 'admin')).toBe('owner');
    expect(pickHigherMemberRole('member', 'admin')).toBe('admin');
  });
});

describe('mergeCanonicalUserFields', () => {
  it('ORs emailVerified and keeps canonical name when set', () => {
    const canonical = user({
      _id: 'c',
      email: 'a@b.com',
      name: 'Self',
      emailVerified: false,
    });
    const duplicate = user({
      _id: 'd',
      email: 'A@b.com',
      name: 'IdP Name',
      emailVerified: true,
      lastActiveOrganizationId: 'org1',
    });
    expect(mergeCanonicalUserFields(canonical, duplicate, 'a@b.com')).toEqual({
      email: 'a@b.com',
      emailVerified: true,
      lastActiveOrganizationId: 'org1',
      name: 'Self',
    });
  });
});

describe('groupAuthUsersByNormalizedEmail', () => {
  it('groups case variants together', () => {
    const groups = groupAuthUsersByNormalizedEmail([
      user({ _id: '1', email: 'a@b.com' }),
      user({ _id: '2', email: 'A@B.com' }),
    ]);
    expect(
      groups
        .get('a@b.com')
        ?.map((u) => u._id)
        .sort(),
    ).toEqual(['1', '2']);
  });
});

describe('reported duplicate scenario', () => {
  it('keeps the lowercase signup account and absorbs SCIM verification', () => {
    const signup = user({
      _id: 'signup',
      email: 'a.falco.stief@m365test4gematik.onmicrosoft.com',
      emailVerified: false,
      createdAt: 1_700_000_000_000,
      name: 'Falco Test-Tenant',
    });
    const scim = user({
      _id: 'scim',
      email: 'a.falco.stief@M365Test4gematik.onmicrosoft.com',
      emailVerified: true,
      createdAt: 1_700_000_100_000,
      name: '(Admin) Stief, Falco',
    });
    expect(selectCanonicalAuthUser([scim, signup])?._id).toBe('signup');
    expect(
      mergeCanonicalUserFields(signup, scim, signup.email).emailVerified,
    ).toBe(true);
  });
});
