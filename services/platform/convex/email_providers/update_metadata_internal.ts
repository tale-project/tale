/**
 * Update provider metadata
 */

import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

interface UpdateMetadataInternalArgs {
  id: Doc<'emailProviders'>['_id'];
  config: Record<string, string | number | boolean>;
}

export async function updateMetadataInternal(
  ctx: MutationCtx,
  args: UpdateMetadataInternalArgs,
): Promise<null> {
  const provider = await ctx.db.get(args.id);
  if (!provider) {
    throw new Error('Email provider not found');
  }

  // Merge config with existing metadata
  const updatedMetadata = {
    ...provider.metadata,
    ...args.config,
  };

  await ctx.db.patch(args.id, {
    metadata: updatedMetadata,
  });

  return null;
}
