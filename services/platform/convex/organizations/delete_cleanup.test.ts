import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression test for #2018: the lifecycle rejections used to surface as opaque
// raw `Error`s ("Server Error"). They now throw `ConvexError({ code })` so the
// UI can branch on a stable code.

vi.mock('../_generated/api', () => ({
  internal: {
    organizations: {
      scaffold: {
        cleanupOrgFilesystem:
          'internal:organizations:scaffold:cleanupOrgFilesystem',
      },
    },
  },
}));

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
  };
});

const mockLogSuccess = vi.fn();
vi.mock('../audit_logs/helpers', () => ({
  logSuccess: (...args: unknown[]) => mockLogSuccess(...args),
}));

const mockAssertNotHeld = vi.fn();
vi.mock('../governance/legal_hold_guard', () => ({
  assertNotHeld: (...args: unknown[]) => mockAssertNotHeld(...args),
}));

const mockCascadeOnOrgDeleted = vi.fn();
vi.mock('../lib/cascades/personalization_cascade', () => ({
  cascadeOnOrgDeleted: (...args: unknown[]) => mockCascadeOnOrgDeleted(...args),
}));

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const mockGetOrganizationMember = vi.fn();
vi.mock('../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: (...args: unknown[]) =>
    mockGetOrganizationMember(...args),
}));

const mockResolveOrgSlug = vi.fn();
vi.mock('./resolve_org_slug', () => ({
  resolveOrgSlug: (...args: unknown[]) => mockResolveOrgSlug(...args),
}));

const AUTH_USER = { userId: 'user_1', email: 'user@example.com' };

function createMockCtx() {
  return {
    scheduler: { runAfter: vi.fn().mockResolvedValue(undefined) },
  };
}

async function getHandler() {
  const { prepareOrganizationDeletion } = await import('./delete_cleanup');
  return (prepareOrganizationDeletion as unknown as { handler: Function })
    .handler;
}

describe('prepareOrganizationDeletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue(AUTH_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'owner' });
    mockResolveOrgSlug.mockResolvedValue('acme');
    mockAssertNotHeld.mockResolvedValue(undefined);
    mockLogSuccess.mockResolvedValue('audit_log_1');
    mockCascadeOnOrgDeleted.mockResolvedValue(undefined);
  });

  it('throws UNAUTHENTICATED when there is no authenticated user', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const handler = await getHandler();

    await expect(
      handler(createMockCtx(), { organizationId: 'org_1' }),
    ).rejects.toMatchObject({ data: { code: 'UNAUTHENTICATED' } });
  });

  it('throws FORBIDDEN when the caller is not an owner', async () => {
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const handler = await getHandler();

    await expect(
      handler(createMockCtx(), { organizationId: 'org_1' }),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  });

  it('throws DEFAULT_ORG_PROTECTED when deleting the default organization', async () => {
    mockResolveOrgSlug.mockResolvedValue('default');
    const handler = await getHandler();

    await expect(
      handler(createMockCtx(), { organizationId: 'org_1' }),
    ).rejects.toMatchObject({ data: { code: 'DEFAULT_ORG_PROTECTED' } });
  });

  it('schedules cleanup and returns the slug on success', async () => {
    const ctx = createMockCtx();
    const handler = await getHandler();

    const result = await handler(ctx, { organizationId: 'org_1' });

    expect(result).toEqual({ orgSlug: 'acme' });
    expect(mockLogSuccess).toHaveBeenCalledTimes(1);
    expect(mockCascadeOnOrgDeleted).toHaveBeenCalledWith(ctx, 'org_1');
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      'internal:organizations:scaffold:cleanupOrgFilesystem',
      { orgSlug: 'acme' },
    );
  });

  it('surfaces all rejections as ConvexError, never a raw Error', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const handler = await getHandler();

    await expect(
      handler(createMockCtx(), { organizationId: 'org_1' }),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});
