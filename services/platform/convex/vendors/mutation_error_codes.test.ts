// Regression gate for issue #2004 — vendors mutations must throw structured
// `ConvexError` (not raw `Error`) for not-found and conflict cases so that
// `withRestAuth` can map them to 404/409 and the UI gets actionable errors
// instead of opaque 500s.
//
// The mutation/internalMutation factories are mocked to hand the config
// straight through (same pattern as sandbox/internal_mutations.test.ts) so the
// handler bodies are unit-testable without a running backend.

import { ConvexError } from 'convex/values';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/rls', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutationWithRLS: (config: Record<string, unknown>) => config,
  };
});

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

vi.mock('../governance/legal_hold_guard', () => ({
  assertNotHeld: vi.fn().mockResolvedValue(undefined),
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

// A fluent query builder whose `.first()` resolves to a configurable row.
function makeQueryBuilder(firstResult: unknown) {
  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(firstResult),
  };
  return builder;
}

describe('vendors mutations error codes (issue #2004)', () => {
  describe('client-callable mutations.ts', () => {
    it('updateVendor throws VENDOR_NOT_FOUND ConvexError when vendor is missing', async () => {
      const ctx = {
        db: { get: vi.fn().mockResolvedValue(null) },
      };
      const err = await captureError(mutations.updateVendor, ctx, {
        vendorId: 'v1',
        name: 'New',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('VENDOR_NOT_FOUND');
    });

    it('updateVendor throws DUPLICATE_EMAIL ConvexError on email conflict', async () => {
      const existing = {
        _id: 'v1',
        organizationId: 'org1',
        email: 'old@example.com',
      };
      const conflict = { _id: 'v2' };
      const ctx = {
        db: {
          get: vi.fn().mockResolvedValue(existing),
          query: vi.fn().mockReturnValue(makeQueryBuilder(conflict)),
        },
      };
      const err = await captureError(mutations.updateVendor, ctx, {
        vendorId: 'v1',
        email: 'new@example.com',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('DUPLICATE_EMAIL');
    });

    it('updateVendor throws DUPLICATE_EXTERNAL_ID ConvexError on externalId conflict', async () => {
      const existing = {
        _id: 'v1',
        organizationId: 'org1',
        externalId: 'ext-old',
      };
      const conflict = { _id: 'v2' };
      const ctx = {
        db: {
          get: vi.fn().mockResolvedValue(existing),
          query: vi.fn().mockReturnValue(makeQueryBuilder(conflict)),
        },
      };
      const err = await captureError(mutations.updateVendor, ctx, {
        vendorId: 'v1',
        externalId: 'ext-new',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('DUPLICATE_EXTERNAL_ID');
    });

    it('deleteVendor throws VENDOR_NOT_FOUND ConvexError when vendor is missing', async () => {
      const ctx = {
        db: { get: vi.fn().mockResolvedValue(null) },
      };
      const err = await captureError(mutations.deleteVendor, ctx, {
        vendorId: 'v1',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('VENDOR_NOT_FOUND');
    });
  });

  describe('REST-path internal_mutations.ts', () => {
    it('updateVendor throws VENDOR_NOT_FOUND ConvexError when vendor is missing', async () => {
      const ctx = {
        db: { get: vi.fn().mockResolvedValue(null) },
      };
      const err = await captureError(internalMutations.updateVendor, ctx, {
        vendorId: 'v1',
        name: 'New',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('VENDOR_NOT_FOUND');
    });

    it('updateVendor throws VENDOR_NOT_FOUND ConvexError on cross-tenant access', async () => {
      const existing = { _id: 'v1', organizationId: 'org1' };
      const ctx = {
        db: { get: vi.fn().mockResolvedValue(existing) },
      };
      const err = await captureError(internalMutations.updateVendor, ctx, {
        vendorId: 'v1',
        name: 'New',
        callerOrgId: 'org2',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('VENDOR_NOT_FOUND');
    });

    it('updateVendor throws DUPLICATE_EMAIL ConvexError on email conflict', async () => {
      const existing = {
        _id: 'v1',
        organizationId: 'org1',
        email: 'old@example.com',
      };
      const conflict = { _id: 'v2' };
      const ctx = {
        db: {
          get: vi.fn().mockResolvedValue(existing),
          query: vi.fn().mockReturnValue(makeQueryBuilder(conflict)),
        },
      };
      const err = await captureError(internalMutations.updateVendor, ctx, {
        vendorId: 'v1',
        email: 'new@example.com',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('DUPLICATE_EMAIL');
    });

    it('updateVendor throws DUPLICATE_EXTERNAL_ID ConvexError on externalId conflict', async () => {
      const existing = {
        _id: 'v1',
        organizationId: 'org1',
        externalId: 'ext-old',
      };
      const conflict = { _id: 'v2' };
      const ctx = {
        db: {
          get: vi.fn().mockResolvedValue(existing),
          query: vi.fn().mockReturnValue(makeQueryBuilder(conflict)),
        },
      };
      const err = await captureError(internalMutations.updateVendor, ctx, {
        vendorId: 'v1',
        externalId: 'ext-new',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('DUPLICATE_EXTERNAL_ID');
    });

    it('deleteVendor throws VENDOR_NOT_FOUND ConvexError when vendor is missing', async () => {
      const ctx = {
        db: { get: vi.fn().mockResolvedValue(null) },
      };
      const err = await captureError(internalMutations.deleteVendor, ctx, {
        vendorId: 'v1',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('VENDOR_NOT_FOUND');
    });

    it('deleteVendor throws VENDOR_NOT_FOUND ConvexError on cross-tenant access', async () => {
      const existing = { _id: 'v1', organizationId: 'org1' };
      const ctx = {
        db: { get: vi.fn().mockResolvedValue(existing) },
      };
      const err = await captureError(internalMutations.deleteVendor, ctx, {
        vendorId: 'v1',
        callerOrgId: 'org2',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('VENDOR_NOT_FOUND');
    });
  });
});
