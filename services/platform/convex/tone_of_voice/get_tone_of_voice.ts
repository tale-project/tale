/**
 * Get tone of voice for an organization
 */

import { QueryCtx } from '../_generated/server';
import { ToneOfVoice } from './types';

export async function getToneOfVoice(
  ctx: QueryCtx,
  args: { organizationId: string },
): Promise<ToneOfVoice | null> {
  const toneOfVoice = await ctx.db
    .query('toneOfVoice')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .first();

  return toneOfVoice;
}
