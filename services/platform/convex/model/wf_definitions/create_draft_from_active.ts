/**
 * Create a draft workflow version from an active workflow.
 *
 * This model function encapsulates all versioning and step-cloning logic.
 */

import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';

export interface CreateDraftFromActiveArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  createdBy: string;
}

export interface CreateDraftFromActiveResult {
  draftId: Id<'wfDefinitions'>;
  isNewDraft: boolean;
}

export async function createDraftFromActive(
  ctx: MutationCtx,
  args: CreateDraftFromActiveArgs,
): Promise<CreateDraftFromActiveResult> {
  const activeWorkflow = await ctx.db.get(args.wfDefinitionId);

  if (!activeWorkflow) {
    throw new Error('Workflow not found');
  }

  if (activeWorkflow.status !== 'active') {
    throw new Error('Can only create drafts from active workflows');
  }

  // Check if draft already exists for this workflow (same org + name + draft status)
  const existingDraft = await ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_name_status', (q) =>
      q
        .eq('organizationId', activeWorkflow.organizationId)
        .eq('name', activeWorkflow.name)
        .eq('status', 'draft'),
    )
    .first();

  if (existingDraft) {
    return { draftId: existingDraft._id, isNewDraft: false };
  }

  // Load all steps from the active version
  const steps: Array<Doc<'wfStepDefs'>> = [];
  for await (const step of ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) =>
      q.eq('wfDefinitionId', args.wfDefinitionId),
    )) {
    steps.push(step);
  }

  // Create new draft version
  const newVersionNumber = activeWorkflow.versionNumber + 1;
  const rootVersionId = activeWorkflow.rootVersionId;

  const draftId = await ctx.db.insert('wfDefinitions', {
    organizationId: activeWorkflow.organizationId,
    name: activeWorkflow.name,
    description: activeWorkflow.description,
    category: activeWorkflow.category,
    version: `v${newVersionNumber}`,
    versionNumber: newVersionNumber,
    status: 'draft',
    workflowType: activeWorkflow.workflowType,
    config: activeWorkflow.config,
    ...(rootVersionId ? { rootVersionId } : {}),
    parentVersionId: activeWorkflow._id,
    metadata: {
      ...(activeWorkflow.metadata || {}),
      createdAt: Date.now(),
      createdBy: args.createdBy,
      basedOnVersion: activeWorkflow.version,
    },
  });

  // Copy steps to new draft
  for (const step of steps) {
    await ctx.db.insert('wfStepDefs', {
      organizationId: step.organizationId,
      wfDefinitionId: draftId,
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

  return { draftId, isNewDraft: true };
}

