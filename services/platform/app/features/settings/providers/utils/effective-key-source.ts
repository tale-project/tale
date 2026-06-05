import type { EnvSecretStatus } from '@/lib/shared/schemas/providers';

/**
 * Which source actually provides a provider's API key right now — and, when it
 * isn't the obvious one, why.
 *
 * Mirrors the provider-level slice of the backend resolver
 * (`convex/providers/secret_resolver.ts` `resolveApiKey`): an env var that
 * resolves wins over the stored file secret, which survives underneath as a
 * fallback. Model-level `secretsEnv` is intentionally out of scope here — this
 * powers the provider-level API-key surface only.
 */
export type EffectiveKeyState =
  | 'env-resolving'
  | 'env-unresolved-fallback'
  | 'env-unresolved-no-file'
  | 'env-not-prefixed'
  | 'stored-only'
  | 'none';

export function computeEffectiveKeyState(input: {
  providerEnvStatus?: EnvSecretStatus;
  hasSecret: boolean;
}): EffectiveKeyState {
  const { providerEnvStatus, hasSecret } = input;
  const name = providerEnvStatus?.name;
  if (name) {
    if (providerEnvStatus.resolved) return 'env-resolving';
    if (!providerEnvStatus.allowed) return 'env-not-prefixed';
    return hasSecret ? 'env-unresolved-fallback' : 'env-unresolved-no-file';
  }
  return hasSecret ? 'stored-only' : 'none';
}
