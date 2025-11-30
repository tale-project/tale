/**
 * Internal query to load example messages for AI processing
 */

import { QueryCtx } from '../../_generated/server';
import { ExampleMessageContent } from './types';

export async function loadExampleMessagesForGeneration(
  ctx: QueryCtx,
  args: { organizationId: string },
): Promise<Array<ExampleMessageContent>> {
  const examples = await ctx.db
    .query('exampleMessages')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .collect();

  return examples.map((example) => ({
    content: example.content,
  }));
}
