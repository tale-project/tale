import { describe, expect, it } from 'vitest';

import {
  coerceBoolean,
  combineName,
  parseEqFilter,
  parseGroupPatch,
  parseGroupResource,
  parseUserPatch,
  parseUserResource,
  resolvePatchedName,
  toScimGroup,
  toScimUser,
} from './mappers';

describe('toScimUser', () => {
  it('maps an active user record with split name + email', () => {
    const r = toScimUser(
      {
        userId: 'u1',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        active: true,
        externalId: 'ext-1',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_100_000,
      },
      'https://app.example.com/scim/v2',
    );
    expect(r.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:User']);
    expect(r.id).toBe('u1');
    expect(r.externalId).toBe('ext-1');
    expect(r.userName).toBe('ada@example.com');
    expect(r.name).toMatchObject({ givenName: 'Ada', familyName: 'Lovelace' });
    expect(r.emails).toEqual([
      { value: 'ada@example.com', primary: true, type: 'work' },
    ]);
    expect(r.active).toBe(true);
    expect(r.meta.resourceType).toBe('User');
    expect(r.meta.location).toBe('https://app.example.com/scim/v2/Users/u1');
    expect(r.meta.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('marks disabled members as inactive and omits externalId when absent', () => {
    const r = toScimUser({
      userId: 'u2',
      email: 'grace@example.com',
      name: 'Grace',
      active: false,
    });
    expect(r.active).toBe(false);
    expect(r.externalId).toBeUndefined();
    expect(r.name).toMatchObject({ givenName: 'Grace' });
    expect(r.name?.familyName).toBeUndefined();
  });
});

describe('toScimGroup', () => {
  it('maps a team + members', () => {
    const r = toScimGroup({
      teamId: 't1',
      displayName: 'Engineering',
      memberUserIds: ['u1', 'u2'],
      externalId: 'g-ext',
    });
    expect(r.displayName).toBe('Engineering');
    expect(r.members).toEqual([{ value: 'u1' }, { value: 'u2' }]);
    expect(r.externalId).toBe('g-ext');
    expect(r.meta.resourceType).toBe('Group');
  });
});

describe('parseEqFilter', () => {
  it('extracts a userName eq filter value', () => {
    expect(parseEqFilter('userName eq "ada@example.com"', 'userName')).toBe(
      'ada@example.com',
    );
  });
  it('is case-insensitive on attribute + operator', () => {
    expect(parseEqFilter('USERNAME EQ "x@y.z"', 'userName')).toBe('x@y.z');
  });
  it('returns null for a different attribute or malformed filter', () => {
    expect(parseEqFilter('displayName eq "x"', 'userName')).toBeNull();
    expect(parseEqFilter('userName co "x"', 'userName')).toBeNull();
    expect(parseEqFilter(undefined, 'userName')).toBeNull();
  });
  it('parses displayName eq for groups', () => {
    expect(parseEqFilter('displayName eq "Engineering"', 'displayName')).toBe(
      'Engineering',
    );
  });
});

describe('coerceBoolean', () => {
  it('handles real booleans and Entra-style strings', () => {
    expect(coerceBoolean(true)).toBe(true);
    expect(coerceBoolean(false)).toBe(false);
    expect(coerceBoolean('True')).toBe(true);
    expect(coerceBoolean('false')).toBe(false);
    expect(coerceBoolean(undefined)).toBe(false);
  });
});

describe('combineName', () => {
  it('joins given + family, falling back to displayName then fallback', () => {
    expect(combineName('Ada', 'Lovelace', undefined, 'x')).toBe('Ada Lovelace');
    expect(combineName(undefined, undefined, 'Ada L', 'x')).toBe('Ada L');
    expect(combineName(undefined, undefined, undefined, 'ada@x.io')).toBe(
      'ada@x.io',
    );
  });
});

describe('parseUserResource', () => {
  it('parses a typical Okta create body', () => {
    const input = parseUserResource({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'ada@example.com',
      name: { givenName: 'Ada', familyName: 'Lovelace' },
      emails: [{ value: 'ada@example.com', primary: true }],
      externalId: 'ext-1',
      active: true,
    });
    expect(input).toMatchObject({
      email: 'ada@example.com',
      givenName: 'Ada',
      familyName: 'Lovelace',
      externalId: 'ext-1',
      active: true,
      name: 'Ada Lovelace',
    });
  });
  it('defaults active to true and tolerates missing name', () => {
    const input = parseUserResource({ userName: 'g@example.com' });
    expect(input).toMatchObject({
      email: 'g@example.com',
      active: true,
      name: 'g@example.com',
    });
  });
  it('returns null without a userName', () => {
    expect(parseUserResource({ displayName: 'x' })).toBeNull();
    expect(parseUserResource('nope')).toBeNull();
  });
});

describe('parseGroupResource', () => {
  it('parses displayName + members', () => {
    const g = parseGroupResource({
      displayName: 'Engineering',
      members: [{ value: 'u1' }, { value: 'u2' }],
      externalId: 'g1',
    });
    expect(g).toMatchObject({
      displayName: 'Engineering',
      externalId: 'g1',
      memberIds: ['u1', 'u2'],
    });
  });
  it('returns null without displayName', () => {
    expect(parseGroupResource({ members: [] })).toBeNull();
  });
});

describe('parseUserPatch', () => {
  it('handles path-based active replace (Okta)', () => {
    const patch = parseUserPatch({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: 'active', value: false }],
    });
    expect(patch.active).toBe(false);
  });
  it('handles path-less value replace (Entra) with string boolean', () => {
    const patch = parseUserPatch({
      Operations: [{ op: 'Replace', value: { active: 'False' } }],
    });
    expect(patch.active).toBe(false);
  });
  it('captures name + displayName updates', () => {
    const patch = parseUserPatch({
      Operations: [
        { op: 'replace', path: 'name.givenName', value: 'Ada' },
        { op: 'replace', path: 'displayName', value: 'Ada L' },
      ],
    });
    expect(patch).toMatchObject({ givenName: 'Ada', displayName: 'Ada L' });
  });
});

describe('resolvePatchedName', () => {
  it('returns undefined when no name fields are present', () => {
    expect(resolvePatchedName('Ada Lovelace', {})).toBeUndefined();
  });
  it('replaces wholesale with displayName', () => {
    expect(resolvePatchedName('Ada Lovelace', { displayName: 'Ada L' })).toBe(
      'Ada L',
    );
  });
  it('merges a partial given-name patch with the existing family name', () => {
    expect(resolvePatchedName('Ada Lovelace', { givenName: 'Augusta' })).toBe(
      'Augusta Lovelace',
    );
  });
});

describe('parseGroupPatch', () => {
  it('adds members via path members', () => {
    const patch = parseGroupPatch({
      Operations: [{ op: 'add', path: 'members', value: [{ value: 'u3' }] }],
    });
    expect(patch.addMembers).toEqual(['u3']);
  });
  it('removes a member via members[value eq "id"] path (Okta)', () => {
    const patch = parseGroupPatch({
      Operations: [{ op: 'remove', path: 'members[value eq "u1"]' }],
    });
    expect(patch.removeMembers).toEqual(['u1']);
  });
  it('replaces the whole membership set', () => {
    const patch = parseGroupPatch({
      Operations: [
        { op: 'replace', path: 'members', value: [{ value: 'u1' }] },
      ],
    });
    expect(patch.replaceMembers).toEqual(['u1']);
  });
  it('renames via displayName replace', () => {
    const patch = parseGroupPatch({
      Operations: [{ op: 'replace', path: 'displayName', value: 'Platform' }],
    });
    expect(patch.displayName).toBe('Platform');
  });
  it('clears all members on bare members remove', () => {
    const patch = parseGroupPatch({
      Operations: [{ op: 'remove', path: 'members' }],
    });
    expect(patch.replaceMembers).toEqual([]);
  });
});
