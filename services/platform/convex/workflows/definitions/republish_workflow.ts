/**
 * Republish a workflow by activating its latest archived version.
 * Accepts any version ID (including root) and finds the latest archived version.
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { activateVersion } from './activate_version';
import type { ActivateVersionResult } from './types';

export interface RepublishWorkflowArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  publishedBy: string;
}

export async function republishWorkflow(
  ctx: MutationCtx,
  args: RepublishWorkflowArgs,
): Promise<ActivateVersionResult> {
  const workflow = await ctx.db.get(args.wfDefinitionId);
  if (!workflow) {
    throw new Error(`Workflow ${args.wfDefinitionId} not found`);
  }

  let latestArchived: { _id: Id<'wfDefinitions'>; versionNumber: number } | null = null;
  for await (const version of ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_name_status', (q) =>
      q
        .eq('organizationId', workflow.organizationId)
        .eq('name', workflow.name)
        .eq('status', 'archived'),
    )) {
    if (!latestArchived || version.versionNumber > latestArchived.versionNumber) {
      latestArchived = { _id: version._id, versionNumber: version.versionNumber };
    }
  }

  if (!latestArchived) {
    throw new Error('No archived version found to republish');
  }

  return await activateVersion(ctx, {
    wfDefinitionId: latestArchived._id,
    activatedBy: args.publishedBy,
  });
}
