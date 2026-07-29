/**
 * The credential's auth shape as `resolveExecution` reads it, taken from the
 * provider's own declaration of that method (subscription constraints live
 * on the provider, not the credential row). One lookup shared by every
 * surface that turns a credential row into resolver input — the composer's
 * model listing and the harness status listing — so the shape can never
 * drift between them.
 *
 * Layer A in spirit: pure data in, pure data out — no Convex imports.
 */

import type { CredentialAuth } from '../../../lib/shared/providers/resolve_execution';
import type {
  ProviderAuthMethodName,
  ProviderDefinition,
} from '../../../lib/shared/schemas/providers';

/**
 * Returns `null` when the provider does not offer the method the credential
 * names — a stale credential for a method the provider dropped — so the
 * caller simply skips it.
 */
export function credentialAuthFor(
  provider: ProviderDefinition,
  authMethod: ProviderAuthMethodName,
): CredentialAuth | null {
  const entry = provider.auth.find(
    (candidate) => candidate.method === authMethod,
  );
  if (!entry) return null;
  switch (entry.method) {
    case 'api-key':
      return { authMethod: 'api-key' };
    case 'env':
      return { authMethod: 'env' };
    case 'subscription-key':
      return { authMethod: 'subscription-key', constraints: entry.constraints };
    case 'subscription-broker':
      return {
        authMethod: 'subscription-broker',
        constraints: entry.constraints,
      };
    default: {
      const _exhaustive: never = entry;
      return _exhaustive;
    }
  }
}
