import { afterEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { readCustomInstructions } from './custom_instructions';

/** A ctx whose `runQuery` answers the preferences seam with `answer`, or
 * throws it when it is an Error. */
function createCtx(answer: unknown) {
  const runQuery = vi.fn((ref: unknown, _args: unknown) => {
    const name = functionRefName(ref);
    if (!name.includes('getCustomInstructionsInternal')) {
      return Promise.reject(new Error(`unexpected query: ${name}`));
    }
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
  return { ctx: { runQuery } as never, runQuery };
}

const WHO = { organizationId: 'org_1', userId: 'user_1' };

describe('readCustomInstructions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers the gated text the seam returns, scoped to the person', async () => {
    const { ctx, runQuery } = createCtx('Reply tersely.');
    await expect(readCustomInstructions(ctx, WHO)).resolves.toBe(
      'Reply tersely.',
    );
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), WHO);
  });

  it('is absent when the feature is off for the person (the seam says null)', async () => {
    const { ctx } = createCtx(null);
    await expect(readCustomInstructions(ctx, WHO)).resolves.toBeUndefined();
  });

  it('degrades to no instructions with a warning when the read fails — never a refused turn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx } = createCtx(new Error('preferences table is away'));
    await expect(readCustomInstructions(ctx, WHO)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('custom instructions unavailable'),
      'preferences table is away',
    );
  });
});
