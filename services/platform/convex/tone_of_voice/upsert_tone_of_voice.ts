/**
 * Create or update tone of voice
 */

import type { JsonRecord } from '../../lib/shared/schemas/utils/json-value';

import { Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';

export async function upsertToneOfVoice(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    generatedTone?: string;
    metadata?: JsonRecord;
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
      ...(args.metadata !== undefined && { metadata: args.metadata }),
    });
    return existing._id;
  }

  return await ctx.db.insert('toneOfVoice', {
    organizationId: args.organizationId,
    generatedTone: args.generatedTone,
    lastUpdated: now,
    ...(args.metadata !== undefined && { metadata: args.metadata }),
  });
}
