/**
 * Validation Constants
 *
 * Shared constants for workflow validation.
 * This is the single source of truth for step types and trigger types.
 */

// =============================================================================
// STEP TYPES
// =============================================================================

/**
 * Valid workflow step types.
 *
 * IMPORTANT: When adding new step types, also update:
 * - steps/ directory (add new validator)
 * - variables/step_schemas.ts (add output schema)
 * - validate_step_config.ts (add to switch statement)
 */
export const VALID_STEP_TYPES = [
  'trigger',
  'llm',
  'condition',
  'action',
  'loop',
] as const;

export type StepType = (typeof VALID_STEP_TYPES)[number];

/**
 * Type guard to check if a value is a valid step type
 */
export function isValidStepType(value: unknown): value is StepType {
  return typeof value === 'string' && VALID_STEP_TYPES.includes(value as StepType);
}

// =============================================================================
// TRIGGER TYPES
// =============================================================================

/**
 * Valid trigger types for trigger steps.
 */
export const VALID_TRIGGER_TYPES = ['manual', 'scheduled', 'webhook', 'event'] as const;

export type TriggerType = (typeof VALID_TRIGGER_TYPES)[number];

/**
 * Type guard to check if a value is a valid trigger type
 */
export function isValidTriggerType(value: unknown): value is TriggerType {
  return typeof value === 'string' && VALID_TRIGGER_TYPES.includes(value as TriggerType);
}

