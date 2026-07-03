import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { mapHumanInputError } from './map-human-input-error';

// Identity translators tag the namespace: `t:` = humanInputRequest (t),
// `c:` = approvalCommon (tCommon), bare fallback = the caller's default.
const t = (key: string) => `t:${key}`;
const tCommon = (key: string) => `c:${key}`;
const FALLBACK = 'fallback';

function map(err: unknown) {
  return mapHumanInputError(err, t, tCommon, FALLBACK);
}

describe('mapHumanInputError (#2056)', () => {
  it('maps shared codes to the approvalCommon namespace', () => {
    expect(map(new ConvexError({ code: 'UNAUTHENTICATED' }))).toBe(
      'c:errorNotAuthenticated',
    );
    expect(map(new ConvexError({ code: 'NOT_FOUND' }))).toBe('c:errorNotFound');
  });

  it('maps human-input-specific codes to the request namespace', () => {
    expect(map(new ConvexError({ code: 'ALREADY_RESPONDED' }))).toBe(
      't:errorAlreadyResponded',
    );
    expect(map(new ConvexError({ code: 'NOT_EDITABLE' }))).toBe(
      't:errorNotEditable',
    );
    expect(map(new ConvexError({ code: 'WORKFLOW_NOT_EDITABLE' }))).toBe(
      't:errorWorkflowNotEditable',
    );
    expect(map(new ConvexError({ code: 'GENERATION_IN_PROGRESS' }))).toBe(
      't:errorGenerationInProgress',
    );
  });

  it('shows the server-provided message verbatim for BUDGET_EXCEEDED', () => {
    const err = new ConvexError({
      code: 'BUDGET_EXCEEDED',
      message: 'Monthly token budget exhausted',
    });
    expect(map(err)).toBe('Monthly token budget exhausted');
  });

  it('falls back when BUDGET_EXCEEDED carries no message', () => {
    expect(map(new ConvexError({ code: 'BUDGET_EXCEEDED' }))).toBe(FALLBACK);
  });

  it('returns the fallback for unknown codes and non-ConvexError throws', () => {
    expect(map(new ConvexError({ code: 'WAT' }))).toBe(FALLBACK);
    expect(map(new Error('Server Error'))).toBe(FALLBACK);
  });
});
