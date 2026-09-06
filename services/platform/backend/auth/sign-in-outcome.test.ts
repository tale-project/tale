import { APIError } from 'better-auth/api';
import { describe, expect, it } from 'vitest';

import { classifySignInOutcome } from './auth.ts';

/**
 * Only a refusal that actually checked the password counts against the
 * account. Better Auth runs the after-hook for endpoint APIErrors too, and
 * its sign-in refuses a malformed address (a whitespace-padded one fails
 * `z.email()`) with a 400 BEFORE any lookup — counting that bumped the real
 * account's counter and, past the threshold, raised a false lockout audit
 * row and admin bell while no lock existed.
 */
describe('classifySignInOutcome', () => {
  it('counts an UNAUTHORIZED refusal as a failed attempt', () => {
    expect(
      classifySignInOutcome(
        new APIError('UNAUTHORIZED', { message: 'Invalid email or password' }),
        null,
      ),
    ).toBe('failure');
  });

  it('does not count a 400 refusal that never reached the password check', () => {
    expect(
      classifySignInOutcome(
        new APIError('BAD_REQUEST', { message: 'Invalid email' }),
        null,
      ),
    ).toBe('not-attempted');
  });

  it('does not count a 403 that already passed the password check', () => {
    expect(
      classifySignInOutcome(
        new APIError('FORBIDDEN', { message: 'Email not verified' }),
        null,
      ),
    ).toBe('not-attempted');
  });

  it('is a success when a session was issued', () => {
    expect(classifySignInOutcome({ token: 't' }, { user: { id: 'u-1' } })).toBe(
      'success',
    );
  });

  it('is a failure when no error was thrown but no session exists', () => {
    expect(classifySignInOutcome({ token: 't' }, null)).toBe('failure');
  });
});
