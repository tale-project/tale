// Regression gate for issue #2017 — agents mutations must throw structured
// `ConvexError` (not raw `Error`) for auth and permission cases so the UI/API
// layer gets an actionable `code` instead of an opaque 500.
//
// The `mutation` factory is mocked to pass the config straight through (same
// pattern as team_members/mutations.test.ts) so handler bodies are unit-
// testable without a running backend. `convex/values` keeps the real
// `ConvexError` (via importOriginal) while stubbing the `v` validator builders.

import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAuthUser = vi.fn();

// Sources import these concrete modules directly (not via the lib/rls barrel).
vi.mock('../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: vi.fn(),
}));
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: vi.fn(async () => {
    const u = await mockGetAuthUser();
    return u ? { userId: String(u._id), email: u.email, name: u.name } : null;
  }),
}));

vi.mock('convex/values', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stub = () => 'validator';
  return {
    // Preserve the real `ConvexError` so the handlers' structured throws
    // construct correctly; only the `v` validator builders are stubbed.
    ...actual,
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      union: stub,
      object: stub,
      literal: stub,
      array: stub,
      null: stub,
      id: stub,
    },
  };
});

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

// `./mutations` imports `knowledgeFileValidator` from `./schema`, whose module
// body calls `defineTable` — which rejects the stubbed `v` builders. The
// handlers only use the validator as an arg validator (already stubbed), so a
// lightweight stub of the schema export keeps the module importable.
vi.mock('./schema', () => ({
  knowledgeFileValidator: 'validator',
}));

const { getOrganizationMember } =
  await import('../lib/rls/organization/get_organization_member');
const mockedGetOrgMember = vi.mocked(getOrganizationMember);

interface MutHandler {
  handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
}

function asHandler(m: unknown): MutHandler {
  return m as MutHandler;
}

async function captureError(
  m: unknown,
  ctx: unknown,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    await asHandler(m).handler(ctx, args);
    return null;
  } catch (e) {
    return e;
  }
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof ConvexError) {
    const data = error.data;
    if (typeof data === 'object' && data !== null && 'code' in data) {
      const code = (data as { code: unknown }).code;
      return typeof code === 'string' ? code : undefined;
    }
  }
  return undefined;
}

function createMockCtx() {
  return {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    db: {
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          first: async () => null,
          collect: async () => [],
        }),
      }),
      insert: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    auth: {},
    scheduler: { runAfter: vi.fn() },
    storage: { delete: vi.fn() },
  };
}

const AUTH_USER = { _id: 'user_1', email: 'owner@example.com', name: 'Owner' };

const ORG_ARGS = { organizationId: 'org_1', agentSlug: 'support' };

describe('agents mutations error codes (issue #2017)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateAgentBindings', () => {
    it('throws UNAUTHENTICATED when caller has no identity', async () => {
      mockGetAuthUser.mockResolvedValue(null);
      const { updateAgentBindings } = await import('./mutations');
      const err = await captureError(updateAgentBindings, createMockCtx(), {
        ...ORG_ARGS,
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('UNAUTHENTICATED');
    });
  });

  describe('updateAgentSharing', () => {
    it('throws UNAUTHENTICATED when caller has no identity', async () => {
      mockGetAuthUser.mockResolvedValue(null);
      const { updateAgentSharing } = await import('./mutations');
      const err = await captureError(updateAgentSharing, createMockCtx(), {
        ...ORG_ARGS,
        teamIds: [],
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('UNAUTHENTICATED');
    });

    it('throws FORBIDDEN when caller is not an owner or admin', async () => {
      mockGetAuthUser.mockResolvedValue(AUTH_USER);
      mockedGetOrgMember.mockResolvedValue({ role: 'member' } as never);
      const { updateAgentSharing } = await import('./mutations');
      const err = await captureError(updateAgentSharing, createMockCtx(), {
        ...ORG_ARGS,
        teamIds: ['team_1'],
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('FORBIDDEN');
    });
  });

  describe('addKnowledgeFile', () => {
    it('throws UNAUTHENTICATED when caller has no identity', async () => {
      mockGetAuthUser.mockResolvedValue(null);
      const { addKnowledgeFile } = await import('./mutations');
      const err = await captureError(addKnowledgeFile, createMockCtx(), {
        ...ORG_ARGS,
        fileId: 'storage_1',
        fileName: 'doc.pdf',
        contentType: 'application/pdf',
        fileSize: 10,
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('UNAUTHENTICATED');
    });
  });

  describe('removeKnowledgeFile', () => {
    it('throws UNAUTHENTICATED when caller has no identity', async () => {
      mockGetAuthUser.mockResolvedValue(null);
      const { removeKnowledgeFile } = await import('./mutations');
      const err = await captureError(removeKnowledgeFile, createMockCtx(), {
        ...ORG_ARGS,
        fileId: 'storage_1',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('UNAUTHENTICATED');
    });
  });
});
