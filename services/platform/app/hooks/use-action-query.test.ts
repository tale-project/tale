import { describe, expect, it } from 'vitest';

import { BackendError } from '@/app/lib/backend/backend-error';

import { convexErrorCode, isStructuredConvexError } from './use-action-query';

describe('isStructuredConvexError', () => {
  it('is true for a BackendError carrying object data', () => {
    expect(isStructuredConvexError(new BackendError({ code: 'X' }))).toBe(true);
  });

  it('is false for a plain Error and non-error values', () => {
    expect(isStructuredConvexError(new Error('boom'))).toBe(false);
    expect(isStructuredConvexError('boom')).toBe(false);
    expect(isStructuredConvexError(null)).toBe(false);
    // A BackendError with a string payload has no structured `data` object.
    expect(isStructuredConvexError(new BackendError('boom'))).toBe(false);
  });
});

describe('convexErrorCode', () => {
  it('returns the code from a structured BackendError', () => {
    expect(
      convexErrorCode(new BackendError({ code: 'CONNECTOR_NOT_CONNECTED' })),
    ).toBe('CONNECTOR_NOT_CONNECTED');
  });

  it('returns undefined when there is no string code', () => {
    expect(convexErrorCode(new BackendError({ message: 'no code' }))).toBe(
      undefined,
    );
    expect(convexErrorCode(new BackendError({ code: 42 }))).toBe(undefined);
  });

  it('returns undefined for a plain Error or non-error value', () => {
    expect(convexErrorCode(new Error('boom'))).toBe(undefined);
    expect(convexErrorCode(undefined)).toBe(undefined);
    expect(convexErrorCode({ data: null })).toBe(undefined);
  });
});
