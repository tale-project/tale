import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { mapTriggerError } from './map-trigger-error';

// Identity translator returns the key so assertions show which message was
// chosen; bare `fallback` is the caller's generic default.
const t = (key: string) => key;
const FALLBACK = 'generic';

function map(err: unknown) {
  return mapTriggerError(err, t, FALLBACK);
}

describe('mapTriggerError (#2056)', () => {
  it('maps each trigger error code to its namespaced message', () => {
    const cases: Array<[string, string]> = [
      ['UNAUTHENTICATED', 'triggers.errors.unauthenticated'],
      ['INVALID_SLUG', 'triggers.errors.invalidSlug'],
      ['NOT_INSTALLED', 'triggers.errors.notInstalled'],
      ['NOT_FOUND', 'triggers.errors.notFound'],
      ['APP_OWNED_WORKFLOW', 'triggers.errors.appOwnedWorkflow'],
      ['INVALID_EVENT_TYPE', 'triggers.errors.invalidEventType'],
      ['DUPLICATE_SUBSCRIPTION', 'triggers.errors.duplicateSubscription'],
    ];
    for (const [code, key] of cases) {
      expect(map(new ConvexError({ code }))).toBe(key);
    }
  });

  it('returns the fallback for an unrecognized code', () => {
    expect(map(new ConvexError({ code: 'WAT' }))).toBe(FALLBACK);
  });

  it('returns the fallback for a non-ConvexError (the prod-redacted case)', () => {
    expect(map(new Error('Server Error'))).toBe(FALLBACK);
  });
});
