'use node';

// Sandbox LLM-gateway management client. The platform is the source of truth
// for provider credentials + model catalogs; the gateway (pinned
// maximhq/bifrost, management API verified against v1.5.13) is a derived
// cache. This module:
//   - provisions/reconciles an org's providers + upstream keys into the
//     gateway,
//   - mints a session-scoped virtual key (budget + model allowlist) at
//     session create, returning the plaintext `sk-bf-*` (injected into the
//     sandbox, never persisted) plus the key id,
//   - revokes the key at session destroy,
//   - reads per-key spend for the usage ledger.
//
// Raw provider API keys + the admin password are Tier-0 secrets — they live
// only here (Convex) and in the gateway, never in the sandbox.
//
// v1.5.13 wire facts this module encodes (each verified against the pinned
// gateway; do not "simplify" them away without re-verifying):
//   - upstream KEYS are a provider SUB-RESOURCE (`/api/providers/:p/keys`,
//     CRUD), NOT embedded in the provider PUT (a keys[] there is ignored).
//     Per-org keys coexist under one shared provider record.
//   - VK create takes `provider_configs[]` where each config carries
//     `key_ids: [<id>]` (the WRITE field — sending `keys:[id]` is silently
//     ignored, leaving an empty binding that denies everything) +
//     `allow_all_keys:false` (binds the VK to THIS org's upstream key only)
//     + `allowed_models` (deny-by-default, enforced on inference incl. the
//     /anthropic route; an EMPTY list denies all) + `budget` (singular;
//     `reset_duration` must parse — 'never' is rejected). The response wraps
//     the key as `{ virtual_key: { id, value } }`.
//   - `base_provider_type` / the presence of `custom_provider_config` are
//     immutable per record; changing them requires delete + recreate.

import { createHash } from 'node:crypto';

import { providerAttributionHeaders } from '../../../../lib/shared/providers/attribution';
import { sanitizeError } from '../../lib/utils/sanitize_secrets';

/**
 * Read a `SANDBOX_LLM_GATEWAY_*` env var, falling back to the pre-rename
 * `LLM_GATEWAY_*` name — `.env.example` documents that operators' old names
 * are still read, so an existing deployment keeps working until `tale
 * upgrade` rewrites its env file.
 */
function gatewayEnv(suffix: string): string | undefined {
  return (
    process.env[`SANDBOX_LLM_GATEWAY_${suffix}`] ??
    process.env[`LLM_GATEWAY_${suffix}`]
  );
}

function llmGatewayUrl(): string {
  return gatewayEnv('URL') ?? 'http://sandbox-llm-gateway:8080';
}

/** Admin username for the gateway management plane (auth_config). */
function adminUsername(): string {
  return gatewayEnv('ADMIN_USERNAME') ?? 'admin';
}

/**
 * Plaintext admin password for the gateway management plane. REQUIRED —
 * fail closed: the gateway is dual-homed onto the sandbox network with ONE
 * port serving both inference and `/api/*`, so an anonymous management plane
 * lets sandboxed code read the config and mint its own unlimited virtual
 * keys. Every management call sends it as HTTP Basic (managementHeaders) and
 * applyGatewayConfig enables auth_config with it, so the plane is never left
 * open. Exported so session provisioning can surface the precondition once,
 * before any network call.
 */
export function requireGatewayAdminPassword(): string {
  const pw = gatewayEnv('ADMIN_PASSWORD')?.trim();
  if (!pw) {
    throw new Error(
      'SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD is not set — the sandbox LLM gateway management API must never ' +
        'run anonymous (it is reachable from every sandbox session). `tale deploy` and `bun run dev` mint it ' +
        'into .env; for a hand-rolled compose stack set it in .env (compose.dev.yml carries an insecure dev default).',
    );
  }
  return pw;
}

/** Total per-request timeout pushed to every provider's `network_config`. */
const REQUEST_TIMEOUT_SECONDS = 600;

/** Per-stream IDLE timeout (gateway `stream_idle_timeout_in_seconds`): how
 * long the gateway waits for ANY byte from the upstream mid-stream before
 * aborting with `ErrStreamIdleTimeout`. The gateway defaults this to 60s,
 * which is fine for a native Anthropic upstream (it pings every ~15-30s) —
 * but a CUSTOM OpenAI-compatible upstream sends NO keepalive during a long
 * prefill or a silent reasoning gap, so a large-context turn trips the 60s
 * window and the agent's stream dies mid-run with no retry (harness CLIs do
 * not auto-retry a mid-stream failure). Default it to the full request
 * budget so a silent gap is bounded only by the total timeout, never a
 * premature idle abort. Operator-tunable. */
const STREAM_IDLE_TIMEOUT_SECONDS = Number(
  gatewayEnv('STREAM_IDLE_TIMEOUT_SECONDS') ?? String(REQUEST_TIMEOUT_SECONDS),
);

function managementHeaders(): Record<string, string> {
  // The gateway authenticates /api/* with HTTP Basic
  // (admin_username/admin_password), not a bearer token. ALWAYS sent:
  // harmless before auth_config is enabled (the first applyGatewayConfig on a
  // fresh gateway), required after — and requireGatewayAdminPassword() fails
  // closed, so there is no anonymous management call at all.
  const basic = Buffer.from(
    `${adminUsername()}:${requireGatewayAdminPassword()}`,
  ).toString('base64');
  return {
    'content-type': 'application/json',
    authorization: `Basic ${basic}`,
  };
}

/** Provider names the gateway serves with a BUILT-IN implementation (its own
 * base URL + request shaping). Mirrors the gateway's `StandardProviders`
 * (maximhq/bifrost core/schemas/bifrost.go @ core/v1.5.13). This is NOT an
 * allowlist of permitted providers — any connector can be provisioned; it is
 * the set the gateway RESERVES: it rejects `custom_provider_config` on these
 * names (400) and overriding their `network_config.base_url` breaks the
 * built-in URL construction. A standard provider keeps native dispatch;
 * every other connector is provisioned as a custom OpenAI-compatible (or
 * Anthropic-format) upstream. */
const LLM_GATEWAY_STANDARD_PROVIDERS = new Set([
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

/** Whether the gateway has a built-in implementation for this provider name
 * (and so owns its wire format + rejects custom_provider_config). */
export function isStandardGatewayProvider(name: string): boolean {
  return LLM_GATEWAY_STANDARD_PROVIDERS.has(name);
}

/** Gateway provider name for a CUSTOM connector's per-model upstream. The
 * model's effective (baseUrl, apiFormat, key) lives on its own provider
 * record so model-level routing actually works — one gateway record holds
 * exactly one base_url + base_provider_type. `/` is sanitized out of the
 * NAME segment because the gateway routes on the FIRST `/`; the model id
 * keeps its own form (matched against the key catalog after the prefix is
 * stripped). */
function customGatewayProviderName(slug: string, modelId: string): string {
  return `${slug}__${modelId}`.replace(/\//g, '_');
}

export interface GatewayRouting {
  /** Gateway provider (record) name the request routes to. */
  gatewayProvider: string;
  /** Full gateway model ref (`<gatewayProvider>/<modelId>`) for the harness
   * model env + the VK allowed_models. */
  gatewayModel: string;
}

/**
 * Map a (connector, catalog model id) pair onto gateway routing. A standard
 * connector name routes to the shared native provider record
 * (`<name>/<modelId>`); any other connector routes to the model's own
 * per-model upstream record (`<name>__<modelId>/<modelId>`). Single source
 * of truth shared by the harness glue (model env), the mint (VK binding),
 * and the provisioner (record names) so they can never drift.
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

/** One model the virtual key may call: the connector it belongs to plus its
 * catalog id in that connector's own dialect. */
export interface AllowedModelRef {
  providerSlug: string;
  modelId: string;
}

export interface MintVirtualKeyArgs {
  /** Hard spend cap; the gateway rejects inference once exhausted. */
  budgetCents: number;
  /** Models the key may call (already filtered by org availability). */
  allowedModels: AllowedModelRef[];
  /** Attribution anchored in the key name for usage lookup + debugging. */
  organizationId: string;
  sessionId: string;
}

export interface MintedVirtualKey {
  /** Plaintext `sk-bf-*` — injected into the sandbox, never persisted. */
  key: string;
  /** Stable id for revoke + spend queries. */
  keyId: string;
}

/** POST /api/governance/virtual-keys — mint a session-scoped key.
 *
 * The gateway enforces both axes on the inference path:
 *   - `key_ids: [<this org's key id>]` + `allow_all_keys:false` binds the VK
 *     to THIS org's upstream key only — a request can never be served by
 *     another org's key under the same shared provider record (cross-org
 *     isolation).
 *   - `allowed_models` is deny-by-default (an EMPTY list denies all), so an
 *     empty resolution fails closed here — throw, never mint a deny-all key.
 */
export async function mintVirtualKey(
  args: MintVirtualKeyArgs,
): Promise<MintedVirtualKey> {
  // Group the allowed models by the GATEWAY provider record they route to
  // (the shared record for standard connectors; per-model records for custom
  // ones). Allow both the bare model id and the full gateway ref so the
  // allowlist matches however the requesting client spells the model.
  const byProvider = new Map<string, string[]>();
  for (const ref of args.allowedModels) {
    const { gatewayProvider, gatewayModel } = resolveGatewayRouting(
      ref.providerSlug,
      ref.modelId,
    );
    const models = byProvider.get(gatewayProvider) ?? [];
    models.push(ref.modelId, gatewayModel);
    byProvider.set(gatewayProvider, models);
  }
  if (byProvider.size === 0) {
    throw new Error('mintVirtualKey: no allowed models resolved');
  }
  // Bind each provider config to THIS org's key id (resolved by stable
  // name). The key must already exist (provisionProviders ran at session
  // create); fail closed if not — an unbound or over-permissive key is
  // exactly the hole this binding closes, so a missing key must surface, not
  // silently widen access.
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
    providerConfigs.push({
      provider,
      key_ids: [keyId],
      allow_all_keys: false,
      allowed_models: allowedModels,
    });
  }
  const body = {
    // team_id/customer_id are mutually-exclusive FK references in the
    // gateway; attribution is anchored in the (required) name instead. The
    // gateway has no native TTL; session teardown revokes the key.
    name: `tale-${args.organizationId}-${args.sessionId}-${Date.now().toString(36)}`,
    provider_configs: providerConfigs,
    budget: {
      max_limit: args.budgetCents / 100, // the governance API takes dollars
      // Smallest accepted horizon ('never' is rejected); the key is revoked
      // at session end, long before any reset matters.
      reset_duration: '1M',
    },
    is_active: true,
  };
  const res = await fetch(`${llmGatewayUrl()}/api/governance/virtual-keys`, {
    method: 'POST',
    headers: managementHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`llm-gateway mint key failed (${res.status})`);
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as {
    virtual_key?: { id?: string; value?: string };
  };
  const key = parsed.virtual_key?.value;
  const keyId = parsed.virtual_key?.id;
  if (!key || !keyId) {
    throw new Error('llm-gateway mint key returned no key/id');
  }
  return { key, keyId };
}

/** DELETE /api/governance/virtual-keys/:id — instant revoke (session destroy
 * / teardown). A 404 means it is already gone. */
export async function revokeVirtualKey(keyId: string): Promise<void> {
  const res = await fetch(
    `${llmGatewayUrl()}/api/governance/virtual-keys/${encodeURIComponent(keyId)}`,
    {
      method: 'DELETE',
      headers: managementHeaders(),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`llm-gateway revoke key failed (${res.status})`);
  }
}

/**
 * Cumulative spend on a virtual key, in (fractional) cents, from
 * `GET /api/governance/virtual-keys/:id` → `budget.current_usage` (dollars).
 * The budget figure is the gateway's only authoritative spend signal — and
 * the only usage source that works where a harness's own stream reports 0
 * tokens. Returns null on error; the caller degrades to whatever the agent
 * stream reported.
 */
export async function getVirtualKeySpendCents(
  keyId: string,
): Promise<number | null> {
  const res = await fetch(
    `${llmGatewayUrl()}/api/governance/virtual-keys/${encodeURIComponent(keyId)}`,
    {
      method: 'GET',
      headers: managementHeaders(),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    // Degrade to the agent-stream spend, but make the gateway failure
    // visible — a down gateway is otherwise indistinguishable from "key not
    // found" and would silently stamp a zero cost. keyId is an id, not a
    // secret.
    console.warn(
      `[llm-gateway] spend read failed (${res.status}) for key ${keyId}; degrading to agent-stream spend`,
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
  // Sub-cent spends are real with cheap models — keep the precision.
  return dollars === null ? null : dollars * 100;
}

export interface ProviderProvision {
  /** Gateway provider name. A standard gateway name uses native dispatch;
   * any other name is provisioned as a custom upstream and requires a
   * `baseUrl`. */
  name: string;
  baseUrl?: string;
  /** Wire format for a CUSTOM upstream → gateway `base_provider_type`.
   * Absent ⇒ 'openai'. Ignored for standard providers (the gateway owns
   * their format). */
  apiFormat?: 'openai' | 'anthropic';
  apiKey: string;
  /** Catalog model ids (the connector's own dialect) this key may serve. */
  models: string[];
}

/**
 * Drift signal for the provision reconcile: the fingerprint this process
 * last pushed per (org, provider). `GET /api/providers` redacts key values,
 * so the platform can only compare against its own pushes. Module-scoped —
 * lives for the Node action runtime's lifetime; an empty memo (fresh
 * process) makes the next provision rewrite each provider once, which is
 * also what picks up env-var key rotations (env changes only land via a
 * restart).
 */
const pushedProviderFingerprints = new Map<string, string>();

function providerFingerprint(p: ProviderProvision): string {
  // baseUrl IS included: for a custom provider it is pushed to the gateway
  // as network_config.base_url, so a base-URL-only change must bust the memo
  // and re-provision. Inert for standard providers (their baseUrl is never
  // pushed and is a stable value).
  return createHash('sha256')
    .update(
      JSON.stringify({
        apiKey: p.apiKey,
        baseUrl: p.baseUrl ?? null,
        apiFormat: p.apiFormat ?? null,
        models: [...p.models].sort(),
      }),
    )
    .digest('hex');
}

/** True when a provider cannot be provisioned at all: a custom upstream with
 * no base URL — the gateway requires `network_config.base_url` for it, so
 * there is nothing to point it at. Warn + skip. */
function skipUnprovisionable(p: ProviderProvision): boolean {
  if (isStandardGatewayProvider(p.name) || p.baseUrl) return false;
  console.warn(
    `[llm-gateway] skipping custom provider '${p.name}' (no base URL to route to)`,
  );
  return true;
}

/** The upstream base URL the gateway appends the completions PATH to. That
 * path is pinned to `/chat/completions` via `request_path_overrides` (see
 * ensureProviderConfig), so the gateway builds `<base>/chat/completions` —
 * exactly the platform chat path's contract. The base therefore carries the
 * provider's OWN API version in its path (`/v1`, `/api/paas/v4`, …) and must
 * not end in a slash (which would double the join). Strip only a trailing
 * slash; PRESERVE the version segment — stripping `/v1` and relying on the
 * gateway's default `/v1/chat/completions` breaks any provider whose version
 * segment is not `/v1` (maximhq/bifrost issue #2356). */
function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Stable per-(org, provider) upstream-key name. Keys are a provider
 * sub-resource, but their NAME must be unique GLOBALLY across all providers
 * (the gateway's config store enforces one key-name index). The name embeds
 * BOTH the org and the provider so each org's key coexists under one shared
 * provider record without clobbering, and one org's per-provider keys never
 * collide with each other. The id is gateway-side state (changes if its
 * store is reset); the NAME is the durable handle the mint path resolves by.
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
 * (values are masked). Empty when the provider has no keys / is absent. */
async function listProviderKeys(provider: string): Promise<GatewayKey[]> {
  const res = await fetch(
    `${llmGatewayUrl()}/api/providers/${encodeURIComponent(provider)}/keys`,
    {
      method: 'GET',
      headers: managementHeaders(),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    // Treat as "no keys" but log: a transient gateway failure here would
    // otherwise look like a clean empty set, masking the real cause behind
    // the mint path's fail-closed error.
    console.warn(
      `[llm-gateway] list keys for provider ${provider} failed (${res.status}); treating as none`,
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
 * sub-resources; verified: GET 404s after). Used to recreate a custom
 * provider whose immutable `base_provider_type` must change
 * (openai↔anthropic) — the gateway forbids mutating it in place. Tolerates
 * 404 (already gone). */
async function deleteGatewayProvider(name: string): Promise<void> {
  const res = await fetch(
    `${llmGatewayUrl()}/api/providers/${encodeURIComponent(name)}`,
    {
      method: 'DELETE',
      headers: managementHeaders(),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `llm-gateway delete provider ${name} failed (${res.status}): ${sanitizeError(await res.text())}`,
    );
  }
}

/** PUT /api/providers/:name — provider RECORD config only (network +
 * concurrency; keys are a sub-resource, a keys[] in this body is ignored;
 * concurrency must be > 0 or the config validator 400s). Idempotent.
 *
 * A STANDARD gateway provider carries its own base URL — overriding it
 * breaks the built-in URL construction and custom_provider_config on it is
 * rejected — so only the timeouts are widened and, for OpenRouter, the Tale
 * attribution headers added (`extra_headers` ride every upstream request the
 * gateway makes, so sandbox-agent traffic shows up as Tale instead of
 * Unknown — the same canonical helper as the in-platform chat path).
 *
 * A CUSTOM provider is provisioned as an upstream in its declared wire
 * format: `network_config.base_url` (trailing slash stripped — see
 * stripTrailingSlash) + `custom_provider_config`. The openai format
 * restricts requests to chat completions (most custom upstreams have no
 * /v1/responses) and pins the completions path to `/chat/completions`; the
 * anthropic format takes the base URL verbatim (the native handler appends
 * `/v1/messages` itself) and allows all request types so pass-through server
 * tools survive.
 */
async function ensureProviderConfig(
  p: ProviderProvision,
): Promise<{ recreated: boolean }> {
  const attribution = providerAttributionHeaders({
    providerName: p.name,
    baseUrl: p.baseUrl ?? '',
  });
  const custom = !isStandardGatewayProvider(p.name);
  const anthropic = custom && p.apiFormat === 'anthropic';
  const baseUrl =
    custom && p.baseUrl
      ? anthropic
        ? p.baseUrl
        : stripTrailingSlash(p.baseUrl)
      : undefined;
  const body = {
    network_config: {
      default_request_timeout_in_seconds: REQUEST_TIMEOUT_SECONDS,
      stream_idle_timeout_in_seconds: STREAM_IDLE_TIMEOUT_SECONDS,
      ...(baseUrl ? { base_url: baseUrl } : {}),
      ...(Object.keys(attribution).length > 0
        ? { extra_headers: attribution }
        : {}),
    },
    concurrency_and_buffer_size: { concurrency: 1000, buffer_size: 5000 },
    ...(custom
      ? {
          custom_provider_config: anthropic
            ? { base_provider_type: 'anthropic' }
            : {
                base_provider_type: 'openai',
                allowed_requests: {
                  chat_completion: true,
                  chat_completion_stream: true,
                },
                request_path_overrides: {
                  chat_completion: '/chat/completions',
                  chat_completion_stream: '/chat/completions',
                },
              },
        }
      : {}),
  };
  const putConfig = () =>
    fetch(`${llmGatewayUrl()}/api/providers/${encodeURIComponent(p.name)}`, {
      method: 'PUT',
      headers: managementHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

  const res = await putConfig();
  if (res.ok) return { recreated: false };

  // A PUT that changes the immutable base type 400s ("base_provider_type
  // cannot be changed from X to Y after creation") — this happens when a
  // custom provider's apiFormat flips. Recreate: delete the record (its keys
  // go too — the caller re-POSTs) then PUT fresh.
  const errBody = sanitizeError(await res.text());
  if (res.status === 400 && /cannot be (changed|removed)/i.test(errBody)) {
    console.warn(
      `[llm-gateway] provider '${p.name}' base type is immutable; recreating: ${errBody}`,
    );
    await deleteGatewayProvider(p.name);
    const retry = await putConfig();
    if (!retry.ok) {
      throw new Error(
        `llm-gateway provider config ${p.name} failed after recreate (${retry.status}): ${sanitizeError(await retry.text())}`,
      );
    }
    return { recreated: true };
  }
  throw new Error(
    `llm-gateway provider config ${p.name} failed (${res.status}): ${errBody}`,
  );
}

/**
 * POST (create) / PUT (rotate) THIS org's upstream key as a sub-resource of
 * the provider. `existing` is the already-resolved key row (or null) so the
 * caller's single GET serves both the skip check and this write.
 */
async function writeProviderKey(
  organizationId: string,
  p: ProviderProvision,
  existing: GatewayKey | null,
): Promise<void> {
  const keyBody = {
    name: gatewayKeyName(organizationId, p.name),
    value: p.apiKey,
    models: p.models,
    weight: 1,
  };
  const url = existing
    ? `${llmGatewayUrl()}/api/providers/${encodeURIComponent(p.name)}/keys/${encodeURIComponent(existing.id)}`
    : `${llmGatewayUrl()}/api/providers/${encodeURIComponent(p.name)}/keys`;
  const res = await fetch(url, {
    method: existing ? 'PUT' : 'POST',
    headers: managementHeaders(),
    body: JSON.stringify(keyBody),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(
      `llm-gateway ${existing ? 'update' : 'create'} key for ${p.name}/org ${organizationId} failed (${res.status}): ${sanitizeError(await res.text())}`,
    );
  }
}

/**
 * Ensure a provider's record config + this org's key sub-resource are in the
 * gateway. One GET (list keys) drives both the skip check and the
 * POST-vs-PUT decision: when this org's key already exists AND the
 * fingerprint memo (keyed by org:provider) matches, the whole provider is
 * skipped — no config PUT, no key write — so steady-state session create is
 * one GET per provider. An empty memo (fresh process) or a missing key
 * rewrites once. GET masks the key value, so memo drift — not a value diff —
 * is the rotation signal.
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
  // A recreate (immutable base-type change) deleted the record + its keys,
  // so the previously-fetched key row is gone — POST a fresh one.
  await writeProviderKey(organizationId, p, recreated ? null : existing);
  pushedProviderFingerprints.set(memoKey, providerFingerprint(p));
}

/**
 * Push one provider's current key + model list into the gateway for an org.
 * The credential-save actions call this so a key rotation reaches the
 * gateway immediately instead of at the next session create. Throws on
 * failure — callers own the degrade posture; the memo stays unset, so the
 * next session-create provision retries.
 */
export async function reprovisionProvider(
  organizationId: string,
  p: ProviderProvision,
): Promise<void> {
  if (skipUnprovisionable(p)) return;
  await provisionOne(organizationId, p);
}

/**
 * Reconcile the org's providers into the gateway: ensure each provider's
 * record config + this org's upstream key. Called once per session create so
 * a fresh gateway (or a rotated key) is in place before the first mint; the
 * credential-save actions also push eagerly via reprovisionProvider, making
 * this the self-heal catch-up for pushes that failed (gateway down) or
 * happened in another process.
 *
 * Per-org keys coexist under one shared provider record, so multiple orgs
 * holding distinct keys for the same provider never clobber each other, and
 * each session VK binds to its own org's key (see mintVirtualKey).
 *
 * Per-provider resilient: a single provider's failure is logged and skipped
 * rather than aborting the whole reconcile — one misconfigured upstream must
 * not starve the others; a genuinely broken one surfaces via mintVirtualKey's
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
        `[llm-gateway] provisioning provider '${p.name}' for org '${organizationId}' failed (continuing):`,
        err,
      );
    }
  }
}

/**
 * Harden the gateway's auth posture (idempotent; safe to call every
 * provision):
 *   - `client_config.enforce_auth_on_inference` → inference REQUIRES a
 *     minted virtual key (closes open inference).
 *   - `enforce_governance_header` → allowed_models / key binding is actually
 *     enforced on that VK (without it the gateway stores allowed_models but
 *     does not enforce it on the inference path).
 *   - `auth_config` (admin Basic auth over /api/*) from the REQUIRED
 *     SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD → the management plane is never
 *     anonymous (it shares the gateway's single port on the sandbox network).
 *     The gateway hashes the stored password itself and compares with bcrypt;
 *     managementHeaders() sends the plaintext as Basic.
 *
 * GET-merge-PUT: `PUT /api/config` reads several client_config fields
 * directly from the payload, so the FULL current client_config is sent with
 * only the enforce flags flipped, never a partial.
 */
export async function applyGatewayConfig(): Promise<void> {
  const getRes = await fetch(`${llmGatewayUrl()}/api/config`, {
    method: 'GET',
    headers: managementHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!getRes.ok) {
    throw new Error(`llm-gateway get config failed (${getRes.status})`);
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const cfg = (await getRes.json()) as {
    client_config?: Record<string, unknown>;
  };
  const current = cfg.client_config ?? {};
  // `PUT /api/config` re-validates the whole client_config, but GET returns
  // server-side zero-defaults that fail it — notably log_retention_days=0 vs
  // the `min=1` validator. Clamp the known-constrained field before
  // re-PUTting.
  const logRetentionRaw = current.log_retention_days;
  const logRetention =
    typeof logRetentionRaw === 'number' && logRetentionRaw >= 1
      ? logRetentionRaw
      : 30;
  const clientConfig = {
    ...current,
    log_retention_days: logRetention,
    enforce_auth_on_inference: true,
    enforce_governance_header: true,
  };
  const body: Record<string, unknown> = {
    client_config: clientConfig,
    // Send the PLAINTEXT password — the gateway hashes it itself on store
    // and compares with bcrypt at request time. Pre-hashing would
    // double-hash and every Basic-auth call would 401.
    auth_config: {
      is_enabled: true,
      admin_username: adminUsername(),
      admin_password: requireGatewayAdminPassword(),
      // Inference is gated by enforce_auth_on_inference (VK), not admin
      // login.
      disable_auth_on_inference: true,
    },
  };
  const putRes = await fetch(`${llmGatewayUrl()}/api/config`, {
    method: 'PUT',
    headers: managementHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!putRes.ok) {
    throw new Error(`llm-gateway apply config failed (${putRes.status})`);
  }
}

/** sha256 hex of a minted virtual key — what gets persisted (never the
 * plaintext). */
export function hashVirtualKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
