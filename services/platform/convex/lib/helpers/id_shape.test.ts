import { describe, expect, it } from 'vitest';

import { looksLikeConvexDocumentId } from './id_shape';

describe('looksLikeConvexDocumentId', () => {
  it('accepts real document-id shapes', () => {
    // A production Better Auth organization id (32 chars, base-32).
    expect(looksLikeConvexDocumentId('jn7e5agwkrztazsh38bq0zt73n87e20w')).toBe(
      true,
    );
    expect(looksLikeConvexDocumentId('kd72m0v4d3sa8gh2plq9x1c5znb0e4tf')).toBe(
      true,
    );
  });

  it('rejects the sentinels and non-id strings that throw inside db.get', () => {
    // The 'system' actor sentinel — the observed "Invalid ID length 6" spam.
    expect(looksLikeConvexDocumentId('system')).toBe(false);
    expect(looksLikeConvexDocumentId('')).toBe(false);
    expect(looksLikeConvexDocumentId('larry-test')).toBe(false);
    expect(looksLikeConvexDocumentId('user@example.com')).toBe(false);
    expect(looksLikeConvexDocumentId('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')).toBe(
      false,
    );
  });
});
