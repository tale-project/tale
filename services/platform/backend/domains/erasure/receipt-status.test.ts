import { describe, expect, test } from 'vitest';

import { erasureReceiptError, erasureReceiptStatus } from './service.ts';

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
