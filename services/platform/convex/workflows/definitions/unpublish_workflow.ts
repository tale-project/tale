/**
 * Unpublish a workflow by archiving its active version.
 * All triggers stop firing automatically since getActiveWorkflowVersion() returns null.
 */

import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

export interface UnpublishWorkflowArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  updatedBy: string;
}

export async function unpublishWorkflow(
  ctx: MutationCtx,
  args: UnpublishWorkflowArgs,
): Promise<null> {
  const workflow = await ctx.db.get(args.wfDefinitionId);
  if (!workflow) {
    throw new Error(`Workflow ${args.wfDefinitionId} not found`);
  }

  const activeVersion = await ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_name_status', (q) =>
      q
        .eq('organizationId', workflow.organizationId)
        .eq('name', workflow.name)
        .eq('status', 'active'),
    )
    .first();

  if (!activeVersion) {
    throw new Error('No active version found to unpublish');
  }

  await ctx.db.patch(activeVersion._id, {
    status: 'archived',
    metadata: {
      ...(activeVersion.metadata as Record<string, unknown>),
      archivedAt: Date.now(),
      archivedBy: args.updatedBy,
    },
  });

  return null;
}
