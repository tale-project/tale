import { describe, expect, it } from 'vitest';

import { mapDsrError } from './data-subject-requests-errors';

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;

function makeError(data: Record<string, unknown>) {
  return { data };
}

describe('mapDsrError', () => {
  it('maps unauthenticated to the unauthenticated string', () => {
    const result = mapDsrError(makeError({ code: 'unauthenticated' }), t);
    expect(result.description).toBe(
      'dataSubjectRequests.errors.unauthenticated',
    );
  });

  it('maps forbidden, validation, not_found, alreadyPending, notRetriable, notExtendable, alreadyExtended, deadlineLapsed', () => {
    const cases: Array<[string, string]> = [
      ['forbidden', 'dataSubjectRequests.errors.forbidden'],
      ['validation', 'dataSubjectRequests.errors.validation'],
      ['not_found', 'dataSubjectRequests.errors.notFound'],
      ['ALREADY_PENDING', 'dataSubjectRequests.errors.alreadyPending'],
      ['NOT_RETRIABLE', 'dataSubjectRequests.errors.notRetriable'],
      ['NOT_EXTENDABLE', 'dataSubjectRequests.errors.notExtendable'],
      ['ALREADY_EXTENDED', 'dataSubjectRequests.errors.alreadyExtended'],
      ['DEADLINE_LAPSED', 'dataSubjectRequests.errors.deadlineLapsed'],
    ];
    for (const [code, expected] of cases) {
      expect(mapDsrError(makeError({ code }), t).description).toBe(expected);
    }
  });

  it('returns a legalHoldBlock payload (no toast) when code is LEGAL_HOLD_BLOCKS_ERASURE', () => {
    const result = mapDsrError(
      makeError({
        code: 'LEGAL_HOLD_BLOCKS_ERASURE',
        requestId: 'req_abc',
        orgHeld: true,
        userCustodianHeld: false,
      }),
      t,
    );
    expect(result.legalHoldBlock).toEqual({
      requestId: 'req_abc',
      orgHeld: true,
      userCustodianHeld: false,
    });
    expect(result.description).toBe(
      'dataSubjectRequests.errors.legalHoldBlocked',
    );
  });

  it('falls back to a generic mapping for unknown codes', () => {
    const result = mapDsrError(makeError({ code: 'WAT', message: 'oh no' }), t);
    expect(result.title).toBe('dataSubjectRequests.errors.generic.title');
    expect(result.description).toBe('oh no');
  });

  it('handles non-ConvexError shaped errors gracefully', () => {
    const result = mapDsrError(new Error('plain'), t);
    expect(result.title).toBe('dataSubjectRequests.errors.generic.title');
    expect(result.description).toBe(
      'dataSubjectRequests.errors.generic.description',
    );
  });
});
