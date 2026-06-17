/**
 * Update execution metadata (merge)
 */

import { isRecord } from '../../../lib/utils/type-utils';
import type { MutationCtx } from '../../_generated/server';
import type { UpdateExecutionMetadataArgs } from './types';

/**
 * Merge a patch into an execution's serialized metadata without dropping
 * existing keys (e.g. `componentWorkflowIds`, which the step-journal loader
 * depends on). Failure paths must use this instead of replacing the JSON
 * string wholesale.
 */
export function mergeExecutionMetadata(
  current: string | undefined | null,
  patch: Record<string, unknown>,
): string {
  let parsed: Record<string, unknown> = {};
  if (current) {
    try {
      const value: unknown = JSON.parse(current);
      if (isRecord(value)) parsed = value;
    } catch (error) {
      console.warn(
        'mergeExecutionMetadata: failed to parse existing metadata, replacing it:',
        error,
      );
    }
  }
  return JSON.stringify({ ...parsed, ...patch });
}

export async function updateExecutionMetadata(
  ctx: MutationCtx,
  args: UpdateExecutionMetadataArgs,
): Promise<null> {
  const current = await ctx.db.get(args.executionId);

  await ctx.db.patch(args.executionId, {
    metadata: mergeExecutionMetadata(current?.metadata, args.metadata),
    updatedAt: Date.now(),
  });
  return null;
}
