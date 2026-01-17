/**
 * Trigger a manual rescan of a website
 */

import type { MutationCtx } from '../_generated/server';
import type { Id, Doc } from '../_generated/dataModel';
import { api } from '../_generated/api';

/**
 * Trigger a manual rescan of a website
 *
 * - Finds the attached workflow (by metadata.workflowId, else by naming convention)
 * - Starts the workflow immediately as a manual run
 * - Updates website status and lastScannedAt optimistically
 */
export async function rescanWebsite(
  ctx: MutationCtx,
  websiteId: Id<'websites'>,
): Promise<Doc<'websites'> | null> {
  const website = await ctx.db.get(websiteId);
  if (!website) {
    throw new Error('Website not found');
  }

  // Normalize domain for consistency
  const ensureUrl = (s: string) =>
    s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`;
  const normalizedDomain = new URL(ensureUrl(website.domain)).hostname;

  // If stored domain includes protocol/path, normalize it when safe (no conflict)
  if (normalizedDomain !== website.domain) {
    const conflict = await ctx.db
      .query('websites')
      .withIndex('by_organizationId_and_domain', (q) =>
        q
          .eq('organizationId', website.organizationId)
          .eq('domain', normalizedDomain),
      )
      .first();
    if (!conflict) {
      await ctx.db.patch(websiteId, { domain: normalizedDomain });
    }
  }

  // Resolve the attached workflow id from metadata only.
  const metadata =
    (website.metadata as Record<string, unknown> | undefined) ?? {};
  const workflowId = metadata['workflowId'] as Id<'wfDefinitions'> | undefined;

  if (!workflowId) {
    throw new Error('Attached workflowId missing from website metadata');
  }

  if (!workflowId) {
    throw new Error('Attached workflow not found for this website');
  }

  // Start the workflow immediately using the engine executor directly
  await ctx.runMutation(api.workflow_engine.engine.startWorkflow, {
    organizationId: website.organizationId,
    wfDefinitionId: workflowId,
    input: { websiteId: website._id, domain: normalizedDomain },
    triggeredBy: 'manual',
    triggerData: {
      triggerType: 'manual',
      reason: 'rescan',
      timestamp: Date.now(),
    },
  });

  // Optimistically update the last scanned timestamp/status
  await ctx.db.patch(websiteId, {
    lastScannedAt: Date.now(),
    status: 'active',
  });

  return await ctx.db.get(websiteId);
}
