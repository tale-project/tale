/**
 * Load database workflow data
 *
 * Loads workflow definition and steps from database
 */

import type { MutationCtx } from '../../../_generated/server';
import type { Id, Doc } from '../../../_generated/dataModel';
import type { WorkflowType } from '../../types/workflow';
import { buildStepsConfigMap } from './build_steps_config_map';
import type { WorkflowData } from './workflow_data';
import { validateWorkflowSteps } from './validate_workflow_steps';

/**
 * Load database workflow data
 *
 * @param ctx - Mutation context
 * @param wfDefinitionId - Workflow definition ID
 * @returns Workflow data with database document types
 */
export async function loadDatabaseWorkflow(
  ctx: MutationCtx,
  wfDefinitionId: Id<'wfDefinitions'>,
): Promise<WorkflowData<Doc<'wfDefinitions'>, Doc<'wfStepDefs'>>> {
  // 1) Load the requested definition
  const requestedDefinition = await ctx.db.get(wfDefinitionId);
  if (!requestedDefinition) {
    throw new Error(`Workflow definition ${wfDefinitionId} not found`);
  }

  // 2) If the requested definition is not executable (neither active nor draft),
  //    attempt to fall back to an executable version:
  //    - First, walk parentVersionId chain to find an active ancestor
  //    - If none found, look up any active version by organizationId + name
  const allowedStatuses = new Set(['active', 'draft']);
  let effectiveDefinition: Doc<'wfDefinitions'> =
    requestedDefinition as Doc<'wfDefinitions'>;

  if (!allowedStatuses.has(effectiveDefinition.status as unknown as string)) {
    // Try walking up the parentVersionId chain to find an active ancestor
    const visited = new Set<string>();
    let candidate: Doc<'wfDefinitions'> | null = effectiveDefinition;

    while (
      candidate &&
      (candidate.status as unknown as string) !== 'active' &&
      candidate.parentVersionId &&
      !visited.has(candidate._id as unknown as string)
    ) {
      visited.add(candidate._id as unknown as string);
      const parent = (await ctx.db.get(
        candidate.parentVersionId as Id<'wfDefinitions'>,
      )) as Doc<'wfDefinitions'> | null;
      if (!parent) break;
      candidate = parent;
    }

    if (candidate && (candidate.status as unknown as string) === 'active') {
      console.log(
        '[loadDatabaseWorkflow] Falling back to active ancestor via parentVersionId',
        { requestedId: wfDefinitionId, activeId: candidate._id },
      );
      effectiveDefinition = candidate;
    } else {
      // As a secondary fallback, find any active version with the same name
      const active = await ctx.db
        .query('wfDefinitions')
        .withIndex('by_org_name_status', (q) =>
          q
            .eq('organizationId', requestedDefinition.organizationId)
            .eq('name', requestedDefinition.name)
            .eq('status', 'active'),
        )
        .first();

      if (active) {
        console.log(
          '[loadDatabaseWorkflow] Falling back to active version by name',
          { requestedId: wfDefinitionId, activeId: active._id },
        );
        effectiveDefinition = active as Doc<'wfDefinitions'>;
      }
    }
  }

  // 3) Load steps for the effective definition
  const steps = await ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) =>
      q.eq('wfDefinitionId', effectiveDefinition._id as Id<'wfDefinitions'>),
    )
    .collect();

  const orderedSteps = steps.sort((a, b) => a.order - b.order);

  // Validate workflow steps configuration before execution
  validateWorkflowSteps(orderedSteps);

  const stepsConfigMap = buildStepsConfigMap(orderedSteps);

  // Build complete workflow config with metadata
  const sanitizedConfig = { ...(effectiveDefinition.config || {}) } as Record<
    string,
    unknown
  >;

  const completeWorkflowConfig = {
    name: effectiveDefinition.name,
    description: effectiveDefinition.description,
    version: effectiveDefinition.version,
    workflowType: (effectiveDefinition as { workflowType?: WorkflowType })
      .workflowType,
    config: sanitizedConfig,
  };

  const workflowConfigJson = JSON.stringify(completeWorkflowConfig);

  return {
    definition: effectiveDefinition,
    steps: orderedSteps,
    stepsConfigMap,
    workflowConfigJson,
  };
}
