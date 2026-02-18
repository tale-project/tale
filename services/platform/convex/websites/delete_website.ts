/**
 * Delete a website and its attached Website Scan workflow (if any)
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { toId } from '../lib/type_cast_helpers';
import { deleteWorkflow as deleteWorkflowModel } from '../workflows/definitions/delete_workflow';

/**
 * Delete a website and its attached Website Scan workflow (if any)
 */
export async function deleteWebsite(
  ctx: MutationCtx,
  websiteId: Id<'websites'>,
): Promise<null> {
  const website = await ctx.db.get(websiteId);
  if (!website) {
    throw new Error('Website not found');
  }

  const metadata = isRecord(website.metadata) ? website.metadata : undefined;
  const workflowIdStr = metadata
    ? getString(metadata, 'workflowId')
    : undefined;

  if (workflowIdStr) {
    await deleteWorkflowModel(ctx, toId<'wfDefinitions'>(workflowIdStr));
  }

  await ctx.db.delete(websiteId);
  return null;
}
