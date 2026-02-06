/**
 * Validate Workflow Definition
 *
 * Validates a complete workflow definition structure.
 * Checks:
 * - Valid stepTypes (trigger, llm, action, condition, loop)
 * - Required fields for each step type
 * - Valid nextSteps references
 * - Config structure for each step type
 * - Variable references (step existence, execution order, path structure)
 */

import { isValidStepType } from './constants';
import type { WorkflowValidationResult } from './types';
import { validateStepConfig } from './validate_step_config';
import { validateWorkflowSteps } from './validate_workflow_steps';
import { validateWorkflowVariableReferences } from './variables';
import { validateCircularDependencies } from './circular_dependency_validator';

// Re-export types for backward compatibility
export type { WorkflowValidationResult } from './types';

/**
 * Validate a complete workflow definition.
 *
 * @param workflowConfig - Workflow configuration object (must have name)
 * @param stepsConfig - Array of step configuration objects
 * @returns Validation result with errors and warnings
 */
export function validateWorkflowDefinition(
  workflowConfig: { name?: string },
  stepsConfig: Array<Record<string, unknown>>,
): WorkflowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate workflow config
  if (!workflowConfig.name || typeof workflowConfig.name !== 'string') {
    errors.push('Workflow config must have a "name" field (string)');
  }

  // Validate each step
  for (let i = 0; i < stepsConfig.length; i++) {
    const step = stepsConfig[i];
    const stepSlug = (step as { stepSlug?: string }).stepSlug || 'unknown';
    const stepPrefix = `Step ${i + 1} (${stepSlug}):`;

    // Validate basic step structure
    if (!step || typeof step !== 'object') {
      errors.push(`${stepPrefix} Step must be an object`);
      continue;
    }

    // Validate fields that are not covered by validateStepConfig
    if (typeof (step as { order?: unknown }).order !== 'number') {
      errors.push(
        `${stepPrefix} Missing or invalid "order" field (must be number)`,
      );
    }

    if (
      !(step as { nextSteps?: unknown }).nextSteps ||
      typeof (step as { nextSteps?: unknown }).nextSteps !== 'object'
    ) {
      errors.push(
        `${stepPrefix} Missing or invalid "nextSteps" field (must be object)`,
      );
    }

    // Delegate step-level validation
    const stepValidation = validateStepConfig({
      stepSlug:
        typeof (step as { stepSlug?: unknown }).stepSlug === 'string'
          ? ((step as { stepSlug?: unknown }).stepSlug as string)
          : undefined,
      name:
        typeof (step as { name?: unknown }).name === 'string'
          ? ((step as { name?: unknown }).name as string)
          : undefined,
      stepType:
        typeof (step as { stepType?: unknown }).stepType === 'string'
          ? ((step as { stepType?: unknown }).stepType as string)
          : undefined,
      config: (step as { config?: unknown }).config,
    });

    if (!stepValidation.valid) {
      for (const message of stepValidation.errors) {
        errors.push(`${stepPrefix} ${message}`);
      }
    }

    if (stepValidation.warnings) {
      for (const message of stepValidation.warnings) {
        warnings.push(`${stepPrefix} ${message}`);
      }
    }

    // Additional warnings for action type matching stepType
    const config = (step as { config?: unknown }).config as
      | Record<string, unknown>
      | undefined;
    if (
      (step as { stepType?: unknown }).stepType === 'action' &&
      config &&
      typeof config === 'object' &&
      'type' in config
    ) {
      const actionType = config.type as string;
      if (isValidStepType(actionType)) {
        warnings.push(
          `${stepPrefix} Action type "${actionType}" matches a stepType name. Did you mean stepType: "${actionType}"?`,
        );
      }
    }
  }

  // Validate nextSteps references
  try {
    validateWorkflowSteps(
      stepsConfig as Array<{
        stepSlug: string;
        name: string;
        nextSteps?: Record<string, string>;
      }>,
    );
  } catch (e) {
    errors.push(
      `Invalid nextSteps references: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Validate circular dependencies
  const validStepsForCircularCheck = stepsConfig.filter(
    (step): step is { stepSlug: string; nextSteps?: Record<string, string> } =>
      step !== null &&
      typeof step === 'object' &&
      typeof (step as { stepSlug?: unknown }).stepSlug === 'string',
  );
  const circularDepResult = validateCircularDependencies(
    validStepsForCircularCheck,
  );
  errors.push(...circularDepResult.errors);
  warnings.push(...circularDepResult.warnings);

  // Check for trigger or start step
  const hasTrigger = stepsConfig.some((step) => step.stepType === 'start' || step.stepType === 'trigger');
  if (!hasTrigger) {
    warnings.push(
      'No start or trigger step found. Workflows should start with a start or trigger step.',
    );
  }

  // Validate variable references (step existence, execution order, path structure)
  const variableRefValidation = validateWorkflowVariableReferences(stepsConfig);
  errors.push(...variableRefValidation.errors);
  warnings.push(...variableRefValidation.warnings);

  return { valid: errors.length === 0, errors, warnings };
}
