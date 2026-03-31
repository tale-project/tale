import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { MutationCtx } from '../../_generated/server';

vi.mock('../../lib/rls', () => ({
  getAuthUserIdentity: vi.fn().mockResolvedValue({ userId: 'user_1' }),
}));

vi.mock('../../lib/rls/auth/get_trusted_auth_data', () => ({
  getTrustedAuthData: vi.fn().mockResolvedValue({ trustedRole: 'admin' }),
}));

const { upsertBrandingBindingsHandler } = await import('../mutations');

function createMockMutationCtx(
  existingDoc: Record<string, unknown> | null = null,
) {
  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(existingDoc),
  };

  const ctx = {
    db: {
      query: vi.fn().mockReturnValue(builder),
      insert: vi.fn().mockResolvedValue('binding_new'),
      patch: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };

  return { ctx, builder };
}

describe('upsertBrandingBindingsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts new bindings with global key when none exist', async () => {
    const { ctx } = createMockMutationCtx(null);

    await upsertBrandingBindingsHandler(ctx as unknown as MutationCtx, {
      logoStorageId: 'new_logo' as never,
    });

    expect(ctx.db.insert).toHaveBeenCalledWith('brandingBindings', {
      organizationId: 'global',
      logoStorageId: 'new_logo',
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('patches existing bindings', async () => {
    const existing = {
      _id: 'binding_1',
      organizationId: 'global',
    };
    const { ctx } = createMockMutationCtx(existing);

    await upsertBrandingBindingsHandler(ctx as unknown as MutationCtx, {
      logoStorageId: 'new_logo' as never,
    });

    expect(ctx.db.patch).toHaveBeenCalledWith('binding_1', {
      logoStorageId: 'new_logo',
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('deletes old logo storage when replaced', async () => {
    const existing = {
      _id: 'binding_1',
      organizationId: 'global',
      logoStorageId: 'old_logo',
    };
    const { ctx } = createMockMutationCtx(existing);

    await upsertBrandingBindingsHandler(ctx as unknown as MutationCtx, {
      logoStorageId: 'new_logo' as never,
    });

    expect(ctx.storage.delete).toHaveBeenCalledWith('old_logo');
  });

  it('does not delete storage when same ID is provided', async () => {
    const existing = {
      _id: 'binding_1',
      organizationId: 'global',
      logoStorageId: 'same_logo',
    };
    const { ctx } = createMockMutationCtx(existing);

    await upsertBrandingBindingsHandler(ctx as unknown as MutationCtx, {
      logoStorageId: 'same_logo' as never,
    });

    expect(ctx.storage.delete).not.toHaveBeenCalled();
  });

  it('deletes old favicon storage files when replaced', async () => {
    const existing = {
      _id: 'binding_1',
      organizationId: 'global',
      faviconLightStorageId: 'old_fav_light',
      faviconDarkStorageId: 'old_fav_dark',
    };
    const { ctx } = createMockMutationCtx(existing);

    await upsertBrandingBindingsHandler(ctx as unknown as MutationCtx, {
      faviconLightStorageId: 'new_fav_light' as never,
      faviconDarkStorageId: 'new_fav_dark' as never,
    });

    expect(ctx.storage.delete).toHaveBeenCalledWith('old_fav_light');
    expect(ctx.storage.delete).toHaveBeenCalledWith('old_fav_dark');
  });

  it('returns null', async () => {
    const { ctx } = createMockMutationCtx();

    const result = await upsertBrandingBindingsHandler(
      ctx as unknown as MutationCtx,
      {},
    );

    expect(result).toBeNull();
  });
});
