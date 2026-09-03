import { describe, expect, it } from 'vitest';

import { forcedResetEligible } from './service.ts';

/**
 * A forced (current-password-skipping) password reset must be a function of
 * the credential's real state ONLY — never of the request body. This pins that
 * `forcedResetEligible` takes no client `trigger` and is true only when the
 * credential exists AND is genuinely expired/force-change. If a client could
 * select 'forced', a stolen session could rotate the password without proving
 * the current one.
 */

describe('forcedResetEligible', () => {
  it('allows a forced reset only for an EXISTING, expired credential', () => {
    expect(forcedResetEligible(true, { expired: true })).toBe(true);
  });

  it('refuses a forced reset when the credential is NOT expired', () => {
    // This is the attack shape: a live session, a fresh credential, no reason
    // to skip the current-password check.
    expect(forcedResetEligible(true, { expired: false })).toBe(false);
  });

  it('refuses a forced reset when there is no credential (OAuth-only user)', () => {
    expect(forcedResetEligible(false, { expired: true })).toBe(false);
    expect(forcedResetEligible(false, { expired: false })).toBe(false);
  });
});
