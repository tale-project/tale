import { describe, expect, it } from 'vitest';

import { isMemberRole } from '@/app/features/settings/organization/utils/role-guards';

describe('isMemberRole', () => {
  it('returns true for valid roles', () => {
    expect(isMemberRole('admin')).toBe(true);
    expect(isMemberRole('developer')).toBe(true);
    expect(isMemberRole('editor')).toBe(true);
    expect(isMemberRole('member')).toBe(true);
    expect(isMemberRole('disabled')).toBe(true);
  });

  it('returns true for owner role', () => {
    expect(isMemberRole('owner')).toBe(true);
  });

  it('returns false for invalid role strings', () => {
    expect(isMemberRole('superadmin')).toBe(false);
    expect(isMemberRole('')).toBe(false);
    expect(isMemberRole('ADMIN')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isMemberRole(undefined)).toBe(false);
  });
});
