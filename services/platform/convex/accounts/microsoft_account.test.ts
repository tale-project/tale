import { describe, expect, it } from 'vitest';

import {
  isMicrosoftProvider,
  pickMicrosoftAccount,
  scopeGrantsOneDrive,
} from './microsoft_account';

describe('isMicrosoftProvider', () => {
  it('matches the legacy social-login provider', () => {
    expect(isMicrosoftProvider('microsoft')).toBe(true);
  });

  // Regression: Enterprise SSO stores Graph tokens under `entra-id`; the
  // lookups used to match only `microsoft`, which hid the Microsoft 365
  // documents entry for every SSO user (#354 cutover leftover).
  it('matches the Enterprise SSO Entra ID provider', () => {
    expect(isMicrosoftProvider('entra-id')).toBe(true);
  });

  it('rejects other providers and non-strings', () => {
    expect(isMicrosoftProvider('credential')).toBe(false);
    expect(isMicrosoftProvider('generic-oidc')).toBe(false);
    expect(isMicrosoftProvider('saml')).toBe(false);
    expect(isMicrosoftProvider(undefined)).toBe(false);
    expect(isMicrosoftProvider(42)).toBe(false);
  });
});

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

describe('scopeGrantsOneDrive', () => {
  it('treats an unrecorded scope as capable (legacy rows)', () => {
    expect(scopeGrantsOneDrive(null)).toBe(true);
    expect(scopeGrantsOneDrive(undefined)).toBe(true);
    expect(scopeGrantsOneDrive('')).toBe(true);
  });

  it('accepts fully-qualified and short Graph scope forms', () => {
    expect(
      scopeGrantsOneDrive(
        'openid profile https://graph.microsoft.com/Files.Read',
      ),
    ).toBe(true);
    expect(scopeGrantsOneDrive('Files.Read Sites.Read.All openid')).toBe(true);
    expect(scopeGrantsOneDrive('files.read')).toBe(true);
  });

  // Regression: an org that removed the OneDrive scopes from its SSO
  // connection must not surface the Microsoft 365 entry — the token can
  // sign in but cannot read files.
  it('rejects a sign-in-only scope set', () => {
    expect(scopeGrantsOneDrive('openid profile email offline_access')).toBe(
      false,
    );
    expect(
      scopeGrantsOneDrive(
        'openid https://graph.microsoft.com/User.Read https://graph.microsoft.com/GroupMember.Read.All',
      ),
    ).toBe(false);
  });
});
