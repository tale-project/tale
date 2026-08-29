// Word matching runs ALONGSIDE an entity's existing phrase match, never
// instead of it. These cases pin both halves of that: the words a question
// should find, and the fields the phrase check is still solely responsible for.

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../_generated/api';
import schema from '../../schema';

const rawModules = import.meta.glob('../../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  const stack: string[] = [];
  for (const part of `lib/search/${key}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  modules[stack.join('/')] = loader;
}

const ORG = 'org_word_match';

async function seedProduct(
  t: ReturnType<typeof convexTest>,
  fields: Record<string, unknown>,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('products', {
      organizationId: ORG,
      name: 'Placeholder',
      status: 'active',
      ...fields,
    } as never);
  });
}

async function searchProducts(
  t: ReturnType<typeof convexTest>,
  searchTerm: string,
  matchWords?: boolean,
) {
  const result = await t.query(
    internal.products.internal_queries.queryProducts,
    {
      organizationId: ORG,
      searchTerm,
      ...(matchWords !== undefined ? { matchWords } : {}),
      paginationOpts: { numItems: 20, cursor: null },
    },
  );
  return result.page.map((p: { name: string }) => p.name);
}

describe('products search — words alongside the phrase', () => {
  it('finds a product from a multi-word question', async () => {
    // The whole question as one substring matches nothing, which is the bug.
    const t = convexTest(schema, modules);
    await seedProduct(t, { name: 'Red Running Shoes' });
    expect(
      await searchProducts(t, 'do we have red running shoes', true),
    ).toEqual(['Red Running Shoes']);
  });

  it('finds nothing for the same question without opting in', async () => {
    // The products page keeps today's behaviour, so this must stay a miss.
    const t = convexTest(schema, modules);
    await seedProduct(t, { name: 'Red Running Shoes' });
    expect(await searchProducts(t, 'do we have red running shoes')).toEqual([]);
  });

  it('still finds a product by its TRANSLATED name', async () => {
    // The reason both checks run. This field is not in the word-match config,
    // so only the phrase check can reach it — swapping instead of adding would
    // have silently lost this.
    const t = convexTest(schema, modules);
    await seedProduct(t, {
      name: 'Running Shoes',
      translations: [{ language: 'de', name: 'Laufschuhe', lastUpdated: 0 }],
    });
    expect(await searchProducts(t, 'Laufschuhe', true)).toEqual([
      'Running Shoes',
    ]);
  });

  it('still finds a product by its translated DESCRIPTION', async () => {
    const t = convexTest(schema, modules);
    await seedProduct(t, {
      name: 'Running Shoes',
      translations: [
        { language: 'de', description: 'Bequeme Sportschuhe', lastUpdated: 0 },
      ],
    });
    expect(await searchProducts(t, 'Bequeme Sportschuhe', true)).toEqual([
      'Running Shoes',
    ]);
  });

  it('does not match on a stopword alone', async () => {
    // `any` mode drops stopwords, or every question would match everything.
    const t = convexTest(schema, modules);
    await seedProduct(t, { name: 'Running Shoes' });
    expect(await searchProducts(t, 'do we have the', true)).toEqual([]);
  });

  it('does not match a mid-word fragment', async () => {
    // `any` requires a word START. Without that floor, "ad" would pull in
    // every product containing "overhead".
    const t = convexTest(schema, modules);
    await seedProduct(t, { name: 'Overhead Projector' });
    expect(await searchProducts(t, 'ad projector', true)).toContain(
      'Overhead Projector',
    );
    expect(await searchProducts(t, 'ad lamp', true)).toEqual([]);
  });

  it('applies to the externalId-array path too', async () => {
    // `queryProducts` filters in memory when `externalId` is an array, a
    // separate branch from the paginated walk. Both thread the word term, and
    // only this case exercises the first.
    const t = convexTest(schema, modules);
    await seedProduct(t, { name: 'Red Running Shoes', externalId: 'SKU-1' });
    await seedProduct(t, { name: 'Blue Hat', externalId: 'SKU-2' });
    const result = await t.query(
      internal.products.internal_queries.queryProducts,
      {
        organizationId: ORG,
        externalId: ['SKU-1', 'SKU-2'],
        searchTerm: 'do we have red running shoes',
        matchWords: true,
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(result.page.map((p: { name: string }) => p.name)).toEqual([
      'Red Running Shoes',
    ]);
  });
});
