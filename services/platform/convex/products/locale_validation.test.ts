import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { createProductWithTranslations } from './create_product_with_translations';
import { assertSupportedProductLocale } from './locale_validation';
import { updateProduct } from './update_product';
import { upsertProductTranslation } from './upsert_product_translation';

describe('assertSupportedProductLocale', () => {
  it('accepts every supported locale', () => {
    for (const locale of ['en', 'de', 'fr']) {
      expect(() => assertSupportedProductLocale(locale)).not.toThrow();
    }
  });

  it.each(['xyz', 'not-a-locale', 'EN', 'en-US', '', 'x'.repeat(10_000)])(
    'rejects unsupported locale %p with a AppError',
    (locale) => {
      expect(() => assertSupportedProductLocale(locale)).toThrow(AppError);
    },
  );

  it('includes the rejected value and the whitelist in the error', () => {
    try {
      assertSupportedProductLocale('klingon');
      throw new Error('expected assertSupportedProductLocale to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const data = (error as AppError<{ code: string; message: string }>).data;
      expect(data.code).toBe('invalid_locale');
      expect(data.message).toContain('klingon');
      expect(data.message).toContain('en, de, fr');
    }
  });
});

const PRODUCT_ID = 'product_1' as Id<'products'>;

function createMockMutationCtx(existing?: Record<string, unknown>) {
  const db = {
    get: vi.fn().mockResolvedValue(existing ?? null),
    insert: vi.fn().mockResolvedValue(PRODUCT_ID),
    patch: vi.fn().mockResolvedValue(undefined),
  };
  return { ctx: { db } as unknown as MutationCtx, db };
}

describe('product translation handlers reject unsupported locales', () => {
  it('upsertProductTranslation throws before touching the database', async () => {
    const { ctx, db } = createMockMutationCtx();

    await expect(
      upsertProductTranslation(ctx, {
        productId: PRODUCT_ID,
        language: 'not-a-locale',
        name: 'Test',
      }),
    ).rejects.toBeInstanceOf(AppError);

    expect(db.get).not.toHaveBeenCalled();
    expect(db.patch).not.toHaveBeenCalled();
  });

  it('createProductWithTranslations throws before inserting', async () => {
    const { ctx, db } = createMockMutationCtx();

    await expect(
      createProductWithTranslations(ctx, {
        organizationId: 'org_1',
        name: 'Widget',
        translations: [{ language: 'xyz', lastUpdated: 1 }],
      }),
    ).rejects.toBeInstanceOf(AppError);

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('updateProduct throws before patching', async () => {
    const { ctx, db } = createMockMutationCtx({ translations: [] });

    await expect(
      updateProduct(ctx, {
        productId: PRODUCT_ID,
        translations: [{ language: 'xyz', lastUpdated: 1 }],
      }),
    ).rejects.toBeInstanceOf(AppError);

    expect(db.patch).not.toHaveBeenCalled();
  });
});

describe('product translation handlers accept supported locales', () => {
  it('upsertProductTranslation persists a supported locale', async () => {
    const { ctx, db } = createMockMutationCtx({ translations: [] });

    await expect(
      upsertProductTranslation(ctx, {
        productId: PRODUCT_ID,
        language: 'de',
        name: 'Test',
      }),
    ).resolves.toBe(PRODUCT_ID);

    expect(db.patch).toHaveBeenCalledTimes(1);
  });

  it('createProductWithTranslations inserts with a supported locale', async () => {
    const { ctx, db } = createMockMutationCtx();

    await expect(
      createProductWithTranslations(ctx, {
        organizationId: 'org_1',
        name: 'Widget',
        translations: [{ language: 'fr', lastUpdated: 1 }],
      }),
    ).resolves.toBe(PRODUCT_ID);

    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});
