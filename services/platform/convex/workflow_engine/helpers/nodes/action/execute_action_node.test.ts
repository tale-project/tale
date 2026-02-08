import { describe, it, expect } from 'vitest';

// Test the pure helper functions from execute_action_node.ts
// These are not exported, so we replicate the logic for unit testing.

// isSecureWrapper type guard
function isSecureWrapper(val: unknown): val is { __secure: true; jwe: string } {
  return (
    !!val &&
    typeof val === 'object' &&
    (val as Record<string, unknown>)['__secure'] === true &&
    typeof (val as Record<string, unknown>)['jwe'] === 'string'
  );
}

// sanitizeActionResultForOutput
function sanitizeActionResultForOutput(result: unknown): unknown {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const { variables: _omitted, ...rest } = result as Record<string, unknown>;
    return rest;
  }
  return result;
}

describe('isSecureWrapper', () => {
  it('should return true for valid secure wrapper', () => {
    expect(isSecureWrapper({ __secure: true, jwe: 'encrypted_data' })).toBe(
      true,
    );
  });

  it('should return false for null', () => {
    expect(isSecureWrapper(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isSecureWrapper(undefined)).toBe(false);
  });

  it('should return false for non-object', () => {
    expect(isSecureWrapper('string')).toBe(false);
    expect(isSecureWrapper(42)).toBe(false);
    expect(isSecureWrapper(true)).toBe(false);
  });

  it('should return false when __secure is not true', () => {
    expect(isSecureWrapper({ __secure: false, jwe: 'data' })).toBe(false);
  });

  it('should return false when jwe is not a string', () => {
    expect(isSecureWrapper({ __secure: true, jwe: 123 })).toBe(false);
  });

  it('should return false when jwe is missing', () => {
    expect(isSecureWrapper({ __secure: true })).toBe(false);
  });

  it('should return false for empty object', () => {
    expect(isSecureWrapper({})).toBe(false);
  });

  it('should return true even with extra properties', () => {
    expect(
      isSecureWrapper({ __secure: true, jwe: 'data', extra: 'field' }),
    ).toBe(true);
  });
});

describe('sanitizeActionResultForOutput', () => {
  it('should remove variables key from object result', () => {
    const result = {
      data: 'hello',
      variables: { secret: 'should_be_removed' },
      status: 'ok',
    };

    expect(sanitizeActionResultForOutput(result)).toEqual({
      data: 'hello',
      status: 'ok',
    });
  });

  it('should return object without variables key as-is', () => {
    const result = { data: 'hello', status: 'ok' };

    expect(sanitizeActionResultForOutput(result)).toEqual({
      data: 'hello',
      status: 'ok',
    });
  });

  it('should return arrays as-is', () => {
    const result = [1, 2, 3];
    expect(sanitizeActionResultForOutput(result)).toEqual([1, 2, 3]);
  });

  it('should return null as-is', () => {
    expect(sanitizeActionResultForOutput(null)).toBeNull();
  });

  it('should return primitives as-is', () => {
    expect(sanitizeActionResultForOutput('string')).toBe('string');
    expect(sanitizeActionResultForOutput(42)).toBe(42);
    expect(sanitizeActionResultForOutput(undefined)).toBeUndefined();
  });

  it('should handle empty object', () => {
    expect(sanitizeActionResultForOutput({})).toEqual({});
  });
});
