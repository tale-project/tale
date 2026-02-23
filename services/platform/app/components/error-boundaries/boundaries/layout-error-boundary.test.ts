import { describe, it, expect } from 'vitest';

import { isConvexTransientError } from './layout-error-boundary';

describe('isConvexTransientError', () => {
  it('returns true for timeout errors', () => {
    expect(isConvexTransientError(new Error('Request timed out'))).toBe(true);
  });

  it('returns true for function execution errors', () => {
    expect(
      isConvexTransientError(
        new Error('Function execution took too long to complete'),
      ),
    ).toBe(true);
  });

  it('returns true for overloaded errors', () => {
    expect(isConvexTransientError(new Error('Server is overloaded'))).toBe(
      true,
    );
  });

  it('returns false for generic errors', () => {
    expect(isConvexTransientError(new Error('Something went wrong'))).toBe(
      false,
    );
  });

  it('returns false for empty error messages', () => {
    expect(isConvexTransientError(new Error(''))).toBe(false);
  });

  it('returns true for TypeError with undefined property access', () => {
    const error = new TypeError(
      "Cannot read properties of undefined (reading 'filter')",
    );
    expect(isConvexTransientError(error)).toBe(true);
  });

  it('returns true for TypeError with other undefined property reads', () => {
    const error = new TypeError(
      "Cannot read properties of undefined (reading 'length')",
    );
    expect(isConvexTransientError(error)).toBe(true);
  });

  it('returns false for non-TypeError with undefined property message', () => {
    const error = new Error(
      "Cannot read properties of undefined (reading 'filter')",
    );
    expect(isConvexTransientError(error)).toBe(false);
  });

  it('returns false for TypeError with a different message', () => {
    const error = new TypeError('Assignment to constant variable');
    expect(isConvexTransientError(error)).toBe(false);
  });
});
