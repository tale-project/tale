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
    // 0.5 Better Auth (Postgres) ids are MIXED-CASE alphanumerics; the same
    // reused callers pass them through this guard, so the class is
    // case-blind (a mixed-case miss just reaches the adapter and nulls).
    expect(looksLikeConvexDocumentId('Tmz6Qql0PHQdbLvGS7zFEgok4zitji7H')).toBe(
      true,
    );
    expect(looksLikeConvexDocumentId('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')).toBe(
      true,
    );
  });

  it('accepts convex-test synthetic document ids', () => {
    // convex-test allocates ids as `<counter>;<tableName>`; these are real
    // document ids in the in-process backend and must not be short-circuited.
    expect(looksLikeConvexDocumentId('10000;organization')).toBe(true);
    expect(looksLikeConvexDocumentId('1;user')).toBe(true);
    expect(looksLikeConvexDocumentId('42;member')).toBe(true);
  });

  it('rejects the sentinels and non-id strings that throw inside db.get', () => {
    // The 'system' actor sentinel — the observed "Invalid ID length 6" spam.
    expect(looksLikeConvexDocumentId('system')).toBe(false);
    expect(looksLikeConvexDocumentId('')).toBe(false);
    expect(looksLikeConvexDocumentId('larry-test')).toBe(false);
    expect(looksLikeConvexDocumentId('user@example.com')).toBe(false);
    // Short alphanumeric fixtures used in mocked unit tests — not document ids.
    expect(looksLikeConvexDocumentId('org1')).toBe(false);
    expect(looksLikeConvexDocumentId('org_abc')).toBe(false);
  });
});
