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
// NOTE: the governance endpoint paths + field names below are verified
// against the pinned maximhq/bifrost:v1.4.8 (transports/bifrost-http/
// handlers/governance.go at tag transports/v1.4.8): VK create takes
// `name` (required) + `provider_configs[]` (array, per-provider
// allowed_models) + `budget` (singular; reset_duration must parse as a
// duration — 'never' is rejected), `team_id`/`customer_id` are mutually
// exclusive FK references (we encode attribution in `name` instead), and
// the response wraps the key as `{ virtual_key: { id, value } }`.

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

/**
 * Tale model refs are colon-qualified (`openrouter:anthropic/claude-sonnet-4.6`,
 * optionally with a quantization qualifier like `@fp8`) but Bifrost routes on
 * the first slash (`provider/model`) and rejects the colon form as an invalid
 * model ID (verified against v1.4.8). Upstreams don't understand the Tale
 * quantization qualifier either (the in-platform chat path strips it before
 * calling the provider), so drop it here too. Translate at this boundary
 * only — everything platform-side keeps the Tale ref.
 */
export function toGatewayModelRef(taleModelRef: string): string {
  return taleModelRef.replace(':', '/').replace(/@[^@/]+$/, '');
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
  // Group allowed models by gateway provider; allow both the bare and the
  // provider-qualified spellings so the allowlist matches however the
  // resolver normalizes the request model.
  const byProvider = new Map<string, string[]>();
  for (const taleRef of args.allowedModels) {
    const gatewayRef = toGatewayModelRef(taleRef);
    const slash = gatewayRef.indexOf('/');
    const provider = slash === -1 ? gatewayRef : gatewayRef.slice(0, slash);
    const bare = slash === -1 ? gatewayRef : gatewayRef.slice(slash + 1);
    const models = byProvider.get(provider) ?? [];
    models.push(bare, gatewayRef);
    byProvider.set(provider, models);
  }
  const body = {
    // team_id/customer_id are mutually-exclusive FK references in Bifrost;
    // we anchor attribution in the (required) name instead. Bifrost has no
    // native TTL; the session watchdog revokes on expiry.
    name: `tale-${args.organizationId}-${args.sessionId}-${Date.now().toString(36)}`,
    provider_configs: [...byProvider.entries()].map(
      ([provider, allowedModels]) => ({
        provider,
        allowed_models: allowedModels,
      }),
    ),
    budget: {
      max_limit: args.budgetCents / 100, // governance API is dollars
      // Smallest accepted horizon ('never' is rejected); the key is revoked
      // at turn end, long before any reset matters.
      reset_duration: '1M',
    },
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
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as {
    virtual_key?: { id?: string; value?: string };
  };
  const key = parsed.virtual_key?.value;
  const keyId = parsed.virtual_key?.id;
  if (!key || !keyId) {
    throw new Error('bifrost mint key returned no key/id');
  }
  return { key, keyId };
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
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
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
