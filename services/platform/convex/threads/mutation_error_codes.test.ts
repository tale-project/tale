// Regression gate for issue #2007 — thread share/fork/branch mutations must
// throw structured `ConvexError` (not raw `Error`) so the Convex client error
// boundary surfaces an actionable `code` instead of an opaque "Server Error".
//
// The `mutation`/`internalMutation` factories are mocked to hand the config
// straight through (same pattern as vendors/mutation_error_codes.test.ts) so
// the handler bodies are unit-testable without a running backend. The auth
// helper is mocked so each case can drive the unauthenticated / not-found /
// not-authorized branches directly.

import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Preserve the real `convex/values` exports (`v` builders + `ConvexError`).
// Importing `mutations.ts` pulls a deep helper graph; without pinning the
// module here the `ConvexError` binding can land in a TDZ during that
// circular load and the handlers' structured throws fail with
// "ConvexError is not defined".
vi.mock('convex/values', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual };
});

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

import * as createBranchThreadMod from './create_branch_thread';
import * as mutations from './mutations';

interface MutHandler {
  handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
}

function asHandler(m: unknown): MutHandler {
  return m as MutHandler;
}

// Run a handler and return whatever it throws (or null if it resolves).
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

// A ctx whose `threadMetadata` query resolves `.first()` to a configurable row.
function makeCtx(metadataFirst: unknown) {
  return {
    db: {
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(metadataFirst),
      }),
    },
  };
}

describe('thread mutation error codes (issue #2007)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({ userId: 'user_1' });
  });

  describe('createArenaThreadB', () => {
    it('throws UNAUTHENTICATED when caller is signed out', async () => {
      mockGetAuthUserIdentity.mockResolvedValue(null);
      const err = await captureError(
        mutations.createArenaThreadB,
        makeCtx(null),
        {
          threadIdA: 'thread_a',
          organizationId: 'org_1',
        },
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('UNAUTHENTICATED');
    });

    it('throws THREAD_NOT_FOUND when source thread is missing', async () => {
      const err = await captureError(
        mutations.createArenaThreadB,
        makeCtx(null),
        {
          threadIdA: 'thread_a',
          organizationId: 'org_1',
        },
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('THREAD_NOT_FOUND');
    });

    it('throws THREAD_NOT_FOUND when source thread belongs to another user', async () => {
      const ctx = makeCtx({ _id: 'meta_a', userId: 'someone_else' });
      const err = await captureError(mutations.createArenaThreadB, ctx, {
        threadIdA: 'thread_a',
        organizationId: 'org_1',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('THREAD_NOT_FOUND');
    });
  });

  describe('cleanupArenaBranch', () => {
    it('throws UNAUTHENTICATED when caller is signed out', async () => {
      mockGetAuthUserIdentity.mockResolvedValue(null);
      const err = await captureError(
        mutations.cleanupArenaBranch,
        makeCtx(null),
        {
          threadIdA: 'thread_a',
          threadIdB: 'thread_b',
        },
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('UNAUTHENTICATED');
    });

    it('throws THREAD_NOT_FOUND when thread A is not owned by caller', async () => {
      const ctx = makeCtx({ _id: 'meta_a', userId: 'someone_else' });
      const err = await captureError(mutations.cleanupArenaBranch, ctx, {
        threadIdA: 'thread_a',
        threadIdB: 'thread_b',
      });

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('THREAD_NOT_FOUND');
    });
  });

  describe('createBranchThread (internal)', () => {
    it('throws THREAD_NOT_FOUND when source thread is missing', async () => {
      const err = await captureError(
        createBranchThreadMod.createBranchThread,
        makeCtx(null),
        {
          userId: 'user_1',
          organizationId: 'org_1',
          sourceThreadId: 'thread_src',
          rootThreadId: 'thread_root',
          editedMessageId: 'msg_1',
          editedMessageOrder: 2,
          newMessage: 'hi',
        },
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('THREAD_NOT_FOUND');
    });

    it('throws NOT_AUTHORIZED when caller does not own the source thread', async () => {
      const ctx = makeCtx({ _id: 'meta_src', userId: 'someone_else' });
      const err = await captureError(
        createBranchThreadMod.createBranchThread,
        ctx,
        {
          userId: 'user_1',
          organizationId: 'org_1',
          sourceThreadId: 'thread_src',
          rootThreadId: 'thread_root',
          editedMessageId: 'msg_1',
          editedMessageOrder: 2,
          newMessage: 'hi',
        },
      );

      expect(err).toBeInstanceOf(ConvexError);
      expect(errorCode(err)).toBe('NOT_AUTHORIZED');
    });
  });
});
