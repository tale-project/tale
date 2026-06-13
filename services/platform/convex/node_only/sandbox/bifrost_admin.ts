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
// NOTE: endpoint paths + field names are verified against the pinned
// maximhq/bifrost:v1.5.13 (spike 2026-06-13; see
// reference-bifrost-provider-api-v1513). Key shape vs the old v1.4.8:
//   - upstream KEYS are a provider SUB-RESOURCE (`/api/providers/:p/keys`,
//     CRUD), NOT embedded in the provider PUT (a keys[] there is ignored).
//     Per-org keys coexist under one shared provider record.
//   - VK create takes `name` + `provider_configs[]` where each config has
//     `keys: [<key id>]` + `allow_all_keys` (binds the VK to specific upstream
//     keys) + `allowed_models` (deny-by-default ENFORCED on inference, incl.
//     the /anthropic route; an EMPTY list denies all) + `budget` (singular;
//     reset_duration must parse — 'never' is rejected). Response wraps the key
//     as `{ virtual_key: { id, value } }`.

import { createHash } from 'node:crypto';

import { providerAttributionHeaders } from '../../providers/provider_attribution';

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

/** POST /api/governance/virtual-keys — mint a session-scoped key.
 *
 * v1.5.13 enforces both axes (verified by spike, see
 * reference-bifrost-provider-api-v1513):
 *   - `provider_configs[].keys: [<this org's key id>]` + `allow_all_keys:false`
 *     binds the VK to THIS org's upstream key only — a request can never be
 *     served by another org's key under the same provider (cross-org
 *     isolation; v1.4.8 had no such binding and routed to whatever global key
 *     occupied the provider slot).
 *   - `allowed_models` is deny-by-default enforced on the inference path
 *     (incl. the /anthropic route the adapter uses) — a request for a model
 *     outside the list is rejected 403 model_blocked, not forwarded upstream.
 *     An EMPTY list denies everything, so we fail closed (throw) rather than
 *     mint a deny-all key if no model resolves.
 */
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
  if (byProvider.size === 0) {
    // Empty allowed_models = deny-all in v1.5.13; never mint such a key.
    throw new Error('mintVirtualKey: no allowed models resolved');
  }
  // Bind each provider config to THIS org's key id (resolved by stable name).
  // The key must already exist (provisionProviders ran at session create);
  // fail closed if not — an unbound/over-permissive key is the bug we're
  // closing, so a missing key must surface, not silently widen access.
  const providerConfigs: Array<{
    provider: string;
    key_ids: string[];
    allow_all_keys: boolean;
    allowed_models: string[];
  }> = [];
  for (const [provider, allowedModels] of byProvider) {
    const keyId = await resolveOrgProviderKeyId(provider, args.organizationId);
    if (!keyId) {
      throw new Error(
        `mintVirtualKey: no gateway key for provider '${provider}' / org '${args.organizationId}' (provisioning did not run or failed)`,
      );
    }
    // v1.5.13: the WRITE field is `key_ids` (read back as `keys:[{...}]`).
    // Sending `keys:[id]` is silently ignored → an empty binding which, with
    // allow_all_keys:false, denies ALL keys (verified against v1.5.13).
    providerConfigs.push({
      provider,
      key_ids: [keyId],
      allow_all_keys: false,
      allowed_models: allowedModels,
    });
  }
  const body = {
    // team_id/customer_id are mutually-exclusive FK references in Bifrost;
    // we anchor attribution in the (required) name instead. Bifrost has no
    // native TTL; the session watchdog revokes on expiry.
    name: `tale-${args.organizationId}-${args.sessionId}-${Date.now().toString(36)}`,
    provider_configs: providerConfigs,
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
 * Drift signal for the provision reconcile: the fingerprint this process last
 * pushed per provider name. `GET /api/providers` redacts key values, so the
 * platform can only compare against its own pushes. Module-scoped — lives for
 * the lifetime of the Convex action runtime (per Node process; one process per
 * host in self-hosted Convex), same pattern as `secretWriteLocks` in
 * providers/file_actions.ts. An empty memo (fresh process) makes the next
 * provision rewrite each provider once, which is also what picks up
 * `TALE_PROVIDER_KEY_*` env rotations (env changes only land via a restart).
 */
const pushedProviderFingerprints = new Map<string, string>();

function providerFingerprint(p: ProviderProvision): string {
  // baseUrl is deliberately excluded — it is never pushed to the gateway
  // (native providers carry their own base URL; see putGatewayProvider).
  return createHash('sha256')
    .update(
      JSON.stringify({
        apiKey: p.apiKey,
        models: p.models.map(toGatewayModelRef).sort(),
      }),
    )
    .digest('hex');
}

/** A non-native (custom) upstream needs a base URL, but v1.4.8 routes it via
 * `custom_provider_config`, not a bare `network_config.base_url` — which we
 * don't model yet. Skip + log rather than provision a broken provider. The
 * default agents only use native providers (openrouter), so this is inert
 * for them; revisit when a custom OpenAI-compatible upstream is required.
 * Returns true when the provider was skipped. */
function skipNonNative(p: ProviderProvision): boolean {
  if (NATIVE_BIFROST_PROVIDERS.has(p.name)) return false;
  console.warn(
    `[bifrost] skipping non-native provider '${p.name}' (custom base-URL provisioning not supported)`,
  );
  return true;
}

/**
 * Stable per-(org,provider) upstream-key name. v1.5.13 keys are a provider
 * sub-resource, but their NAME must be unique GLOBALLY across all providers
 * (config store: "API key names must be unique across providers" — carried
 * over from v1.4.8's global key-name index). So the name embeds BOTH the org
 * and the provider: `tale-<orgId>-<provider>`. This lets each org's key
 * coexist under one shared provider record (no last-writer-wins clobber) AND
 * keeps one org's per-provider keys from colliding with each other. The id is
 * bifrost-side state (changes if its store is reset); the NAME is the durable
 * handle the mint path resolves by.
 */
function gatewayKeyName(organizationId: string, provider: string): string {
  return `tale-${organizationId}-${provider}`;
}

interface GatewayKey {
  id: string;
  name: string;
  models: string[];
}

/** GET /api/providers/:provider/keys — the provider's key sub-resources
 * (v1.5.13; values are masked). Empty when the provider has no keys / is
 * absent. */
async function listProviderKeys(provider: string): Promise<GatewayKey[]> {
  const res = await fetch(
    `${bifrostUrl()}/api/providers/${encodeURIComponent(provider)}/keys`,
    {
      method: 'GET',
      headers: managementHeaders(),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) return [];
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as { keys?: GatewayKey[] | null };
  return parsed.keys ?? [];
}

/** Resolve THIS org's upstream-key id for a provider (by stable name). Null
 * when absent — the mint path treats that as fail-closed. */
async function resolveOrgProviderKeyId(
  provider: string,
  organizationId: string,
): Promise<string | null> {
  const want = gatewayKeyName(organizationId, provider);
  const keys = await listProviderKeys(provider);
  return keys.find((k) => k.name === want)?.id ?? null;
}

/** PUT /api/providers/:name — provider RECORD config only (network +
 * concurrency). In v1.5.13 keys are NOT embedded here (they're a sub-resource,
 * see ensureProviderKey); a keys[] in this body is ignored. concurrency must
 * be > 0 or the config validator 400s. Idempotent; safe to call every
 * provision. Native providers carry their own base URL — overriding it breaks
 * the built-in URL construction — so we only widen the timeout and, for
 * OpenRouter, add the Tale attribution headers: `extra_headers` ride every
 * upstream request the gateway makes (v1.5.13 NetworkConfig.ExtraHeaders,
 * applied by the openrouter provider), so sandbox-agent traffic shows up as
 * Tale on OpenRouter's dashboard instead of Unknown. Same canonical helper as
 * the in-platform chat path. */
async function ensureProviderConfig(p: ProviderProvision): Promise<void> {
  const attribution = providerAttributionHeaders({
    providerName: p.name,
    baseUrl: p.baseUrl ?? '',
  });
  const body = {
    network_config: {
      default_request_timeout_in_seconds: 600,
      ...(Object.keys(attribution).length > 0
        ? { extra_headers: attribution }
        : {}),
    },
    concurrency_and_buffer_size: { concurrency: 1000, buffer_size: 5000 },
  };
  const res = await fetch(
    `${bifrostUrl()}/api/providers/${encodeURIComponent(p.name)}`,
    {
      method: 'PUT',
      headers: managementHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    throw new Error(`bifrost provider config ${p.name} failed (${res.status})`);
  }
}

/**
 * POST (create) / PUT (rotate) THIS org's upstream key as a sub-resource of
 * the provider (v1.5.13). `existing` is the already-resolved key row (or null)
 * so the caller's single GET serves both the skip check and this write.
 */
async function writeProviderKey(
  organizationId: string,
  p: ProviderProvision,
  existing: GatewayKey | null,
): Promise<void> {
  const keyBody = {
    name: gatewayKeyName(organizationId, p.name),
    value: p.apiKey,
    models: p.models.map(toGatewayModelRef),
    weight: 1,
  };
  const url = existing
    ? `${bifrostUrl()}/api/providers/${encodeURIComponent(p.name)}/keys/${encodeURIComponent(existing.id)}`
    : `${bifrostUrl()}/api/providers/${encodeURIComponent(p.name)}/keys`;
  const res = await fetch(url, {
    method: existing ? 'PUT' : 'POST',
    headers: managementHeaders(),
    body: JSON.stringify(keyBody),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(
      `bifrost ${existing ? 'update' : 'create'} key for ${p.name}/org ${organizationId} failed (${res.status})`,
    );
  }
}

/**
 * Ensure a provider's record config + this org's key sub-resource are in the
 * gateway. One GET (list keys) drives both the skip check and the POST-vs-PUT
 * decision: when this org's key already exists AND the fingerprint memo
 * (keyed by org:provider) matches, the whole provider is skipped — no config
 * PUT, no key write — so steady-state session-create is one GET per provider.
 * An empty memo (fresh process) or a missing key rewrites once, which is also
 * what picks up `TALE_PROVIDER_KEY_*` env rotations. GET masks the key value,
 * so memo drift — not a value diff — is the rotation signal.
 */
async function provisionOne(
  organizationId: string,
  p: ProviderProvision,
): Promise<void> {
  const memoKey = `${organizationId}:${p.name}`;
  const existing =
    (await listProviderKeys(p.name)).find(
      (k) => k.name === gatewayKeyName(organizationId, p.name),
    ) ?? null;
  if (
    existing &&
    pushedProviderFingerprints.get(memoKey) === providerFingerprint(p)
  ) {
    return; // fully provisioned by this process already
  }
  await ensureProviderConfig(p);
  await writeProviderKey(organizationId, p, existing);
  pushedProviderFingerprints.set(memoKey, providerFingerprint(p));
}

/**
 * Push one provider's current key + model list into the gateway for an org.
 * The provider-save actions call this so a key rotation reaches the gateway
 * immediately instead of at the next session create. Throws on failure —
 * callers own the degrade posture; the memo stays unset, so the next
 * session-create provision retries.
 */
export async function reprovisionProvider(
  organizationId: string,
  p: ProviderProvision,
): Promise<void> {
  if (skipNonNative(p)) return;
  await provisionOne(organizationId, p);
}

/**
 * Reconcile the org's providers into Bifrost: ensure each provider's record
 * config + this org's upstream key (per-org key sub-resource — see
 * ensureProviderKey). Called once per session create so a fresh gateway (or a
 * rotated key) is in place before the first mint; the provider-save actions
 * also push eagerly via reprovisionProvider, making this the self-heal
 * catch-up for pushes that failed (gateway down) or happened in another
 * process.
 *
 * Per-org keys coexist under one shared provider record, so multiple orgs
 * holding distinct keys for the same provider no longer clobber each other,
 * and each session VK binds to its own org's key (see mintVirtualKey).
 */
export async function provisionProviders(
  organizationId: string,
  providers: ProviderProvision[],
): Promise<void> {
  for (const p of providers) {
    if (skipNonNative(p)) continue;
    await provisionOne(organizationId, p);
  }
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
    // Inference requires a minted VK (closes open-inference)...
    enforce_auth_on_inference: true,
    // ...and governance (allowed_models / key binding) is enforced on that VK.
    // Without this v1.5.x stores allowed_models but does not enforce it on the
    // inference path — the gap this whole change closes.
    enforce_governance_header: true,
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
