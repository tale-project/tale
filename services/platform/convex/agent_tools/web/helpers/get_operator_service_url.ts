/**
 * Helper: getOperatorServiceUrl
 *
 * Resolve the operator service base URL from agent variables or environment.
 */

export function getOperatorServiceUrl(
  variables?: Record<string, unknown>,
): string {
  return (
    (variables?.operatorServiceUrl as string) ||
    process.env.OPERATOR_URL ||
    'http://localhost:8004'
  );
}
