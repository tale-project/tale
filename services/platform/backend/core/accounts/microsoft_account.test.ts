import { describe, expect, it } from 'vitest';

import { pickMicrosoftAccount } from './microsoft_account';

describe('pickMicrosoftAccount', () => {
  it('returns null when the user has no Microsoft account', () => {
    expect(
      pickMicrosoftAccount([
        { providerId: 'credential', accessToken: null },
        { providerId: 'generic-oidc', accessToken: 'tok' },
      ]),
    ).toBeNull();
  });

  it('picks an entra-id account (the SSO login row)', () => {
    const entra = { providerId: 'entra-id', accessToken: 'graph-token' };
    expect(
      pickMicrosoftAccount([
        { providerId: 'credential', accessToken: null },
        entra,
      ]),
    ).toBe(entra);
  });

  it('prefers the row that still carries an access token', () => {
    const stale = {
      providerId: 'microsoft',
      accessToken: null,
      updatedAt: 2000,
    };
    const live = {
      providerId: 'entra-id',
      accessToken: 'graph-token',
      updatedAt: 1000,
    };
    expect(pickMicrosoftAccount([stale, live])).toBe(live);
  });

  it('prefers the newest row when several carry tokens', () => {
    const older = {
      providerId: 'microsoft',
      accessToken: 'old-token',
      updatedAt: 1000,
    };
    const newer = {
      providerId: 'entra-id',
      accessToken: 'new-token',
      updatedAt: 2000,
    };
    expect(pickMicrosoftAccount([older, newer])).toBe(newer);
  });

  it('falls back to a tokenless Microsoft row (refresh may still work)', () => {
    const tokenless = { providerId: 'entra-id', accessToken: null };
    expect(pickMicrosoftAccount([tokenless])).toBe(tokenless);
  });
});
