/**
 * Add an example message
 */

import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';

export async function addExampleMessage(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    content: string;
    metadata?: unknown;
  },
): Promise<Id<'exampleMessages'>> {
  // Ensure tone of voice exists
  let toneOfVoice = await ctx.db
    .query('toneOfVoice')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .first();

  if (!toneOfVoice) {
    // Create tone of voice if it doesn't exist
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
  const id = await ctx.db.insert('exampleMessages', {
    organizationId: args.organizationId,
    toneOfVoiceId: toneOfVoice._id,
    content: args.content,
    createdAt: now,
    updatedAt: now,
    metadata: args.metadata,
  });

  return id;
}
