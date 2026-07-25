// searchTerm on queryProducts — the products counterpart of queryContacts'
// search: case-insensitive contains over name/description/category/tags/
// externalId and the per-language translations. Exercised over a fake
// async-iterable db so the in-memory filter (paginateWithFilter path) and the
// externalId-array path are both locked.

import { describe, expect, it } from 'vitest';

import type { QueryCtx } from '../_generated/server';
import { queryProducts } from './query_products';

type FakeProduct = Record<string, unknown>;

function fakeCtx(products: FakeProduct[]): QueryCtx {
  const iterable = {
    async *[Symbol.asyncIterator]() {
      for (const row of products) yield row;
    },
  };
  const afterIndex = {
    order: () => iterable,
    first: () => Promise.resolve(products[0] ?? null),
  };
  return {
    db: { query: () => ({ withIndex: () => afterIndex }) },
  } as unknown as QueryCtx;
}

function product(overrides: FakeProduct): FakeProduct {
  return {
    _id: `p_${String(overrides.name)}`,
    _creationTime: 1,
    organizationId: 'org_1',
    ...overrides,
  };
}

const PAGE = { numItems: 20, cursor: null };

describe('queryProducts searchTerm', () => {
  it('matches name case-insensitively and drops the rest', async () => {
    const ctx = fakeCtx([
      product({ name: 'Blue Chair' }),
      product({ name: 'Red Table' }),
    ]);
    const result = await queryProducts(ctx, {
      organizationId: 'org_1',
      searchTerm: 'blue',
      paginationOpts: PAGE,
    });
    expect(result.page.map((p) => p.name)).toEqual(['Blue Chair']);
  });

  it('matches description, category, tags and externalId', async () => {
    const ctx = fakeCtx([
      product({ name: 'A', description: 'ergonomic mesh back' }),
      product({ name: 'B', category: 'Office-Mesh' }),
      product({ name: 'C', tags: ['mesh', 'chair'] }),
      product({ name: 'D', externalId: 'MESH-001' }),
      product({ name: 'E' }),
    ]);
    const result = await queryProducts(ctx, {
      organizationId: 'org_1',
      searchTerm: 'mesh',
      paginationOpts: PAGE,
    });
    expect(result.page.map((p) => p.name)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('matches translated names and descriptions', async () => {
    const ctx = fakeCtx([
      product({
        name: 'Desk',
        translations: [
          { language: 'de', name: 'Schreibtisch', lastUpdated: 1 },
        ],
      }),
      product({ name: 'Lamp' }),
    ]);
    const result = await queryProducts(ctx, {
      organizationId: 'org_1',
      searchTerm: 'schreib',
      paginationOpts: PAGE,
    });
    expect(result.page.map((p) => p.name)).toEqual(['Desk']);
  });

  it('a blank searchTerm filters nothing', async () => {
    const ctx = fakeCtx([product({ name: 'A' }), product({ name: 'B' })]);
    const result = await queryProducts(ctx, {
      organizationId: 'org_1',
      searchTerm: '   ',
      paginationOpts: PAGE,
    });
    expect(result.page).toHaveLength(2);
  });

  it('applies to the externalId-array path too', async () => {
    const ctx = fakeCtx([product({ name: 'Red Chair', externalId: 'X1' })]);
    const miss = await queryProducts(ctx, {
      organizationId: 'org_1',
      externalId: ['X1'],
      searchTerm: 'blue',
      paginationOpts: PAGE,
    });
    expect(miss.page).toHaveLength(0);
    const hit = await queryProducts(ctx, {
      organizationId: 'org_1',
      externalId: ['X1'],
      searchTerm: 'red',
      paginationOpts: PAGE,
    });
    expect(hit.page.map((p) => p.name)).toEqual(['Red Chair']);
  });
});
