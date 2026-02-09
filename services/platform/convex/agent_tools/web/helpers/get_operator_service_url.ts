/**
 * Helper: getOperatorServiceUrl
 *
 * Resolve the operator service base URL from agent variables or environment.
 */

export function getOperatorServiceUrl(
  variables?: Record<string, unknown>,
): string {
  const fromVars = variables?.operatorServiceUrl;
  return (
    (typeof fromVars === 'string' ? fromVars : '') ||
    process.env.OPERATOR_URL ||
    'http://localhost:8004'
  );
}
