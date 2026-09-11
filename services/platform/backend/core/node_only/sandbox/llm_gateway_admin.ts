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
//     Per-org keys coexist under one shared STANDARD provider record; a
//     custom connector gets one record per (org, model) — see
//     customGatewayProviderName.
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
import { isRecord } from '../../../../lib/utils/type-utils';
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

/** Gateway provider name for a CUSTOM connector's per-(org, model) upstream.
 * The model's effective (baseUrl, apiFormat, key) lives on its own provider
 * record so model-level routing actually works — one gateway record holds
 * exactly one base_url + base_provider_type. The record is ORG-SCOPED: a
 * custom connector is an org-defined file (`<orgSlug>/providers/*.yml`) and
 * two orgs may define the same connector name with different endpoints or
 * wire formats. A shared `<slug>__<model>` record let the last org to
 * provision rewrite `base_url` for every org sharing the name — org A's
 * key then went to org B's endpoint — and an apiFormat flip recreated the
 * record and deleted the other orgs' keys. Only the gateway's STANDARD
 * providers (whose URL + format the gateway owns) keep one shared record.
 * `/` is sanitized out of the NAME segment because the gateway routes on the
 * FIRST `/`; the model id keeps its own form (matched against the key
 * catalog after the prefix is stripped). */
function customGatewayProviderName(
  organizationId: string,
  slug: string,
  modelId: string,
  anthropicHarnessLane = false,
): string {
  // An anthropic-wire harness (Claude Code) on a connector that declares a
  // native Anthropic harness endpoint rides a DISTINCT record so its upstream
  // (base_provider_type: anthropic) never overwrites the OpenAI record other
  // harnesses use for the same (org, model). `__anthropic` is a safe suffix:
  // `/` is still stripped below, and the segment stays one gateway record name.
  const base = `${organizationId}__${slug}__${modelId}`;
  return (anthropicHarnessLane ? `${base}__anthropic` : base).replace(
    /\//g,
    '_',
  );
}

export interface GatewayRouting {
  /** Gateway provider (record) name the request routes to. */
  gatewayProvider: string;
  /** Full gateway model ref (`<gatewayProvider>/<modelId>`) for the harness
   * model env + the VK allowed_models. */
  gatewayModel: string;
}

/** Extra routing inputs beyond the (org, connector, model) triple. */
export interface GatewayRoutingOpts {
  /** The requesting harness speaks the Anthropic wire to the gateway AND the
   * connector declares a native Anthropic harness endpoint, so this session
   * rides a distinct per-model record (`…__anthropic`) whose upstream is that
   * endpoint. Ignored for standard connectors (they own their record + wire
   * format and declare no harness endpoint). */
  anthropicHarnessLane?: boolean;
}

/**
 * Map an (org, connector, catalog model id) triple onto gateway routing. A
 * standard connector name routes to the shared native provider record
 * (`<name>/<modelId>`); any other connector routes to the org's own
 * per-model upstream record (`<orgId>__<name>__<modelId>/<modelId>`), or its
 * anthropic-harness sibling (`…__anthropic/<modelId>`) when opts say so. Single
 * source of truth shared by the harness glue (model env), the mint (VK
 * binding), and the provisioner (record names) so they can never drift — pass
 * the SAME opts at every call site for one session's model.
 */
export function resolveGatewayRouting(
  organizationId: string,
  providerSlug: string,
  modelId: string,
  opts: GatewayRoutingOpts = {},
): GatewayRouting {
  if (isStandardGatewayProvider(providerSlug)) {
    return {
      gatewayProvider: providerSlug,
      gatewayModel: `${providerSlug}/${modelId}`,
    };
  }
  const name = customGatewayProviderName(
    organizationId,
    providerSlug,
    modelId,
    opts.anthropicHarnessLane,
  );
  return { gatewayProvider: name, gatewayModel: `${name}/${modelId}` };
}

/** One model the virtual key may call: the connector it belongs to plus its
 * catalog id in that connector's own dialect. */
export interface AllowedModelRef {
  providerSlug: string;
  modelId: string;
  /** Route this model through the connector's native Anthropic harness
   * endpoint (Claude Code lane). See {@link GatewayRoutingOpts}. */
  anthropicHarnessLane?: boolean;
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
  // (the shared record for standard connectors; this org's per-model records
  // for custom ones). Allow both the bare model id and the full gateway ref so the
  // allowlist matches however the requesting client spells the model.
  const byProvider = new Map<string, string[]>();
  for (const ref of args.allowedModels) {
    const { gatewayProvider, gatewayModel } = resolveGatewayRouting(
      args.organizationId,
      ref.providerSlug,
      ref.modelId,
      { anthropicHarnessLane: ref.anthropicHarnessLane },
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
    // `budgets` (plural, one entry per reset window) is the gateway's
    // multi-budget contract. Its JSON decoder drops unknown fields, so the
    // pre-multi-budget singular `budget` object is accepted with a 200 and
    // silently stores the key WITHOUT a cap — which is why the response is
    // checked below rather than trusted.
    budgets: [
      {
        max_limit: args.budgetCents / 100, // the governance API takes dollars
        // Smallest accepted horizon ('never' is rejected); the key is revoked
        // at session end, long before any reset matters.
        reset_duration: '1M',
      },
    ],
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
    virtual_key?: { id?: string; value?: string; budgets?: unknown };
  };
  const key = parsed.virtual_key?.value;
  const keyId = parsed.virtual_key?.id;
  if (!key || !keyId) {
    throw new Error('llm-gateway mint key returned no key/id');
  }
  // The budget is the only thing bounding what a runaway turn can spend, and
  // its `current_usage` is the only spend signal the ledger has. A key the
  // gateway stored without one is an uncapped, unmetered credential — revoke
  // it and refuse the session rather than serve it.
  const budgets = parsed.virtual_key?.budgets;
  if (!Array.isArray(budgets) || budgets.length === 0) {
    await revokeVirtualKey(keyId).catch((err: unknown) =>
      console.warn(
        `[llm-gateway] revoke of budget-less key ${keyId} failed:`,
        err,
      ),
    );
    throw new Error(
      'llm-gateway mint key returned a key without its budget (the spend cap did not attach)',
    );
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
 * `GET /api/governance/virtual-keys/:id` → the key's `budgets[].current_usage`
 * (dollars; the pre-multi-budget singular `budget` is still read). Every
 * budget on a key meters the same requests over its own reset window, so the
 * largest figure is the key's spend. The budget figure is the gateway's only
 * authoritative spend signal — and the only usage source that works where a
 * harness's own stream reports 0 tokens. Returns null on error, or for a key
 * the gateway holds without any budget; the caller degrades to whatever the
 * agent stream reported.
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
    virtual_key?: {
      budgets?: unknown;
      budget?: { current_usage?: number };
    };
    budget?: { current_usage?: number };
  };
  const budgets = parsed.virtual_key?.budgets;
  const usages = [
    ...(Array.isArray(budgets) ? budgets : []).map((budget: unknown) =>
      isRecord(budget) ? budget.current_usage : undefined,
    ),
    parsed.virtual_key?.budget?.current_usage,
    parsed.budget?.current_usage,
  ].filter(
    (usage): usage is number =>
      typeof usage === 'number' && Number.isFinite(usage),
  );
  if (usages.length === 0) {
    // A key without a budget is unmetered (see mintVirtualKey); say so
    // instead of stamping a silent zero.
    console.warn(
      `[llm-gateway] key ${keyId} carries no budget; its spend is unknown`,
    );
    return null;
  }
  // Sub-cent spends are real with cheap models — keep the precision.
  return Math.max(...usages) * 100;
}

/** The price the gateway should bill one model at, in the catalog's unit
 * (cents per million tokens). */
export interface ModelPricingOverride {
  /** Gateway provider (record) name the model routes to. */
  gatewayProvider: string;
  /** The model id as the client sends it under that record — an override
   * matches the wire model, i.e. the ref with its provider prefix stripped. */
  modelId: string;
  inputCentsPerMillion: number;
  outputCentsPerMillion: number;
}

/** Request kinds a sandbox harness turn bills under (stream variants ride
 * their base type). The gateway rejects an override with an empty list. */
const PRICING_OVERRIDE_REQUEST_TYPES = [
  'chat_completion',
  'responses',
  'text_completion',
] as const;

/** Page size for listing a provider's pricing overrides. */
const PRICING_OVERRIDE_PAGE = 200;

/**
 * Drift signal for the pricing reconcile: the patch this process last saw
 * on the gateway per override name. Module-scoped like the provider memo — a
 * fresh process re-reads each override once and then skips it.
 */
const pushedPricingFingerprints = new Map<string, string>();

function pricingOverrideName(override: ModelPricingOverride): string {
  return `tale-pricing-${override.gatewayProvider}-${override.modelId}`;
}

/** Dollars per token from the catalog's cents per million tokens. */
function dollarsPerToken(centsPerMillion: number): number {
  return centsPerMillion / 100 / 1_000_000;
}

/** One override as the gateway lists it (`pricing_patch` is the stored patch
 * as a JSON string). */
interface GatewayPricingOverride {
  id: string;
  name: string;
  pattern?: string;
  match_type?: string;
  request_types?: string[];
  pricing_patch?: unknown;
}

/** Whether the gateway's stored patch already prices at `patch` (its JSON
 * round-trips the floats, so an exact compare is enough). */
function samePricingPatch(
  stored: unknown,
  patch: { input_cost_per_token: number; output_cost_per_token: number },
): boolean {
  let parsed: unknown = stored;
  if (typeof stored === 'string') {
    try {
      parsed = JSON.parse(stored);
    } catch (err) {
      // Not JSON → not our patch; the caller rewrites it.
      console.warn('[llm-gateway] unreadable pricing override patch:', err);
      return false;
    }
  }
  return (
    isRecord(parsed) &&
    parsed.input_cost_per_token === patch.input_cost_per_token &&
    parsed.output_cost_per_token === patch.output_cost_per_token
  );
}

/** Every override on a provider record, paged until the gateway's own total
 * is reached. */
async function listPricingOverrides(
  gatewayProvider: string,
): Promise<GatewayPricingOverride[]> {
  const overrides: GatewayPricingOverride[] = [];
  // Advance by what the gateway actually returned, not the requested page
  // size — a server-side cap below it would otherwise skip a stride.
  for (let offset = 0; ; offset = overrides.length) {
    const res = await fetch(
      `${llmGatewayUrl()}/api/governance/pricing-overrides?provider_id=${encodeURIComponent(gatewayProvider)}&limit=${PRICING_OVERRIDE_PAGE}&offset=${offset}`,
      {
        method: 'GET',
        headers: managementHeaders(),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      throw new Error(
        `llm-gateway list pricing overrides failed (${res.status})`,
      );
    }
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const page = (await res.json()) as {
      pricing_overrides?: GatewayPricingOverride[];
      total_count?: number;
    };
    const items = page.pricing_overrides ?? [];
    overrides.push(...items);
    const total = typeof page.total_count === 'number' ? page.total_count : 0;
    if (items.length === 0 || overrides.length >= total) return overrides;
  }
}

/**
 * Ensure the gateway bills `modelId` under `gatewayProvider` at the catalog's
 * price (`/api/governance/pricing-overrides`, scope `provider`, exact model
 * match). The gateway meters a virtual key's budget from the cost it computes
 * per request, and that cost comes from its own pricing datasheet — which
 * knows nothing about an org's custom upstream records
 * (`<org>__<slug>__<model>`) and lags for the rest. Without the override
 * every request under such a record costs 0: the budget never fills, the
 * hard cap never trips, and the spend ledger stays empty. Idempotent by
 * override name: a matching override is left alone, a stale one (the catalog
 * price moved) is updated in place, and the per-process memo makes the
 * steady state zero gateway calls. A zero/zero price is skipped — the
 * gateway applies only non-zero patch fields, and a zero token price marks a
 * free tier or non-token billing, never a rate.
 */
export async function ensureModelPricingOverride(
  override: ModelPricingOverride,
): Promise<void> {
  if (
    override.inputCentsPerMillion <= 0 &&
    override.outputCentsPerMillion <= 0
  ) {
    return;
  }
  const name = pricingOverrideName(override);
  const patch = {
    input_cost_per_token: dollarsPerToken(override.inputCentsPerMillion),
    output_cost_per_token: dollarsPerToken(override.outputCentsPerMillion),
  };
  const fingerprint = JSON.stringify(patch);
  if (pushedPricingFingerprints.get(name) === fingerprint) return;

  const existing = (await listPricingOverrides(override.gatewayProvider)).find(
    (entry) => entry.name === name,
  );
  const requestTypes = [...PRICING_OVERRIDE_REQUEST_TYPES];
  if (
    existing &&
    existing.pattern === override.modelId &&
    existing.match_type === 'exact' &&
    samePricingPatch(existing.pricing_patch, patch) &&
    requestTypes.every((type) => existing.request_types?.includes(type))
  ) {
    pushedPricingFingerprints.set(name, fingerprint);
    return;
  }
  const desired = {
    scope_kind: 'provider',
    provider_id: override.gatewayProvider,
    match_type: 'exact',
    pattern: override.modelId,
    request_types: requestTypes,
    patch,
  };
  const res = await fetch(
    existing
      ? `${llmGatewayUrl()}/api/governance/pricing-overrides/${encodeURIComponent(existing.id)}`
      : `${llmGatewayUrl()}/api/governance/pricing-overrides`,
    {
      method: existing ? 'PUT' : 'POST',
      headers: managementHeaders(),
      body: JSON.stringify(existing ? desired : { name, ...desired }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    throw new Error(
      `llm-gateway ${existing ? 'update' : 'create'} pricing override ${name} failed (${res.status}): ${sanitizeError(await res.text())}`,
    );
  }
  pushedPricingFingerprints.set(name, fingerprint);
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
  /** Platform-side metadata only (never pushed to the gateway): the
   * connector's native Anthropic harness endpoint, applied to the per-model
   * record when an anthropic-wire harness rides this provider. See
   * {@link GatewayRoutingOpts.anthropicHarnessLane}. */
  harnessEndpoint?: { baseUrl: string; apiFormat: 'openai' | 'anthropic' };
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

/** One provider the reconcile could not push: the gateway record name and
 * the error the write failed with. */
export interface ProviderProvisionFailure {
  name: string;
  error: unknown;
}

/**
 * Reconcile the org's providers into the gateway: ensure each provider's
 * record config + this org's upstream key. Called once per session create —
 * this is the ONLY push (no credential-save action pushes eagerly), so a
 * fresh gateway, a rotated key, or a push that failed in an earlier process
 * (gateway down) all land here, before the first mint.
 *
 * Per-org keys coexist under one shared STANDARD provider record, so
 * multiple orgs holding distinct keys for the same provider never clobber
 * each other, and each session VK binds to its own org's key (see
 * mintVirtualKey). A CUSTOM connector's record is already org-scoped by name
 * (resolveGatewayRouting), so its base_url / wire format are this org's own.
 *
 * Per-provider resilient: a single provider's failure is logged and skipped
 * rather than aborting the whole reconcile — one misconfigured upstream must
 * not starve the others. Never throws; the failures are RETURNED so the
 * caller decides. The session mint must treat any failure for a provider it
 * needs as fatal: the gateway still holds that org's key from the last
 * successful push, and `mintVirtualKey` resolves it by stable name — so a
 * mint after a swallowed failure would bind a fresh virtual key to the
 * pre-rotation secret and keep serving a credential the admin replaced.
 */
export async function provisionProviders(
  organizationId: string,
  providers: ProviderProvision[],
): Promise<ProviderProvisionFailure[]> {
  const failures: ProviderProvisionFailure[] = [];
  for (const p of providers) {
    if (skipUnprovisionable(p)) continue;
    try {
      await provisionOne(organizationId, p);
    } catch (err) {
      console.warn(
        `[llm-gateway] provisioning provider '${p.name}' for org '${organizationId}' failed (continuing):`,
        err,
      );
      failures.push({ name: p.name, error: err });
    }
  }
  return failures;
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
    auth_config?: { is_enabled?: boolean };
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
  // The gateway (Bifrost >= v1.6.9) enforces an admin-password strength policy
  // (>=12 chars, an upper, a lower, a digit and a non-alphanumeric special
  // char) — but ONLY when the password is being CHANGED. It treats a plaintext
  // `admin_password` as a change, so re-asserting one on every apply 400s
  // ("auth password must include one special character") for any secret minted
  // before the policy (a base64url secret has no special char ~half the time).
  // Once auth is established we therefore send the password in "preserve
  // stored" form (an empty value → SecretVar.ShouldPreserveStored on the
  // gateway): it keeps the existing hash and skips the policy, and Basic auth
  // keeps matching the unchanged secret. Only the FIRST-time bootstrap sends
  // the plaintext to establish auth — and that minted secret is policy-
  // compliant by construction (the ensure-env / dev-secret generators). The
  // gateway hashes the stored password itself (bcrypt); managementHeaders()
  // sends the plaintext as Basic.
  const authAlreadyEnabled = cfg.auth_config?.is_enabled === true;
  const body: Record<string, unknown> = {
    client_config: clientConfig,
    auth_config: {
      is_enabled: true,
      admin_username: adminUsername(),
      admin_password: authAlreadyEnabled ? '' : requireGatewayAdminPassword(),
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
