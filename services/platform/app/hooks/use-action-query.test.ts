import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { convexErrorCode, isStructuredConvexError } from './use-action-query';

describe('isStructuredConvexError', () => {
  it('is true for a ConvexError carrying object data', () => {
    expect(isStructuredConvexError(new ConvexError({ code: 'X' }))).toBe(true);
  });

  it('is false for a plain Error and non-error values', () => {
    expect(isStructuredConvexError(new Error('boom'))).toBe(false);
    expect(isStructuredConvexError('boom')).toBe(false);
    expect(isStructuredConvexError(null)).toBe(false);
    // A ConvexError with a string payload has no structured `data` object.
    expect(isStructuredConvexError(new ConvexError('boom'))).toBe(false);
  });
});

describe('convexErrorCode', () => {
  it('returns the code from a structured ConvexError', () => {
    expect(
      convexErrorCode(new ConvexError({ code: 'CONNECTOR_NOT_CONNECTED' })),
    ).toBe('CONNECTOR_NOT_CONNECTED');
  });

  it('returns undefined when there is no string code', () => {
    expect(convexErrorCode(new ConvexError({ message: 'no code' }))).toBe(
      undefined,
    );
    expect(convexErrorCode(new ConvexError({ code: 42 }))).toBe(undefined);
  });

  it('returns undefined for a plain Error or non-error value', () => {
    expect(convexErrorCode(new Error('boom'))).toBe(undefined);
    expect(convexErrorCode(undefined)).toBe(undefined);
    expect(convexErrorCode({ data: null })).toBe(undefined);
  });
});
