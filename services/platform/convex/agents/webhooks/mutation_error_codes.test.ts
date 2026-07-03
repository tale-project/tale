// Regression gate for issue #2017 — agent webhook mutations must throw
// structured `ConvexError` (not raw `Error`) for auth, validation, and
// not-found cases so the UI/API layer gets an actionable `code`.
//
// The `mutation` factory is mocked to pass the config straight through so
// handler bodies are unit-testable without a running backend. `convex/values`
// keeps the real `ConvexError` (via importOriginal) while stubbing the `v`
// validator builders.

import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAuthUser = vi.fn();

vi.mock('../../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: vi.fn(),
}));
vi.mock('../../lib/rls/auth/get_auth_user_identity', () => ({
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

vi.mock('../../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
  };
});

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

function createMockCtx(webhook: unknown = null) {
  return {
    db: {
      get: vi.fn().mockResolvedValue(webhook),
      insert: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          collect: async () => [],
        }),
      }),
    },
    auth: {},
  };
}

const AUTH_USER = { _id: 'user_1', email: 'owner@example.com', name: 'Owner' };

describe('agent webhook mutations error codes (issue #2017)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createWebhook', () => {
    it('throws UNAUTHENTICATED when caller has no identity', async () => {
      mockGetAuthUser.mockResolvedValue(null);
      const { createWebhook } = await import('./mutations');
      const err = await captureError(createWebhook, createMockCtx(), {
        organizationId: 'org_1',
        agentSlug: 'support',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('UNAUTHENTICATED');
    });

    it('throws INVALID_AGENT_SLUG when the slug is malformed', async () => {
      mockGetAuthUser.mockResolvedValue(AUTH_USER);
      const { createWebhook } = await import('./mutations');
      const err = await captureError(createWebhook, createMockCtx(), {
        organizationId: 'org_1',
        // Spaces are invalid in an agent slug, forcing validateAgentName to fail.
        agentSlug: 'not a valid slug',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('INVALID_AGENT_SLUG');
    });
  });

  describe('toggleWebhook', () => {
    it('throws UNAUTHENTICATED when caller has no identity', async () => {
      mockGetAuthUser.mockResolvedValue(null);
      const { toggleWebhook } = await import('./mutations');
      const err = await captureError(toggleWebhook, createMockCtx(), {
        webhookId: 'wh_1',
        isActive: true,
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('UNAUTHENTICATED');
    });

    it('throws WEBHOOK_NOT_FOUND when the webhook is missing', async () => {
      mockGetAuthUser.mockResolvedValue(AUTH_USER);
      const { toggleWebhook } = await import('./mutations');
      const err = await captureError(toggleWebhook, createMockCtx(null), {
        webhookId: 'wh_1',
        isActive: true,
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('WEBHOOK_NOT_FOUND');
    });
  });

  describe('deleteWebhook', () => {
    it('throws UNAUTHENTICATED when caller has no identity', async () => {
      mockGetAuthUser.mockResolvedValue(null);
      const { deleteWebhook } = await import('./mutations');
      const err = await captureError(deleteWebhook, createMockCtx(), {
        webhookId: 'wh_1',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('UNAUTHENTICATED');
    });

    it('throws WEBHOOK_NOT_FOUND when the webhook is missing', async () => {
      mockGetAuthUser.mockResolvedValue(AUTH_USER);
      const { deleteWebhook } = await import('./mutations');
      const err = await captureError(deleteWebhook, createMockCtx(null), {
        webhookId: 'wh_1',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('WEBHOOK_NOT_FOUND');
    });
  });
});
