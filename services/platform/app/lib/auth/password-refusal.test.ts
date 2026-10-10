import { describe, expect, it } from 'vitest';

import { readPasswordRefusal, retryAfterSeconds } from './password-refusal';

describe('readPasswordRefusal', () => {
  it('reads Better Auth’s wrong password and the sign-in lock', () => {
    expect(
      readPasswordRefusal({ status: 400, code: 'INVALID_PASSWORD' }),
    ).toEqual({ reason: 'wrong-password' });
    expect(
      readPasswordRefusal({ status: 429, message: 'x', retryAfter: 90 } as {
        status: number;
      }),
    ).toEqual({ reason: 'locked', retryAfterSec: 90 });
    expect(readPasswordRefusal({ status: 429 })).toEqual({
      reason: 'locked',
      retryAfterSec: undefined,
    });
  });

  it('leaves every other answer to the caller', () => {
    expect(
      readPasswordRefusal({ status: 400, code: 'TOTP_ALREADY_ENABLED' }),
    ).toBeNull();
    expect(readPasswordRefusal({ status: 500 })).toBeNull();
    expect(readPasswordRefusal(null)).toBeNull();
    expect(readPasswordRefusal(undefined)).toBeNull();
  });
});

describe('retryAfterSeconds', () => {
  it('reads a number or a numeric header value, nothing else', () => {
    expect(retryAfterSeconds(120)).toBe(120);
    expect(retryAfterSeconds('45')).toBe(45);
    expect(retryAfterSeconds('soon')).toBeUndefined();
    expect(retryAfterSeconds(undefined)).toBeUndefined();
  });
});
