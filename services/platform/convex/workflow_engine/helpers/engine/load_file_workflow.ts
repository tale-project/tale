/**
 * Load file-based workflow data.
 *
 * Converts a WorkflowJsonConfig into the same WorkflowData shape
 * used by the engine, allowing the same executeWorkflowStart path.
 */

import type {
  WorkflowJsonConfig,
  WorkflowStep,
} from '../../../../lib/shared/schemas/workflows';
import type { WorkflowDefinition, StepDefinition } from '../data_source/types';
import type { WorkflowData } from './workflow_data';

import { validateWorkflowSteps } from '../validation/validate_workflow_steps';
import { buildStepsConfigMap } from './build_steps_config_map';

/**
 * Convert a file-based workflow JSON config into WorkflowData for the engine.
 *
 * @param config - Parsed workflow JSON config
 * @param workflowSlug - The file path slug (e.g., "general/conversation-sync")
 * @param organizationId - The org this workflow belongs to
 */
export function loadFileWorkflow(
  config: WorkflowJsonConfig,
  workflowSlug: string,
  organizationId: string,
): WorkflowData<WorkflowDefinition, StepDefinition> {
  const definition: WorkflowDefinition = {
    _id: workflowSlug,
    organizationId,
    name: config.name,
    description: config.description,
    version: config.version ?? '1.0.0',
    status: config.enabled ? 'active' : 'inactive',
    workflowType: 'predefined',
    config: config.config
      ? {
          timeout: config.config.timeout,
          retryPolicy: config.config.retryPolicy,
          variables: config.config.variables,
        }
      : undefined,
  };

  const steps: Array<
    StepDefinition & { stepSlug: string; order: number; config: unknown }
  > = config.steps.map((step: WorkflowStep, index: number) => ({
    _id: `${workflowSlug}:${step.stepSlug}`,
    organizationId,
    wfDefinitionId: workflowSlug,
    stepSlug: step.stepSlug,
    name: step.name,
    stepType: step.stepType,
    order: step.order ?? index,
    config: step.config,
    nextSteps: step.nextSteps,
    description: step.description,
  }));

  const orderedSteps = steps.sort((a, b) => a.order - b.order);

  validateWorkflowSteps(orderedSteps);

  const stepsConfigMap = buildStepsConfigMap(orderedSteps);

  const workflowConfigJson = JSON.stringify({
    name: definition.name,
    description: definition.description,
    version: definition.version,
    workflowType: definition.workflowType,
    config: definition.config ?? {},
  });

  return {
    definition,
    steps: orderedSteps,
    stepsConfigMap,
    workflowConfigJson,
  };
}
