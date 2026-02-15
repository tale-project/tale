/**
 * Validate Operation Scopes
 *
 * Checks that the integration's configured scopes include all scopes
 * required by an operation. Throws a clear error if scopes are missing.
 */

import type { Doc } from '../../../../_generated/dataModel';

interface OperationConfig {
  name?: string;
  requiredScopes?: string[];
}

export function validateOperationScopes(
  operationConfig: OperationConfig | null | undefined,
  integration: Doc<'integrations'>,
  operationName: string,
): void {
  const requiredScopes = operationConfig?.requiredScopes;
  if (!requiredScopes || requiredScopes.length === 0) {
    return;
  }

  if (integration.authMethod !== 'oauth2') {
    return;
  }

  const configuredScopes = integration.oauth2Config?.scopes ?? [];

  const missingScopes = requiredScopes.filter(
    (scope) => !configuredScopes.includes(scope),
  );

  if (missingScopes.length > 0) {
    throw new Error(
      `Operation "${operationName}" requires scopes: [${missingScopes.join(', ')}] ` +
        `which are not configured. ` +
        `Current scopes: [${configuredScopes.join(', ')}]. ` +
        `Update the integration's scopes and re-authorize.`,
    );
  }
}
