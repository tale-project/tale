// Regression gate for issue #2316 — deleting a website must not be blocked by
// an unreachable or failing crawler. `deregisterAndDeleteWebsiteRow` deregisters
// the crawler binding best-effort, then always deletes the local row, so a
// crawler outage can never leave a website that can't be removed.

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
  it('deletes the row even when crawler deregister throws', async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    // The crawler deregister runAction fails as it would when the crawler
    // datastore is unreachable (the PostgresError in the bug report).
    const runAction = vi
      .fn()
      .mockRejectedValue(
        new Error('password authentication failed for user "tale"'),
      );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

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
    expect(warn).toHaveBeenCalledOnce();

    warn.mockRestore();
  });

  it('deregisters before deleting when the crawler is reachable', async () => {
    const calls: string[] = [];
    const runAction = vi.fn().mockImplementation(async () => {
      calls.push('deregister');
      return { success: true };
    });
    const runMutation = vi.fn().mockImplementation(async () => {
      calls.push('delete');
      return null;
    });

    await deregisterAndDeleteWebsiteRow(
      asCtx({ runAction, runMutation }),
      WEBSITE_ID,
      'org-slug',
      'example.com',
    );

    expect(calls).toEqual(['deregister', 'delete']);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({ websiteId: WEBSITE_ID });
  });
});
