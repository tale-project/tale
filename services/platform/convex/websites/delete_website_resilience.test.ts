// Regression gate for issue #2316 — deleting a website must not be blocked by
// an unreachable or failing crawler. `deregisterAndDeleteWebsiteRow`
// deregisters the crawler binding best-effort, then always deletes the local
// row, so a crawler outage can never leave a website that can't be removed.
//
// The crawler pipeline is currently offline (knowledge backend rebuild), so
// deregistration is a logged no-op that never runs a crawler action. The
// invariant this gate protects is unchanged and even stronger: the local row
// is always deleted, and deletion issues no crawler action at all.

import { describe, it, expect, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { deregisterAndDeleteWebsiteRow } from './internal_actions';

// oxlint-disable-next-line typescript/no-explicit-any -- a partial mock ctx is all the helper touches
function asCtx(value: unknown): ActionCtx {
  return value as ActionCtx;
}

const WEBSITE_ID = 'w1' as Id<'websites'>;

describe('deregisterAndDeleteWebsiteRow (#2316)', () => {
  it('always deletes the local row', async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const runAction = vi.fn();

    await expect(
      deregisterAndDeleteWebsiteRow(
        asCtx({ runAction, runMutation }),
        WEBSITE_ID,
        'org-slug',
        'example.com',
      ),
    ).resolves.toBeUndefined();

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({ websiteId: WEBSITE_ID });
  });

  it('issues no crawler action while the crawler is offline', async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const runAction = vi.fn();

    await deregisterAndDeleteWebsiteRow(
      asCtx({ runAction, runMutation }),
      WEBSITE_ID,
      'org-slug',
      'example.com',
    );

    // Deregistration is a logged no-op — no crawler runAction is dispatched —
    // and the row is still deleted.
    expect(runAction).not.toHaveBeenCalled();
    expect(runMutation.mock.calls[0]?.[1]).toEqual({ websiteId: WEBSITE_ID });
  });
});
