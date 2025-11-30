/**
 * Step Configuration Validator
 *
 * This module validates step configurations to ensure they meet
 * the requirements for each step type.
 */

export type StepType = 'trigger' | 'llm' | 'condition' | 'action' | 'loop';

export interface StepDefinitionInput {
  stepSlug?: string;
  name?: string;
  stepType?: StepType | string;
  config?: unknown;
}

export interface StepConfigValidationResult {
  valid: boolean;
  errors: string[];
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
    return { valid: false, errors };
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
    return { valid: false, errors };
  }

  // Type guard for config object
  const isConfigObject = (config: unknown): config is Record<string, unknown> =>
    typeof config === 'object' && config !== null;

  const config = stepDef.config;

  if (!isConfigObject(config)) {
    errors.push('Step config is required and must be an object');
    return { valid: false, errors };
  }

  // Type-specific validation
  switch (stepDef.stepType) {
    case 'trigger':
      if (!('type' in config)) {
        errors.push('Trigger step requires "type" field in config');
      }
      break;

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
      }
      break;

    case 'action':
      if (!('type' in config)) {
        errors.push('Action type is required for action steps');
      }
      break;

    case 'loop': {
      const { maxIterations } = config as { maxIterations?: unknown };
      if (
        maxIterations !== undefined &&
        (typeof maxIterations !== 'number' || maxIterations <= 0)
      ) {
        errors.push('Max iterations must be a positive number for loop steps');
      }
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
