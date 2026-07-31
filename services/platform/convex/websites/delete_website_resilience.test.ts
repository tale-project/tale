// Regression gate for issue #2316 — deleting a website must not be blocked by
// an unreachable or failing crawler. `deregisterAndDeleteWebsiteRow`
// deregisters the corpus binding best-effort, then always deletes the local
// row, so a crawler outage can never leave a website that can't be removed.

import { describe, it, expect, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { deregisterAndDeleteWebsiteRow } from './internal_actions';

function asCtx(value: unknown): ActionCtx {
  return value as ActionCtx;
}

const WEBSITE_ID = 'w1' as Id<'websites'>;

describe('deregisterAndDeleteWebsiteRow (#2316)', () => {
  it('deregisters the corpus binding and deletes the local row', async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const runAction = vi.fn().mockResolvedValue(null);

    await expect(
      deregisterAndDeleteWebsiteRow(
        asCtx({ runAction, runMutation }),
        WEBSITE_ID,
        'org-slug',
        'example.com',
      ),
    ).resolves.toBeUndefined();

    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runAction.mock.calls[0]?.[1]).toEqual({
      orgSlug: 'org-slug',
      domain: 'example.com',
    });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({ websiteId: WEBSITE_ID });
  });

  it('deletes the row even when the corpus deregister fails', async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const runAction = vi
      .fn()
      .mockRejectedValue(new Error('knowledge database unreachable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(
        deregisterAndDeleteWebsiteRow(
          asCtx({ runAction, runMutation }),
          WEBSITE_ID,
          'org-slug',
          'example.com',
        ),
      ).resolves.toBeUndefined();

      // The failure is logged, never propagated — the row delete still runs.
      expect(runMutation).toHaveBeenCalledTimes(1);
      expect(runMutation.mock.calls[0]?.[1]).toEqual({ websiteId: WEBSITE_ID });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
