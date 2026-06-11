'use node';

// Bifrost governance-API client. The platform is the source of truth for
// providers + models; Bifrost is a derived cache. This module:
//   - provisions/reconciles the org's providers + upstream keys into Bifrost,
//   - mints a session-scoped virtual key (budget + model allowlist) at session
//     create, returning the plaintext `sk-bf-*` (injected into the sandbox)
//     plus the key id (stored, with the key's sha256, in sandboxSessionTokens),
//   - revokes the key at session destroy,
//   - pulls per-key usage for the watchdog → usageLedger sync.
//
// Raw provider API keys + the management token are Tier-0 secrets — they live
// only here (Convex) and in Bifrost, never in the sandbox.
//
// NOTE: the exact governance endpoint paths + field names are pinned to the
// Bifrost version in compose.yml (maximhq/bifrost). The shapes below follow
// docs.getbifrost.ai/features/governance/virtual-keys; re-verify against the
// pinned version's OpenAPI at integration time (an integration test guards the
// VK auth path before rollout — sessions plan §"Bifrost 集成").

import { createHash } from 'node:crypto';

function bifrostUrl(): string {
  return process.env.BIFROST_URL ?? 'http://bifrost:8080';
}

function managementHeaders(): Record<string, string> {
  const token = process.env.BIFROST_MANAGEMENT_TOKEN ?? '';
  return {
    'content-type': 'application/json',
    // Management API uses a bearer scheme distinct from the data-plane virtual
    // keys (which it explicitly rejects on the governance routes).
    authorization: `Bearer ${token}`,
  };
}

export interface MintVirtualKeyArgs {
  /** Hard spend cap; Bifrost rejects inference once exhausted. */
  budgetCents: number;
  /** Models the key may call (org allowlist). */
  allowedModels: string[];
  /** Metadata anchored to the key for usage attribution + lookup. */
  organizationId: string;
  sessionId: string;
}

export interface MintedVirtualKey {
  /** Plaintext `sk-bf-*` — injected into the sandbox, never persisted. */
  key: string;
  /** Stable id for revoke + usage queries. */
  keyId: string;
}

/** POST /api/governance/virtual-keys — mint a session-scoped key. */
export async function mintVirtualKey(
  args: MintVirtualKeyArgs,
): Promise<MintedVirtualKey> {
  const body = {
    budgets: {
      max_limit: args.budgetCents / 100, // governance API is dollars
      reset_duration: 'never',
    },
    provider_configs: { allowed_models: args.allowedModels },
    // Bifrost has no native TTL; the session watchdog revokes on expiry.
    team_id: args.organizationId,
    customer_id: args.sessionId,
    is_active: true,
  };
  const res = await fetch(`${bifrostUrl()}/api/governance/virtual-keys`, {
    method: 'POST',
    headers: managementHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`bifrost mint key failed (${res.status})`);
  }
  const parsed = (await res.json()) as { key?: string; id?: string };
  if (!parsed.key || !parsed.id) {
    throw new Error('bifrost mint key returned no key/id');
  }
  return { key: parsed.key, keyId: parsed.id };
}

/** DELETE /api/governance/virtual-keys/:id — instant revoke (session destroy /
 * watchdog). Best-effort: a 404 means it's already gone. */
export async function revokeVirtualKey(keyId: string): Promise<void> {
  const res = await fetch(
    `${bifrostUrl()}/api/governance/virtual-keys/${encodeURIComponent(keyId)}`,
    {
      method: 'DELETE',
      headers: managementHeaders(),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`bifrost revoke key failed (${res.status})`);
  }
}

export interface KeyUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costCents: number;
}

/** GET per-key usage — the watchdog/heartbeat pulls this and upserts the delta
 * into usageLedger (the single billing source of truth). */
export async function getKeyUsage(keyId: string): Promise<KeyUsage | null> {
  const res = await fetch(
    `${bifrostUrl()}/api/governance/virtual-keys/${encodeURIComponent(keyId)}/usage`,
    {
      method: 'GET',
      headers: managementHeaders(),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) return null;
  const u = (await res.json()) as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    cost?: number;
  };
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_tokens ?? 0,
    cacheWriteTokens: u.cache_write_tokens ?? 0,
    costCents: Math.round((u.cost ?? 0) * 100),
  };
}

export interface ProviderProvision {
  /** Bifrost provider name (e.g. 'openai', 'anthropic', 'openrouter', or a
   * custom name with base_provider_type 'openai'). */
  name: string;
  baseProviderType: 'openai' | 'anthropic';
  baseUrl?: string;
  apiKey: string;
  models: string[];
}

/**
 * Reconcile the org's providers into Bifrost (idempotent upsert). Called at
 * boot + on provider-config change so Bifrost's model list + upstream keys
 * track the platform (the source of truth). Key rotation only touches the
 * platform; this re-pushes.
 */
export async function provisionProviders(
  providers: ProviderProvision[],
): Promise<void> {
  for (const p of providers) {
    const body = {
      name: p.name,
      base_provider_type: p.baseProviderType,
      ...(p.baseUrl ? { network_config: { base_url: p.baseUrl } } : {}),
      keys: [{ value: p.apiKey, models: p.models }],
    };
    const res = await fetch(`${bifrostUrl()}/api/providers`, {
      method: 'PUT',
      headers: managementHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok && res.status !== 409) {
      throw new Error(
        `bifrost provision provider ${p.name} failed (${res.status})`,
      );
    }
  }
}

/** sha256 hex of a minted virtual key — what we persist (never the plaintext). */
export function hashVirtualKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
