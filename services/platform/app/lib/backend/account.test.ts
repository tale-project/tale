// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  accountReadAdapters,
  passwordExpiryQuery,
  twoFactorStatusQuery,
} from './account';
import { BackendApiError } from './api-client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe('account query options', () => {
  it('keys under the account scope so no org hint ever touches them', () => {
    expect(twoFactorStatusQuery().queryKey).toEqual([
      'backend',
      'me',
      'account',
      'two-factor-status',
    ]);
    expect(passwordExpiryQuery().queryKey).toEqual([
      'backend',
      'me',
      'account',
      'password-expiry',
    ]);
  });

  it('fetches the status routes without an org scope', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(200, { authenticated: false })),
      );
    await twoFactorStatusQuery().queryFn?.({
      signal: new AbortController().signal,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only signal is read
    } as never);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/app/two-factor/status',
      expect.objectContaining({ method: 'GET' }),
    );
    await passwordExpiryQuery().queryFn?.({
      signal: new AbortController().signal,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only signal is read
    } as never);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/app/users/password-expiry',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('retries transport failures but never a deterministic 4xx', () => {
    const { retry } = twoFactorStatusQuery();
    expect(typeof retry).toBe('function');
    if (typeof retry !== 'function') return;
    expect(retry(0, new BackendApiError(401, 'Unauthorized'))).toBe(false);
    expect(retry(0, new BackendApiError(503, 'Service unavailable'))).toBe(
      true,
    );
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(retry(3, new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('the effective password policy row', () => {
  it('reads the caller’s own rules under the account scope, whatever org is open', async () => {
    const policy = {
      minLength: 20,
      requireUpper: true,
      requireLower: true,
      requireDigit: true,
      requireSpecial: true,
      rotationDays: 0,
    };
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { policy }));
    const adapted = accountReadAdapters['users/queries:getMyPasswordPolicy']?.(
      {},
      { organizationId: 'org-1' },
    );

    expect(adapted?.queryKey).toEqual([
      'backend',
      'me',
      'account',
      'password-policy',
    ]);
    await expect(adapted?.queryFn()).resolves.toEqual(policy);
    // The strictest policy across every org the user belongs to: no org scope.
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/app/users/me/password-policy',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
