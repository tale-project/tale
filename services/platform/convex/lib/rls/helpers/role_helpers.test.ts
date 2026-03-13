import { describe, expect, it } from 'vitest';

import { isAdmin } from './role_helpers';

describe('isAdmin', () => {
  it('returns true for admin role', () => {
    expect(isAdmin('admin')).toBe(true);
  });

  it('returns true for owner role', () => {
    expect(isAdmin('owner')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAdmin('Admin')).toBe(true);
    expect(isAdmin('ADMIN')).toBe(true);
    expect(isAdmin('Owner')).toBe(true);
    expect(isAdmin('OWNER')).toBe(true);
  });

  it('returns false for non-admin roles', () => {
    expect(isAdmin('member')).toBe(false);
    expect(isAdmin('editor')).toBe(false);
    expect(isAdmin('developer')).toBe(false);
    expect(isAdmin('disabled')).toBe(false);
  });

  it('returns false for undefined or empty', () => {
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin('')).toBe(false);
  });
});
