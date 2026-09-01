import { describe, expect, it } from 'vitest';

import type { RoleMappingRule, SsoUserInfo } from '../types';
import { mapEntraRoleToPlatformRole } from './role_mapping';

const baseUser: SsoUserInfo = {
  externalId: 'user-1',
  email: 'user@example.com',
  name: 'User One',
};

describe('mapEntraRoleToPlatformRole (#1506)', () => {
  it('matches group rules against the user groups', () => {
    const rules: RoleMappingRule[] = [
      { source: 'group', pattern: 'platform-admin*', targetRole: 'admin' },
    ];
    expect(
      mapEntraRoleToPlatformRole(rules, 'member', {
        ...baseUser,
        groups: ['platform-admins', 'everyone'],
      }),
    ).toBe('admin');
  });

  it('falls back to the default role when no group matches', () => {
    const rules: RoleMappingRule[] = [
      { source: 'group', pattern: 'platform-admin*', targetRole: 'admin' },
    ];
    expect(
      mapEntraRoleToPlatformRole(rules, 'member', {
        ...baseUser,
        groups: ['everyone'],
      }),
    ).toBe('member');
  });

  it('matches claim rules via a dot-path into rawClaims (string array)', () => {
    const rules: RoleMappingRule[] = [
      {
        source: 'claim',
        claim: 'realm_access.roles',
        pattern: '*admin*',
        targetRole: 'admin',
      },
    ];
    expect(
      mapEntraRoleToPlatformRole(rules, 'member', {
        ...baseUser,
        rawClaims: { realm_access: { roles: ['uma', 'platform-admin'] } },
      }),
    ).toBe('admin');
  });

  it('matches claim rules against a single string claim value', () => {
    const rules: RoleMappingRule[] = [
      {
        source: 'claim',
        claim: 'department',
        pattern: 'engineering',
        targetRole: 'developer',
      },
    ];
    expect(
      mapEntraRoleToPlatformRole(rules, 'member', {
        ...baseUser,
        rawClaims: { department: 'Engineering' },
      }),
    ).toBe('developer');
  });

  it('skips claim rules without a claim path or without rawClaims', () => {
    const noPath: RoleMappingRule[] = [
      { source: 'claim', pattern: '*', targetRole: 'admin' },
    ];
    expect(
      mapEntraRoleToPlatformRole(noPath, 'member', {
        ...baseUser,
        rawClaims: { anything: 'x' },
      }),
    ).toBe('member');

    const withPath: RoleMappingRule[] = [
      { source: 'claim', claim: 'roles', pattern: '*', targetRole: 'admin' },
    ];
    expect(mapEntraRoleToPlatformRole(withPath, 'member', baseUser)).toBe(
      'member',
    );
  });

  it('ignores non-string entries in a claim array', () => {
    const rules: RoleMappingRule[] = [
      { source: 'claim', claim: 'roles', pattern: '*', targetRole: 'admin' },
    ];
    expect(
      mapEntraRoleToPlatformRole(rules, 'member', {
        ...baseUser,
        rawClaims: { roles: [42, { nested: true }, null] },
      }),
    ).toBe('member');
  });

  it('keeps first-match-wins ordering across mixed rule sources', () => {
    const rules: RoleMappingRule[] = [
      { source: 'group', pattern: 'editors', targetRole: 'editor' },
      {
        source: 'claim',
        claim: 'realm_access.roles',
        pattern: 'platform-admin',
        targetRole: 'admin',
      },
    ];
    expect(
      mapEntraRoleToPlatformRole(rules, 'member', {
        ...baseUser,
        groups: ['editors'],
        rawClaims: { realm_access: { roles: ['platform-admin'] } },
      }),
    ).toBe('editor');
  });
});
