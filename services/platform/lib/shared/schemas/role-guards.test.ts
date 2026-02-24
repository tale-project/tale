import { describe, expect, it } from 'vitest';

import { memberRoleSchema } from './organizations';

function isMemberRole(role: string | undefined): boolean {
  return memberRoleSchema.safeParse(role).success;
}

describe('isMemberRole (memberRoleSchema guard)', () => {
  it('returns true for valid roles', () => {
    expect(isMemberRole('admin')).toBe(true);
    expect(isMemberRole('developer')).toBe(true);
    expect(isMemberRole('editor')).toBe(true);
    expect(isMemberRole('member')).toBe(true);
    expect(isMemberRole('disabled')).toBe(true);
  });

  it('returns false for invalid role strings', () => {
    expect(isMemberRole('superadmin')).toBe(false);
    expect(isMemberRole('owner')).toBe(false);
    expect(isMemberRole('')).toBe(false);
    expect(isMemberRole('ADMIN')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isMemberRole(undefined)).toBe(false);
  });
});
