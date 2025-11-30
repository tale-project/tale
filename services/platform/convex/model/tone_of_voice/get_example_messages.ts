/**
 * Get example messages for a tone of voice
 */

import { QueryCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { ExampleMessage } from './types';

export async function getExampleMessages(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    toneOfVoiceId?: Id<'toneOfVoice'>;
  },
): Promise<Array<ExampleMessage>> {
  if (args.toneOfVoiceId !== undefined) {
    const examples = await ctx.db
      .query('exampleMessages')
      .withIndex('by_toneOfVoiceId', (q) =>
        q.eq('toneOfVoiceId', args.toneOfVoiceId!),
      )
      .collect();
    return examples;
  }

  // If no toneOfVoiceId provided, get all for organization
  const examples = await ctx.db
    .query('exampleMessages')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .collect();
  return examples;
}
