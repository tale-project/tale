/**
 * Step Configuration Validator
 *
 * This module validates step configurations to ensure they meet
 * the requirements for each step type.
 */

import { validateActionParameters } from './validate_action_parameters';

export type StepType = 'trigger' | 'llm' | 'condition' | 'action' | 'loop';

// Valid trigger types
export const VALID_TRIGGER_TYPES = [
  'manual',
  'scheduled',
  'webhook',
  'event',
] as const;
export type TriggerType = (typeof VALID_TRIGGER_TYPES)[number];

export interface StepDefinitionInput {
  stepSlug?: string;
  name?: string;
  stepType?: StepType | string;
  config?: unknown;
}

export interface StepConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a single workflow step definition's basic fields and config.
 *
 * This helper is used both at authoring time (agent tool) and at runtime
 * to ensure that step definitions meet the same requirements everywhere.
 */
export function validateStepConfig(
  stepDef: StepDefinitionInput,
): StepConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Step slug (machine-readable, must be snake_case)
  if (!stepDef.stepSlug) {
    errors.push('Step slug is required');
  } else {
    // Step slug must be snake_case and contain only lowercase letters and underscores
    // Example: "first_step", "process_customer", "a"
    const snakeCaseSlugRegex = /^[a-z]+(?:_[a-z]+)*$/;
    if (!snakeCaseSlugRegex.test(stepDef.stepSlug)) {
      errors.push(
        'Step slug must be snake_case and contain only lowercase letters and underscores (e.g., "first_step")',
      );
    }
  }

  // Step name (human-readable label)
  if (!stepDef.name) {
    errors.push('Step name is required');
  }

  // Step type
  if (!stepDef.stepType) {
    errors.push('Step type is required');
    return { valid: false, errors, warnings };
  }

  const validStepTypes: StepType[] = [
    'trigger',
    'llm',
    'condition',
    'action',
    'loop',
  ];

  if (!validStepTypes.includes(stepDef.stepType as StepType)) {
    errors.push(
      `Invalid step type "${stepDef.stepType}". Must be one of: ${validStepTypes.join(
        ', ',
      )}`,
    );
    return { valid: false, errors, warnings };
  }

  // Type guard for config object
  const isConfigObject = (config: unknown): config is Record<string, unknown> =>
    typeof config === 'object' && config !== null;

  const config = stepDef.config;

  if (!isConfigObject(config)) {
    errors.push('Step config is required and must be an object');
    return { valid: false, errors, warnings };
  }

  // Type-specific validation
  switch (stepDef.stepType) {
    case 'trigger': {
      if (!('type' in config)) {
        errors.push('Trigger step requires "type" field in config');
        break;
      }

      // Validate trigger type
      const triggerType = config.type as string;
      if (!VALID_TRIGGER_TYPES.includes(triggerType as TriggerType)) {
        errors.push(
          `Invalid trigger type "${triggerType}". Must be one of: ${VALID_TRIGGER_TYPES.join(', ')}`,
        );
        break;
      }

      // Validate type-specific trigger config
      const triggerErrors = validateTriggerConfig(
        triggerType as TriggerType,
        config,
      );
      errors.push(...triggerErrors);
      break;
    }

    case 'llm': {
      // Support both direct config and { llmNode: config }
      const llmConfig =
        'llmNode' in config && typeof config.llmNode === 'object'
          ? (config.llmNode as Record<string, unknown>)
          : config;

      if (!llmConfig || typeof llmConfig !== 'object') {
        errors.push('LLM step requires valid config or llmNode');
        break;
      }

      if (!llmConfig.name) {
        errors.push('LLM step requires "name" field');
      }
      if (!llmConfig.systemPrompt) {
        errors.push('LLM step requires "systemPrompt" field');
      }
      // Model is now resolved from environment (OPENAI_MODEL) and cannot be
      // customized per step, so we intentionally do not validate a model field
      // here. Any provided model value will be ignored at execution time.
      break;
    }

    case 'condition':
      if (!('expression' in config)) {
        errors.push('Expression is required for condition steps');
      } else if (typeof config.expression !== 'string') {
        errors.push('Condition expression must be a string');
      } else if (config.expression.trim() === '') {
        errors.push('Condition expression cannot be empty');
      }
      break;

    case 'action': {
      if (!('type' in config)) {
        errors.push('Action type is required for action steps');
        break;
      }

      const actionType = config.type as string;
      // Get parameters - they can be in config.parameters or directly in config
      const parameters =
        'parameters' in config ? config.parameters : { ...config };
      // Remove 'type' from parameters if it was copied from config
      if (
        typeof parameters === 'object' &&
        parameters !== null &&
        'type' in parameters
      ) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { type: _type, ...rest } = parameters as Record<string, unknown>;
        const actionValidation = validateActionParameters(actionType, rest);
        errors.push(...actionValidation.errors);
        warnings.push(...actionValidation.warnings);
      } else {
        const actionValidation = validateActionParameters(
          actionType,
          parameters,
        );
        errors.push(...actionValidation.errors);
        warnings.push(...actionValidation.warnings);
      }
      break;
    }

    case 'loop': {
      const { maxIterations, items } = config as {
        maxIterations?: unknown;
        items?: unknown;
      };
      if (
        maxIterations !== undefined &&
        (typeof maxIterations !== 'number' || maxIterations <= 0)
      ) {
        errors.push('Max iterations must be a positive number for loop steps');
      }

      // Warn if no items source is defined
      if (items === undefined) {
        warnings.push(
          'Loop step has no "items" defined - loop may not iterate over anything',
        );
      }
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate trigger-type specific configuration
 */
function validateTriggerConfig(
  triggerType: TriggerType,
  config: Record<string, unknown>,
): string[] {
  const errors: string[] = [];

  switch (triggerType) {
    case 'scheduled':
      if (!config.schedule) {
        errors.push('Scheduled trigger requires "schedule" field (cron expression)');
      } else if (typeof config.schedule !== 'string') {
        errors.push('Scheduled trigger "schedule" must be a string (cron expression)');
      } else {
        // Basic cron expression validation (5 or 6 parts)
        const parts = (config.schedule as string).trim().split(/\s+/);
        if (parts.length < 5 || parts.length > 6) {
          errors.push(
            `Invalid cron expression "${config.schedule}". Expected 5 or 6 space-separated parts (e.g., "0 * * * *" for every hour)`,
          );
        }
      }
      break;

    case 'event':
      if (!config.eventType) {
        errors.push('Event trigger requires "eventType" field');
      } else if (typeof config.eventType !== 'string') {
        errors.push('Event trigger "eventType" must be a string');
      }
      break;

    case 'manual':
      // Manual triggers have minimal requirements - just the type
      // Optionally can have inputs and data fields
      if (config.inputs !== undefined && !Array.isArray(config.inputs)) {
        errors.push('Manual trigger "inputs" must be an array if provided');
      }
      break;

    case 'webhook':
      // Webhook triggers are flexible - minimal validation
      break;
  }

  return errors;
}
