/**
 * Get example messages for a tone of voice
 */

import { Id } from '../_generated/dataModel';
import { QueryCtx } from '../_generated/server';
import { ExampleMessage } from './types';

export async function getExampleMessages(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    toneOfVoiceId?: Id<'toneOfVoice'>;
  },
): Promise<Array<ExampleMessage>> {
  if (args.toneOfVoiceId !== undefined) {
    const toneOfVoiceId = args.toneOfVoiceId;
    const examples: Array<ExampleMessage> = [];
    for await (const example of ctx.db
      .query('exampleMessages')
      .withIndex('by_toneOfVoiceId', (q) =>
        q.eq('toneOfVoiceId', toneOfVoiceId),
      )) {
      examples.push(example);
    }
    return examples;
  }

  // If no toneOfVoiceId provided, get all for organization
  const examples: Array<ExampleMessage> = [];
  for await (const example of ctx.db
    .query('exampleMessages')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )) {
    examples.push(example);
  }
  return examples;
}
