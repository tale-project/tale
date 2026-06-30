// Regression gate for issue #2020 — the location approval response mutation
// must throw structured `ConvexError` (not raw `Error`) for user-facing
// conditions (approval missing, already resolved, wrong type, no thread) so the
// UI gets actionable error codes instead of an opaque "Server Error".
//
// The `internalMutation` factory is mocked to hand the config straight through
// (same pattern as vendors/mutation_error_codes.test.ts) so the handler body is
// unit-testable without a running backend.

import { ConvexError } from 'convex/values';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

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

const defaultArgs = {
  approvalId: 'a1',
  location: 'Berlin',
  respondedBy: 'user@example.com',
  approvedBy: 'user1',
};

describe('location tool mutations error codes (issue #2020)', () => {
  it('throws APPROVAL_NOT_FOUND ConvexError when the approval is missing', async () => {
    const ctx = {
      db: { get: vi.fn().mockResolvedValue(null) },
    };
    const err = await captureError(
      mutations.submitLocationResponseInternal,
      ctx,
      defaultArgs,
    );

    expect(err).toBeInstanceOf(ConvexError);
    expect(errorCode(err)).toBe('APPROVAL_NOT_FOUND');
  });

  it('throws ALREADY_RESOLVED ConvexError when the request was already responded to', async () => {
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue({
          status: 'completed',
          resourceType: 'location_request',
        }),
      },
    };
    const err = await captureError(
      mutations.submitLocationResponseInternal,
      ctx,
      defaultArgs,
    );

    expect(err).toBeInstanceOf(ConvexError);
    expect(errorCode(err)).toBe('ALREADY_RESOLVED');
  });

  it('throws INVALID_APPROVAL_TYPE ConvexError when the approval is not a location request', async () => {
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue({
          status: 'pending',
          resourceType: 'human_input',
        }),
      },
    };
    const err = await captureError(
      mutations.submitLocationResponseInternal,
      ctx,
      defaultArgs,
    );

    expect(err).toBeInstanceOf(ConvexError);
    expect(errorCode(err)).toBe('INVALID_APPROVAL_TYPE');
  });

  it('throws LOCATION_REQUEST_NO_THREAD ConvexError when no thread is associated', async () => {
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue({
          status: 'pending',
          resourceType: 'location_request',
          threadId: undefined,
        }),
      },
    };
    const err = await captureError(
      mutations.submitLocationResponseInternal,
      ctx,
      defaultArgs,
    );

    expect(err).toBeInstanceOf(ConvexError);
    expect(errorCode(err)).toBe('LOCATION_REQUEST_NO_THREAD');
  });
});
