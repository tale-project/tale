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

/** Admin username for the Bifrost management plane (auth_config). */
function adminUsername(): string {
  return process.env.BIFROST_ADMIN_USERNAME ?? 'admin';
}

/** Plaintext admin password, or '' when management auth is not configured
 * (dev). When set, applyGatewayConfig enables auth_config and every /api/*
 * call must carry HTTP Basic auth. */
function adminPassword(): string {
  return process.env.BIFROST_ADMIN_PASSWORD ?? '';
}

function managementHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  // Bifrost v1.4.8's APIMiddleware authenticates /api/* with HTTP Basic
  // (admin_username/admin_password) — NOT a bearer token (the old
  // BIFROST_MANAGEMENT_TOKEN env was never read by bifrost). Send Basic when a
  // password is configured; harmless before auth_config is enabled, required
  // after. Omit entirely in dev (no password → management plane open).
  const pw = adminPassword();
  if (pw) {
    const basic = Buffer.from(`${adminUsername()}:${pw}`).toString('base64');
    headers.authorization = `Basic ${basic}`;
  }
  return headers;
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

/**
 * Cumulative spend on a virtual key, in cents, from `GET /api/governance/
 * virtual-keys/:id` → `budget.current_usage` (dollars). v1.4.8 has NO
 * `/usage` endpoint (it 404s) and the budget figure is the only authoritative
 * spend signal — it's also the only usage source that works through the
 * openrouter→deepseek path, where Claude Code's own stream reports 0 tokens.
 * Returns null on error (caller degrades to whatever the agent stream gave).
 */
export async function getVirtualKeySpendCents(
  keyId: string,
): Promise<number | null> {
  const res = await fetch(
    `${bifrostUrl()}/api/governance/virtual-keys/${encodeURIComponent(keyId)}`,
    {
      method: 'GET',
      headers: managementHeaders(),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) return null;
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as {
    virtual_key?: { budget?: { current_usage?: number } };
    budget?: { current_usage?: number };
  };
  const dollars =
    parsed.virtual_key?.budget?.current_usage ??
    parsed.budget?.current_usage ??
    null;
  // Fractional cents — the usageLedger costEstimate is a float (sub-cent turns
  // are real with cheap models), so don't round away the precision.
  return dollars === null ? null : dollars * 100;
}

/** Provider names Bifrost v1.4.8 recognizes natively (built-in base URL +
 * request shaping). Anything else is a custom provider needing
 * `custom_provider_config`, which we don't provision yet. Source:
 * core/schemas/bifrost.go @ transports/v1.4.8. */
const NATIVE_BIFROST_PROVIDERS = new Set([
  'openai',
  'azure',
  'anthropic',
  'bedrock',
  'cohere',
  'vertex',
  'mistral',
  'ollama',
  'groq',
  'sgl',
  'parasail',
  'perplexity',
  'cerebras',
  'gemini',
  'openrouter',
  'elevenlabs',
  'huggingface',
  'nebius',
  'xai',
  'replicate',
  'vllm',
  'runway',
]);

export interface ProviderProvision {
  /** Bifrost provider name. Must be one of the native names (see
   * NATIVE_BIFROST_PROVIDERS) — non-native upstreams are skipped. */
  name: string;
  baseUrl?: string;
  apiKey: string;
  /** Tale model refs the key may serve; translated to the gateway spelling. */
  models: string[];
}

/**
 * Reconcile the org's providers into Bifrost. Idempotent against the v1.4.8
 * API: `GET /api/providers` first, then `POST` only the names not already
 * present. (v1.4.8's `PUT /api/providers/:name` 500s with "record already
 * exists" on an existing provider, so create-if-absent is the safe path; key
 * rotation is a follow-up `DELETE`+`POST` if/when we need it.) Called once per
 * session create so a fresh gateway (or a new org's key) gets its upstream
 * before the first mint.
 *
 * NOTE: providers are global in Bifrost (the per-session VK scopes models, not
 * the upstream key). A deployment with two orgs holding DISTINCT keys for the
 * same provider name would need per-org provider names — out of scope for the
 * single-key-per-deployment norm; revisit if multi-key-per-provider lands.
 */
export async function provisionProviders(
  providers: ProviderProvision[],
): Promise<void> {
  const existing = await listProviderNames();
  for (const p of providers) {
    if (existing.has(p.name)) continue;
    const native = NATIVE_BIFROST_PROVIDERS.has(p.name);
    // A non-native (custom) upstream needs a base URL, but v1.4.8 routes it via
    // `custom_provider_config`, not a bare `network_config.base_url` — which we
    // don't model yet. Skip + log rather than provision a broken provider. The
    // default agents only use native providers (openrouter), so this is inert
    // for them; revisit when a custom OpenAI-compatible upstream is required.
    if (!native) {
      console.warn(
        `[bifrost] skipping non-native provider '${p.name}' (custom base-URL provisioning not supported)`,
      );
      continue;
    }
    const body = {
      provider: p.name,
      keys: [
        {
          value: p.apiKey,
          models: p.models.map(toGatewayModelRef),
          weight: 1,
        },
      ],
      // Native providers carry their own base URL — overriding it via
      // network_config.base_url breaks the built-in URL construction (verified:
      // openrouter 500s "failed to execute HTTP request"). Only widen the
      // timeout for long agent turns.
      network_config: { default_request_timeout_in_seconds: 600 },
      concurrency_and_buffer_size: { concurrency: 1000, buffer_size: 5000 },
    };
    const res = await fetch(`${bifrostUrl()}/api/providers`, {
      method: 'POST',
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

/** Names of providers already configured in Bifrost (for idempotent provision). */
async function listProviderNames(): Promise<Set<string>> {
  const res = await fetch(`${bifrostUrl()}/api/providers`, {
    method: 'GET',
    headers: managementHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return new Set();
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as { providers?: Array<{ name?: string }> };
  return new Set(
    (parsed.providers ?? []).map((p) => p.name ?? '').filter(Boolean),
  );
}

/**
 * Harden the gateway's auth posture (idempotent; safe to call every provision).
 *   - client_config.enforce_auth_on_inference = true → inference REQUIRES a
 *     minted virtual key (the env BIFROST_ENFORCE_VIRTUAL_KEYS never did this;
 *     bifrost only reads this config field). Closes the open-inference hole.
 *   - auth_config (admin basic-auth over /api/*) when BIFROST_ADMIN_PASSWORD is
 *     set → the management plane stops being anonymous. The stored password is
 *     a bcrypt hash (bifrost compares with bcrypt.CompareHashAndPassword);
 *     managementHeaders() sends the plaintext as Basic auth.
 *
 * GET-merge-PUT: `PUT /api/config` reads several client_config fields directly
 * from the payload (EnableLogging, MaxRequestBodySizeMB, …), so we must send
 * the FULL current client_config with only enforce flipped, never a partial.
 */
export async function applyGatewayConfig(): Promise<void> {
  const getRes = await fetch(`${bifrostUrl()}/api/config`, {
    method: 'GET',
    headers: managementHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!getRes.ok) {
    throw new Error(`bifrost get config failed (${getRes.status})`);
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const cfg = (await getRes.json()) as {
    client_config?: Record<string, unknown>;
  };
  const current = cfg.client_config ?? {};
  // `PUT /api/config` re-validates the whole client_config, but GET returns
  // server-side zero-defaults that fail it — notably log_retention_days=0 vs
  // the `min=1` validator. Echoing the GET'd config back verbatim 400s, so
  // clamp the known-constrained field before re-PUTting.
  const logRetentionRaw = current.log_retention_days;
  const logRetention =
    typeof logRetentionRaw === 'number' && logRetentionRaw >= 1
      ? logRetentionRaw
      : 30;
  const clientConfig = {
    ...current,
    log_retention_days: logRetention,
    enforce_auth_on_inference: true,
  };
  const body: Record<string, unknown> = { client_config: clientConfig };
  const pw = adminPassword();
  if (pw) {
    // Send the PLAINTEXT password — bifrost hashes it itself (encrypt.Hash) on
    // store and compares with bcrypt at request time. Pre-hashing would
    // double-hash and every Basic-auth call would 401.
    body.auth_config = {
      is_enabled: true,
      admin_username: adminUsername(),
      admin_password: pw,
      // Inference is gated by enforce_auth_on_inference (VK), not admin login.
      disable_auth_on_inference: true,
    };
  }
  const putRes = await fetch(`${bifrostUrl()}/api/config`, {
    method: 'PUT',
    headers: managementHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!putRes.ok) {
    throw new Error(`bifrost apply config failed (${putRes.status})`);
  }
}

/** sha256 hex of a minted virtual key — what we persist (never the plaintext). */
export function hashVirtualKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
