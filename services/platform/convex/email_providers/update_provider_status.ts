/**
 * Update email provider status
 */

import type { MutationCtx } from '../_generated/server';
import type { UpdateProviderStatusArgs } from './types';

export async function updateProviderStatus(
  ctx: MutationCtx,
  args: UpdateProviderStatusArgs,
): Promise<null> {
  const { providerId, ...patch } = args;
  await ctx.db.patch(providerId, patch);
  return null;
}
