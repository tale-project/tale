import { describe, expect, it } from 'vitest';

import type { MutationCtx } from '../_generated/server';
import { removeRecommendedProduct, updateApprovalStatus } from './helpers';

/**
 * #2056 regression: the approval guards must reject with a structured
 * `ConvexError({ code })`. A raw `Error` is redacted to "Server Error" in prod,
 * so the approval/human-input cards can't map the failure to a useful message.
 */

function codeOf(err: unknown): string | undefined {
  if (err === null || typeof err !== 'object' || !('data' in err)) {
    return undefined;
  }
  const data: unknown = err.data;
  if (typeof data !== 'object' || data === null || !('code' in data)) {
    return undefined;
  }
  const candidate: unknown = data.code;
  return typeof candidate === 'string' ? candidate : undefined;
}

/** Mock ctx whose `db.get` resolves to `approval`. The guards under test run
 * before any other ctx access, so `db.get` is all that's needed. */
function ctxWith(approval: unknown): MutationCtx {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stub; only db.get is reached on the guard paths
  return { db: { get: async () => approval } } as unknown as MutationCtx;
}

async function catchCode(
  fn: () => Promise<unknown>,
): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return codeOf(err);
  }
  return undefined;
}

describe('approvals helper error codes (#2056)', () => {
  describe('updateApprovalStatus', () => {
    it('throws NOT_FOUND when the approval is missing', async () => {
      const code = await catchCode(() =>
        updateApprovalStatus(ctxWith(null), {
          approvalId: 'a1' as never,
          status: 'executing',
          approvedBy: 'user_1',
        }),
      );
      expect(code).toBe('NOT_FOUND');
    });

    it('throws ALREADY_RESOLVED for a non-pending approval', async () => {
      const code = await catchCode(() =>
        updateApprovalStatus(ctxWith({ status: 'completed' }), {
          approvalId: 'a1' as never,
          status: 'executing',
          approvedBy: 'user_1',
        }),
      );
      expect(code).toBe('ALREADY_RESOLVED');
    });

    it('throws INVALID_DECISION for a status that is neither approve nor reject', async () => {
      const code = await catchCode(() =>
        updateApprovalStatus(ctxWith({ status: 'pending' }), {
          approvalId: 'a1' as never,
          // not 'executing' | 'rejected'
          status: 'completed',
          approvedBy: 'user_1',
        }),
      );
      expect(code).toBe('INVALID_DECISION');
    });
  });

  describe('removeRecommendedProduct', () => {
    it('throws NOT_FOUND when the approval is missing', async () => {
      const code = await catchCode(() =>
        removeRecommendedProduct(ctxWith(null), {
          approvalId: 'a1' as never,
          productId: 'p1',
        }),
      );
      expect(code).toBe('NOT_FOUND');
    });

    it('throws ALREADY_RESOLVED when the approval is no longer pending', async () => {
      const code = await catchCode(() =>
        removeRecommendedProduct(ctxWith({ status: 'rejected' }), {
          approvalId: 'a1' as never,
          productId: 'p1',
        }),
      );
      expect(code).toBe('ALREADY_RESOLVED');
    });
  });
});
