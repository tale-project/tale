/**
 * Delete a website and its attached Website Scan workflow (if any)
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
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

  const metadata = (website.metadata || {}) as {
    workflowId?: Id<'wfDefinitions'>;
  };
  const workflowId = metadata.workflowId;

  if (workflowId) {
    await deleteWorkflowModel(ctx, workflowId);
  }

  await ctx.db.delete(websiteId);
  return null;
}
