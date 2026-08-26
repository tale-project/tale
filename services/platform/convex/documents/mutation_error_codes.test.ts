// Regression gate for issue #2010 — documents mutations must throw structured
// `ConvexError` (not raw `Error`) for not-found, folder, and authz rejections
// so that `withRestAuth` can map them to 4xx and the UI gets actionable error
// codes instead of opaque 500s.
//
// The mutation/internalMutation factories are mocked to hand the config
// straight through (same pattern as vendors/mutation_error_codes.test.ts) so
// the handler bodies are unit-testable without a running backend. The real
// `ConvexError` is preserved via `importOriginal` so the structured throws
// construct correctly.

import { ConvexError } from 'convex/values';
import { describe, it, expect, vi } from 'vitest';

vi.mock('convex/values', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stub = () => 'validator';
  return {
    ...actual,
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      id: stub,
      object: stub,
      union: stub,
      literal: stub,
      array: stub,
      null: stub,
      // Indexing dispatch declares the pool's completion shape, whose
      // `returnValue` is `v.any()`.
      any: stub,
    },
  };
});

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

vi.mock('../governance/legal_hold_guard', () => ({
  assertNotHeld: vi.fn().mockResolvedValue(undefined),
}));

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

vi.mock('../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: vi.fn().mockResolvedValue({
    _id: 'member_1',
    organizationId: 'org_1',
    userId: 'user_1',
    role: 'member',
  }),
}));

vi.mock('../../lib/shared/schemas/utils/json-value', () => ({
  jsonValueValidator: 'validator',
  jsonRecordValidator: 'validator',
}));

vi.mock('./validators', () => ({
  sourceProviderValidator: 'validator',
}));

import * as internalMutations from './internal_mutations';
import * as mutations from './mutations';

interface MutHandler {
  handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
}

function asHandler(m: unknown): MutHandler {
  return m as MutHandler;
}

// Run a handler and return whatever it throws (or null if it resolves).
async function captureError(
  m: unknown,
  ctx: unknown,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    await asHandler(m).handler(ctx, args);
    return null;
  } catch (e) {
    return e;
  }
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof ConvexError) {
    const data = error.data;
    if (typeof data === 'object' && data !== null && 'code' in data) {
      const code = (data as { code: unknown }).code;
      return typeof code === 'string' ? code : undefined;
    }
  }
  return undefined;
}

const AUTH_USER = { userId: 'user_1' };

describe('documents mutations error codes (issue #2010)', () => {
  describe('client-callable mutations.ts', () => {
    it('updateDocument throws UNAUTHENTICATED when caller is anonymous', async () => {
      mockGetAuthUserIdentity.mockResolvedValueOnce(null);
      const ctx = { db: { get: vi.fn() } };
      const err = await captureError(mutations.updateDocument, ctx, {
        documentId: 'd1',
        title: 'New',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('UNAUTHENTICATED');
    });

    it('updateDocument throws DOCUMENT_NOT_FOUND when document is missing', async () => {
      mockGetAuthUserIdentity.mockResolvedValueOnce(AUTH_USER);
      const ctx = { db: { get: vi.fn().mockResolvedValue(null) } };
      const err = await captureError(mutations.updateDocument, ctx, {
        documentId: 'd1',
        title: 'New',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('DOCUMENT_NOT_FOUND');
    });

    it('deleteDocument throws UNAUTHENTICATED when caller is anonymous', async () => {
      mockGetAuthUserIdentity.mockResolvedValueOnce(null);
      const ctx = { db: { get: vi.fn() } };
      const err = await captureError(mutations.deleteDocument, ctx, {
        documentId: 'd1',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('UNAUTHENTICATED');
    });

    it('deleteDocument throws DOCUMENT_NOT_FOUND when document is missing', async () => {
      mockGetAuthUserIdentity.mockResolvedValueOnce(AUTH_USER);
      const ctx = { db: { get: vi.fn().mockResolvedValue(null) } };
      const err = await captureError(mutations.deleteDocument, ctx, {
        documentId: 'd1',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('DOCUMENT_NOT_FOUND');
    });
  });

  describe('REST-path internal_mutations.ts', () => {
    it('updateDocument throws not_found ConvexError on cross-tenant access', async () => {
      const existing = { _id: 'd1', organizationId: 'org_1' };
      const ctx = { db: { get: vi.fn().mockResolvedValue(existing) } };
      const err = await captureError(internalMutations.updateDocument, ctx, {
        documentId: 'd1',
        title: 'New',
        callerOrgId: 'org_2',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('not_found');
    });

    it('createDocument throws FOLDER_NOT_FOUND when folder is missing', async () => {
      const ctx = { db: { get: vi.fn().mockResolvedValue(null) } };
      const err = await captureError(internalMutations.createDocument, ctx, {
        organizationId: 'org_1',
        title: 'doc.pdf',
        folderId: 'folder_missing',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('FOLDER_NOT_FOUND');
    });
  });
});
