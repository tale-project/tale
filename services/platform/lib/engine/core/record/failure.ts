/**
 * Why a step failed, as a stable reason a reader can explain in their own
 * language: set where the failure is raised, never read back out of an
 * English message. The run-level `code` (`Run.failureCode`) names the family
 * an integrator branches on; the reason names the cause within it.
 */

/** Every reason a step can fail with. A newer server may answer a reason an
 * older reader does not know; readers fall back to the run-level code. */
export const STEP_FAILURE_REASONS = [
  'EXPR_SYNTAX',
  'EXPR_READ_MISSING',
  'EXPR_NAME_UNKNOWN',
  'EXPR_NOT_FUNCTION',
  'EXPR_FAILED',
  'EXPR_TIMEOUT',
  'TEMPLATE_VALUE_MISSING',
  'FOREACH_NOT_LIST',
  'CODE_NO_RESULT',
  'CODE_FAILED',
  'CODE_TIMEOUT',
  'CONNECTOR_CREDENTIAL_MISSING',
  'CONNECTOR_INPUT_REFUSED',
  'CONNECTOR_AUTH',
  'CONNECTOR_NOT_FOUND',
  'CONNECTOR_RATE_LIMITED',
  'CONNECTOR_UNREACHABLE',
  'CONNECTOR_FAILED',
  'LLM_OUTPUT_INVALID',
  'LLM_PROVIDER',
  'AGENT_FAILED',
  'SUBAUTOMATION_FAILED',
  'SUBAUTOMATION_INPUT_REFUSED',
  'SUBAUTOMATION_NOT_FOUND',
  'SUBAUTOMATION_TOO_DEEP',
  'APPROVAL_REJECTED',
  'EXECUTION_LIMIT',
  'EFFECT_IN_DOUBT_FAILED',
  'UNKNOWN',
] as const;

export type StepFailureReason = (typeof STEP_FAILURE_REASONS)[number];
