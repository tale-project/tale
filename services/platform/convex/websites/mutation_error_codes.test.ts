// Regression gate for issue #2003 — websites mutations must throw structured
// `ConvexError` (not raw `Error`) for not-found and conflict cases so
// `withRestAuth` can map them to 404/409 and the UI gets actionable error
// codes instead of opaque 500s.
//
// The business-logic helpers are plain `(ctx, args)` functions whose
// not-found / conflict guards run before any side effect (`db.patch`,
// `db.insert`), so they are unit-testable with a minimal mock ctx and the
// real `ConvexError`.

import { ConvexError } from 'convex/values';
import { describe, it, expect, vi } from 'vitest';

import type { MutationCtx } from '../_generated/server';
import { bulkCreateWebsites } from './bulk_create_websites';
import { deleteWebsite } from './delete_website';
import { updateWebsite } from './update_website';

// Run a handler and return whatever it throws (or null if it resolves).
async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
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
  return {
    withIndex: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(firstResult),
  };
}

// oxlint-disable-next-line typescript/no-explicit-any -- a partial mock ctx is all the guards under test touch
function asCtx(value: unknown): MutationCtx {
  return value as MutationCtx;
}

describe('websites mutations error codes (issue #2003)', () => {
  describe('updateWebsite', () => {
    it('throws WEBSITE_NOT_FOUND when the website is missing', async () => {
      const ctx = asCtx({ db: { get: vi.fn().mockResolvedValue(null) } });
      const err = await captureError(() =>
        // oxlint-disable-next-line typescript/no-explicit-any -- branded Id not needed for this guard
        updateWebsite(ctx, { websiteId: 'w1' as any, title: 'New' }),
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('WEBSITE_NOT_FOUND');
    });

    it('throws WEBSITE_NOT_FOUND on cross-tenant access', async () => {
      const existing = { _id: 'w1', organizationId: 'org1' };
      const ctx = asCtx({ db: { get: vi.fn().mockResolvedValue(existing) } });
      const err = await captureError(() =>
        updateWebsite(ctx, {
          // oxlint-disable-next-line typescript/no-explicit-any -- branded Id not needed for this guard
          websiteId: 'w1' as any,
          title: 'New',
          callerOrgId: 'org2',
        }),
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('WEBSITE_NOT_FOUND');
    });

    it('throws DUPLICATE_DOMAIN when another website owns the new domain', async () => {
      const existing = {
        _id: 'w1',
        organizationId: 'org1',
        domain: 'old.example.com',
      };
      const conflict = { _id: 'w2' };
      const ctx = asCtx({
        db: {
          get: vi.fn().mockResolvedValue(existing),
          query: vi.fn().mockReturnValue(makeQueryBuilder(conflict)),
        },
      });
      const err = await captureError(() =>
        updateWebsite(ctx, {
          // oxlint-disable-next-line typescript/no-explicit-any -- branded Id not needed for this guard
          websiteId: 'w1' as any,
          domain: 'new.example.com',
        }),
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('DUPLICATE_DOMAIN');
    });
  });

  describe('deleteWebsite', () => {
    it('throws WEBSITE_NOT_FOUND when the website is missing', async () => {
      const ctx = asCtx({ db: { get: vi.fn().mockResolvedValue(null) } });
      const err = await captureError(() =>
        // oxlint-disable-next-line typescript/no-explicit-any -- branded Id not needed for this guard
        deleteWebsite(ctx, 'w1' as any),
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('WEBSITE_NOT_FOUND');
    });
  });

  describe('bulkCreateWebsites', () => {
    // The per-row guard throws a DUPLICATE_DOMAIN ConvexError that the loop
    // catches and records into `errors[].error`; assert the message still
    // surfaces so the structured throw didn't break the bulk reporting.
    it('records a duplicate-domain failure for an existing domain', async () => {
      const ctx = asCtx({
        db: {
          query: vi.fn().mockReturnValue(makeQueryBuilder({ _id: 'w1' })),
          insert: vi.fn(),
        },
      });

      const result = await bulkCreateWebsites(ctx, {
        organizationId: 'org1',
        websites: [
          // oxlint-disable-next-line typescript/no-explicit-any -- only `domain` is read by the guard under test
          { domain: 'dup.example.com' } as any,
        ],
      });

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors[0]?.error).toContain('already exists');
    });
  });
});
