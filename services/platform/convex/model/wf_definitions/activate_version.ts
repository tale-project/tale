/**
 * Activate a historical version (rollback)
 * - Archives current active version
 * - Activates specified version
 * - Creates new draft based on activated version
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { ActivateVersionResult } from './types';

export interface ActivateVersionArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  activatedBy: string;
  changeLog?: string;
}

export async function activateVersion(
  ctx: MutationCtx,
  args: ActivateVersionArgs,
): Promise<ActivateVersionResult> {
  const workflow = await ctx.db.get(args.wfDefinitionId);
  if (!workflow) {
    throw new Error('Workflow not found');
  }

  // Can only activate archived versions (not draft)
  if (workflow.status === 'draft') {
    throw new Error('Cannot activate draft version. Publish it first.');
  }

  if (workflow.status === 'active') {
    throw new Error('This version is already active');
  }

  // 1. Archive current active version
  const currentActive = await ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_name_status', (q) =>
      q
        .eq('organizationId', workflow.organizationId)
        .eq('name', workflow.name)
        .eq('status', 'active'),
    )
    .first();

  if (currentActive) {
    await ctx.db.patch(currentActive._id, {
      status: 'archived',
    });
  }

  // 2. Activate specified version
  await ctx.db.patch(args.wfDefinitionId, {
    status: 'active',
    metadata: {
      ...(workflow.metadata as Record<string, unknown>),
      reactivatedAt: Date.now(),
      reactivatedBy: args.activatedBy,
      reactivationReason: args.changeLog,
    },
  });

  // 3. Get all steps from activated version
  const steps = await ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) =>
      q.eq('wfDefinitionId', args.wfDefinitionId),
    )
    .collect();

  // 4. Find highest version number to create new draft
  let maxVersionNumber = 0;
  for await (const version of ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_and_name', (q) =>
      q.eq('organizationId', workflow.organizationId).eq('name', workflow.name),
    )) {
    if (version.versionNumber > maxVersionNumber) {
      maxVersionNumber = version.versionNumber;
    }
  }
  const newVersionNumber = maxVersionNumber + 1;

  // 5. Delete existing draft (if any)
  const existingDraft = await ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_name_status', (q) =>
      q
        .eq('organizationId', workflow.organizationId)
        .eq('name', workflow.name)
        .eq('status', 'draft'),
    )
    .first();

  if (existingDraft) {
    // Delete draft's steps first
    for await (const step of ctx.db
      .query('wfStepDefs')
      .withIndex('by_definition', (q) =>
        q.eq('wfDefinitionId', existingDraft._id),
      )) {
      await ctx.db.delete(step._id);
    }
    await ctx.db.delete(existingDraft._id);
  }

  // 6. Create new draft based on activated version
  const rootVersionId = (workflow as any).rootVersionId;
  const newDraftId = await ctx.db.insert('wfDefinitions', {
    organizationId: workflow.organizationId,
    name: workflow.name,
    description: workflow.description,
    category: workflow.category,
    workflowType: (workflow as any).workflowType ?? 'predefined',

    version: `v${newVersionNumber}`,
    versionNumber: newVersionNumber,
    status: 'draft',

    config: workflow.config,

    ...(rootVersionId ? { rootVersionId } : {}),
    parentVersionId: args.wfDefinitionId,

    metadata: {
      createdAt: Date.now(),
      createdBy: args.activatedBy,
      basedOnVersion: workflow.version,
      createdByRollback: true,
    },
  });

  // 7. Copy steps to new draft
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
    newDraftId,
  };
}
