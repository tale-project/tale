import { convexTest, type TestConvex } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { createProduct } from './create_product';
import { createProductWithTranslations } from './create_product_with_translations';
import { updateProduct } from './update_product';
import { updateProducts } from './update_products';

// convex-test module map keyed relative to the convex/ root. This file lives at
// convex/products/, so resolve glob keys against that base (mirrors
// tasks/internal_mutations.test.ts).
const TEST_DIR_FROM_CONVEX_ROOT = 'products';
function toConvexRootKey(globKey: string): string {
  const stack: Array<string> = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_product_name_validation';
type T = TestConvex<typeof schema>;

function seedProduct(t: T, name: string): Promise<Id<'products'>> {
  return t.run((ctx) =>
    ctx.db.insert('products', {
      organizationId: ORG,
      name,
      lastUpdated: 0,
    }),
  );
}

/**
 * Assert a thrown error is the `validation` ConvexError for a blank name.
 *
 * convex-test serializes `ConvexError.data` across the function boundary, so we
 * assert the surfaced message carries both the `validation` code (→ REST 400)
 * and the required-name text rather than deep-equalling the data object.
 */
async function expectRequiredNameRejection(
  run: () => Promise<unknown>,
): Promise<void> {
  await expect(run()).rejects.toThrowError(ConvexError);
  await expect(run()).rejects.toThrowError('Product name is required');
  await expect(run()).rejects.toThrowError('validation');
}

// Regression guard for issue #2072: every non-UI product write path must reject
// an empty / whitespace-only name server-side, not just the UI dialogs. If a
// future edit drops a `validateProductName(...)` call-site, one of these fails.
describe('product write paths reject a blank name', () => {
  it.each(['', '   ', '\t\n '])('createProduct rejects %j', async (name) => {
    const t = convexTest(schema, modules);
    await expectRequiredNameRejection(() =>
      t.run((ctx) => createProduct(ctx, { organizationId: ORG, name })),
    );
  });

  it.each(['', '   ', '\t\n '])(
    'createProductWithTranslations rejects %j',
    async (name) => {
      const t = convexTest(schema, modules);
      await expectRequiredNameRejection(() =>
        t.run((ctx) =>
          createProductWithTranslations(ctx, { organizationId: ORG, name }),
        ),
      );
    },
  );

  it.each(['', '   ', '\t\n '])(
    'updateProduct cannot clear the name to %j',
    async (name) => {
      const t = convexTest(schema, modules);
      const productId = await seedProduct(t, 'Original');
      await expectRequiredNameRejection(() =>
        t.run((ctx) => updateProduct(ctx, { productId, name })),
      );
      // The original name must be untouched after the rejected update.
      const after = await t.run((ctx) => ctx.db.get(productId));
      expect(after?.name).toBe('Original');
    },
  );

  it.each(['', '   ', '\t\n '])(
    'updateProducts (REST PATCH / agent / workflow path) cannot clear the name to %j',
    async (name) => {
      const t = convexTest(schema, modules);
      const productId = await seedProduct(t, 'Original');
      await expectRequiredNameRejection(() =>
        t.run((ctx) => updateProducts(ctx, { productId, updates: { name } })),
      );
      const after = await t.run((ctx) => ctx.db.get(productId));
      expect(after?.name).toBe('Original');
    },
  );

  it('createProduct persists the trimmed name for valid input', async () => {
    const t = convexTest(schema, modules);
    const result = await t.run((ctx) =>
      createProduct(ctx, { organizationId: ORG, name: '  Widget  ' }),
    );
    const doc = await t.run((ctx) => ctx.db.get(result.productId));
    expect(doc?.name).toBe('Widget');
  });
});
