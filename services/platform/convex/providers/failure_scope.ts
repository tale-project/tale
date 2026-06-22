/**
 * Failure-scope identities for the model fallback loop.
 *
 * When a model fails with a *deterministic* provider-level error, every model
 * that shares the failing resource is doomed too and should be skipped — but
 * the resource is NOT the provider name. It is:
 *
 * - the **credential** (provider + API key) for out-of-funds (402) and invalid
 *   key (401/403) — these are account/key-level, so two models on the same
 *   provider with DIFFERENT per-model `secretsEnv` keys are independent;
 * - the **endpoint** (provider + baseUrl) for an unreachable host — this is
 *   provider-wide (models can't override baseUrl).
 *
 * Keying the dead-set by these identities (instead of the provider name) means
 * a sibling model with its own key is still tried after the first key fails.
 *
 * Pure, V8-safe module (no Node, no crypto): the key fingerprint is a plain
 * FNV-1a hash, used only to bucket identical keys without holding the raw key
 * in the set — not a security primitive.
 */

import type { ChatErrorCode } from '../../lib/shared/chat-errors';

/** The minimal resolved-model shape these helpers need. */
interface ScopeModelData {
  providerName: string;
  /** Per-model API key; absent for keyless/local providers (treated as ''). */
  apiKey?: string;
  /** Endpoint base URL; absent when the provider default is used (treated as ''). */
  baseUrl?: string;
}

/** FNV-1a 32-bit → 8-char hex. Stable, non-reversible bucket id for an API key. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Credential identity: provider + API key (funds / auth are key-scoped). */
export function credentialScopeKey(data: ScopeModelData): string {
  return `cred:${data.providerName}:${fingerprint(data.apiKey ?? '')}`;
}

/** Endpoint identity: provider + baseUrl (reachability is endpoint-scoped). */
export function endpointScopeKey(data: ScopeModelData): string {
  return `host:${data.providerName}:${data.baseUrl ?? ''}`;
}

/** Every scope a model belongs to — for dead-set membership tests. */
export function modelScopeKeys(data: ScopeModelData): readonly string[] {
  return [credentialScopeKey(data), endpointScopeKey(data)];
}

/**
 * The scope a deterministic provider-level failure retires for THIS model, or
 * `null` when the error is not deterministic-provider-level (nothing is retired,
 * so the next model — even on the same provider — is still attempted).
 */
export function retiredScopeKey(
  code: ChatErrorCode,
  data: ScopeModelData,
): string | null {
  if (code === 'provider_unreachable') return endpointScopeKey(data);
  if (code === 'credit_exhausted' || code === 'auth_error') {
    return credentialScopeKey(data);
  }
  return null;
}

/** True if any of the model's scopes has already been retired this turn. */
export function isModelScopeRetired(
  data: ScopeModelData,
  deadScopes: ReadonlySet<string>,
): boolean {
  return modelScopeKeys(data).some((key) => deadScopes.has(key));
}
