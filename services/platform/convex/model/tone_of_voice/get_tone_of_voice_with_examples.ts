/**
 * Get tone of voice with example messages
 */

import { QueryCtx } from '../../_generated/server';
import { ToneOfVoiceWithExamples } from './types';

export async function getToneOfVoiceWithExamples(
  ctx: QueryCtx,
  args: { organizationId: string },
): Promise<ToneOfVoiceWithExamples | null> {
  const toneOfVoice = await ctx.db
    .query('toneOfVoice')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .first();

  if (!toneOfVoice) {
    return null;
  }

  const examples = await ctx.db
    .query('exampleMessages')
    .withIndex('by_toneOfVoiceId', (q) =>
      q.eq('toneOfVoiceId', toneOfVoice._id),
    )
    .collect();

  return {
    toneOfVoice,
    examples,
  };
}
