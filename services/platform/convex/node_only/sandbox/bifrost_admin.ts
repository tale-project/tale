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

import { sanitizeError } from '../../lib/utils/sanitize_secrets';
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

/** Whether Bifrost has a built-in provider implementation for this name (and so
 * owns its wire format + rejects custom_provider_config). Exported so the
 * gateway loader can group standard providers (one native record per slug) vs
 * custom ones (per-model upstreams). */
export function isStandardGatewayProvider(name: string): boolean {
  return BIFROST_STANDARD_PROVIDERS.has(name);
}

/** Bifrost provider name for a CUSTOM model's per-model upstream. The model's
 * effective (baseUrl, apiFormat, key) lives on its own provider record so that
 * model-level overrides actually route (Bifrost holds one base_url +
 * base_provider_type per record). Sanitize `/` out of the NAME segment —
 * Bifrost routes on the FIRST `/`, so the provider-name part must contain none;
 * the model id keeps its own form (matched against the key catalog after the
 * prefix is stripped). */
function customGatewayProviderName(slug: string, modelId: string): string {
  return `${slug}__${modelId}`.replace(/\//g, '_');
}

export interface GatewayRouting {
  /** Bifrost provider name the request routes to. */
  gatewayProvider: string;
  /** Full gateway model ref (`<gatewayProvider>/<modelId>`) for ANTHROPIC_MODEL
   * + the VK allowed_models. */
  gatewayModel: string;
}

/**
 * Map a Tale (providerSlug, modelId) onto Bifrost routing. Standard slug → the
 * native provider record (`<slug>/<modelId>`); custom slug → the model's own
 * per-model upstream (`<slug>__<modelId>/<modelId>`). Single source of truth
 * shared by the adapter (ANTHROPIC_MODEL), the mint (VK provider binding), and
 * the gateway loader (record names) so they can never drift.
 */
export function resolveGatewayRouting(
  providerSlug: string,
  modelId: string,
): GatewayRouting {
  if (isStandardGatewayProvider(providerSlug)) {
    return {
      gatewayProvider: providerSlug,
      gatewayModel: `${providerSlug}/${modelId}`,
    };
  }
  const name = customGatewayProviderName(providerSlug, modelId);
  return { gatewayProvider: name, gatewayModel: `${name}/${modelId}` };
}

/** Resolve routing from a full Tale model ref (`provider:model[@quant]`). */
export function resolveGatewayRoutingFromRef(
  taleModelRef: string,
): GatewayRouting {
  const gatewayRef = toGatewayModelRef(taleModelRef);
  const slash = gatewayRef.indexOf('/');
  const slug = slash === -1 ? gatewayRef : gatewayRef.slice(0, slash);
  const modelId = slash === -1 ? gatewayRef : gatewayRef.slice(slash + 1);
  return resolveGatewayRouting(slug, modelId);
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
  // Group allowed models by the GATEWAY provider they route to (per-model for
  // custom providers; the slug for standard). Allow both the bare model id and
  // the full gateway ref so the allowlist matches however the resolver
  // normalizes the request model. resolveGatewayRouting is the same mapping the
  // adapter + gateway loader use, so the VK binds the exact record that serves.
  const byProvider = new Map<string, string[]>();
  for (const taleRef of args.allowedModels) {
    const { gatewayProvider, gatewayModel } =
      resolveGatewayRoutingFromRef(taleRef);
    const slash = gatewayModel.indexOf('/');
    const bare = slash === -1 ? gatewayModel : gatewayModel.slice(slash + 1);
    const models = byProvider.get(gatewayProvider) ?? [];
    models.push(bare, gatewayModel);
    byProvider.set(gatewayProvider, models);
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
  if (!res.ok) {
    // Degrade to the agent-stream spend, but make the gateway failure visible —
    // a down gateway is otherwise indistinguishable from "key not found" and
    // would silently stamp costEstimateCents:0. keyId is an id, not a secret.
    console.warn(
      `[bifrost] spend read failed (${res.status}) for key ${keyId}; degrading to agent-stream spend`,
    );
    return null;
  }
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

/** Provider names Bifrost handles with a built-in implementation (its own base
 * URL + request shaping). Mirrors Bifrost's `StandardProviders`
 * (core/schemas/bifrost.go @ core/v1.5.13). This is NOT a Tale allowlist of
 * "permitted" providers — users may add ANY provider (the chat path treats
 * every provider as OpenAI-compatible against its own base URL). It is the set
 * Bifrost RESERVES: it rejects `custom_provider_config` on these names with a
 * 400 ("cannot be created on standard providers"), and overriding their
 * `network_config.base_url` breaks the built-in URL construction. So a standard
 * provider keeps native dispatch; every OTHER provider is provisioned as a
 * custom OpenAI-compatible upstream (see ensureProviderConfig). */
const BIFROST_STANDARD_PROVIDERS = new Set([
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
  'fireworks',
]);

export interface ProviderProvision {
  /** Bifrost provider name. A standard Bifrost name (see
   * BIFROST_STANDARD_PROVIDERS) uses native dispatch; any other name is
   * provisioned as a custom upstream (see resolveGatewayRouting / per-model
   * naming) and so requires a `baseUrl`. */
  name: string;
  baseUrl?: string;
  /** Wire format for a CUSTOM upstream → Bifrost `base_provider_type`. Absent ⇒
   * 'openai'. Ignored for standard providers (Bifrost owns their format). */
  apiFormat?: 'openai' | 'anthropic';
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
  // baseUrl IS included: for a custom (non-standard) provider it is pushed to
  // the gateway as network_config.base_url, so a base-URL-only change must bust
  // the memo and re-provision. Inert for standard providers (their baseUrl is
  // never pushed, and is a stable value).
  return createHash('sha256')
    .update(
      JSON.stringify({
        apiKey: p.apiKey,
        baseUrl: p.baseUrl ?? null,
        apiFormat: p.apiFormat ?? null,
        models: p.models.map(toGatewayModelRef).sort(),
      }),
    )
    .digest('hex');
}

/** Whether Bifrost has a built-in implementation for this provider name (and so
 * rejects custom_provider_config / a base_url override on it). Standard names
 * keep native dispatch; everything else is provisioned as a custom
 * OpenAI-compatible upstream. */
function isStandardProvider(p: ProviderProvision): boolean {
  return isStandardGatewayProvider(p.name);
}

/** True when a provider cannot be provisioned at all: a non-standard (custom)
 * upstream with no base URL. Bifrost requires `network_config.base_url` for a
 * custom provider, so there is nothing to point it at — warn + skip. Standard
 * providers (no base_url needed) and custom providers WITH a base_url both
 * proceed. */
function skipUnprovisionable(p: ProviderProvision): boolean {
  if (isStandardProvider(p) || p.baseUrl) return false;
  console.warn(
    `[bifrost] skipping custom provider '${p.name}' (no base URL to route to)`,
  );
  return true;
}

/** Bifrost's OpenAI handler always appends `/v1/chat/completions` to a custom
 * provider's base_url, but Tale provider configs store the base URL WITH a
 * `/v1` (the chat path appends only `/chat/completions`). Strip a trailing
 * `/v1` (or `/v1/`) before pushing so the gateway builds `<base>/v1/chat/
 * completions`, not `<base>/v1/v1/chat/completions` (Bifrost issue #2356).
 * Assumes the upstream exposes chat at `<base>/v1/chat/completions` — the
 * DeepSeek/Together/standard OpenAI-compatible convention. */
function stripTrailingV1(url: string): string {
  return url.replace(/\/v1\/?$/, '');
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
  if (!res.ok) {
    // Treat as "no keys" but log: a transient gateway failure here would
    // otherwise look like a clean empty set (e.g. the mint path's fail-closed
    // resolve), masking the real cause.
    console.warn(
      `[bifrost] list keys for provider ${provider} failed (${res.status}); treating as none`,
    );
    return [];
  }
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

/** DELETE /api/providers/:name — remove a provider RECORD (and its key
 * sub-resources). v1.5.13 actually deletes the record (verified: GET 404s
 * after). Used to recreate a custom provider whose immutable
 * `base_provider_type` must change (openai↔anthropic) — Bifrost forbids
 * mutating it in place. Tolerates 404 (already gone). */
async function deleteGatewayProvider(name: string): Promise<void> {
  const res = await fetch(
    `${bifrostUrl()}/api/providers/${encodeURIComponent(name)}`,
    {
      method: 'DELETE',
      headers: managementHeaders(),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `bifrost delete provider ${name} failed (${res.status}): ${sanitizeError(await res.text())}`,
    );
  }
}

/** PUT /api/providers/:name — provider RECORD config only (network +
 * concurrency). In v1.5.13 keys are NOT embedded here (they're a sub-resource,
 * see ensureProviderKey); a keys[] in this body is ignored. concurrency must
 * be > 0 or the config validator 400s. Idempotent; safe to call every
 * provision.
 *
 * A STANDARD Bifrost provider carries its own base URL — overriding it breaks
 * the built-in URL construction, and Bifrost rejects custom_provider_config on
 * it (400) — so we only widen the timeout and, for OpenRouter, add the Tale
 * attribution headers: `extra_headers` ride every upstream request the gateway
 * makes (v1.5.13 NetworkConfig.ExtraHeaders), so sandbox-agent traffic shows up
 * as Tale on OpenRouter's dashboard instead of Unknown. Same canonical helper
 * as the in-platform chat path.
 *
 * A CUSTOM (non-standard) provider is provisioned as an OpenAI-compatible
 * upstream: `network_config.base_url` (its own, with a trailing `/v1` stripped —
 * see stripTrailingV1) + `custom_provider_config` declaring base_provider_type
 * "openai" and the request types the agent path uses. This makes the gateway
 * contract identical to the chat path's createOpenAICompatible contract, so any
 * provider that works in chat works for external agents (incl. the /anthropic
 * route, which translates Anthropic↔OpenAI for any non-Claude model). */
async function ensureProviderConfig(
  p: ProviderProvision,
): Promise<{ recreated: boolean }> {
  const attribution = providerAttributionHeaders({
    providerName: p.name,
    baseUrl: p.baseUrl ?? '',
  });
  const custom = !isStandardProvider(p);
  const anthropic = custom && p.apiFormat === 'anthropic';
  // Anthropic base_url is the `/anthropic` endpoint verbatim — the native
  // Anthropic provider appends `/v1/messages` itself (NO /v1 strip, unlike the
  // openai handler which appends /v1/chat/completions, see stripTrailingV1).
  const baseUrl =
    custom && p.baseUrl
      ? anthropic
        ? p.baseUrl
        : stripTrailingV1(p.baseUrl)
      : undefined;
  const body = {
    network_config: {
      default_request_timeout_in_seconds: 600,
      ...(baseUrl ? { base_url: baseUrl } : {}),
      ...(Object.keys(attribution).length > 0
        ? { extra_headers: attribution }
        : {}),
    },
    concurrency_and_buffer_size: { concurrency: 1000, buffer_size: 5000 },
    ...(custom
      ? {
          custom_provider_config: anthropic
            ? // Omit allowed_requests ⇒ allow-all ⇒ the Responses path stays
              // (no Responses→Chat fallback), so Claude Code's web_search
              // server tool survives to DeepSeek's /anthropic endpoint.
              { base_provider_type: 'anthropic' }
            : {
                base_provider_type: 'openai',
                // Restrict to chat so the OpenAI handler forces the
                // /v1/chat/completions path (most custom openai upstreams have
                // no /v1/responses).
                allowed_requests: {
                  chat_completion: true,
                  chat_completion_stream: true,
                },
              },
        }
      : {}),
  };
  const putConfig = () =>
    fetch(`${bifrostUrl()}/api/providers/${encodeURIComponent(p.name)}`, {
      method: 'PUT',
      headers: managementHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

  const res = await putConfig();
  if (res.ok) return { recreated: false };

  // `base_provider_type` and the presence of `custom_provider_config` are
  // IMMUTABLE in Bifrost — a PUT that changes them 400s ("base_provider_type
  // cannot be changed from X to Y after creation"). This happens when a custom
  // provider's apiFormat flips (openai↔anthropic). Recreate: delete the record
  // (its keys go too — caller re-POSTs) then PUT fresh.
  const errBody = sanitizeError(await res.text());
  if (res.status === 400 && /cannot be (changed|removed)/i.test(errBody)) {
    console.warn(
      `[bifrost] provider '${p.name}' base type is immutable; recreating: ${errBody}`,
    );
    await deleteGatewayProvider(p.name);
    const retry = await putConfig();
    if (!retry.ok) {
      throw new Error(
        `bifrost provider config ${p.name} failed after recreate (${retry.status}): ${sanitizeError(await retry.text())}`,
      );
    }
    return { recreated: true };
  }
  throw new Error(
    `bifrost provider config ${p.name} failed (${res.status}): ${errBody}`,
  );
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
      `bifrost ${existing ? 'update' : 'create'} key for ${p.name}/org ${organizationId} failed (${res.status}): ${sanitizeError(await res.text())}`,
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
  const { recreated } = await ensureProviderConfig(p);
  // A recreate (immutable base-type change) deletes the record + its keys, so
  // the previously-fetched key row is gone — POST a fresh one (existing=null).
  await writeProviderKey(organizationId, p, recreated ? null : existing);
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
  if (skipUnprovisionable(p)) return;
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
 *
 * Per-provider resilient: a single provider's failure is logged and skipped
 * rather than aborting the whole reconcile. The org's providers all get
 * provisioned here (not just the turn's model provider), so one misconfigured
 * upstream must not starve the others — the turn's actual provider still gets
 * its key, and a genuinely broken one surfaces via mintVirtualKey's
 * fail-closed error, not a silent gap here.
 */
export async function provisionProviders(
  organizationId: string,
  providers: ProviderProvision[],
): Promise<void> {
  for (const p of providers) {
    if (skipUnprovisionable(p)) continue;
    try {
      await provisionOne(organizationId, p);
    } catch (err) {
      console.warn(
        `[bifrost] provisioning provider '${p.name}' for org '${organizationId}' failed (continuing):`,
        err,
      );
    }
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
