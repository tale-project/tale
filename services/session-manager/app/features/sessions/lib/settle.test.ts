import { describe, expect, it } from 'vitest';

import { ApiError } from '@/app/lib/api/client';

import { isRefusal, settle } from './settle';

describe('settle', () => {
  it('hands over the result of a write that worked', async () => {
    expect(await settle(Promise.resolve(7))).toEqual({ ok: true, value: 7 });
  });

  it('hands over the error of a write that failed, instead of throwing it', async () => {
    const error = new ApiError(409, 'name_taken', 'x');
    expect(await settle(Promise.reject(error))).toEqual({ ok: false, error });
  });
});

describe('isRefusal', () => {
  it('is true for the backend refusing with one of the codes', () => {
    const error = new ApiError(409, 'ip_in_use', 'x');
    expect(isRefusal(error, 'ip_in_use')).toBe(true);
    expect(isRefusal(error, 'name_taken', 'ip_in_use')).toBe(true);
  });

  it('is false for another code, another kind of error and a non-error', () => {
    expect(isRefusal(new ApiError(409, 'name_taken', 'x'), 'ip_in_use')).toBe(
      false,
    );
    expect(isRefusal(new Error('ip_in_use'), 'ip_in_use')).toBe(false);
    expect(isRefusal('ip_in_use', 'ip_in_use')).toBe(false);
  });
});
