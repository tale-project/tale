import { describe, it, expect } from 'vitest';

import { buildSmtpAuthPatch } from './smtp-auth-payload';

describe('buildSmtpAuthPatch', () => {
  it('sets smtpAuth from entered credentials when the toggle is on', () => {
    expect(
      buildSmtpAuthPatch({
        smtpSeparate: true,
        smtpUsername: 'resend',
        smtpPassword: 're_key',
        storedUsername: undefined,
        hasStoredSmtpAuth: false,
      }),
    ).toEqual({ smtpAuth: { username: 'resend', password: 're_key' } });
  });

  it('falls back to the stored username when only the password is re-entered', () => {
    expect(
      buildSmtpAuthPatch({
        smtpSeparate: true,
        smtpUsername: '  ',
        smtpPassword: 'new-secret',
        storedUsername: 'resend',
        hasStoredSmtpAuth: true,
      }),
    ).toEqual({ smtpAuth: { username: 'resend', password: 'new-secret' } });
  });

  it('is a no-op when the toggle is on but nothing was entered (keeps stored creds)', () => {
    expect(
      buildSmtpAuthPatch({
        smtpSeparate: true,
        smtpUsername: '',
        smtpPassword: '',
        storedUsername: 'resend',
        hasStoredSmtpAuth: true,
      }),
    ).toEqual({});
  });

  it('clears stored smtpAuth when the toggle is turned off', () => {
    expect(
      buildSmtpAuthPatch({
        smtpSeparate: false,
        smtpUsername: '',
        smtpPassword: '',
        storedUsername: 'resend',
        hasStoredSmtpAuth: true,
      }),
    ).toEqual({ clearSmtpAuth: true });
  });

  it('is a no-op when the toggle is off and nothing was ever stored', () => {
    expect(
      buildSmtpAuthPatch({
        smtpSeparate: false,
        smtpUsername: '',
        smtpPassword: '',
        storedUsername: undefined,
        hasStoredSmtpAuth: false,
      }),
    ).toEqual({});
  });
});
