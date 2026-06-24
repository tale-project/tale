import { describe, expect, it } from 'vitest';

import { isSafeInternalPath, sanitizeInternalRedirect } from './safe-redirect';

describe('isSafeInternalPath', () => {
  it('accepts root-relative paths', () => {
    expect(isSafeInternalPath('/')).toBe(true);
    expect(isSafeInternalPath('/dashboard')).toBe(true);
    expect(isSafeInternalPath('/sign-in')).toBe(true);
    expect(isSafeInternalPath('/dashboard/abc?tab=1#section')).toBe(true);
  });

  it('rejects absolute and protocol-relative URLs', () => {
    expect(isSafeInternalPath('https://evil.com')).toBe(false);
    expect(isSafeInternalPath('//evil.com')).toBe(false);
    expect(isSafeInternalPath('/\\evil.com')).toBe(false);
    expect(isSafeInternalPath('http:/evil.com')).toBe(false);
  });

  it('rejects values that are not root-relative paths', () => {
    expect(isSafeInternalPath('')).toBe(false);
    expect(isSafeInternalPath('dashboard')).toBe(false);
    expect(isSafeInternalPath(' /dashboard')).toBe(false);
  });
});

describe('sanitizeInternalRedirect', () => {
  it('returns a safe path unchanged', () => {
    expect(sanitizeInternalRedirect('/dashboard', '/home')).toBe('/dashboard');
  });

  it('falls back for unsafe or missing values', () => {
    expect(sanitizeInternalRedirect('https://evil.com', '/home')).toBe('/home');
    expect(sanitizeInternalRedirect('//evil.com', '/home')).toBe('/home');
    expect(sanitizeInternalRedirect(null, '/home')).toBe('/home');
    expect(sanitizeInternalRedirect(undefined, '/home')).toBe('/home');
  });
});
