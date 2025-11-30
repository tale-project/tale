/**
 * Workflow Node Constants
 *
 * Centralized constants for workflow node ports and common values.
 */

// =============================================================================
// PORT CONSTANTS
// =============================================================================

/**
 * Common ports used across different node types
 */
export const PORTS = {
  // Loop node ports
  LOOP: 'loop',
  DONE: 'done',

  // Condition node ports
  TRUE: 'true',
  FALSE: 'false',

  // Action node ports
  SUCCESS: 'success',
} as const;

/**
 * Type for all valid port values
 */
export type Port = (typeof PORTS)[keyof typeof PORTS];
