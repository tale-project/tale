import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { QueryCtx } from '../../_generated/server';

vi.mock('../../lib/rls', () => ({
  validateOrganizationAccess: vi.fn(),
  getAuthUserIdentity: vi.fn(),
}));

const { getBrandingHandler } = await import('../queries');
const { validateOrganizationAccess } = await import('../../lib/rls');

const mockedValidate = vi.mocked(validateOrganizationAccess);

function createMockQueryCtx(
  brandingDoc: Record<string, unknown> | null = null,
) {
  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(brandingDoc),
  };

  const ctx = {
    db: {
      query: vi.fn().mockReturnValue(builder),
    },
    storage: {
      getUrl: vi
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(`https://storage.example.com/${id}`),
        ),
    },
  };

  return { ctx, builder };
}

describe('getBrandingHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates organization access', async () => {
    const { ctx } = createMockQueryCtx();

    await getBrandingHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(mockedValidate).toHaveBeenCalledWith(
      ctx,
      'org_1',
      undefined,
      undefined,
    );
  });

  it('returns null when no branding exists', async () => {
    const { ctx } = createMockQueryCtx(null);

    const result = await getBrandingHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toBeNull();
  });

  it('queries branding by organizationId index', async () => {
    const { ctx, builder } = createMockQueryCtx(null);

    await getBrandingHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(ctx.db.query).toHaveBeenCalledWith('brandingSettings');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId',
      expect.any(Function),
    );
  });

  it('returns branding with resolved storage URLs', async () => {
    const { ctx } = createMockQueryCtx({
      _id: 'branding_1',
      organizationId: 'org_1',
      appName: 'Acme Corp',
      textLogo: 'Acme',
      logoStorageId: 'storage_logo',
      faviconLightStorageId: 'storage_fav_light',
      faviconDarkStorageId: 'storage_fav_dark',
      brandColor: '#FF0000',
      accentColor: '#00FF00',
      updatedAt: 1000,
    });

    const result = await getBrandingHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual({
      appName: 'Acme Corp',
      textLogo: 'Acme',
      logoUrl: 'https://storage.example.com/storage_logo',
      faviconLightUrl: 'https://storage.example.com/storage_fav_light',
      faviconDarkUrl: 'https://storage.example.com/storage_fav_dark',
      brandColor: '#FF0000',
      accentColor: '#00FF00',
    });
  });

  it('resolves null URLs when storage IDs are missing', async () => {
    const { ctx } = createMockQueryCtx({
      _id: 'branding_1',
      organizationId: 'org_1',
      appName: 'Acme',
      updatedAt: 1000,
    });

    const result = await getBrandingHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual({
      appName: 'Acme',
      textLogo: undefined,
      logoUrl: null,
      faviconLightUrl: null,
      faviconDarkUrl: null,
      brandColor: undefined,
      accentColor: undefined,
    });
    expect(ctx.storage.getUrl).not.toHaveBeenCalled();
  });

  it('returns partial branding when only some fields are set', async () => {
    const { ctx } = createMockQueryCtx({
      _id: 'branding_1',
      organizationId: 'org_1',
      brandColor: '#3366FF',
      updatedAt: 1000,
    });

    const result = await getBrandingHandler(ctx as unknown as QueryCtx, {
      organizationId: 'org_1',
    });

    expect(result).toEqual({
      appName: undefined,
      textLogo: undefined,
      logoUrl: null,
      faviconLightUrl: null,
      faviconDarkUrl: null,
      brandColor: '#3366FF',
      accentColor: undefined,
    });
  });
});
