/**
 * Delete a website and cascade-cleanup all related resources.
 *
 * Synchronous (immediate):
 *   - Delete scan workflow (via shared deleteWorkflow helper,
 *     which also cleans triggers, executions, audit logs, etc.)
 *   - Delete the website record
 *
 * Asynchronous (scheduled):
 *   - Batch-delete all website pages and their embeddings
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { toId } from '../lib/type_cast_helpers';
import { deleteWorkflow } from '../workflows/definitions/delete_workflow';

export async function deleteWebsite(
  ctx: MutationCtx,
  websiteId: Id<'websites'>,
): Promise<null> {
  const website = await ctx.db.get(websiteId);
  if (!website) {
    throw new Error('Website not found');
  }

  const metadata = isRecord(website.metadata) ? website.metadata : undefined;

  const scanWorkflowId = metadata
    ? getString(metadata, 'workflowId')
    : undefined;

  if (scanWorkflowId) {
    await deleteWorkflow(ctx, toId<'wfDefinitions'>(scanWorkflowId));
  }

  const domain = website.domain;

  await ctx.db.delete(websiteId);

  await ctx.scheduler.runAfter(
    0,
    internal.websites.internal_mutations.batchCleanupWebsitePages,
    { websiteId },
  );

  await ctx.scheduler.runAfter(
    0,
    internal.websites.internal_actions.deregisterWebsiteFromCrawler,
    { domain },
  );

  return null;
}
