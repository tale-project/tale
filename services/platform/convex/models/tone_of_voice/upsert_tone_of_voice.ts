/**
 * Create or update tone of voice
 */

import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';

export async function upsertToneOfVoice(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    generatedTone?: string;
    metadata?: unknown;
  },
): Promise<Id<'toneOfVoice'>> {
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
      metadata: args.metadata,
    });
    return existing._id;
  } else {
    const id = await ctx.db.insert('toneOfVoice', {
      organizationId: args.organizationId,
      generatedTone: args.generatedTone,
      lastUpdated: now,
      metadata: args.metadata,
    });
    return id;
  }
}
