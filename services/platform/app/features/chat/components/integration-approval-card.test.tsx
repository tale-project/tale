// @vitest-environment jsdom
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { mapApprovalError } from './integration-approval-card';

// Identity translators tag the namespace so assertions show which message was
// chosen: `c:` = approvalCommon (tCommon), bare fallback = the caller's default.
const tCommon = (key: string) => `c:${key}`;
const FALLBACK = 'fallback';

describe('mapApprovalError (#2056)', () => {
  it('maps UNAUTHENTICATED to the not-authenticated message', () => {
    const err = new ConvexError({ code: 'UNAUTHENTICATED' });
    expect(mapApprovalError(err, tCommon, FALLBACK)).toBe(
      'c:errorNotAuthenticated',
    );
  });

  it('maps NOT_FOUND and ALREADY_RESOLVED to their messages', () => {
    expect(
      mapApprovalError(
        new ConvexError({ code: 'NOT_FOUND' }),
        tCommon,
        FALLBACK,
      ),
    ).toBe('c:errorNotFound');
    expect(
      mapApprovalError(
        new ConvexError({ code: 'ALREADY_RESOLVED' }),
        tCommon,
        FALLBACK,
      ),
    ).toBe('c:errorAlreadyResolved');
  });

  it('returns the fallback for an unrecognized code', () => {
    expect(
      mapApprovalError(new ConvexError({ code: 'WAT' }), tCommon, FALLBACK),
    ).toBe(FALLBACK);
  });

  it('returns the fallback for a non-ConvexError (the prod-redacted case)', () => {
    expect(mapApprovalError(new Error('Server Error'), tCommon, FALLBACK)).toBe(
      FALLBACK,
    );
  });
});
