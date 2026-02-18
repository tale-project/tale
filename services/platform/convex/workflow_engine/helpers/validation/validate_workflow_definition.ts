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

import type { WorkflowValidationResult } from './types';

import { isRecord, getString } from '../../../../lib/utils/type-guards';
import { validateCircularDependencies } from './circular_dependency_validator';
import { isValidStepType } from './constants';
import { validateStepConfig } from './validate_step_config';
import { validateWorkflowSteps } from './validate_workflow_steps';
import { validateWorkflowVariableReferences } from './variables';

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
    const stepSlug = getString(step, 'stepSlug') || 'unknown';
    const stepPrefix = `Step ${i + 1} (${stepSlug}):`;

    // Validate basic step structure
    if (!step || typeof step !== 'object') {
      errors.push(`${stepPrefix} Step must be an object`);
      continue;
    }

    // Validate fields that are not covered by validateStepConfig
    if (typeof step.order !== 'number') {
      errors.push(
        `${stepPrefix} Missing or invalid "order" field (must be number)`,
      );
    }

    if (!step.nextSteps || typeof step.nextSteps !== 'object') {
      errors.push(
        `${stepPrefix} Missing or invalid "nextSteps" field (must be object)`,
      );
    }

    // Delegate step-level validation
    const stepValidation = validateStepConfig({
      stepSlug: typeof step.stepSlug === 'string' ? step.stepSlug : undefined,
      name: typeof step.name === 'string' ? step.name : undefined,
      stepType: typeof step.stepType === 'string' ? step.stepType : undefined,
      config: step.config,
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
    const config = isRecord(step.config) ? step.config : undefined;
    if (step.stepType === 'action' && config && 'type' in config) {
      const actionType = getString(config, 'type');
      if (actionType && isValidStepType(actionType)) {
        warnings.push(
          `${stepPrefix} Action type "${actionType}" matches a stepType name. Did you mean stepType: "${actionType}"?`,
        );
      }
    }
  }

  // Validate nextSteps references
  try {
    validateWorkflowSteps(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stepsConfig elements match the expected shape; validated above
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
      typeof step.stepSlug === 'string',
  );
  const circularDepResult = validateCircularDependencies(
    validStepsForCircularCheck,
  );
  errors.push(...circularDepResult.errors);
  warnings.push(...circularDepResult.warnings);

  // Check for trigger or start step
  const hasTrigger = stepsConfig.some(
    (step) => step?.stepType === 'start' || step?.stepType === 'trigger',
  );
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
