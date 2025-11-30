/**
 * Update execution metadata (merge)
 */

import type { MutationCtx } from '../../_generated/server';
import type { UpdateExecutionMetadataArgs } from './types';

export async function updateExecutionMetadata(
  ctx: MutationCtx,
  args: UpdateExecutionMetadataArgs,
): Promise<null> {
  const current = await ctx.db.get(args.executionId);

  const currentMetadata =
    current && 'metadata' in current && current.metadata
      ? JSON.parse(current.metadata)
      : {};

  const merged = {
    ...currentMetadata,
    ...args.metadata,
  };

  await ctx.db.patch(args.executionId, {
    metadata: JSON.stringify(merged),
    updatedAt: Date.now(),
  });
  return null;
}
