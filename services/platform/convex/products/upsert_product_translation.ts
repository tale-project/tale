/**
 * Upsert a product translation (create or update) (public API)
 */

import { MutationCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';

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
  const translations = product.translations || [];

  // Find existing translation for this language
  const existingIndex = translations.findIndex(
    (t: { language: string }) => t.language === args.language,
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
    // Update existing translation
    translations[existingIndex] = newTranslation;
  } else {
    // Add new translation
    translations.push(newTranslation);
  }

  await ctx.db.patch(args.productId, {
    translations,
    lastUpdated: now,
  });

  return args.productId;
}

