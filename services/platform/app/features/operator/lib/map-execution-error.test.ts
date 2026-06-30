import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { mapExecutionError } from './map-execution-error';

// Identity translator returns the key so assertions show which message was
// chosen; bare `fallback` is the caller's generic default.
const t = (key: string) => key;
const FALLBACK = 'generic';

function map(err: unknown) {
  return mapExecutionError(err, t, FALLBACK);
}

describe('mapExecutionError (#2013)', () => {
  it('maps each execution error code to its namespaced message', () => {
    const cases: Array<[string, string]> = [
      ['UNAUTHENTICATED', 'executionErrors.unauthenticated'],
      ['EXECUTION_NOT_FOUND', 'executionErrors.notFound'],
      ['EXECUTION_NOT_CANCELABLE', 'executionErrors.notCancelable'],
      ['EXECUTION_MISSING_SLUG', 'executionErrors.missingWorkflow'],
    ];
    for (const [code, key] of cases) {
      expect(map(new ConvexError({ code }))).toBe(key);
    }
  });

  it('ignores the extra `status` field and still maps on `code`', () => {
    expect(
      map(
        new ConvexError({
          code: 'EXECUTION_NOT_CANCELABLE',
          status: 'completed',
        }),
      ),
    ).toBe('executionErrors.notCancelable');
  });

  it('returns the fallback for an unrecognized code', () => {
    expect(map(new ConvexError({ code: 'WAT' }))).toBe(FALLBACK);
  });

  it('returns the fallback for a non-ConvexError (the prod-redacted case)', () => {
    expect(map(new Error('Server Error'))).toBe(FALLBACK);
  });
});
