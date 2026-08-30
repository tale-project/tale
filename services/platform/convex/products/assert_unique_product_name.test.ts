import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { assertUniqueProductName } from './assert_unique_product_name';

/** A `db` whose `by_organizationId` scan yields the given product rows. */
function createMockCtx(documents: Array<{ _id: string; name: string }>) {
  const builder = {
    withIndex: vi.fn().mockReturnValue({
      async *[Symbol.asyncIterator]() {
        for (const doc of documents) yield doc;
      },
    }),
  };
  const ctx = {
    db: { query: vi.fn().mockReturnValue(builder) },
  };
  return { ctx, builder };
}

describe('assertUniqueProductName', () => {
  it('passes when no product shares the name', async () => {
    const { ctx } = createMockCtx([
      { _id: 'p_1', name: 'Widget' },
      { _id: 'p_2', name: 'Gadget' },
    ]);

    await expect(
      assertUniqueProductName(
        ctx as unknown as MutationCtx,
        'org_1',
        'Doohickey',
      ),
    ).resolves.toBeUndefined();
  });

  it('throws DUPLICATE_PRODUCT_NAME on a case-insensitive, trimmed collision', async () => {
    const { ctx } = createMockCtx([{ _id: 'p_1', name: 'Widget' }]);

    await expect(
      assertUniqueProductName(
        ctx as unknown as MutationCtx,
        'org_1',
        '  widget ',
      ),
    ).rejects.toMatchObject({
      data: { code: 'DUPLICATE_PRODUCT_NAME' },
    });
  });

  it('excludes the row being renamed so an in-place edit keeping the name passes', async () => {
    const { ctx } = createMockCtx([{ _id: 'p_1', name: 'Widget' }]);

    await expect(
      assertUniqueProductName(
        ctx as unknown as MutationCtx,
        'org_1',
        'Widget',
        'p_1' as Id<'products'>,
      ),
    ).resolves.toBeUndefined();
  });

  it('still rejects a collision with a DIFFERENT row when excluding self', async () => {
    const { ctx } = createMockCtx([
      { _id: 'p_1', name: 'Widget' },
      { _id: 'p_2', name: 'Gadget' },
    ]);

    await expect(
      assertUniqueProductName(
        ctx as unknown as MutationCtx,
        'org_1',
        'Gadget',
        'p_1' as Id<'products'>,
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('skips the scan for an empty/whitespace name', async () => {
    const { ctx, builder } = createMockCtx([{ _id: 'p_1', name: 'Widget' }]);

    await assertUniqueProductName(
      ctx as unknown as MutationCtx,
      'org_1',
      '   ',
    );

    expect(builder.withIndex).not.toHaveBeenCalled();
  });
});
