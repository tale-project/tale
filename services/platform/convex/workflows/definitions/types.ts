/**
 * Type definitions for workflow definitions
 */

import type { Infer } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { StepConfig } from '../../workflow_engine/types/nodes';
import type { StepType } from '../steps/types';
import {
  workflowConfigValidator,
  workflowStatusValidator,
  workflowTypeValidator,
} from './validators';

// =============================================================================
// INFERRED TYPES (from validators)
// =============================================================================

export type WorkflowStatus = Infer<typeof workflowStatusValidator>;
export type WorkflowType = Infer<typeof workflowTypeValidator>;
export type WorkflowConfig = Infer<typeof workflowConfigValidator>;

// =============================================================================
// MANUAL TYPES (no corresponding validator)
// =============================================================================

export type WorkflowDefinition = Doc<'wfDefinitions'>;

export interface WorkflowDefinitionWithFirstStep extends WorkflowDefinition {
  firstStepSlug: string | null;
}

export interface PublishDraftResult {
  activeVersionId: Id<'wfDefinitions'>;
}

export interface ActivateVersionResult {
  activeVersionId: Id<'wfDefinitions'>;
  newDraftId: Id<'wfDefinitions'>;
}

/**
 * Type for predefined workflow definitions (imported from JS/TS files).
 * Uses loose types to accommodate the inferred types from predefined workflow files.
 * The values are validated at runtime by Convex validators.
 */
export interface PredefinedWorkflowDefinition {
  workflowConfig: {
    name: string;
    description?: string;
    version?: string;
    workflowType?: string;
    config?: Record<string, unknown>;
  };
  stepsConfig: Array<{
    stepSlug: string;
    name: string;
    stepType: string;
    order: number;
    config: unknown;
    nextSteps: Record<string, string | undefined>;
  }>;
}

// =============================================================================
// API PAYLOAD TYPES (strict types matching handler validators)
// =============================================================================

/**
 * Strict type for workflow config passed to createWorkflowWithSteps handler.
 * Matches the Convex validator exactly.
 */
export interface CreateWorkflowPayload {
  workflowConfig: {
    name: string;
    description?: string;
    version?: string;
    workflowType?: WorkflowType;
    config?: WorkflowConfig;
  };
  stepsConfig: Array<{
    stepSlug: string;
    name: string;
    stepType: StepType;
    order: number;
    config: StepConfig;
    nextSteps: Record<string, string>;
  }>;
}

/**
 * Convert a PredefinedWorkflowDefinition to the strict types expected by API handlers.
 * This is the single point where loose predefined workflow types are bridged to
 * strict API types. The Convex validators provide runtime validation.
 *
 * @param def - The predefined workflow definition with loose types
 * @param configOverrides - Optional overrides for workflowConfig
 * @param stepsTransform - Optional transform function for step configs (e.g., to set trigger schedule)
 */
export function toPredefinedWorkflowPayload(
  def: PredefinedWorkflowDefinition,
  configOverrides?: Partial<CreateWorkflowPayload['workflowConfig']>,
  stepsTransform?: (
    step: PredefinedWorkflowDefinition['stepsConfig'][number],
  ) => PredefinedWorkflowDefinition['stepsConfig'][number],
): CreateWorkflowPayload {
  const workflowConfig = {
    ...def.workflowConfig,
    ...configOverrides,
    // Bridge loose workflowType string to strict literal
    workflowType: def.workflowConfig.workflowType as WorkflowType | undefined,
    // Bridge loose config to strict WorkflowConfig
    config: (configOverrides?.config ?? def.workflowConfig.config) as
      | WorkflowConfig
      | undefined,
  };

  const stepsConfig = def.stepsConfig.map((step) => {
    const transformedStep = stepsTransform ? stepsTransform(step) : step;
    return {
      stepSlug: transformedStep.stepSlug,
      name: transformedStep.name,
      // Bridge loose stepType string to strict StepType literal
      stepType: transformedStep.stepType as StepType,
      order: transformedStep.order,
      // Bridge loose config to strict StepConfig (validated at runtime)
      config: transformedStep.config as StepConfig,
      // Filter out undefined values from nextSteps
      nextSteps: Object.fromEntries(
        Object.entries(transformedStep.nextSteps).filter(
          ([, v]) => v !== undefined,
        ),
      ) as Record<string, string>,
    };
  });

  return { workflowConfig, stepsConfig };
}
