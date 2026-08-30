import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { updateProducts } from './update_products';

type MockProduct = {
  _id: string;
  organizationId: string;
  name: string;
  status?: string;
  category?: string;
  externalId?: string | number;
  metadata?: Record<string, unknown>;
};

/**
 * A `ctx` whose `db.get` resolves products by id and whose
 * `by_organizationId` scan (used both to resolve batch targets and by
 * `assertUniqueProductName`) yields the given org rows.
 */
function createMockCtx(products: Array<MockProduct>) {
  const byId = new Map(products.map((p) => [p._id, p]));
  const builder = {
    withIndex: vi.fn().mockReturnValue({
      async *[Symbol.asyncIterator]() {
        for (const doc of products) yield doc;
      },
    }),
  };
  const patch = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    db: {
      get: vi.fn(async (id: string) => byId.get(id) ?? null),
      query: vi.fn().mockReturnValue(builder),
      patch,
    },
  };
  return { ctx, patch };
}

describe('updateProducts — name uniqueness on the non-UI path', () => {
  it('throws DUPLICATE_PRODUCT_NAME when renaming a product to an existing name', async () => {
    const { ctx, patch } = createMockCtx([
      { _id: 'p_1', organizationId: 'org_1', name: 'Widget' },
      { _id: 'p_2', organizationId: 'org_1', name: 'Gadget' },
    ]);

    await expect(
      updateProducts(ctx as unknown as MutationCtx, {
        productId: 'p_1' as Id<'products'>,
        updates: { name: 'Gadget' },
      }),
    ).rejects.toMatchObject({ data: { code: 'DUPLICATE_PRODUCT_NAME' } });

    expect(patch).not.toHaveBeenCalled();
  });

  it('allows a rename that keeps the same name (self excluded)', async () => {
    const { ctx, patch } = createMockCtx([
      { _id: 'p_1', organizationId: 'org_1', name: 'Widget' },
    ]);

    const result = await updateProducts(ctx as unknown as MutationCtx, {
      productId: 'p_1' as Id<'products'>,
      updates: { name: '  Widget ' },
    });

    expect(result.success).toBe(true);
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('allows a rename to a fresh, unused name', async () => {
    const { ctx, patch } = createMockCtx([
      { _id: 'p_1', organizationId: 'org_1', name: 'Widget' },
      { _id: 'p_2', organizationId: 'org_1', name: 'Gadget' },
    ]);

    const result = await updateProducts(ctx as unknown as MutationCtx, {
      productId: 'p_1' as Id<'products'>,
      updates: { name: 'Doohickey' },
    });

    expect(result.success).toBe(true);
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('rejects renaming a whole batch to one name (would self-collide)', async () => {
    const { ctx, patch } = createMockCtx([
      { _id: 'p_1', organizationId: 'org_1', name: 'Widget' },
      { _id: 'p_2', organizationId: 'org_1', name: 'Gadget' },
    ]);

    await expect(
      updateProducts(ctx as unknown as MutationCtx, {
        organizationId: 'org_1',
        updates: { name: 'Merged' },
      }),
    ).rejects.toBeInstanceOf(AppError);

    expect(patch).not.toHaveBeenCalled();
  });

  it('does not run the uniqueness check when no name change is requested', async () => {
    const { ctx, patch } = createMockCtx([
      { _id: 'p_1', organizationId: 'org_1', name: 'Widget' },
    ]);

    const result = await updateProducts(ctx as unknown as MutationCtx, {
      productId: 'p_1' as Id<'products'>,
      updates: { price: 42 },
    });

    expect(result.success).toBe(true);
    expect(patch).toHaveBeenCalledTimes(1);
  });
});
