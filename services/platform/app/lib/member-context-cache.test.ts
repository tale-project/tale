// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cacheMemberContext,
  clearMemberContextCache,
  readCachedMemberContextRole,
} from './member-context-cache';

const STORAGE_KEY = 'tale:member-context';

beforeEach(() => {
  window.sessionStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('member-context-cache', () => {
  it('round-trips the role for the exact user + org', () => {
    cacheMemberContext({ userId: 'u1', organizationId: 'o1', role: 'admin' });

    expect(readCachedMemberContextRole('u1', 'o1')).toBe('admin');
  });

  it('rejects a different user (one identity can never hydrate another)', () => {
    cacheMemberContext({ userId: 'u1', organizationId: 'o1', role: 'admin' });

    expect(readCachedMemberContextRole('u2', 'o1')).toBeNull();
    // The record itself survives a mismatch — the right identity still reads it.
    expect(readCachedMemberContextRole('u1', 'o1')).toBe('admin');
  });

  it('rejects a different organization', () => {
    cacheMemberContext({ userId: 'u1', organizationId: 'o1', role: 'member' });

    expect(readCachedMemberContextRole('u1', 'o2')).toBeNull();
  });

  it('never caches a disabled role (and clears any previous record)', () => {
    cacheMemberContext({ userId: 'u1', organizationId: 'o1', role: 'admin' });
    cacheMemberContext({
      userId: 'u1',
      organizationId: 'o1',
      role: 'disabled',
    });

    expect(readCachedMemberContextRole('u1', 'o1')).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('expires stale records past the TTL and removes them', () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        userId: 'u1',
        organizationId: 'o1',
        role: 'admin',
        savedAt: Date.now() - 13 * 60 * 60 * 1000, // TTL is 12h
      }),
    );

    expect(readCachedMemberContextRole('u1', 'o1')).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('discards malformed or unknown-role records (cold path unchanged)', () => {
    window.sessionStorage.setItem(STORAGE_KEY, 'not json');
    expect(readCachedMemberContextRole('u1', 'o1')).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();

    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        userId: 'u1',
        organizationId: 'o1',
        role: 'superuser',
        savedAt: Date.now(),
      }),
    );
    expect(readCachedMemberContextRole('u1', 'o1')).toBeNull();
  });

  it('clearMemberContextCache removes the record', () => {
    cacheMemberContext({ userId: 'u1', organizationId: 'o1', role: 'editor' });
    clearMemberContextCache();

    expect(readCachedMemberContextRole('u1', 'o1')).toBeNull();
  });
});
