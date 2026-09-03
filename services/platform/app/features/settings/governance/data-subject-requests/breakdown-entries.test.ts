import { describe, expect, test } from 'vitest';

import { foldBreakdownEntries } from './breakdown-entries.ts';

describe('foldBreakdownEntries', () => {
  test('reads the plain-count shape a pass records', () => {
    // The whole panel rendered blank on this shape before: every entry was
    // skipped, so neither a row nor the empty-category line appeared.
    expect(
      foldBreakdownEntries({ uploads: 3, cloudGrants: 2, memories: 0 }),
    ).toEqual({
      visible: [
        { key: 'uploads', rows: 3, skippedByHold: 0 },
        { key: 'cloudGrants', rows: 2, skippedByHold: 0 },
      ],
      zeroCount: 1,
    });
  });

  test('still reads the older object shape on existing receipts', () => {
    expect(
      foldBreakdownEntries({
        documents: { rows: 4, skippedByHold: 0 },
        threads: { rows: 0, skippedByHold: 2 },
        feedback: { rows: 0, skippedByHold: 0 },
      }),
    ).toEqual({
      visible: [
        { key: 'documents', rows: 4, skippedByHold: 0 },
        { key: 'threads', rows: 0, skippedByHold: 2 },
      ],
      zeroCount: 1,
    });
  });

  test('sums the login-attempts pair into one row count', () => {
    expect(
      foldBreakdownEntries({
        loginAttempts: { attempts: 2, blockCounters: 1 },
      }),
    ).toEqual({
      visible: [{ key: 'loginAttempts', rows: 3, skippedByHold: 0 }],
      zeroCount: 0,
    });
  });

  test('counts a held-off category as visible, not as empty', () => {
    const { visible, zeroCount } = foldBreakdownEntries({
      uploads: { rows: 0, skippedByHold: 5 },
    });
    expect(zeroCount).toBe(0);
    expect(visible).toEqual([{ key: 'uploads', rows: 0, skippedByHold: 5 }]);
  });

  test('ignores a value that is neither a count nor an entry', () => {
    expect(foldBreakdownEntries({ odd: 'nope', missing: null })).toEqual({
      visible: [],
      zeroCount: 0,
    });
  });

  test('an empty snapshot yields nothing to show', () => {
    expect(foldBreakdownEntries({})).toEqual({ visible: [], zeroCount: 0 });
  });
});
