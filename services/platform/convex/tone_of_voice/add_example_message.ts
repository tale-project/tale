/**
 * Add an example message
 */

import { Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';
import type { JsonRecord } from '../../lib/shared/schemas/utils/json-value';

export async function addExampleMessage(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    content: string;
    metadata?: JsonRecord;
  },
): Promise<Id<'exampleMessages'>> {
  let toneOfVoice = await ctx.db
    .query('toneOfVoice')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .first();

  if (!toneOfVoice) {
    const toneOfVoiceId = await ctx.db.insert('toneOfVoice', {
      organizationId: args.organizationId,
      lastUpdated: Date.now(),
    });
    toneOfVoice = await ctx.db.get(toneOfVoiceId);
    if (!toneOfVoice) {
      throw new Error('Failed to create tone of voice');
    }
  }

  const now = Date.now();
  return await ctx.db.insert('exampleMessages', {
    organizationId: args.organizationId,
    toneOfVoiceId: toneOfVoice._id,
    content: args.content,
    createdAt: now,
    updatedAt: now,
    metadata: args.metadata,
  });
}
