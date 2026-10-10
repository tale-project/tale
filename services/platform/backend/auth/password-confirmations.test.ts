// @vitest-environment node

import { APIError } from 'better-auth/api';
import { describe, expect, it } from 'vitest';

import {
  confirmationOutcome,
  passwordConfirmationOf,
} from './password-confirmations.ts';

describe('passwordConfirmationOf', () => {
  it('names every Better Auth door that confirms the signed-in password', () => {
    const body = { password: 'secret' };
    expect(passwordConfirmationOf('/two-factor/enable', body)).toBe(
      'two_factor_enable',
    );
    expect(passwordConfirmationOf('/two-factor/disable', body)).toBe(
      'two_factor_disable',
    );
    expect(
      passwordConfirmationOf('/two-factor/generate-backup-codes', body),
    ).toBe('backup_codes');
    expect(passwordConfirmationOf('/two-factor/get-totp-uri', body)).toBe(
      'totp_uri',
    );
    expect(
      passwordConfirmationOf('/change-password', {
        currentPassword: 'secret',
        newPassword: 'next',
      }),
    ).toBe('change_password');
  });

  it('ignores other paths and bodies that carry no password to check', () => {
    expect(
      passwordConfirmationOf('/sign-in/email', { password: 'x' }),
    ).toBeNull();
    expect(passwordConfirmationOf('/two-factor/disable', {})).toBeNull();
    expect(
      passwordConfirmationOf('/two-factor/disable', { password: '' }),
    ).toBeNull();
    // `/change-password` checks the CURRENT password; the new one is no guess.
    expect(
      passwordConfirmationOf('/change-password', { newPassword: 'next' }),
    ).toBeNull();
    expect(passwordConfirmationOf('/two-factor/enable', null)).toBeNull();
  });
});

describe('confirmationOutcome', () => {
  it('reads a wrong password, a refusal that never decided, and a right one', () => {
    expect(
      confirmationOutcome(
        new APIError('BAD_REQUEST', {
          message: 'Invalid password',
          code: 'INVALID_PASSWORD',
        }),
      ),
    ).toBe('failure');
    expect(
      confirmationOutcome(
        new APIError('BAD_REQUEST', {
          message: 'Password too short',
          code: 'PASSWORD_TOO_SHORT',
        }),
      ),
    ).toBe('not-attempted');
    expect(confirmationOutcome(new APIError('UNAUTHORIZED'))).toBe(
      'not-attempted',
    );
    expect(confirmationOutcome({ status: true })).toBe('success');
  });
});
