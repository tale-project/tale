// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression cover for #2085[06]: the forced-change-password route is
// `/forced-change-password/$id`, so the pathname ends with the org id — never
// the literal segment. The gate's original `endsWith('forced-change-password')`
// short-circuit could therefore never match, and the gate kept re-navigating
// to the page the user was already on. These tests pin the inclusion match.

const { mockNavigate, mockLocation, mockExpiry } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLocation: { value: { pathname: '/dashboard/org-1' } },
  mockExpiry: { value: undefined as unknown },
}));

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => mockLocation.value,
  useNavigate: () => mockNavigate,
  useParams: () => ({ id: 'org-1' }),
}));

vi.mock('@/app/context/account-bootstrap-context', () => ({
  usePasswordExpiry: () => mockExpiry.value,
}));

import { usePasswordExpiryGate } from './use-password-expiry-gate';

describe('usePasswordExpiryGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects an expired credential to the forced-change page', () => {
    mockExpiry.value = { expired: true, hasCredential: true };
    mockLocation.value = { pathname: '/dashboard/org-1' };

    renderHook(() => usePasswordExpiryGate('org-1'));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/forced-change-password/$id',
      params: { id: 'org-1' },
      replace: true,
    });
  });

  it('short-circuits on the forced-change page itself, whose pathname ends with the id (#2085[06])', () => {
    mockExpiry.value = { expired: true, hasCredential: true };
    // The real pathname shape: the id is the last segment, so an
    // endsWith('forced-change-password') check would miss it and loop.
    mockLocation.value = { pathname: '/forced-change-password/org-1' };

    renderHook(() => usePasswordExpiryGate('org-1'));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does nothing while the credential is not expired', () => {
    mockExpiry.value = { expired: false, hasCredential: true };
    mockLocation.value = { pathname: '/dashboard/org-1' };

    renderHook(() => usePasswordExpiryGate('org-1'));

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
