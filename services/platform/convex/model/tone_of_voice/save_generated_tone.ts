/**
 * Internal mutation to save generated tone
 */

import { MutationCtx } from '../../_generated/server';

export async function saveGeneratedTone(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    generatedTone: string;
  },
): Promise<null> {
  const existing = await ctx.db
    .query('toneOfVoice')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .first();

  const now = Date.now();

  if (existing) {
    await ctx.db.patch(existing._id, {
      generatedTone: args.generatedTone,
      lastUpdated: now,
    });
  } else {
    await ctx.db.insert('toneOfVoice', {
      organizationId: args.organizationId,
      generatedTone: args.generatedTone,
      lastUpdated: now,
    });
  }

  return null;
}
