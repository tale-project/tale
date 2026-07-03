// Regression gate for issue #2003 — customers mutations must throw structured
// `ConvexError` (not raw `Error`) for not-found, conflict, and validation
// cases so `withRestAuth` can map them to 404/409/400 and the UI gets
// actionable error codes instead of opaque 500s.
//
// The business-logic helpers are plain `(ctx, args)` functions whose
// not-found / conflict guards run before any side effect (`emitEvent`,
// `assertNotHeld`, `db.patch`), so they are unit-testable with a minimal
// mock ctx and the real `ConvexError`.

import { ConvexError } from 'convex/values';
import { describe, it, expect, vi } from 'vitest';

import type { MutationCtx } from '../_generated/server';
import { deleteCustomer } from './delete_customer';
import { updateCustomer } from './update_customer';
import { updateCustomerMetadata } from './update_customer_metadata';
import { updateCustomers } from './update_customers';

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

describe('customers mutations error codes (issue #2003)', () => {
  describe('updateCustomer', () => {
    it('throws CUSTOMER_NOT_FOUND when the customer is missing', async () => {
      const ctx = asCtx({ db: { get: vi.fn().mockResolvedValue(null) } });
      const err = await captureError(() =>
        // oxlint-disable-next-line typescript/no-explicit-any -- branded Id not needed for this guard
        updateCustomer(ctx, { customerId: 'c1' as any, name: 'New' }),
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('CUSTOMER_NOT_FOUND');
    });

    it('throws DUPLICATE_EMAIL on an email conflict with another customer', async () => {
      const existing = {
        _id: 'c1',
        organizationId: 'org1',
        email: 'old@example.com',
      };
      const conflict = { _id: 'c2' };
      const ctx = asCtx({
        db: {
          get: vi.fn().mockResolvedValue(existing),
          query: vi.fn().mockReturnValue(makeQueryBuilder(conflict)),
        },
      });
      const err = await captureError(() =>
        updateCustomer(ctx, {
          // oxlint-disable-next-line typescript/no-explicit-any -- branded Id not needed for this guard
          customerId: 'c1' as any,
          email: 'new@example.com',
        }),
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('DUPLICATE_EMAIL');
    });

    it('throws DUPLICATE_EXTERNAL_ID on an externalId conflict', async () => {
      const existing = {
        _id: 'c1',
        organizationId: 'org1',
        externalId: 'ext-old',
      };
      const conflict = { _id: 'c2' };
      const ctx = asCtx({
        db: {
          get: vi.fn().mockResolvedValue(existing),
          query: vi.fn().mockReturnValue(makeQueryBuilder(conflict)),
        },
      });
      const err = await captureError(() =>
        updateCustomer(ctx, {
          // oxlint-disable-next-line typescript/no-explicit-any -- branded Id not needed for this guard
          customerId: 'c1' as any,
          externalId: 'ext-new',
        }),
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('DUPLICATE_EXTERNAL_ID');
    });
  });

  describe('updateCustomers', () => {
    it('throws MISSING_FILTER when neither customerId nor organizationId given', async () => {
      const ctx = asCtx({ db: {} });
      const err = await captureError(() =>
        updateCustomers(ctx, { updates: {} }),
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('MISSING_FILTER');
    });

    it('throws CUSTOMER_NOT_FOUND when the id-targeted customer is missing', async () => {
      const ctx = asCtx({ db: { get: vi.fn().mockResolvedValue(null) } });
      const err = await captureError(() =>
        // oxlint-disable-next-line typescript/no-explicit-any -- branded Id not needed for this guard
        updateCustomers(ctx, { customerId: 'c1' as any, updates: {} }),
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('CUSTOMER_NOT_FOUND');
    });

    it('throws CUSTOMER_NOT_FOUND on cross-tenant access', async () => {
      const existing = { _id: 'c1', organizationId: 'org1' };
      const ctx = asCtx({ db: { get: vi.fn().mockResolvedValue(existing) } });
      const err = await captureError(() =>
        updateCustomers(ctx, {
          // oxlint-disable-next-line typescript/no-explicit-any -- branded Id not needed for this guard
          customerId: 'c1' as any,
          organizationId: 'org2',
          updates: {},
        }),
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('CUSTOMER_NOT_FOUND');
    });
  });

  describe('updateCustomerMetadata', () => {
    it('throws CUSTOMER_NOT_FOUND when the customer is missing', async () => {
      const ctx = asCtx({ db: { get: vi.fn().mockResolvedValue(null) } });
      const err = await captureError(() =>
        // oxlint-disable-next-line typescript/no-explicit-any -- branded Id not needed for this guard
        updateCustomerMetadata(ctx, 'c1' as any, { foo: 'bar' }),
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('CUSTOMER_NOT_FOUND');
    });
  });

  describe('deleteCustomer', () => {
    it('throws CUSTOMER_NOT_FOUND when the customer is missing', async () => {
      const ctx = asCtx({ db: { get: vi.fn().mockResolvedValue(null) } });
      const err = await captureError(() =>
        // oxlint-disable-next-line typescript/no-explicit-any -- branded Id not needed for this guard
        deleteCustomer(ctx, 'c1' as any),
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('CUSTOMER_NOT_FOUND');
    });
  });
});
