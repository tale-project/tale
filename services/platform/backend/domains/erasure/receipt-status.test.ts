import { describe, expect, test } from 'vitest';

import {
  erasureHoldBlock,
  erasureHoldError,
  erasureReceiptError,
  erasureReceiptStatus,
} from './service.ts';

describe('erasureReceiptStatus', () => {
  test('a clean cascade is done', () => {
    expect(erasureReceiptStatus([], [])).toBe('done');
  });

  test('a failed pass makes the receipt partial', () => {
    expect(erasureReceiptStatus(['uploads'], [])).toBe('partial');
  });

  test('a pass held off by a legal hold makes it partial too', () => {
    // Without this the receipt would claim `done` for a cascade a hold
    // stopped halfway, which is the Art 19 confirmation the subject reads.
    expect(erasureReceiptStatus([], ['documents'])).toBe('partial');
  });
});

describe('erasureReceiptError', () => {
  test('says nothing when nothing went wrong', () => {
    expect(erasureReceiptError([], [])).toBeNull();
  });

  test('names the failed passes', () => {
    expect(erasureReceiptError(['uploads', 'threads'], [])).toBe(
      'failed passes: uploads, threads',
    );
  });

  test('names the held-off passes separately from the failed ones', () => {
    expect(erasureReceiptError(['uploads'], ['documents'])).toBe(
      'failed passes: uploads; held off by a legal hold: documents',
    );
  });
});

describe('erasureHoldError', () => {
  test('records which hold stopped the receipt — the org-wide hold outranks a custodian hold', () => {
    expect(erasureHoldError(true)).toBe('org_hold');
    expect(erasureHoldError(false)).toBe('user_custodian_hold');
  });
});

describe('erasureHoldBlock', () => {
  test('a released hold reads as inactive — the receipt no longer claims a hold it cannot see', () => {
    expect(
      erasureHoldBlock(
        { orgHeld: false, userMembershipIds: new Set() },
        'subject',
      ),
    ).toEqual({ orgHeld: false, userCustodianHeld: false, active: false });
  });

  test('a custodian hold on the subject keeps the block active', () => {
    expect(
      erasureHoldBlock(
        { orgHeld: false, userMembershipIds: new Set(['subject']) },
        'subject',
      ),
    ).toEqual({ orgHeld: false, userCustodianHeld: true, active: true });
  });

  test('a custodian hold on someone else does not', () => {
    expect(
      erasureHoldBlock(
        { orgHeld: false, userMembershipIds: new Set(['other']) },
        'subject',
      ),
    ).toEqual({ orgHeld: false, userCustodianHeld: false, active: false });
  });

  test('an org-wide hold keeps it active for every subject', () => {
    expect(
      erasureHoldBlock(
        { orgHeld: true, userMembershipIds: new Set() },
        'subject',
      ),
    ).toEqual({ orgHeld: true, userCustodianHeld: false, active: true });
  });
});
