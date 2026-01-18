/**
 * Create or update tone of voice
 */

import { MutationCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';
import type { JsonRecord } from '../../lib/shared/schemas/utils/json-value';

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

  type MetadataType = typeof existing extends { metadata?: infer M } ? M : never;
  const metadata = args.metadata as MetadataType;

  if (existing) {
    await ctx.db.patch(existing._id, {
      generatedTone: args.generatedTone,
      lastUpdated: now,
      metadata,
    });
    return existing._id;
  } else {
    const id = await ctx.db.insert('toneOfVoice', {
      organizationId: args.organizationId,
      generatedTone: args.generatedTone,
      lastUpdated: now,
      metadata,
    });
    return id;
  }
}
