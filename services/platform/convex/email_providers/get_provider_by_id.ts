/**
 * Get email provider by ID
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { GetProviderByIdArgs } from './types';

export async function getProviderById(
  ctx: QueryCtx,
  args: GetProviderByIdArgs,
): Promise<Doc<'emailProviders'> | null> {
  const result = await ctx.db.get(args.providerId);
  return result as Doc<'emailProviders'> | null;
}
