/**
 * Publish draft as active version
 * - Freezes current draft as active (immutable)
 * - Archives previous active version
 * - Creates new draft (version + 1)
 */

import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import type { PublishDraftResult } from './types';

export interface PublishDraftArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  publishedBy: string;
  changeLog?: string;
}

export async function publishDraft(
  ctx: MutationCtx,
  args: PublishDraftArgs,
): Promise<PublishDraftResult> {
  const workflow = await ctx.db.get(args.wfDefinitionId);
  if (!workflow) {
    throw new Error('Workflow not found');
  }

  if (workflow.status !== 'draft' && workflow.status !== 'archived') {
    throw new Error('Only draft or archived workflows can be published');
  }

  // 1. Archive previous active version (if exists)
  const previousActive = await ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_name_status', (q) =>
      q
        .eq('organizationId', workflow.organizationId)
        .eq('name', workflow.name)
        .eq('status', 'active'),
    )
    .first();

  if (previousActive) {
    await ctx.db.patch(previousActive._id, {
      status: 'archived',
    });
  }

  // 2. Set workflow as active
  await ctx.db.patch(args.wfDefinitionId, {
    status: 'active',
    publishedAt: Date.now(),
    publishedBy: args.publishedBy,
    changeLog: args.changeLog,
  });

  // 3. Get all steps from current version
  const steps: Array<Doc<'wfStepDefs'>> = [];
  for await (const step of ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) =>
      q.eq('wfDefinitionId', args.wfDefinitionId),
    )) {
    steps.push(step);
  }

  // 4. Create new draft (version + 1)
  const newVersionNumber = workflow.versionNumber + 1;
  const rootVersionId = (workflow as any).rootVersionId;
  const newDraftId = await ctx.db.insert('wfDefinitions', {
    organizationId: workflow.organizationId,
    name: workflow.name,
    description: workflow.description,
    category: workflow.category,

    version: `v${newVersionNumber}`,
    versionNumber: newVersionNumber,
    status: 'draft',
    workflowType: (workflow as any).workflowType ?? 'predefined',

    config: workflow.config,

    ...(rootVersionId ? { rootVersionId } : {}),
    parentVersionId: args.wfDefinitionId,

    metadata: {
      createdAt: Date.now(),
      createdBy: args.publishedBy,
      basedOnVersion: workflow.version,
    },
  });

  // 5. Copy steps to new draft
  for (const step of steps) {
    await ctx.db.insert('wfStepDefs', {
      organizationId: step.organizationId,
      wfDefinitionId: newDraftId,
      stepSlug: step.stepSlug,
      name: step.name,
      stepType: step.stepType,
      order: step.order,
      nextSteps: step.nextSteps,
      config: step.config,
      inputMapping: step.inputMapping,
      outputMapping: step.outputMapping,
      metadata: step.metadata,
    });
  }

  return {
    activeVersionId: args.wfDefinitionId,
  };
}
