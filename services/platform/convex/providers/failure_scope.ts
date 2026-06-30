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
  /** Model identifier, e.g. `meta-llama/llama-3.3-70b-instruct:free`. */
  modelId?: string;
  /** Per-million-token input price in cents; `0` marks a no-cost model. */
  inputCentsPerMillion?: number;
  /** Per-million-token output price in cents; `0` marks a no-cost model. */
  outputCentsPerMillion?: number;
}

/**
 * Whether a model draws on NO provider credits — so an out-of-funds failure on a
 * sibling that shares its credential must NOT retire it. Two independent signals:
 *
 * - the OpenRouter `:free` id suffix (its free variants never bill the account);
 * - explicit zero token pricing on BOTH sides (a deliberately free/local model).
 *
 * Unconfigured pricing (`undefined`) is intentionally NOT treated as free — only
 * an explicit `0` counts, so a model whose cost simply wasn't filled in stays
 * subject to credit retirement.
 */
export function isFreeModel(data: ScopeModelData): boolean {
  if (
    typeof data.modelId === 'string' &&
    data.modelId.toLowerCase().includes(':free')
  ) {
    return true;
  }
  return data.inputCentsPerMillion === 0 && data.outputCentsPerMillion === 0;
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

/** Credential identity for AUTH failures: provider + API key. */
export function credentialScopeKey(data: ScopeModelData): string {
  return `cred:${data.providerName}:${fingerprint(data.apiKey ?? '')}`;
}

/**
 * Credential identity for CREDIT (out-of-funds) failures: provider + API key.
 *
 * Distinct namespace from {@link credentialScopeKey} so the dead-set records WHY
 * the credential died. An out-of-funds failure must spare zero-cost siblings on
 * the same key (they don't draw credits); an auth failure must not. Same inputs,
 * different prefix — they never collide.
 */
export function creditScopeKey(data: ScopeModelData): string {
  return `credit:${data.providerName}:${fingerprint(data.apiKey ?? '')}`;
}

/** Endpoint identity: provider + baseUrl (reachability is endpoint-scoped). */
export function endpointScopeKey(data: ScopeModelData): string {
  return `host:${data.providerName}:${data.baseUrl ?? ''}`;
}

/**
 * The UNCONDITIONAL scopes a model belongs to — auth credential + endpoint.
 * A dead entry in either retires the model regardless of its pricing. Credit
 * retirement is conditional (free models are exempt) and handled separately in
 * {@link isModelScopeRetired}.
 */
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
  if (code === 'auth_error') return credentialScopeKey(data);
  if (code === 'credit_exhausted') return creditScopeKey(data);
  return null;
}

/**
 * True if any of the model's scopes has already been retired this turn.
 *
 * Auth-credential and endpoint deaths retire every model on the resource. A
 * CREDIT (out-of-funds) death retires only the paid models on the credential —
 * a zero-cost sibling ({@link isFreeModel}) is still attempted, because the
 * account being out of funds doesn't stop a model that costs nothing.
 */
export function isModelScopeRetired(
  data: ScopeModelData,
  deadScopes: ReadonlySet<string>,
): boolean {
  if (modelScopeKeys(data).some((key) => deadScopes.has(key))) return true;
  return deadScopes.has(creditScopeKey(data)) && !isFreeModel(data);
}
