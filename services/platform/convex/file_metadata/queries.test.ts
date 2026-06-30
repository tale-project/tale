import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      id: stub,
      object: stub,
      union: stub,
      literal: stub,
      array: stub,
      null: stub,
    },
  };
});

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    query: (config: Record<string, unknown>) => config,
  };
});

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const mockGetOrganizationMember = vi.fn();
vi.mock('../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: (...args: unknown[]) =>
    mockGetOrganizationMember(...args),
}));

/**
 * Mock ctx whose `by_storageId` lookup resolves each storageId to a row from
 * `rowsByStorageId` (or null when absent). Each `.map` iteration builds a fresh
 * query → withIndex → first chain, so we capture the eq'd storageId per chain.
 */
function createMockCtx(rowsByStorageId: Record<string, unknown>) {
  const ctx = {
    db: {
      query: vi.fn(() => {
        let captured: string | undefined;
        const builder = {
          withIndex: vi.fn((_index: string, cb: (q: unknown) => unknown) => {
            const q = {
              eq: (_field: string, value: string) => {
                captured = value;
                return q;
              },
            };
            cb(q);
            return builder;
          }),
          first: vi.fn(async () =>
            captured ? (rowsByStorageId[captured] ?? null) : null,
          ),
        };
        return builder;
      }),
    },
  };
  return ctx;
}

async function getHandler() {
  const { getByStorageIds } = await import('./queries');
  return (getByStorageIds as unknown as { handler: Function }).handler;
}

const AUTH_USER = {
  userId: 'user_1',
  email: 'test@example.com',
  name: 'Test User',
};

const ownRow = {
  organizationId: 'org_A',
  storageId: 'storage_own',
  fileName: 'own.pdf',
  contentType: 'application/pdf',
  size: 10,
  transcript: 'mine',
  _creationTime: 1,
};

const foreignRow = {
  organizationId: 'org_B',
  storageId: 'storage_foreign',
  fileName: 'secret.mp3',
  contentType: 'audio/mpeg',
  size: 20,
  transcript: 'cross-tenant secret transcript',
  _creationTime: 2,
};

describe('getByStorageIds (public) — RLS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrganizationMember.mockResolvedValue({ _id: 'member_1' });
  });

  it('returns [] for unauthenticated callers', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const ctx = createMockCtx({});
    const handler = await getHandler();

    const result = await handler(ctx, {
      organizationId: 'org_A',
      storageIds: ['storage_own'],
    });

    expect(result).toEqual([]);
    expect(mockGetOrganizationMember).not.toHaveBeenCalled();
  });

  it('returns [] when the caller is not a member of the org', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(AUTH_USER);
    mockGetOrganizationMember.mockRejectedValue(new Error('Not a member'));
    const ctx = createMockCtx({ storage_own: ownRow });
    const handler = await getHandler();

    const result = await handler(ctx, {
      organizationId: 'org_A',
      storageIds: ['storage_own'],
    });

    expect(result).toEqual([]);
  });

  it('filters out rows belonging to a different organization', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx({ storage_foreign: foreignRow });
    const handler = await getHandler();

    // Caller is a member of org_A but asks for a storageId owned by org_B.
    const result = await handler(ctx, {
      organizationId: 'org_A',
      storageIds: ['storage_foreign'],
    });

    expect(result).toEqual([]);
  });

  it('returns metadata for in-tenant storage ids', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx({
      storage_own: ownRow,
      storage_foreign: foreignRow,
    });
    const handler = await getHandler();

    const result = await handler(ctx, {
      organizationId: 'org_A',
      storageIds: ['storage_own', 'storage_foreign'],
    });

    // Only the org_A row comes back; the org_B row is filtered.
    expect(result).toHaveLength(1);
    expect(result[0].storageId).toBe('storage_own');
    expect(result[0].transcript).toBe('mine');
  });
});
