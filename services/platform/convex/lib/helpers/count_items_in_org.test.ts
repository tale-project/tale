import { describe, expect, it, vi } from 'vitest';

import type { DatabaseReader } from '../../_generated/server';

import { countItemsInOrg } from './count_items_in_org';

function createMockDb(itemCount: number) {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    _id: `id_${i}`,
  }));

  const builder = {
    withIndex: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: () => {
        let index = 0;
        return {
          next: () => {
            if (index < items.length) {
              return Promise.resolve({ value: items[index++], done: false });
            }
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    }),
  };

  const db = {
    query: vi.fn().mockReturnValue(builder),
  };

  return { db, builder };
}

describe('countItemsInOrg', () => {
  it('returns 0 for empty table', async () => {
    const { db } = createMockDb(0);

    const count = await countItemsInOrg(
      db as unknown as DatabaseReader,
      'customers',
      'org_1',
    );

    expect(count).toBe(0);
  });

  it('returns exact count when below cap', async () => {
    const { db } = createMockDb(5);

    const count = await countItemsInOrg(
      db as unknown as DatabaseReader,
      'customers',
      'org_1',
    );

    expect(count).toBe(5);
  });

  it('caps at default 20', async () => {
    const { db } = createMockDb(100);

    const count = await countItemsInOrg(
      db as unknown as DatabaseReader,
      'customers',
      'org_1',
    );

    expect(count).toBe(20);
  });

  it('respects custom cap', async () => {
    const { db } = createMockDb(100);

    const count = await countItemsInOrg(
      db as unknown as DatabaseReader,
      'customers',
      'org_1',
      5,
    );

    expect(count).toBe(5);
  });

  it('queries the correct table', async () => {
    const { db } = createMockDb(1);

    await countItemsInOrg(db as unknown as DatabaseReader, 'products', 'org_1');

    expect(db.query).toHaveBeenCalledWith('products');
  });

  it('uses by_organizationId index', async () => {
    const { db, builder } = createMockDb(1);

    await countItemsInOrg(db as unknown as DatabaseReader, 'vendors', 'org_1');

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId',
      expect.any(Function),
    );
  });
});
