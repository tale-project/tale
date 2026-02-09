import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export interface UpsertProductTranslationArgs {
  productId: Id<'products'>;
  language: string;
  name?: string;
  description?: string;
  category?: string;
  tags?: Array<string>;
  metadata?: unknown;
}

export async function upsertProductTranslation(
  ctx: MutationCtx,
  args: UpsertProductTranslationArgs,
): Promise<Id<'products'>> {
  const product = await ctx.db.get(args.productId);
  if (!product) {
    throw new Error('Product not found');
  }

  const now = Date.now();
  const translations = [...(product.translations || [])];

  const existingIndex = translations.findIndex(
    (t) => t.language === args.language,
  );

  const newTranslation = {
    language: args.language,
    name: args.name,
    description: args.description,
    category: args.category,
    tags: args.tags,
    metadata: args.metadata,
    lastUpdated: now,
    createdAt: existingIndex >= 0 ? translations[existingIndex].createdAt : now,
  };

  if (existingIndex >= 0) {
    translations[existingIndex] = newTranslation;
  } else {
    translations.push(newTranslation);
  }

  await ctx.db.patch(args.productId, {
    translations: translations as typeof product.translations,
    lastUpdated: now,
  });

  return args.productId;
}
