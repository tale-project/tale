import { describe, expect, it } from 'vitest';

import {
  assertReviewerNotSubmitter,
  assertReviewResponder,
  pendingReviewEchoes,
} from './records.ts';
import { DocumentError } from './service.ts';

/**
 * The four-eyes rule of the controlled-record review, at the pure seam the
 * submit and respond doors call: a submitter never names themselves, and only
 * the designated reviewer decides. `records.ts` reads the parties off the
 * approval row (metadata first, the record's mirror as fallback) and hands
 * them here; these tables are the contract those doors rely on.
 */

function codeOf(run: () => void): { code: string; status: number } | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof DocumentError) {
      return { code: error.code, status: error.status };
    }
    throw error;
  }
}

describe('assertReviewerNotSubmitter (submit-side self-designation)', () => {
  it('admits a reviewer who is somebody else', () => {
    expect(
      codeOf(() => assertReviewerNotSubmitter('u_bob', 'u_ann')),
    ).toBeNull();
  });

  it('refuses the submitter naming themselves', () => {
    expect(codeOf(() => assertReviewerNotSubmitter('u_ann', 'u_ann'))).toEqual({
      code: 'REVIEWER_SELF_NOT_ALLOWED',
      status: 400,
    });
  });
});

describe('assertReviewResponder (respond-side designee rule)', () => {
  const minted = { requestedFor: 'u_bob', requestedBy: 'u_ann' };

  it('admits the designated reviewer', () => {
    expect(codeOf(() => assertReviewResponder(minted, 'u_bob'))).toBeNull();
  });

  it.each([
    ['the submitter', 'u_ann'],
    ['another writer', 'u_cat'],
  ])('refuses %s as not the designee', (_label, responder) => {
    expect(codeOf(() => assertReviewResponder(minted, responder))).toEqual({
      code: 'REVIEW_NOT_ASSIGNED',
      status: 403,
    });
  });

  it('fails closed on a row that names no designee', () => {
    expect(
      codeOf(() =>
        assertReviewResponder(
          { requestedFor: undefined, requestedBy: 'u_ann' },
          'u_ann',
        ),
      ),
    ).toEqual({ code: 'REVIEW_NOT_ASSIGNED', status: 403 });
  });

  it('refuses the submitter even where an older row designated them', () => {
    // Self-designation is refused at submit today; a row minted before that
    // rule still must not become a self-approval.
    expect(
      codeOf(() =>
        assertReviewResponder(
          { requestedFor: 'u_ann', requestedBy: 'u_ann' },
          'u_ann',
        ),
      ),
    ).toEqual({ code: 'REVIEW_SELF_APPROVAL_FORBIDDEN', status: 403 });
  });

  it('admits the designee of a row whose submitter is unknown', () => {
    expect(
      codeOf(() =>
        assertReviewResponder(
          { requestedFor: 'u_bob', requestedBy: undefined },
          'u_bob',
        ),
      ),
    ).toBeNull();
  });
});

describe('pendingReviewEchoes (re-submit while in review)', () => {
  const standing = {
    metadata: { requestedFor: 'u_bob', requestedBy: 'u_ann', version: 1 },
  };

  it('echoes the live row when the same designee is named again', () => {
    expect(pendingReviewEchoes(standing, 'u_bob')).toBe(true);
  });

  it('re-designates when another reviewer is named', () => {
    // The stuck-review exit: the designee left or lost scope, the submitter
    // names someone who can respond, and the mint-and-supersede path runs.
    expect(pendingReviewEchoes(standing, 'u_cat')).toBe(false);
  });

  it('never echoes a row that names no designee', () => {
    expect(pendingReviewEchoes({ metadata: null }, 'u_bob')).toBe(false);
    expect(pendingReviewEchoes({ metadata: {} }, 'u_bob')).toBe(false);
  });
});
