import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { MutationCtx } from '../../_generated/server';
import type { RLSContext } from '../../lib/rls/types';

const mockRlsContext: RLSContext = {
  user: { userId: 'user_1', email: 'admin@acme.com' },
  member: {
    _id: 'member_1',
    createdAt: 0,
    organizationId: 'org_1',
    userId: 'user_1',
    role: 'admin',
  },
  organizationId: 'org_1',
  role: 'admin',
  isAdmin: true,
};

vi.mock('../../lib/rls', () => ({
  validateOrganizationAccess: vi.fn().mockResolvedValue(mockRlsContext),
  ADMIN_ONLY: { requiredRole: 'admin' },
}));

vi.mock('../../audit_logs/helpers', () => ({
  logSuccess: vi.fn(),
}));

const { upsertBrandingHandler } = await import('../mutations');
const { validateOrganizationAccess } = await import('../../lib/rls');
const AuditLogHelpers = await import('../../audit_logs/helpers');

const mockedValidate = vi.mocked(validateOrganizationAccess);
const mockedAuditLog = vi.mocked(AuditLogHelpers.logSuccess);

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
      insert: vi.fn().mockResolvedValue('branding_new'),
      patch: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };

  return { ctx, builder };
}

describe('upsertBrandingHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedValidate.mockResolvedValue(mockRlsContext);
  });

  it('validates admin-only access', async () => {
    const { ctx } = createMockMutationCtx();

    await upsertBrandingHandler(ctx as unknown as MutationCtx, {
      organizationId: 'org_1',
      appName: 'Acme',
    });

    expect(mockedValidate).toHaveBeenCalledWith(ctx, 'org_1', {
      requiredRole: 'admin',
    });
  });

  it('inserts new branding when none exists', async () => {
    const { ctx } = createMockMutationCtx(null);

    await upsertBrandingHandler(ctx as unknown as MutationCtx, {
      organizationId: 'org_1',
      appName: 'Acme Corp',
      brandColor: '#FF0000',
    });

    expect(ctx.db.insert).toHaveBeenCalledWith('brandingSettings', {
      organizationId: 'org_1',
      appName: 'Acme Corp',
      brandColor: '#FF0000',
      updatedAt: expect.any(Number),
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('patches existing branding', async () => {
    const existing = {
      _id: 'branding_1',
      organizationId: 'org_1',
      appName: 'Old Name',
      updatedAt: 1000,
    };
    const { ctx } = createMockMutationCtx(existing);

    await upsertBrandingHandler(ctx as unknown as MutationCtx, {
      organizationId: 'org_1',
      appName: 'New Name',
    });

    expect(ctx.db.patch).toHaveBeenCalledWith('branding_1', {
      appName: 'New Name',
      updatedAt: expect.any(Number),
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('deletes old logo storage when replaced', async () => {
    const existing = {
      _id: 'branding_1',
      organizationId: 'org_1',
      logoStorageId: 'old_logo',
      updatedAt: 1000,
    };
    const { ctx } = createMockMutationCtx(existing);

    await upsertBrandingHandler(ctx as unknown as MutationCtx, {
      organizationId: 'org_1',
      logoStorageId: 'new_logo' as never,
    });

    expect(ctx.storage.delete).toHaveBeenCalledWith('old_logo');
  });

  it('does not delete storage when same ID is provided', async () => {
    const existing = {
      _id: 'branding_1',
      organizationId: 'org_1',
      logoStorageId: 'same_logo',
      updatedAt: 1000,
    };
    const { ctx } = createMockMutationCtx(existing);

    await upsertBrandingHandler(ctx as unknown as MutationCtx, {
      organizationId: 'org_1',
      logoStorageId: 'same_logo' as never,
    });

    expect(ctx.storage.delete).not.toHaveBeenCalled();
  });

  it('deletes old favicon storage files when replaced', async () => {
    const existing = {
      _id: 'branding_1',
      organizationId: 'org_1',
      faviconLightStorageId: 'old_fav_light',
      faviconDarkStorageId: 'old_fav_dark',
      updatedAt: 1000,
    };
    const { ctx } = createMockMutationCtx(existing);

    await upsertBrandingHandler(ctx as unknown as MutationCtx, {
      organizationId: 'org_1',
      faviconLightStorageId: 'new_fav_light' as never,
      faviconDarkStorageId: 'new_fav_dark' as never,
    });

    expect(ctx.storage.delete).toHaveBeenCalledWith('old_fav_light');
    expect(ctx.storage.delete).toHaveBeenCalledWith('old_fav_dark');
  });

  it('does not delete storage when no existing file exists', async () => {
    const existing = {
      _id: 'branding_1',
      organizationId: 'org_1',
      updatedAt: 1000,
    };
    const { ctx } = createMockMutationCtx(existing);

    await upsertBrandingHandler(ctx as unknown as MutationCtx, {
      organizationId: 'org_1',
      logoStorageId: 'new_logo' as never,
    });

    expect(ctx.storage.delete).not.toHaveBeenCalled();
  });

  it('logs audit event for create', async () => {
    const { ctx } = createMockMutationCtx(null);

    await upsertBrandingHandler(ctx as unknown as MutationCtx, {
      organizationId: 'org_1',
      appName: 'Acme',
    });

    expect(mockedAuditLog).toHaveBeenCalledWith(
      ctx,
      {
        organizationId: 'org_1',
        actor: {
          id: 'user_1',
          email: 'admin@acme.com',
          role: 'admin',
          type: 'user',
        },
      },
      'create_branding',
      'admin',
      'branding',
      'org_1',
      'Branding settings',
      undefined,
      expect.objectContaining({ appName: 'Acme' }),
    );
  });

  it('logs audit event for update with before/after values', async () => {
    const existing = {
      _id: 'branding_1',
      organizationId: 'org_1',
      appName: 'Old Name',
      brandColor: '#000000',
      updatedAt: 1000,
    };
    const { ctx } = createMockMutationCtx(existing);

    await upsertBrandingHandler(ctx as unknown as MutationCtx, {
      organizationId: 'org_1',
      appName: 'New Name',
      brandColor: '#FF0000',
    });

    expect(mockedAuditLog).toHaveBeenCalledWith(
      ctx,
      expect.any(Object),
      'update_branding',
      'admin',
      'branding',
      'org_1',
      'Branding settings',
      expect.objectContaining({
        appName: 'Old Name',
        brandColor: '#000000',
      }),
      expect.objectContaining({
        appName: 'New Name',
        brandColor: '#FF0000',
      }),
    );
  });

  it('rejects invalid brandColor', async () => {
    const { ctx } = createMockMutationCtx();

    await expect(
      upsertBrandingHandler(ctx as unknown as MutationCtx, {
        organizationId: 'org_1',
        brandColor: 'not-a-color',
      }),
    ).rejects.toThrow('Invalid brandColor');
  });

  it('rejects invalid accentColor', async () => {
    const { ctx } = createMockMutationCtx();

    await expect(
      upsertBrandingHandler(ctx as unknown as MutationCtx, {
        organizationId: 'org_1',
        accentColor: '#GGHHII',
      }),
    ).rejects.toThrow('Invalid accentColor');
  });

  it('accepts valid hex colors', async () => {
    const { ctx } = createMockMutationCtx();

    const result = await upsertBrandingHandler(ctx as unknown as MutationCtx, {
      organizationId: 'org_1',
      brandColor: '#FF0000',
      accentColor: '#00ff00',
    });

    expect(result).toBeNull();
  });

  it('returns null', async () => {
    const { ctx } = createMockMutationCtx();

    const result = await upsertBrandingHandler(ctx as unknown as MutationCtx, {
      organizationId: 'org_1',
    });

    expect(result).toBeNull();
  });
});
