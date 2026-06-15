'use node';

/**
 * Provider file I/O actions.
 *
 * CRUD actions for provider JSON files + lightweight model resolution actions
 * that return pure serializable data (no provider instances).
 *
 * Non-node callers use ctx.runAction() to get provider data, then create
 * provider instances locally with @ai-sdk/openai-compatible.
 */

import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

import { ConvexError, v } from 'convex/values';

import type {
  EnvSecretStatus,
  ProviderSecrets,
} from '../../lib/shared/schemas/providers';
import { providerJsonSchema } from '../../lib/shared/schemas/providers';
import { parseModelRef } from '../../lib/shared/utils/model-ref';
import { internal } from '../_generated/api';
import { action, internalAction, type ActionCtx } from '../_generated/server';
import { resolveAgeRecipients } from '../lib/age_keygen';
import type { NormalizedCapability } from '../lib/agent_response/model_capabilities/normalize';
import { normalizeCatalogPayload } from '../lib/agent_response/model_capabilities/normalize';
import {
  atomicWrite,
  atomicWriteSecret,
  readJsonFile,
  sha256,
} from '../lib/file_io';
import { isPrivateIp, safeFetch, SafeFetchError } from '../lib/http/safe_fetch';
import {
  isPlainObject,
  mergeModelLevel,
  pinQuantization,
  stripDenyListed,
} from '../lib/provider_options';
import {
  EncryptedFileWithoutKeyError,
  decryptSecretsFile,
  hasSopsKey,
  invalidateSecretsCache,
} from '../lib/sops';
import { sanitizeError } from '../lib/utils/sanitize_secrets';
import {
  isStandardGatewayProvider,
  reprovisionProvider,
  resolveGatewayRouting,
} from '../node_only/sandbox/bifrost_admin';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import {
  requireDeveloperSettingsAccess,
  requireDeveloperSettingsAccessById,
  requireOrgMembership,
  requireOrgMembershipById,
} from './auth';
import { MissingApiKeyError, NoProviderAvailableError } from './errors';
import type { ProviderJson, ProviderReadResult } from './file_utils';
import {
  MAX_FILE_SIZE_BYTES,
  parseProviderJson,
  parseProviderSecrets,
  providerNameFromFileName,
  resolveProviderFilePath,
  resolveProviderSecretsPath,
  resolveProvidersDir,
  serializeProviderJson,
  validateProviderName,
} from './file_utils';
// Type-only import (erased at runtime — no circular dependency) so the
// in-process resolver shares the canonical ResolvedModelData shape.
import type { ResolvedModelData } from './resolve_model';
import {
  UndecryptableExistingSecretError,
  prepareMergedSecrets,
} from './secret_io';
import {
  envSecret,
  envSecretStatus,
  providerHasEnvKey,
  resolveApiKey,
} from './secret_resolver';

/**
 * Optional routing/cascade metadata fields, shared by the two model-resolution
 * action return validators so they can't drift. Mirrors
 * `modelRoutingMetadataFields` in the provider zod schema. `routingTags` is
 * validated as `v.string()[]` here (the zod schema already enforces the domain
 * enum at config-load time); the action layer only needs to not reject it.
 */
const modelRoutingMetadataValidator = {
  tier: v.optional(
    v.union(v.literal('draft'), v.literal('standard'), v.literal('frontier')),
  ),
  qualityScore: v.optional(v.number()),
  routingTags: v.optional(v.array(v.string())),
  contextWindow: v.optional(v.number()),
} as const;

/**
 * Serializable model-resolution payload shared by `resolveModelData` and
 * `resolveModelByTag` so the two action return validators can't drift. Mirrors
 * `ResolvedModelData` in `resolve_model.ts`.
 */
const resolvedModelDataValidator = v.object({
  providerName: v.string(),
  baseUrl: v.string(),
  apiKey: v.string(),
  modelId: v.string(),
  apiFormat: v.union(v.literal('openai'), v.literal('anthropic')),
  tags: v.array(v.string()),
  dimensions: v.optional(v.number()),
  maxOutputTokens: v.optional(v.number()),
  supportsStructuredOutputs: v.boolean(),
  imageGenerationMode: v.optional(
    v.union(v.literal('images-api'), v.literal('chat-multimodal')),
  ),
  transcriptionMode: v.optional(
    v.union(v.literal('multipart'), v.literal('json-base64')),
  ),
  inputCentsPerMillion: v.optional(v.number()),
  outputCentsPerMillion: v.optional(v.number()),
  imageCentsPerImage: v.optional(v.number()),
  centsPerAudioMinute: v.optional(v.number()),
  centsPerMillionCharacters: v.optional(v.number()),
  defaultVoice: v.optional(v.string()),
  voicesByLocale: v.optional(v.record(v.string(), v.string())),
  defaultInstructions: v.optional(v.string()),
  instructionsByLocale: v.optional(v.record(v.string(), v.string())),
  audioFormat: v.optional(
    v.union(
      v.literal('mp3'),
      v.literal('opus'),
      v.literal('aac'),
      v.literal('flac'),
      v.literal('wav'),
      v.literal('pcm'),
    ),
  ),
  providerOptions: v.optional(v.record(v.string(), v.any())),
  reasoning: v.optional(
    v.object({
      knob: v.union(
        v.literal('effort'),
        v.literal('budgetTokens'),
        v.literal('none'),
      ),
      supportsMinimal: v.optional(v.boolean()),
      minBudgetTokens: v.optional(v.number()),
      maxBudgetTokens: v.optional(v.number()),
    }),
  ),
  promptCaching: v.optional(
    v.object({
      mode: v.union(
        v.literal('explicit-breakpoints'),
        v.literal('auto-server'),
        v.literal('none'),
      ),
      maxBreakpoints: v.optional(v.number()),
    }),
  ),
  ...modelRoutingMetadataValidator,
});

/**
 * Per-model id/tags/quantizations entry returned by the model-listing actions
 * (`getAllModelIds`, `getAllConfiguredModelIds`). Shared so the two return
 * validators stay in sync.
 */
const modelIdEntryValidator = v.object({
  id: v.string(),
  tags: v.array(v.string()),
  providerName: v.string(),
  displayName: v.optional(v.string()),
  quantizations: v.optional(v.array(v.string())),
});

/**
 * Layer the fetched capability cache (`modelCapabilityCache`) UNDER the
 * operator-declared provider-JSON fields: any capability the JSON leaves unset
 * is filled from the cache. Whatever is still unset falls to family-based
 * inference in the pure resolvers (`reasoning/capability.ts`,
 * `prompt_caching/strategy.ts`) for the reasoning knob + caching mode; cost /
 * context have no further fallback (left undefined). Keyed by the resolved
 * `modelId`. A cache miss (or no sync yet) is a no-op.
 */
async function applyCachedCapabilities<
  T extends {
    modelId: string;
    reasoning?: unknown;
    promptCaching?: unknown;
    inputCentsPerMillion?: number;
    outputCentsPerMillion?: number;
    maxOutputTokens?: number;
    contextWindow?: number;
  },
>(ctx: ActionCtx, data: T): Promise<T> {
  const cap = await ctx.runQuery(
    internal.model_catalog.queries.getModelCapabilityInternal,
    { modelId: data.modelId },
  );
  if (!cap) return data;
  return {
    ...data,
    reasoning: data.reasoning ?? cap.reasoning,
    promptCaching: data.promptCaching ?? cap.promptCaching,
    inputCentsPerMillion: data.inputCentsPerMillion ?? cap.inputCentsPerMillion,
    outputCentsPerMillion:
      data.outputCentsPerMillion ?? cap.outputCentsPerMillion,
    maxOutputTokens: data.maxOutputTokens ?? cap.maxOutputTokens,
    contextWindow: data.contextWindow ?? cap.contextWindow,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Mask an API key for "configured?" display in the dashboard. Shows the
 * first 6 chars and the last 4 — enough to disambiguate two keys with
 * the same vendor prefix (e.g. `sk-or-v1-…`) and to cross-check against
 * the vendor's own dashboard, which is the source of truth users compare
 * against. Revealing 4 trailing chars of a 200+ bit bearer token is
 * ~16-20 bits of entropy loss; the remaining keyspace stays
 * astronomically unsearchable. Matches AWS / GitHub / Stripe / OpenAI /
 * OpenRouter masking conventions.
 */
function maskApiKey(key: string): string {
  if (key.length <= 10) return '••••••••••';
  return `${key.slice(0, 6)} … ${key.slice(-4)}`;
}

/**
 * Read a model's declared quantization variants from its `providerOptions`.
 * Returns the array only when it's a non-empty list of strings; any other
 * shape (missing, non-array, mixed types) is treated as "no variants" so the
 * model behaves as a plain non-quantized entry. The schema accepts arbitrary
 * passthrough under `providerOptions`, so this defensive read is required.
 */
function readQuantizations(
  providerOptions: Record<string, unknown> | undefined,
): string[] | undefined {
  if (!providerOptions) return undefined;
  const provider = providerOptions.provider;
  if (!isPlainObject(provider)) return undefined;
  const q = provider.quantizations;
  if (!Array.isArray(q) || q.length === 0) return undefined;
  if (!q.every((item) => typeof item === 'string' && item.length > 0))
    return undefined;
  return q;
}

/**
 * Read the quantization variants that apply to a model after merging
 * provider-level and model-level `providerOptions` (model wins on conflict),
 * so the UI's variant expansion matches what `resolveModelData` would pin
 * at request time. Reading model-level alone would silently ignore
 * provider-wide defaults declared at the top of a provider JSON.
 */
function readEffectiveQuantizations(
  providerLevel: Record<string, unknown> | undefined,
  modelLevel: Record<string, unknown> | undefined,
): string[] | undefined {
  return readQuantizations(mergeModelLevel(providerLevel, modelLevel));
}

interface ModelIdEntry {
  id: string;
  tags: string[];
  providerName: string;
  displayName?: string;
  quantizations?: string[];
}

/**
 * Project a provider's models to the id/tags/quantizations listing shape
 * returned by `getAllModelIds` and `getAllConfiguredModelIds`.
 */
function mapModelIdEntries(
  providerName: string,
  config: ProviderJson,
): ModelIdEntry[] {
  return config.models.map((m) => ({
    id: m.id,
    tags: [...m.tags],
    providerName,
    displayName: m.displayName,
    quantizations: readEffectiveQuantizations(
      config.providerOptions,
      m.providerOptions,
    ),
  }));
}

/** True iff `err` is a Node ErrnoException with the given code. */
function isErrnoCode(err: unknown, code: string): boolean {
  return err instanceof Error && 'code' in err && err.code === code;
}

/**
 * A provider's public config file: a top-level `*.json` that is neither a
 * dot-file nor a `*.secrets.json`. The provider name is its basename.
 */
function isProviderJsonFile(fileName: string): boolean {
  return (
    fileName.endsWith('.json') &&
    !fileName.startsWith('.') &&
    !fileName.endsWith('.secrets.json')
  );
}

/**
 * Cloud metadata service hosts. Always blocked, regardless of
 * `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS` — there is no legitimate reason for an
 * LLM provider endpoint to live at IMDS. Includes the public-IP IMDS
 * endpoints (Alibaba, Oracle) that slip past the RFC1918 / link-local
 * `isPrivateIp` check.
 */
const BLOCKED_METADATA_HOSTS = new Set<string>([
  '169.254.169.254', // AWS, GCP, Azure, DigitalOcean, Oracle (link-local)
  'fd00:ec2::254', // AWS IMDSv2 IPv6
  'metadata.google.internal', // GCP
  'metadata', // bare hostname; resolves under GKE/GCE search domains
  '100.100.100.200', // Alibaba ECS — public IP, not caught by isPrivateIp
  '192.0.0.192', // Oracle Cloud OCI v1 — public IP
  'metadata.tencentyun.com', // Tencent Cloud
]);

/**
 * Reject the URL at the policy layer before issuing any request. Two gates:
 *
 * 1. Cloud metadata services (AWS/GCP/Azure/Alibaba/Oracle/Tencent IMDS,
 *    both link-local and public-IP variants) are always blocked.
 * 2. Other private/loopback hosts (RFC1918, `127.0.0.0/8`, `localhost`,
 *    link-local, ULA) are blocked by default. To support self-hosted
 *    backends like Ollama on `localhost:11434`, operators set
 *    `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` in the platform process env.
 *
 * Validates the hostname string only. DNS rebinding via short-TTL toggling
 * is NOT mitigated; resolution happens again inside `fetch`. Acceptable
 * because (a) only `developerSettings`-scoped users author URLs, and
 * (b) policy is one of several layers (IMDS host blocklist, RFC1918 reject,
 * `redirect: 'manual'` in `safeFetch`). To pin against rebinding, route
 * through an undici Dispatcher with a `lookup` callback.
 *
 * Throws `ConvexError` so the UI can dispatch on `data.code`.
 */
export function checkProviderHostPolicy(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ConvexError({
      code: 'INVALID_URL',
      message: `Invalid URL: ${rawUrl}`,
    });
  }
  // Normalize: lowercase, strip IPv6 brackets, strip trailing dot.
  // A trailing-dot hostname like `metadata.google.internal.` resolves the
  // same DNS-wise but bypasses naive `Set.has` lookups.
  const host = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (BLOCKED_METADATA_HOSTS.has(host)) {
    throw new ConvexError({
      code: 'BLOCKED_HOST',
      message: `Host "${host}" is blocked (cloud metadata endpoint).`,
    });
  }
  if (
    isPrivateIp(host) &&
    process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS !== '1'
  ) {
    throw new ConvexError({
      code: 'PRIVATE_HOST_BLOCKED',
      message:
        `Host "${host}" is a private/loopback address and is blocked. ` +
        'Set TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1 in the platform process env to ' +
        'enable self-hosted backends like Ollama on localhost.',
    });
  }
  return parsed;
}

async function readProviderFile(
  orgSlug: string,
  providerName: string,
): Promise<ProviderReadResult> {
  const filePath = resolveProviderFilePath(orgSlug, providerName);
  const result = await readJsonFile<ProviderJson>(
    filePath,
    MAX_FILE_SIZE_BYTES,
    parseProviderJson,
  );
  if (result.ok) return { ok: true, config: result.data, hash: result.hash };
  return result;
}

interface ProviderWithSecrets {
  name: string;
  config: ProviderJson;
  /**
   * File secrets, or `null` when the provider has no `*.secrets.json` and
   * relies entirely on an env-var key source (`secretsEnv`). The per-resolution
   * key is computed via `resolveApiKey`, which falls back to these file values.
   */
  secrets: ProviderSecrets | null;
}

const FRIENDLY_NO_PROVIDER =
  'No API key is configured for this organization yet. Open Settings → AI providers and add one to start chatting.';

async function loadAllProviders(
  orgSlug: string,
): Promise<ProviderWithSecrets[]> {
  const dir = resolveProvidersDir(orgSlug);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw new NoProviderAvailableError(FRIENDLY_NO_PROVIDER, 'no_providers', [
      `Provider directory missing: ${dir}`,
    ]);
  }

  const jsonFiles = entries.filter(isProviderJsonFile);

  if (jsonFiles.length === 0) {
    throw new NoProviderAvailableError(FRIENDLY_NO_PROVIDER, 'no_providers', [
      `No provider JSON files in ${dir}`,
    ]);
  }

  const providers: ProviderWithSecrets[] = [];
  const skippedReasons: string[] = [];
  let anyMissingSecret = false;

  for (const fileName of jsonFiles) {
    const providerName = path.basename(fileName, '.json');
    if (!validateProviderName(providerName)) {
      console.warn(`Provider "${providerName}": invalid name, skipping.`);
      skippedReasons.push(`${providerName}: invalid name`);
      continue;
    }

    const filePath = path.join(dir, fileName);
    const result = await readJsonFile<ProviderJson>(
      filePath,
      MAX_FILE_SIZE_BYTES,
      parseProviderJson,
    );
    if (!result.ok) {
      console.warn(`Provider "${providerName}": ${result.message}, skipping.`);
      skippedReasons.push(`${providerName}: ${result.message}`);
      continue;
    }

    const secretsPath = path.join(dir, `${providerName}.secrets.json`);
    let secrets: ProviderSecrets | null;
    try {
      const raw = await decryptSecretsFile(secretsPath);
      secrets = parseProviderSecrets(raw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // No usable secrets file. Before skipping, check whether the config can
      // resolve a key from the environment (issue #1711): provider-level
      // `secretsEnv` or any model-level `secretsEnv`, gated by the reserved
      // prefix. If so, keep the provider with `secrets: null` — the
      // per-resolution `resolveApiKey` reads the env value. Otherwise skip as
      // before. ENOENT (the common "config but no key yet" case) drives the
      // UI's Settings → Providers hint.
      if (providerHasEnvKey(result.data)) {
        console.warn(
          `Provider "${providerName}": no secrets file, using env key source.`,
          reason,
        );
        providers.push({
          name: providerName,
          config: result.data,
          secrets: null,
        });
        continue;
      }
      if (/ENOENT/i.test(reason)) {
        anyMissingSecret = true;
      }
      console.warn(
        `Provider "${providerName}": secrets not available, skipping.`,
        reason,
      );
      skippedReasons.push(`${providerName}: ${reason}`);
      continue;
    }

    providers.push({ name: providerName, config: result.data, secrets });
  }

  if (providers.length === 0 && skippedReasons.length > 0) {
    throw new NoProviderAvailableError(
      FRIENDLY_NO_PROVIDER,
      anyMissingSecret ? 'missing_api_key' : 'load_failed',
      skippedReasons,
    );
  }

  return providers;
}

/**
 * Resolve the effective API key for a model on a loaded provider, preferring
 * the env-var source (`secretsEnv`) over file secrets (issue #1711). Throws a
 * per-model `MissingApiKeyError` when nothing resolves — reachable when a
 * provider is kept alive by a sibling model's env key but the queried model has
 * neither an env nor a file key. The throw is failover-eligible (see
 * `errors.ts`), so the agent fallback chain moves on to the next model.
 */
function resolveModelApiKeyOrNull(
  provider: ProviderWithSecrets,
  definition: { id: string; secretsEnv?: string },
): string | null {
  return resolveApiKey({
    modelSecretsEnv: definition.secretsEnv,
    providerSecretsEnv: provider.config.secretsEnv,
    fileModelKey: provider.secrets?.modelKeys?.[definition.id],
    fileApiKey: provider.secrets?.apiKey,
  });
}

function resolveModelApiKey(
  provider: ProviderWithSecrets,
  definition: { id: string; secretsEnv?: string },
): string {
  const apiKey = resolveModelApiKeyOrNull(provider, definition);
  if (!apiKey) {
    throw new MissingApiKeyError(
      provider.name,
      definition.id,
      definition.secretsEnv ?? provider.config.secretsEnv,
    );
  }
  return apiKey;
}

/**
 * Assemble the `resolveModelByTag` result object for a (provider, model) pair
 * whose API key has already been resolved. Shared by the per-tag-default pass
 * and the first-tag-match pass so the (large) shape lives in one place.
 */
function buildResolvedTagModel(
  provider: ProviderWithSecrets,
  definition: ProviderJson['models'][number],
  apiKey: string,
) {
  return {
    providerName: provider.name,
    baseUrl: definition.baseUrl ?? provider.config.baseUrl,
    apiKey,
    modelId: definition.id,
    apiFormat:
      definition.apiFormat ?? provider.config.apiFormat ?? ('openai' as const),
    tags: [...definition.tags],
    dimensions: definition.dimensions,
    maxOutputTokens: definition.maxOutputTokens,
    supportsStructuredOutputs:
      definition.supportsStructuredOutputs ??
      provider.config.supportsStructuredOutputs ??
      false,
    imageGenerationMode: definition.imageGenerationMode,
    transcriptionMode: definition.transcriptionMode,
    inputCentsPerMillion: definition.cost?.inputCentsPerMillion,
    outputCentsPerMillion: definition.cost?.outputCentsPerMillion,
    imageCentsPerImage: definition.cost?.imageCentsPerImage,
    centsPerAudioMinute: definition.cost?.centsPerAudioMinute,
    centsPerMillionCharacters: definition.cost?.centsPerMillionCharacters,
    defaultVoice: definition.defaultVoice,
    voicesByLocale: definition.voicesByLocale,
    defaultInstructions: definition.defaultInstructions,
    instructionsByLocale: definition.instructionsByLocale,
    audioFormat: definition.audioFormat,
    providerOptions: mergeModelLevel(
      provider.config.providerOptions,
      definition.providerOptions,
    ),
    reasoning: definition.reasoning,
    promptCaching: definition.promptCaching,
    tier: definition.tier,
    qualityScore: definition.qualityScore,
    routingTags: definition.routingTags,
    contextWindow: definition.contextWindow,
  };
}

/**
 * Two-pass tag → model resolution over already-loaded candidate providers.
 * Pass 1 honors an explicit per-tag default; pass 2 takes the first tagged
 * model. Both SKIP a model whose API key does not resolve so a keyless match
 * never masks a usable sibling — a provider may be kept loaded by one model's
 * env key (`providerHasEnvKey` is provider-OR-any-model) while another tagged
 * model has none. Throws the per-model, failover-eligible `MissingApiKeyError`
 * when a tag match existed but none resolved a key (transcription/TTS resolve
 * via this path with no failover wrapper, so a premature throw on the first
 * keyless hit would be terminal); throws `UNKNOWN_MODEL` when no model carries
 * the tag at all. Pure (no IO) so the resolution policy is unit-testable.
 */
export function selectModelByTag(
  candidates: ProviderWithSecrets[],
  tag: string,
  providerName: string | undefined,
): ReturnType<typeof buildResolvedTagModel> {
  // A tag match whose API key did not resolve — kept so that, if NO candidate
  // resolves a key, we throw the failover-eligible MissingApiKeyError instead
  // of terminating on the first keyless hit.
  let lastKeyless: {
    provider: ProviderWithSecrets;
    definition: ProviderJson['models'][number];
  } | null = null;

  // First pass: explicit per-tag default. Skip a keyless default so the
  // first-tag-match pass can still surface a usable sibling.
  for (const provider of candidates) {
    const defaults = provider.config.defaults;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- defaults keys are 'chat' | 'vision' | 'embedding'; tag may not match but undefined access is handled below
    const tagKey = tag as keyof NonNullable<typeof defaults>;
    const defaultModelId = defaults?.[tagKey];
    if (!defaultModelId) continue;
    const definition = provider.config.models.find(
      (m) => m.id === defaultModelId,
    );
    if (!definition) continue;
    const apiKey = resolveModelApiKeyOrNull(provider, definition);
    if (!apiKey) {
      lastKeyless = { provider, definition };
      continue;
    }
    return buildResolvedTagModel(provider, definition, apiKey);
  }

  // Fallback: every model with a matching tag, across all candidates. Return
  // the first one that resolves a key — a keyless first match must not mask a
  // usable sibling, including one on the same provider.
  for (const provider of candidates) {
    for (const definition of provider.config.models) {
      if (!(definition.tags as readonly string[]).includes(tag)) {
        continue;
      }
      const apiKey = resolveModelApiKeyOrNull(provider, definition);
      if (!apiKey) {
        lastKeyless = { provider, definition };
        continue;
      }
      return buildResolvedTagModel(provider, definition, apiKey);
    }
  }

  // A tag match existed but none resolved a key: throw the per-model,
  // failover-eligible MissingApiKeyError (a different fallback model on
  // another provider may resolve) rather than the terminal UNKNOWN_MODEL.
  if (lastKeyless) {
    throw new MissingApiKeyError(
      lastKeyless.provider.name,
      lastKeyless.definition.id,
      lastKeyless.definition.secretsEnv ??
        lastKeyless.provider.config.secretsEnv,
    );
  }

  throw new ConvexError({
    code: 'UNKNOWN_MODEL',
    message: `No model with tag "${tag}" found${providerName ? ` in provider "${providerName}"` : ' in any provider'}.`,
  });
}

// ---------------------------------------------------------------------------
// Public CRUD actions (called from frontend)
// ---------------------------------------------------------------------------

export const readProvider = action({
  args: { organizationId: v.string(), providerName: v.string() },
  returns: v.any(),
  handler: async (
    ctx,
    args,
  ): Promise<
    ProviderReadResult & {
      maskedModelKeys?: Record<string, string>;
      envSecretStatus?: {
        provider: EnvSecretStatus;
        models: Record<string, EnvSecretStatus>;
      };
    }
  > => {
    // Returns the masked-key preview, so gate on developerSettings to match
    // the dashboard route that's the only legit consumer.
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    const result = await readProviderFile(orgSlug, args.providerName);
    if (!result.ok) return result;

    // Attach masked per-model API keys (modelId → masked key). Failures here
    // — including encrypted-no-key — degrade silently so the rest of the page
    // still renders. The actionable encrypted-no-key signal lives on
    // `hasProviderSecret` (whose entire purpose is the secret state); the API
    // Key section consumes that and renders the banner.
    const maskedModelKeys: Record<string, string> = {};
    try {
      const secretsPath = resolveProviderSecretsPath(
        orgSlug,
        args.providerName,
      );
      const raw = await decryptSecretsFile(secretsPath);
      const secrets = parseProviderSecrets(raw);
      if (secrets.modelKeys) {
        for (const [id, key] of Object.entries(secrets.modelKeys)) {
          if (key) {
            maskedModelKeys[id] = maskApiKey(key);
          }
        }
      }
    } catch (err) {
      // Missing secrets file → no per-model key overrides (normal); only warn
      // on unexpected read/parse failures.
      const reason = err instanceof Error ? err.message : String(err);
      if (!/ENOENT/i.test(reason)) {
        console.warn(
          `Provider "${args.providerName}": failed to read model key overrides`,
          sanitizeError(err),
        );
      }
    }

    // Env-var key source status (issue #1711): which `secretsEnv` names are
    // configured and whether they currently resolve, so the API Key section can
    // distinguish "not configured" / "configured but empty" / "not
    // prefixed". Never includes the value itself.
    const envSecretStatusByLevel: {
      provider: EnvSecretStatus;
      models: Record<string, EnvSecretStatus>;
    } = {
      provider: envSecretStatus(result.config.secretsEnv),
      models: {},
    };
    for (const model of result.config.models) {
      if (model.secretsEnv) {
        envSecretStatusByLevel.models[model.id] = envSecretStatus(
          model.secretsEnv,
        );
      }
    }

    return {
      ...result,
      maskedModelKeys,
      envSecretStatus: envSecretStatusByLevel,
    };
  },
});

export const listProviders = action({
  args: { organizationId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    await requireOrgMembership(ctx, orgSlug);

    const dir = resolveProvidersDir(orgSlug);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if (!isErrnoCode(err, 'ENOENT')) {
        console.warn('[listProviders] readdir failed', dir, sanitizeError(err));
      }
      return [];
    }

    const jsonFiles = entries.filter(isProviderJsonFile);

    const results = await Promise.all(
      jsonFiles.map(async (fileName) => {
        const name = providerNameFromFileName(fileName);
        if (!validateProviderName(name)) return null;
        const result = await readProviderFile(orgSlug, name);
        if (result.ok) {
          // Try reading secrets to detect per-model API key overrides AND
          // whether the provider has a usable API key at all (the schema
          // requires a non-empty `apiKey`, so a successful parse ⇒ configured).
          let modelKeys: Record<string, string> | undefined;
          let hasApiKey = false;
          try {
            const secretsPath = resolveProviderSecretsPath(orgSlug, name);
            const raw = await decryptSecretsFile(secretsPath);
            const secrets = parseProviderSecrets(raw);
            modelKeys = secrets.modelKeys;
            hasApiKey = true;
          } catch (err) {
            // A missing secrets file just means this provider has no per-model
            // key overrides — the normal case for most providers. Stay quiet on
            // ENOENT; only warn on unexpected read/parse failures.
            const reason = err instanceof Error ? err.message : String(err);
            if (!/ENOENT/i.test(reason)) {
              console.warn(
                `Provider "${name}": failed to read model key overrides`,
                sanitizeError(err),
              );
            }
          }

          // Fold in the env-var key source (issue #1711). Provider-level
          // `hasApiKey` must use ONLY the provider-level env — NOT a
          // model-OR'd signal — so a sibling model's env key never falsely
          // un-blocks the composer for a keyless model. Per-model env folds
          // into `hasApiKeyOverride`, exactly mirroring file `modelKeys`.
          if (!hasApiKey && envSecret(result.config.secretsEnv) != null) {
            hasApiKey = true;
          }

          return {
            name,
            displayName: result.config.displayName,
            description: result.config.description,
            baseUrl: result.config.baseUrl,
            // Wire format (default openai); model entries carry the effective
            // value. Lets picker/UI surfaces reason about anthropic providers.
            apiFormat: result.config.apiFormat ?? 'openai',
            modelCount: result.config.models.length,
            defaults: result.config.defaults,
            // Whether this provider has an API key configured — lets the chat
            // composer disable "send" early with a clear reason instead of
            // failing at dispatch time.
            hasApiKey,
            models: result.config.models.map((m) => ({
              id: m.id,
              displayName: m.displayName,
              description: m.description ?? '',
              tags: m.tags,
              // Effective wire format (model ?? provider ?? openai).
              apiFormat: m.apiFormat ?? result.config.apiFormat ?? 'openai',
              hasBaseUrlOverride: m.baseUrl != null,
              hasApiKeyOverride:
                modelKeys?.[m.id] != null || envSecret(m.secretsEnv) != null,
              // Surface quantization variants so the UI selectors can split
              // each model into one selectable entry per declared weight
              // format. Read from merged provider+model providerOptions to
              // match resolveModelData's runtime view.
              quantizations: readEffectiveQuantizations(
                result.config.providerOptions,
                m.providerOptions,
              ),
              // Whether the model is hidden from picker surfaces (chat
              // composer). The model selector reads `model.hidden` to filter
              // these out; without projecting it here, hidden models leaked
              // into the picker.
              hidden: m.hidden,
            })),
            i18n: result.config.i18n,
          };
        }
        return { name, status: result.error, message: result.message };
      }),
    );

    return results.filter(Boolean);
  },
});

export const saveProvider = action({
  args: {
    organizationId: v.string(),
    providerName: v.string(),
    config: v.any(),
    /**
     * Optional optimistic-concurrency token. When provided, the save
     * fails with `PROVIDER_VERSION_CONFLICT` if the on-disk file's hash
     * differs (someone else saved between the dashboard's load and this
     * write). Frontend snapshots the hash returned by `readProvider` /
     * a previous `saveProvider`. Omit on first-create or when the caller
     * intentionally wants last-write-wins.
     */
    expectedHash: v.optional(v.string()),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );

    if (!validateProviderName(args.providerName))
      throw new Error(`Invalid provider name: ${args.providerName}`);
    // Wrap ZodError in ConvexError with `issues` so the dashboard can render
    // a per-field error message. Raw `parse` would surface as a generic
    // stringified ZodError array in the toast description.
    const parseResult = providerJsonSchema.safeParse(args.config);
    if (!parseResult.success) {
      throw new ConvexError({
        code: 'INVALID_PROVIDER_CONFIG',
        issues: parseResult.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const config = parseResult.data;
    // SSRF: gate persisted base URLs through the same host policy as the
    // probe-time call. Without this, a developerSettings user could save
    // baseUrl pointing at IMDS / internal services and have the API key
    // POSTed there on the next chat/embedding/image/transcription call.
    checkProviderHostPolicy(config.baseUrl);
    for (const model of config.models) {
      if (model.baseUrl !== undefined) checkProviderHostPolicy(model.baseUrl);
    }
    // `apiFormat` only governs CUSTOM (non-standard) providers — Bifrost owns
    // the wire format for its standard names and would ignore (or 400 on) a
    // custom_provider_config. Reject it on a standard slug so the field never
    // silently misleads (e.g. `anthropic` on `openrouter`).
    if (
      isStandardGatewayProvider(args.providerName) &&
      (config.apiFormat !== undefined ||
        config.models.some((m) => m.apiFormat !== undefined))
    ) {
      throw new ConvexError({
        code: 'INVALID_PROVIDER_CONFIG',
        issues: [
          {
            path: 'apiFormat',
            message: `apiFormat applies to custom providers only; '${args.providerName}' is a built-in provider whose wire format the gateway already knows.`,
          },
        ],
      });
    }
    // Optimistic concurrency: if the caller passed `expectedHash`, the file
    // on disk must hash to that value. Reading + writing isn't truly atomic
    // here, but combined with `atomicWrite`'s same-tmp-then-rename it
    // narrows the clobber window enough to surface concurrent edits to the
    // dashboard rather than silently overwriting them.
    if (args.expectedHash !== undefined) {
      const existing = await readProviderFile(orgSlug, args.providerName);
      const conflict = !existing.ok || existing.hash !== args.expectedHash;
      if (conflict) {
        throw new ConvexError({
          code: 'PROVIDER_VERSION_CONFLICT',
          message:
            'Provider may have been deleted or modified by another operator. Reload the page to see the latest state, then re-apply your changes.',
        });
      }
    }
    const content = serializeProviderJson(config);
    const filePath = resolveProviderFilePath(orgSlug, args.providerName);
    await atomicWrite(filePath, content);
    // Model-list changes must reach the gateway too — the Bifrost provider
    // record freezes keys[].models at provision time.
    await syncProviderToGateway(ctx, args.organizationId, args.providerName);
    return { hash: sha256(content) };
  },
});

export const deleteProvider = action({
  args: { organizationId: v.string(), providerName: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const auth = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    const { orgSlug } = auth;
    const filePath = resolveProviderFilePath(orgSlug, args.providerName);
    const secretsPath = resolveProviderSecretsPath(orgSlug, args.providerName);
    // Order: secrets first, then public config. If the secrets unlink fails
    // (rare — EACCES / EIO on a network FS), the public file remains and the
    // entry stays visible in the provider list so the operator can retry the
    // delete. The reversed order would leave an orphaned ciphertext that
    // discovery can't enumerate (loadAllProviders only iterates *.json),
    // requiring shell access to recover.
    await unlink(secretsPath).catch((err: unknown) => {
      if (!isErrnoCode(err, 'ENOENT')) throw err;
    });
    await unlink(filePath).catch((err: unknown) => {
      if (!isErrnoCode(err, 'ENOENT')) throw err;
    });
    // Drop any cached plaintext for the deleted secrets file. Without this,
    // the in-memory cache holds rotated/deleted credentials until process
    // restart (next read would ENOENT before reaching the cache, so this is
    // a memory-residency concern, not a stale-serve risk).
    invalidateSecretsCache(secretsPath);

    // Audit log — destructive op should leave a security-category trail.
    // Best-effort: a successful delete should not be reported as failed
    // because the audit table was unreachable.
    try {
      await ctx.runMutation(
        internal.audit_logs.internal_mutations.createAuditLog,
        {
          organizationId: auth.orgId,
          actorId: auth.userId,
          actorEmail: auth.email,
          actorRole: auth.member.role,
          actorType: 'user',
          action: 'provider_deleted',
          category: 'security',
          resourceType: 'provider',
          resourceId: args.providerName,
          resourceName: args.providerName,
          status: 'success',
        },
      );
    } catch (err) {
      console.warn(
        `[deleteProvider] failed to write audit log for ${args.providerName}`,
        sanitizeError(err),
      );
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Internal actions for model resolution (return pure data, no instances)
// ---------------------------------------------------------------------------

/**
 * Resolve provider data for a specific model ID.
 * Returns serializable data that callers use to create provider instances locally.
 */
export const resolveModelData = internalAction({
  args: {
    modelId: v.string(),
    organizationId: v.string(),
    providerName: v.optional(v.string()),
  },
  returns: resolvedModelDataValidator,
  handler: (ctx, args) => resolveModelDataInline(ctx, args),
});

/**
 * In-process variant of `resolveModelData` — call directly from a node action
 * (e.g. `resolveLanguageModelById`) to avoid a ~340ms node→backend `runAction`
 * dispatch hop. The internalAction above is a thin wrapper kept for any
 * cross-runtime callers.
 */
export async function resolveModelDataInline(
  ctx: ActionCtx,
  args: { modelId: string; organizationId: string; providerName?: string },
): Promise<ResolvedModelData> {
  const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
  const providers = await loadAllProviders(orgSlug);

  // Split off any `@<quant>` suffix so the provider config lookup uses the
  // bare model id from the JSON. The variant pins the
  // `providerOptions.provider.quantizations` array further below.
  // Fall back to the ref's parsed `provider:` qualifier when the caller
  // didn't pass `args.providerName` separately, so a fully-qualified
  // modelId pins the lookup without a redundant arg.
  const {
    providerName: parsedProviderName,
    modelId: bareModelId,
    quantization,
  } = parseModelRef(args.modelId);
  const effectiveProviderName = args.providerName ?? parsedProviderName;

  const candidates = effectiveProviderName
    ? providers.filter((p) => p.name === effectiveProviderName)
    : providers;

  if (effectiveProviderName && candidates.length === 0) {
    const available = providers.map((p) => p.name);
    throw new ConvexError({
      code: 'UNKNOWN_PROVIDER',
      message: `Provider "${effectiveProviderName}" not found. Available: ${available.join(', ')}`,
    });
  }

  let firstMatch:
    | {
        provider: (typeof candidates)[number];
        definition: (typeof candidates)[number]['config']['models'][number];
      }
    | undefined;
  const secondaryMatchProviders: string[] = [];
  for (const provider of candidates) {
    const definition = provider.config.models.find((m) => m.id === bareModelId);
    if (!definition) continue;
    if (!firstMatch) {
      firstMatch = { provider, definition };
    } else {
      secondaryMatchProviders.push(provider.name);
    }
  }

  if (firstMatch) {
    if (!effectiveProviderName && secondaryMatchProviders.length > 0) {
      console.warn(
        `[resolveModelData] Unqualified model "${bareModelId}" matches multiple providers ` +
          `(pinned: ${firstMatch.provider.name}; also in: ${secondaryMatchProviders.join(', ')}). ` +
          `Qualify as "${firstMatch.provider.name}:${bareModelId}" to pin explicitly.`,
      );
    }
    const { provider, definition } = firstMatch;
    let providerOptions = mergeModelLevel(
      provider.config.providerOptions,
      definition.providerOptions,
    );

    // The user pinned a specific quantization via the `@<quant>` suffix.
    // Validate it appears in the model's declared `quantizations` and
    // narrow the merged passthrough to a single-element array so the
    // upstream request asks for exactly that weight format.
    if (quantization) {
      const declared = readQuantizations(providerOptions);
      if (!declared || !declared.includes(quantization)) {
        const available = declared?.length ? declared.join(', ') : '(none)';
        throw new ConvexError({
          code: 'UNKNOWN_MODEL_VARIANT',
          message: `Model "${bareModelId}" has no quantization "${quantization}". Available: ${available}`,
        });
      }
      providerOptions = pinQuantization(providerOptions, quantization);
    }

    return applyCachedCapabilities(ctx, {
      providerName: provider.name,
      baseUrl: definition.baseUrl ?? provider.config.baseUrl,
      apiKey: resolveModelApiKey(provider, definition),
      // Effective wire format: model override ?? provider ?? 'openai' (same
      // precedence as baseUrl). Drives the external-agent gateway base type.
      apiFormat: definition.apiFormat ?? provider.config.apiFormat ?? 'openai',
      // The wire-side request uses the bare config id; the variant lives
      // only in providerOptions.provider.quantizations.
      modelId: bareModelId,
      tags: [...definition.tags],
      dimensions: definition.dimensions,
      maxOutputTokens: definition.maxOutputTokens,
      supportsStructuredOutputs:
        definition.supportsStructuredOutputs ??
        provider.config.supportsStructuredOutputs ??
        false,
      imageGenerationMode: definition.imageGenerationMode,
      transcriptionMode: definition.transcriptionMode,
      inputCentsPerMillion: definition.cost?.inputCentsPerMillion,
      outputCentsPerMillion: definition.cost?.outputCentsPerMillion,
      imageCentsPerImage: definition.cost?.imageCentsPerImage,
      centsPerAudioMinute: definition.cost?.centsPerAudioMinute,
      centsPerMillionCharacters: definition.cost?.centsPerMillionCharacters,
      defaultVoice: definition.defaultVoice,
      voicesByLocale: definition.voicesByLocale,
      defaultInstructions: definition.defaultInstructions,
      instructionsByLocale: definition.instructionsByLocale,
      audioFormat: definition.audioFormat,
      providerOptions,
      reasoning: definition.reasoning,
      promptCaching: definition.promptCaching,
      tier: definition.tier,
      qualityScore: definition.qualityScore,
      routingTags: definition.routingTags,
      contextWindow: definition.contextWindow,
    });
  }

  const allModelIds = candidates.flatMap((p) =>
    p.config.models.map((m) => m.id),
  );
  throw new ConvexError({
    code: 'UNKNOWN_MODEL',
    message: `Model "${bareModelId}" not found${effectiveProviderName ? ` in provider "${effectiveProviderName}"` : ' in any provider'}. Available: ${allModelIds.join(', ')}`,
  });
}

/** One upstream provider, ready to push into the Bifrost gateway. */
export interface GatewayProvider {
  /** Bifrost provider record name: the slug for a standard provider, or the
   * per-model gateway name (`resolveGatewayRouting`) for a custom one. */
  name: string;
  baseUrl?: string;
  /** Wire format for a custom record → Bifrost base_provider_type. */
  apiFormat?: 'openai' | 'anthropic';
  apiKey: string;
  models: string[];
}

/**
 * Load the org's configured providers as Bifrost gateway records. Reuses the
 * same loader + key-resolution the chat path uses (`loadAllProviders` +
 * `resolveModelApiKeyOrNull`) so the gateway tracks exactly what the platform
 * would call directly. Returns [] when the org has no usable providers.
 *
 * Grouping follows the gateway resolution rule (see resolveGatewayRouting):
 *   - STANDARD slug → ONE native record per provider, exposing every model with
 *     a resolvable key (Bifrost owns the base URL + wire format).
 *   - CUSTOM slug → ONE record PER MODEL, named `<slug>__<modelId>`, carrying
 *     that model's effective (baseUrl ?? provider.baseUrl, apiFormat, key) — so
 *     model-level overrides actually route on the agent path (Bifrost holds one
 *     base_url + base_provider_type per record).
 */
export async function loadOrgGatewayProviders(
  ctx: ActionCtx,
  organizationId: string,
): Promise<GatewayProvider[]> {
  const orgSlug = await resolveOrgSlug(ctx, organizationId);
  let providers: ProviderWithSecrets[];
  try {
    providers = await loadAllProviders(orgSlug);
  } catch {
    return [];
  }
  const out: GatewayProvider[] = [];
  for (const provider of providers) {
    if (isStandardGatewayProvider(provider.name)) {
      // One native record; pick the first resolvable key to anchor it and
      // expose every model id with a resolvable key.
      let apiKey: string | null = null;
      const models: string[] = [];
      for (const model of provider.config.models) {
        const key = resolveModelApiKeyOrNull(provider, model);
        if (key) {
          apiKey ??= key;
          models.push(model.id);
        }
      }
      if (apiKey && models.length > 0) {
        out.push({ name: provider.name, apiKey, models });
      }
      continue;
    }
    // Custom: a per-model upstream so each model's endpoint/format/key routes.
    for (const model of provider.config.models) {
      const key = resolveModelApiKeyOrNull(provider, model);
      if (!key) continue;
      out.push({
        name: resolveGatewayRouting(provider.name, model.id).gatewayProvider,
        baseUrl: model.baseUrl ?? provider.config.baseUrl,
        apiFormat: model.apiFormat ?? provider.config.apiFormat ?? 'openai',
        apiKey: key,
        models: [model.id],
      });
    }
  }
  return out;
}

/**
 * Best-effort push of one provider's current key + model list into the Bifrost
 * gateway. The gateway's provider record is a derived cache: without this
 * write-time hook, a rotated key would reach Bifrost only via the
 * session-create reconcile — and running sandbox sessions would keep the stale
 * key until then. Never throws — a deployment without Bifrost just hits a fast
 * connection error here, and the operator's save must succeed regardless (same
 * degrade posture as the session-create provisioning in run_external_agent.ts).
 * Known follow-up: deleteProvider leaves the gateway record orphaned.
 */
async function syncProviderToGateway(
  ctx: ActionCtx,
  organizationId: string,
  providerName: string,
): Promise<void> {
  try {
    const providers = await loadOrgGatewayProviders(ctx, organizationId);
    // A custom provider now expands to one gateway record PER MODEL
    // (`<slug>__<modelId>`), so match the saved slug AND its per-model records.
    // (Benign over-match if another slug is a `<providerName>__…` prefix — the
    // reprovision is idempotent + memoized.)
    const records = providers.filter(
      (p) => p.name === providerName || p.name.startsWith(`${providerName}__`),
    );
    if (records.length === 0) {
      // Key no longer resolves (cleared, or env-sourced without the env set).
      // Leave the stale gateway record to the session-create reconcile.
      console.warn(
        `[syncProviderToGateway] provider '${providerName}' has no resolvable key/models; skipping gateway sync`,
      );
      return;
    }
    for (const record of records) {
      await reprovisionProvider(organizationId, record);
    }
  } catch (err) {
    console.warn(
      `[syncProviderToGateway] best-effort gateway sync failed for '${providerName}' (continuing):`,
      sanitizeError(err),
    );
  }
}

/**
 * Resolve provider data for the first model matching a tag (chat/vision/embedding).
 */
export const resolveModelByTag = internalAction({
  args: {
    tag: v.string(),
    organizationId: v.string(),
    providerName: v.optional(v.string()),
  },
  returns: resolvedModelDataValidator,
  handler: async (ctx, args) => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const providers = await loadAllProviders(orgSlug);

    const candidates = args.providerName
      ? providers.filter((p) => p.name === args.providerName)
      : providers;

    if (args.providerName && candidates.length === 0) {
      const available = providers.map((p) => p.name);
      throw new ConvexError({
        code: 'UNKNOWN_PROVIDER',
        message: `Provider "${args.providerName}" not found. Available: ${available.join(', ')}`,
      });
    }

    return applyCachedCapabilities(
      ctx,
      selectModelByTag(candidates, args.tag, args.providerName),
    );
  },
});

/**
 * Get all model IDs with their tags across all providers.
 * Used for cross-validation of agent supportedModels at config time.
 */
export const getAllModelIds = internalAction({
  args: { organizationId: v.string() },
  returns: v.array(modelIdEntryValidator),
  handler: async (ctx, args) => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    let providers: ProviderWithSecrets[];
    try {
      providers = await loadAllProviders(orgSlug);
    } catch (err) {
      // `loadAllProviders` deliberately attaches `{reason, details[]}` to
      // `NoProviderAvailableError`. Don't drop that context — operators
      // need to tell "no providers configured" (legitimate fresh org)
      // from "config exists but won't load".
      if (err instanceof NoProviderAvailableError) {
        if (err.reason !== 'no_providers') {
          console.warn(
            '[getAllModelIds] loadAllProviders failed',
            err.reason,
            err.details,
          );
        }
      } else {
        console.warn(
          '[getAllModelIds] loadAllProviders threw',
          sanitizeError(err),
        );
      }
      return [];
    }
    return providers.flatMap((provider) =>
      mapModelIdEntries(provider.name, provider.config),
    );
  },
});

/**
 * Read the per-model cost + routing metadata for ALL configured models from
 * provider JSON directly — NO secret decryption, no model instances. Only the
 * non-secret fields routing needs (cost/tier/quality/tags/context).
 */
async function readRoutingCatalog(orgSlug: string) {
  const dir = resolveProvidersDir(orgSlug);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (!isErrnoCode(err, 'ENOENT')) {
      console.warn(
        '[getModelRoutingCatalog] readdir failed',
        dir,
        sanitizeError(err),
      );
    }
    return [];
  }
  const jsonFiles = entries.filter(isProviderJsonFile);
  const perProvider = await Promise.all(
    jsonFiles.map(async (fileName) => {
      const name = providerNameFromFileName(fileName);
      if (!validateProviderName(name)) return [];
      const result = await readProviderFile(orgSlug, name);
      if (!result.ok) {
        console.warn(
          '[getModelRoutingCatalog] readProviderFile failed',
          name,
          result.message,
        );
        return [];
      }
      return result.config.models.map((m) => ({
        id: m.id,
        providerName: name,
        tags: [...m.tags],
        outputCentsPerMillion: m.cost?.outputCentsPerMillion,
        tier: m.tier,
        qualityScore: m.qualityScore,
        routingTags: m.routingTags,
        contextWindow: m.contextWindow,
      }));
    }),
  );
  return perProvider.flat();
}

type RoutingCatalogEntry = Awaited<
  ReturnType<typeof readRoutingCatalog>
>[number];

/**
 * Short-TTL in-process memo of the routing catalog per org. `getModelRoutingCatalog`
 * runs on EVERY auto-routed turn; provider configs change rarely, so caching it
 * for a few seconds (within a warm action isolate) avoids re-reading every
 * provider JSON each turn. Staleness is bounded by the TTL and only affects
 * routing-preference metadata (cost/tier) — never correctness (an unknown model
 * just routes by config order). Mirrors the module-level circuit-breaker state.
 */
const ROUTING_CATALOG_TTL_MS = 30_000;
const routingCatalogCache = new Map<
  string,
  { at: number; catalog: RoutingCatalogEntry[] }
>();

/**
 * Lightweight routing catalog: per-model cost + routing metadata for ALL
 * configured models, WITHOUT resolving secrets or building model instances.
 * Consumed by complexity-based model routing (`model_routing/select_model`) to
 * pick a tier among an agent's `supportedModels`. Returns `[]` (never throws)
 * when no providers are configured so routing degrades to config order.
 */
export const getModelRoutingCatalog = internalAction({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      id: v.string(),
      providerName: v.string(),
      tags: v.array(v.string()),
      outputCentsPerMillion: v.optional(v.number()),
      ...modelRoutingMetadataValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const now = Date.now();
    const cached = routingCatalogCache.get(orgSlug);
    if (cached && now - cached.at < ROUTING_CATALOG_TTL_MS) {
      return cached.catalog;
    }
    const catalog = await readRoutingCatalog(orgSlug);
    routingCatalogCache.set(orgSlug, { at: now, catalog });
    return catalog;
  },
});

/**
 * Like getAllModelIds but reads provider JSON configs directly without
 * requiring secrets. For config-time validation paths (e.g. saveAgent)
 * where reference validity must be decoupled from runtime API-key
 * availability — a provider config existing without an API key yet is a
 * legitimate state, not a missing reference.
 */
export const getAllConfiguredModelIds = internalAction({
  args: { organizationId: v.string() },
  returns: v.array(modelIdEntryValidator),
  handler: async (ctx, args) => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const dir = resolveProvidersDir(orgSlug);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      // Don't fail the caller (empty providers dir is legitimate on a fresh
      // deployment) but surface the underlying error so operators can tell
      // "no providers configured" from "providers dir unreadable".
      if (!isErrnoCode(err, 'ENOENT')) {
        console.warn(
          '[getAllConfiguredModelIds] readdir failed',
          dir,
          sanitizeError(err),
        );
      }
      return [];
    }
    const jsonFiles = entries.filter(isProviderJsonFile);
    const models: ModelIdEntry[] = [];
    await Promise.all(
      jsonFiles.map(async (fileName) => {
        const name = providerNameFromFileName(fileName);
        if (!validateProviderName(name)) {
          console.warn(
            '[getAllConfiguredModelIds] invalid provider name',
            name,
          );
          return;
        }
        const result = await readProviderFile(orgSlug, name);
        if (!result.ok) {
          // Surface malformed/oversized/parse-failed provider files; saveAgent
          // consumes this list for model validation and an empty list there
          // is otherwise indistinguishable from "no providers configured".
          console.warn(
            '[getAllConfiguredModelIds] readProviderFile failed',
            name,
            result.message,
          );
          return;
        }
        models.push(...mapModelIdEntries(name, result.config));
      }),
    );
    return models;
  },
});

/**
 * Get all provider configs (public data only, no secrets).
 */
export const getAllProviderConfigs = action({
  args: { organizationId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    const dir = resolveProvidersDir(orgSlug);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if (!isErrnoCode(err, 'ENOENT')) {
        console.warn(
          '[getAllProviderConfigs] readdir failed',
          dir,
          sanitizeError(err),
        );
      }
      return [];
    }

    const jsonFiles = entries.filter(isProviderJsonFile);

    const results = await Promise.all(
      jsonFiles.map(async (fileName) => {
        const name = providerNameFromFileName(fileName);
        if (!validateProviderName(name)) return null;
        const result = await readProviderFile(orgSlug, name);
        if (!result.ok) return null;
        return {
          providerName: name,
          displayName: result.config.displayName,
          description: result.config.description,
          defaults: result.config.defaults,
          models: result.config.models.map((m) => ({
            id: m.id,
            displayName: m.displayName,
            description: m.description,
            tags: m.tags,
          })),
          i18n: result.config.i18n,
        };
      }),
    );

    return results.filter(Boolean);
  },
});

// ---------------------------------------------------------------------------
// Model discovery
// ---------------------------------------------------------------------------

/** What a model-discovery action hands back to the UI: the raw id plus, when
 *  the source reports it, a human-readable name so the fetched-row list isn't
 *  stuck showing alias ids like `~anthropic/claude-opus-latest`. */
interface FetchedModel {
  id: string;
  displayName?: string;
}

/**
 * Parse a `GET /v1/models` response body via the same `normalizeCatalogPayload`
 * the weekly catalog cron uses, so a rich OpenRouter-shaped response yields the
 * full capability facts (cost, context window, reasoning, …) while a sparse
 * OpenAI-compatible `{ id }` response degrades to id-only entries. Returns both
 * the full normalized rows (for persisting to the capability cache) and the
 * trimmed `{ id, displayName }` list the UI renders. Throws
 * `PROVIDER_FETCH_FAILED` on non-JSON bodies or any shape that yields no ids.
 * Shared by the connect-time and already-configured discovery actions so their
 * parsing can't drift.
 */
function parseProviderModelsList(body: string): {
  models: FetchedModel[];
  capabilities: NormalizedCapability[];
} {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ConvexError({
      code: 'PROVIDER_FETCH_FAILED',
      message: 'Provider returned non-JSON response',
    });
  }
  const isOpenAiShape =
    json != null &&
    typeof json === 'object' &&
    'data' in json &&
    Array.isArray(json.data);
  // `normalizeCatalogPayload` accepts both `{ data: [...] }` and a bare array;
  // reject anything else up front so the operator sees a clear shape error
  // rather than a silent empty list.
  if (!isOpenAiShape && !Array.isArray(json)) {
    throw new ConvexError({
      code: 'PROVIDER_FETCH_FAILED',
      message:
        'Unexpected response format: expected { data: [...] } from /v1/models',
    });
  }
  const capabilities = normalizeCatalogPayload(json);
  const models = capabilities
    .map((c) => ({
      id: c.modelId,
      ...(c.displayName ? { displayName: c.displayName } : {}),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { models, capabilities };
}

/** Persist freshly-fetched capability rows into `modelCapabilityCache`, exactly
 *  as the weekly cron does (chunked, `displayName`/`isChat` projected off since
 *  the cache table stores only runtime fields). Never throws — a cache write
 *  failure must not fail the user-facing model-list fetch. */
async function persistFetchedCapabilities(
  ctx: ActionCtx,
  source: string,
  capabilities: NormalizedCapability[],
  fetchedAt: number,
): Promise<void> {
  const CHUNK = 100;
  try {
    for (let i = 0; i < capabilities.length; i += CHUNK) {
      const chunk = capabilities
        .slice(i, i + CHUNK)
        .map(({ displayName: _displayName, isChat: _isChat, ...row }) => row);
      await ctx.runMutation(
        internal.model_catalog.mutations.upsertCapabilities,
        { source, fetchedAt, entries: chunk },
      );
    }
  } catch (err) {
    console.warn(
      `[fetchProviderModels] failed to cache capabilities from ${source}: ${sanitizeError(err)}`,
    );
  }
}

/**
 * Fetch available models from an OpenAI-compatible /v1/models endpoint.
 * Used by the "Add provider" panel to auto-populate models.
 */
export const fetchProviderModels = action({
  args: {
    organizationId: v.string(),
    baseUrl: v.string(),
    apiKey: v.string(),
  },
  returns: v.array(
    v.object({ id: v.string(), displayName: v.optional(v.string()) }),
  ),
  handler: async (ctx, args): Promise<FetchedModel[]> => {
    // Same gate as the rest of the provider mutations — operators with
    // developerSettings access only. Pre-this-fix, this action accepted any
    // authenticated user (`authComponent.getAuthUser`) and any baseUrl, which
    // allowed any logged-in member to issue authenticated GETs from inside
    // the Convex action runtime to internal services / cloud metadata.
    await requireDeveloperSettingsAccessById(ctx, args.organizationId);

    // Normalize base URL: strip trailing slash, append /models if needed
    let url = args.baseUrl.replace(/\/+$/, '');
    if (!url.endsWith('/models')) {
      url = url.endsWith('/v1') ? `${url}/models` : `${url}/v1/models`;
    }

    // Block IMDS + private hosts (unless TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1).
    checkProviderHostPolicy(url);

    let response;
    try {
      response = await safeFetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${args.apiKey}`,
          Accept: 'application/json',
        },
        timeoutMs: 15_000,
      });
    } catch (err) {
      if (err instanceof SafeFetchError) {
        throw new ConvexError({
          code: 'PROVIDER_FETCH_FAILED',
          message: `Failed to fetch models: ${err.message}`,
        });
      }
      throw err;
    }

    if (response.status < 200 || response.status >= 300) {
      // Don't echo the upstream body to the caller — that would let an
      // attacker who somehow got past the policy gate use this as a partial
      // read primitive against an unresponsive-to-Authorization endpoint.
      // Log the body server-side for ops visibility, sanitised so a
      // 4xx response containing the very API key we sent doesn't leak it
      // into ops logs.
      console.warn(
        `[fetchProviderModels] non-2xx ${response.status} from ${url}: ${sanitizeError(response.body, 500)}`,
      );
      throw new ConvexError({
        code: 'PROVIDER_FETCH_FAILED',
        message: `Failed to fetch models (${response.status} ${response.statusText})`,
      });
    }

    const { models, capabilities } = parseProviderModelsList(response.body);
    // Connect-time fetch isn't yet bound to a provider slug; stamp the cache
    // with the canonical catalog source so these rows merge with the cron's.
    await persistFetchedCapabilities(
      ctx,
      'openrouter',
      capabilities,
      Date.now(),
    );
    return models;
  },
});

// ---------------------------------------------------------------------------
// Fetch models for an already-configured provider (uses stored secret)
// ---------------------------------------------------------------------------

export const fetchConfiguredProviderModels = action({
  args: { organizationId: v.string(), providerName: v.string() },
  returns: v.array(
    v.object({ id: v.string(), displayName: v.optional(v.string()) }),
  ),
  handler: async (ctx, args): Promise<FetchedModel[]> => {
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );

    if (!validateProviderName(args.providerName)) {
      throw new Error(`Invalid provider name: ${args.providerName}`);
    }

    const configResult = await readProviderFile(orgSlug, args.providerName);
    if (!configResult.ok) {
      throw new ConvexError({
        code: 'PROVIDER_FETCH_FAILED',
        message: `Cannot read provider "${args.providerName}": ${configResult.message}`,
      });
    }
    const config = configResult.config;

    const secretsPath = resolveProviderSecretsPath(orgSlug, args.providerName);
    let fileApiKey: string | undefined;
    try {
      const secrets = parseProviderSecrets(
        await decryptSecretsFile(secretsPath),
      );
      fileApiKey = secrets.apiKey;
    } catch (err) {
      // A missing secrets file is fine when the provider uses an env-var key
      // source (issue #1711) — fall through to `resolveApiKey` below. But a
      // genuine decrypt/parse failure (rotated INSTANCE_SECRET, corrupt JSON)
      // must still surface so the operator sees the real cause instead of a
      // generic "no key" message; surface it as PROVIDER_FETCH_FAILED rather
      // than leaking the raw error class.
      if (!isErrnoCode(err, 'ENOENT')) {
        throw new ConvexError({
          code: 'PROVIDER_FETCH_FAILED',
          message: `Failed to read provider secrets: ${sanitizeError(err)}`,
        });
      }
    }
    // Model listing queries one provider-wide /models endpoint with a single
    // bearer, so it has no per-model concept — resolve at provider level only
    // (provider `secretsEnv`, then file `apiKey`). A provider configured with
    // ONLY model-level `secretsEnv` is intentionally not listable here; its
    // models are still usable in chat and can be added manually.
    const apiKey = resolveApiKey({
      providerSecretsEnv: config.secretsEnv,
      fileApiKey,
    });
    if (!apiKey) {
      throw new ConvexError({
        code: 'PROVIDER_FETCH_FAILED',
        message:
          'No provider-level API key configured (file apiKey or provider secretsEnv). Model listing requires one.',
      });
    }

    let url = config.baseUrl.replace(/\/+$/, '');
    if (!url.endsWith('/models')) {
      url = url.endsWith('/v1') ? `${url}/models` : `${url}/v1/models`;
    }
    checkProviderHostPolicy(url);

    let response;
    try {
      response = await safeFetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        timeoutMs: 15_000,
      });
    } catch (err) {
      if (err instanceof SafeFetchError) {
        throw new ConvexError({
          code: 'PROVIDER_FETCH_FAILED',
          message: `Failed to fetch models: ${err.message}`,
        });
      }
      throw err;
    }

    if (response.status < 200 || response.status >= 300) {
      console.warn(
        `[fetchConfiguredProviderModels] non-2xx ${response.status} from ${url}: ${sanitizeError(response.body, 500)}`,
      );
      throw new ConvexError({
        code: 'PROVIDER_FETCH_FAILED',
        message: `Failed to fetch models (${response.status} ${response.statusText})`,
      });
    }

    const { models, capabilities } = parseProviderModelsList(response.body);
    await persistFetchedCapabilities(
      ctx,
      args.providerName,
      capabilities,
      Date.now(),
    );
    return models;
  },
});

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

type ProbeTag =
  | 'chat'
  | 'embedding'
  | 'transcription'
  | 'image-generation'
  | 'text-to-speech';

interface ProbeResult {
  modelId: string;
  tag: ProbeTag;
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
  /**
   * Soft warning when auth succeeded but full verification wasn't possible —
   * e.g. listing probe returned 200 but the model isn't advertised in
   * `/v1/models` (common on OpenRouter for image-only models). The key is
   * valid; the specific model may or may not be invocable.
   */
  warning?: string;
}

function buildProbeUrl(baseUrl: string, endpoint: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith(`/${endpoint}`)) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/${endpoint}`;
  return `${trimmed}/v1/${endpoint}`;
}

/**
 * Generate ~250 ms of 8 kHz, 16-bit, mono PCM silence wrapped in a WAV
 * container. Used as the probe payload for transcription models — Whisper
 * accepts it, returns `{ text: "" }`, and bills at most 1 second of audio
 * (~$0.0001 on OpenAI's whisper-1). Total file size is ~4 KB.
 */
function makeSilentWav(): ArrayBuffer {
  const sampleRate = 8000;
  const samples = 2000;
  const dataSize = samples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  // RIFF chunk descriptor
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  // "fmt " sub-chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  // "data" sub-chunk (already zero-filled)
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);
  return buf;
}

async function runTranscriptionProbe(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  transcriptionMode: 'multipart' | 'json-base64' = 'multipart',
): Promise<ProbeResult> {
  const url = buildProbeUrl(baseUrl, 'audio/transcriptions');
  const start = Date.now();
  try {
    // The probe must use the SAME request convention the real transcription
    // call will, so a green checkmark guarantees the wire shape is accepted.
    // `json-base64` (OpenRouter) wants a JSON `input_audio` envelope; every
    // other OpenAI-compatible server wants `multipart/form-data`.
    const wav = makeSilentWav();
    const probeInit =
      transcriptionMode === 'json-base64'
        ? {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: modelId,
              input_audio: {
                data: Buffer.from(wav).toString('base64'),
                format: 'wav',
              },
            }),
          }
        : (() => {
            const formData = new FormData();
            formData.append(
              'file',
              new Blob([wav], { type: 'audio/wav' }),
              'probe.wav',
            );
            formData.append('model', modelId);
            return {
              headers: { Authorization: `Bearer ${apiKey}` },
              body: formData,
            };
          })();
    // safeFetch enforces redirect: 'manual' + per-hop host policy so a 302
    // to IMDS can't carry the bearer token along.
    const response = await safeFetch(url, {
      method: 'POST',
      ...probeInit,
      timeoutMs: 15_000,
    });
    const latencyMs = Date.now() - start;
    if (response.status >= 200 && response.status < 300) {
      return { modelId, tag: 'transcription', ok: true, latencyMs };
    }
    return {
      modelId,
      tag: 'transcription',
      ok: false,
      latencyMs,
      status: response.status,
      error: extractErrorMessage(response.body) || response.statusText,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return {
      modelId,
      tag: 'transcription',
      ok: false,
      latencyMs,
      error: message,
    };
  }
}

/**
 * TTS probe: POST a 4-character input to `/v1/audio/speech` and verify the
 * response is binary audio (any `audio/*` content type). Cost is well under
 * a tenth of a cent on OpenAI's gpt-4o-mini-tts. The voice defaults to the
 * provider's `defaultVoice`; if neither default nor any locale entry is set,
 * we report a probe failure rather than guess a vendor-specific voice id.
 */
async function runTtsProbe(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  voice: string,
  audioFormat: string,
): Promise<ProbeResult> {
  const url = buildProbeUrl(baseUrl, 'audio/speech');
  const start = Date.now();
  try {
    const response = await safeFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        input: 'test',
        voice,
        response_format: audioFormat,
      }),
      timeoutMs: 15_000,
    });
    const latencyMs = Date.now() - start;
    if (response.status >= 200 && response.status < 300) {
      // Defence against a gateway that fronts the TTS endpoint with a 200
      // JSON envelope ("ok": true, no audio) — without the content-type
      // check the probe falsely greens. The audio/* family covers every
      // configurable response_format (mp3, opus, aac, flac, wav, pcm).
      const contentType =
        response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.startsWith('audio/')) {
        return {
          modelId,
          tag: 'text-to-speech',
          ok: false,
          latencyMs,
          status: response.status,
          error: `expected audio/* response, got ${contentType || 'unknown'}`,
        };
      }
      return { modelId, tag: 'text-to-speech', ok: true, latencyMs };
    }
    return {
      modelId,
      tag: 'text-to-speech',
      ok: false,
      latencyMs,
      status: response.status,
      error: extractErrorMessage(response.body) || response.statusText,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return {
      modelId,
      tag: 'text-to-speech',
      ok: false,
      latencyMs,
      error: message,
    };
  }
}

type ListingResult =
  | { ok: true; ids: Set<string> }
  | { ok: false; status?: number; error: string };

/**
 * Fetch the provider's model catalog (`GET /v1/models`) and return the set
 * of advertised model IDs. Used by the image-generation probe — image gen
 * costs cents per real call, so we settle for an indirect check that the
 * key is accepted and the model is in the provider's listing.
 *
 * Some providers (notably OpenRouter) return hundreds of models and the
 * response is several hundred KB; the 15 s timeout accounts for that.
 */
async function fetchProviderModelIds(
  baseUrl: string,
  apiKey: string,
): Promise<ListingResult> {
  const url = buildProbeUrl(baseUrl, 'models');
  try {
    const response = await safeFetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      timeoutMs: 15_000,
    });
    if (response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        status: response.status,
        error: extractErrorMessage(response.body) || response.statusText,
      };
    }
    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch {
      return { ok: false, error: 'Unexpected response from /v1/models' };
    }
    const data =
      json &&
      typeof json === 'object' &&
      'data' in json &&
      Array.isArray(json.data)
        ? json.data
        : null;
    if (!data) {
      return { ok: false, error: 'Unexpected response from /v1/models' };
    }
    const ids = new Set<string>();
    for (const m of data) {
      if (m != null && typeof m === 'object' && 'id' in m) {
        const id = m.id;
        if (typeof id === 'string') ids.add(id);
      }
    }
    return { ok: true, ids };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Verify an `images-api` image-generation model indirectly via a (cached)
 * `/v1/models` listing keyed by API key. All probes sharing a key reuse the
 * same fetch, so a provider with N image models hits the catalog endpoint
 * once instead of N times.
 */
async function runImageListingProbe(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  listingCache: Map<string, Promise<ListingResult>>,
): Promise<ProbeResult> {
  const start = Date.now();
  let pending = listingCache.get(apiKey);
  if (!pending) {
    pending = fetchProviderModelIds(baseUrl, apiKey);
    listingCache.set(apiKey, pending);
  }
  const result = await pending;
  const latencyMs = Date.now() - start;
  if (!result.ok) {
    return {
      modelId,
      tag: 'image-generation',
      ok: false,
      latencyMs,
      status: result.status,
      error: result.error,
    };
  }
  if (!result.ids.has(modelId)) {
    // Listing succeeded → the API key is valid for this provider. The model
    // simply isn't advertised in /v1/models, which is common for image-only
    // models on routers like OpenRouter. Soft-warn instead of hard-fail so
    // the user knows their key works but full verification wasn't possible.
    return {
      modelId,
      tag: 'image-generation',
      ok: true,
      latencyMs,
      warning: 'Key verified, but model not in provider catalog',
    };
  }
  return { modelId, tag: 'image-generation', ok: true, latencyMs };
}

async function runProbe(
  url: string,
  apiKey: string,
  body: unknown,
  modelId: string,
  tag: 'chat' | 'embedding' | 'image-generation',
): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const response = await safeFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      timeoutMs: 8_000,
    });
    const latencyMs = Date.now() - start;
    if (response.status >= 200 && response.status < 300) {
      return { modelId, tag, ok: true, latencyMs };
    }
    return {
      modelId,
      tag,
      ok: false,
      latencyMs,
      status: response.status,
      error: extractErrorMessage(response.body) || response.statusText,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return { modelId, tag, ok: false, latencyMs, error: message };
  }
}

/**
 * Pull a human-readable error message from a JSON or plain-text error body.
 *
 * Handles OpenRouter-style wrapped errors: when the upstream provider returns
 * an error, OpenRouter wraps it as `error.message = "Provider returned error"`
 * and stuffs the real upstream JSON into `error.metadata.raw`. We prefer that
 * inner message so users see the real cause (e.g. "Unsupported parameter:
 * max_tokens — use max_completion_tokens") instead of the opaque outer wrap.
 */
function extractErrorMessage(body: string): string | null {
  if (!body) return null;
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- raw JSON before structural narrowing
    const parsed = JSON.parse(body) as unknown;
    return extractFromObject(parsed) ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

function extractFromObject(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by typeof/null check above
  const obj = value as Record<string, unknown>;

  // 1. Try to drill into a wrapped upstream error first (OpenRouter etc.).
  const error = obj.error;
  if (error && typeof error === 'object') {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by typeof/null check above
    const errObj = error as Record<string, unknown>;
    const metadata = errObj.metadata;
    if (metadata && typeof metadata === 'object') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by typeof/null check above
      const meta = metadata as Record<string, unknown>;
      const raw = meta.raw;
      if (typeof raw === 'string') {
        try {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- raw JSON before structural narrowing
          const inner = JSON.parse(raw) as unknown;
          const innerMsg = extractFromObject(inner);
          if (innerMsg) {
            const provider =
              typeof meta.provider_name === 'string'
                ? `${meta.provider_name}: `
                : '';
            return `${provider}${innerMsg}`;
          }
        } catch {
          // raw isn't JSON — fall through to outer message.
        }
      }
    }
    if (typeof errObj.message === 'string') return errObj.message;
  }
  if (typeof error === 'string') return error;

  if (typeof obj.message === 'string') return obj.message;
  return null;
}

/**
 * Probe each chat / embedding model configured on a provider with a minimal
 * real request. Verifies that the provider-level API key (and any per-model
 * `modelKeys` overrides) actually work against the live provider, surfacing
 * per-model failures so users can diagnose configuration issues without
 * opening a chat. Transcription and image-generation models are skipped —
 * probing them is either expensive or requires real assets.
 */
export const testProviderConnection = action({
  args: { organizationId: v.string(), providerName: v.string() },
  returns: v.object({
    results: v.array(
      v.object({
        modelId: v.string(),
        tag: v.string(),
        ok: v.boolean(),
        latencyMs: v.number(),
        status: v.optional(v.number()),
        error: v.optional(v.string()),
        warning: v.optional(v.string()),
      }),
    ),
    skipped: v.array(v.object({ modelId: v.string(), reason: v.string() })),
  }),
  handler: async (ctx, args) => {
    // Test connection issues real authenticated requests against the saved
    // provider with the org's API key; gate on developerSettings to match
    // the write actions' threat model (a regular member calling this could
    // burn quota / trigger fraud signals in the org's name).
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );

    if (!validateProviderName(args.providerName))
      throw new Error(`Invalid provider name: ${args.providerName}`);

    const configResult = await readProviderFile(orgSlug, args.providerName);
    if (!configResult.ok) {
      throw new Error(
        `Cannot read provider "${args.providerName}": ${configResult.message}`,
      );
    }
    const config = configResult.config;

    // Reject IMDS / private hosts unless explicitly allowed via env. Probes
    // call the upstream over the network with a real API key; running them
    // against a metadata service would either expose the key or surface a
    // partial-read primitive in the error path. The check happens once
    // here and protects all four downstream probe helpers.
    checkProviderHostPolicy(config.baseUrl);

    const secretsPath = resolveProviderSecretsPath(orgSlug, args.providerName);
    let secrets: ProviderSecrets | null = null;
    try {
      secrets = parseProviderSecrets(await decryptSecretsFile(secretsPath));
    } catch (err) {
      // Env-only providers (issue #1711) have no secrets file — fall through to
      // the env key source per model. A genuine decrypt/parse failure (rotated
      // INSTANCE_SECRET, corrupt file) is logged rather than silently swallowed.
      if (!isErrnoCode(err, 'ENOENT')) {
        console.warn(
          `[testProviderConnection] Provider "${args.providerName}": secrets read failed`,
          sanitizeError(err),
        );
      }
    }

    const probes: Promise<ProbeResult>[] = [];
    const skipped: { modelId: string; reason: string }[] = [];
    const listingCache = new Map<string, Promise<ListingResult>>();

    for (const model of config.models) {
      // Resolve the per-model key (env source preferred). On nothing resolved,
      // skip this model with a clear reason BEFORE any probe dispatch — keeps
      // empty keys out of the probe helpers and the apiKey-keyed listingCache,
      // and never throws the whole action for a partially-configured provider.
      const apiKey = resolveApiKey({
        modelSecretsEnv: model.secretsEnv,
        providerSecretsEnv: config.secretsEnv,
        fileModelKey: secrets?.modelKeys?.[model.id],
        fileApiKey: secrets?.apiKey,
      });
      if (!apiKey) {
        skipped.push({
          modelId: model.id,
          reason:
            model.secretsEnv || config.secretsEnv
              ? 'No API key resolved (secretsEnv unset/empty or not prefixed, and no file key)'
              : 'No API key configured',
        });
        continue;
      }
      const isChat =
        model.tags.includes('chat') || model.tags.includes('vision');
      const isEmbedding = model.tags.includes('embedding');
      const isTranscription = model.tags.includes('transcription');
      const isImageGeneration = model.tags.includes('image-generation');
      const isTextToSpeech = model.tags.includes('text-to-speech');

      // Merge provider+model providerOptions into the probe body so a typo
      // in the editor (e.g. `provider.quanitzations`) surfaces as the same
      // upstream 4xx the user would hit on first real call, instead of a
      // false-green checkmark. Deny-listed keys (model/messages/...) are
      // already rejected at parse time and stripped here as defense-in-depth.
      const mergedProviderOptions =
        stripDenyListed(
          mergeModelLevel(config.providerOptions, model.providerOptions),
        ) ?? {};

      if (isChat) {
        probes.push(
          runProbe(
            buildProbeUrl(config.baseUrl, 'chat/completions'),
            apiKey,
            {
              ...mergedProviderOptions,
              model: model.id,
              messages: [{ role: 'user', content: 'hi' }],
            },
            model.id,
            'chat',
          ),
        );
      } else if (isEmbedding) {
        probes.push(
          runProbe(
            buildProbeUrl(config.baseUrl, 'embeddings'),
            apiKey,
            { ...mergedProviderOptions, model: model.id, input: 'hi' },
            model.id,
            'embedding',
          ),
        );
      } else if (isTranscription) {
        probes.push(
          runTranscriptionProbe(
            config.baseUrl,
            apiKey,
            model.id,
            model.transcriptionMode,
          ),
        );
      } else if (isTextToSpeech) {
        // Schema's `superRefine` (lib/shared/schemas/providers.ts) rejects
        // TTS models that have neither `defaultVoice` nor a non-empty
        // `voicesByLocale`, so the resolution below always finds a voice.
        // The previous `?? 'alloy'` fallback was OpenAI-specific dead code
        // that would have shipped a wrong voice id to non-OpenAI providers.
        const probeVoice =
          model.defaultVoice ??
          (model.voicesByLocale
            ? Object.values(model.voicesByLocale)[0]
            : undefined);
        if (!probeVoice) {
          // Defence in depth — should be unreachable per the schema
          // guarantee above; surface loudly rather than guessing.
          probes.push(
            Promise.resolve({
              modelId: model.id,
              tag: 'text-to-speech' as const,
              ok: false,
              latencyMs: 0,
              error: 'TTS model has no defaultVoice or voicesByLocale entries',
            }),
          );
        } else {
          probes.push(
            runTtsProbe(
              config.baseUrl,
              apiKey,
              model.id,
              probeVoice,
              model.audioFormat ?? 'mp3',
            ),
          );
        }
      } else if (isImageGeneration) {
        // All image-generation modes use a /v1/models membership check.
        // Direct invocation isn't safe to probe: `images-api` bills per image
        // (cents per call), and `chat-multimodal` (FLUX, gpt-image-1, nano-
        // banana) routes through /v1/chat/completions but still triggers a
        // real image generation on most providers — so a "hi" prompt either
        // costs real money or times out. Listing verifies key + catalog
        // membership without any generation.
        probes.push(
          runImageListingProbe(config.baseUrl, apiKey, model.id, listingCache),
        );
      } else {
        skipped.push({
          modelId: model.id,
          reason: model.tags.join(',') || 'no probeable tag',
        });
      }
    }

    const results = await Promise.all(probes);
    return { results, skipped };
  },
});

// ---------------------------------------------------------------------------
// Secret management actions
// ---------------------------------------------------------------------------

/**
 * Save an API key for a provider by writing a `.secrets.json` file.
 *
 * When `SOPS_AGE_KEY` or `SOPS_AGE_KEY_FILE` is set, the file is
 * SOPS-encrypted; otherwise it is written as plaintext JSON at mode 0600.
 *
 * Refuses to overwrite an existing-but-undecryptable file (e.g. SOPS-shaped
 * with no key configured, or decrypt failure from a wrong/rotated key) by
 * default — the on-disk ciphertext may be the only recoverable copy. The
 * caller must affirmatively pass `force: true` (after a UI confirm dialog)
 * to discard the existing file. The action surfaces the refusal as a
 * `ConvexError` with `data.kind` of `'encrypted_no_key'` or
 * `'undecryptable_existing'` so the UI dispatches on a discriminator.
 */
export const saveProviderSecret = action({
  args: {
    organizationId: v.string(),
    providerName: v.string(),
    apiKey: v.optional(v.string()),
    // Tightened from `v.any()` so a malformed payload (e.g. nested object
    // value) is rejected at the action boundary instead of silently
    // landing on disk and bricking the next read with
    // `Invalid provider secrets`. The schema is also enforced at write
    // time via `providerSecretsSchema` in lib/shared, but failing fast
    // here surfaces the bug at the right call site.
    modelKeys: v.optional(v.record(v.string(), v.string())),
    force: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const auth = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    const { orgSlug } = auth;

    if (!validateProviderName(args.providerName))
      throw new Error(`Invalid provider name: ${args.providerName}`);

    const secretsPath = resolveProviderSecretsPath(orgSlug, args.providerName);

    // Per-(orgSlug, providerName) advisory lock. `prepareMergedSecrets`
    // is read-modify-write on the secrets file with no transactional
    // guarantee, so two concurrent saves on the same provider can
    // clobber one another's `modelKeys` additions. Within a single Node
    // process the lock serializes them; cross-process safety is a
    // follow-up that would require a real `expectedHash` round-trip
    // (also exposed via the read query).
    const lockKey = `${orgSlug}:${args.providerName}`;
    const previous = secretWriteLocks.get(lockKey);
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    secretWriteLocks.set(lockKey, previous ? previous.then(() => next) : next);
    if (previous) await previous;

    try {
      return await runSaveProviderSecret(ctx, args, auth, secretsPath);
    } finally {
      release();
      // Drop the entry once we're the tail; a later writer may have
      // already chained behind us, in which case we leave their entry.
      if (secretWriteLocks.get(lockKey) === next) {
        secretWriteLocks.delete(lockKey);
      }
    }
  },
});

// Module-scoped per-provider advisory locks. Lives for the lifetime of
// the Convex action runtime (per Node process); one process per host in
// self-hosted Convex.
const secretWriteLocks = new Map<string, Promise<unknown>>();

async function runSaveProviderSecret(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    providerName: string;
    apiKey?: string;
    modelKeys?: Record<string, string>;
    force?: boolean;
  },
  auth: Awaited<ReturnType<typeof requireDeveloperSettingsAccess>>,
  secretsPath: string,
): Promise<null> {
  const encryptMode = hasSopsKey();

  const incomingModelKeys = args.modelKeys;

  let plaintext: string;
  let prepared: Awaited<ReturnType<typeof prepareMergedSecrets>>;
  try {
    prepared = await prepareMergedSecrets(
      secretsPath,
      { apiKey: args.apiKey, modelKeys: incomingModelKeys },
      { force: args.force },
    );
    plaintext = prepared.plaintext;
  } catch (err) {
    // Convert typed refuse-overwrite errors to ConvexError carrying a
    // structured discriminator. The UI reads `error.data.kind` to decide
    // whether to render the "overwrite anyway?" confirm dialog and re-call
    // with `force: true`. `data.reason` carries the raw inner cause for
    // the dialog body — the wrapper Error.message is intentionally NOT
    // forwarded because it already embeds path + meta-instructions that
    // would duplicate against the i18n template.
    if (err instanceof EncryptedFileWithoutKeyError) {
      throw new ConvexError({
        code: 'PROVIDER_SECRET_REFUSED_OVERWRITE',
        kind: 'encrypted_no_key',
        path: secretsPath,
      });
    }
    if (err instanceof UndecryptableExistingSecretError) {
      throw new ConvexError({
        code: 'PROVIDER_SECRET_REFUSED_OVERWRITE',
        kind: 'undecryptable_existing',
        path: secretsPath,
        reason: err.reason,
      });
    }
    throw err;
  }

  if (!encryptMode) {
    await atomicWriteSecret(secretsPath, plaintext);
    invalidateSecretsCache(secretsPath);
    await maybeAuditForceOverwrite(ctx, args, secretsPath, prepared, auth);
    await syncProviderToGateway(ctx, args.organizationId, args.providerName);
    return null;
  }

  // Resolve all age recipients from env. With multiple keys in
  // `SOPS_AGE_KEY_FILE`, sops -e encrypts to all of them — new ciphertext
  // is decryptable by any key in the file. This is the rotation primitive:
  // append a new key, re-save each provider via the UI, then remove the
  // old key. Decrypt path walks all keys naturally, so existing files keep
  // working through the transition.
  const recipients = resolveAgeRecipients();
  if (recipients.length === 0) {
    throw new Error(
      'No age secret key available. Set SOPS_AGE_KEY (inline) or SOPS_AGE_KEY_FILE (path) in .env, or unset both to use plaintext mode.',
    );
  }
  const recipientArg = recipients.join(',');

  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } =
    await import('node:fs');
  const { tmpdir } = await import('node:os');

  const tmpDir = mkdtempSync(path.join(tmpdir(), 'sops-'));
  const tmpFile = path.join(tmpDir, 'plain.json');
  let encrypted: string;
  try {
    // mkdtempSync gives us a 0o700 parent dir, so other users can't
    // traverse to read this file even at default 0o644 mode. Belt-and-
    // suspenders 0o600 anyway — matches atomicWriteSecret and means the
    // mode bit is correct even if a future change to the parent dir mode
    // regresses.
    writeFileSync(tmpFile, plaintext, { encoding: 'utf-8', mode: 0o600 });
    encrypted = execFileSync(
      'sops',
      [
        '-e',
        '--input-type',
        'json',
        '--output-type',
        'json',
        '--age',
        recipientArg,
        tmpFile,
      ],
      {
        encoding: 'utf-8',
        timeout: 10_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to encrypt secrets for "${args.providerName}": ${message}. ` +
        'Ensure sops is installed and SOPS_AGE_KEY is set.',
      { cause: err },
    );
  } finally {
    // Split the cleanup so a failed unlink (which would leak the plaintext
    // API key into /tmp until the systemd-tmpfiles reaper sweeps in ~10
    // days) surfaces as a warn rather than getting silently swallowed.
    try {
      unlinkSync(tmpFile);
    } catch (cleanupErr) {
      if (!isErrnoCode(cleanupErr, 'ENOENT')) {
        console.warn(
          `[saveProviderSecret] failed to unlink plaintext tmp file ${tmpFile}`,
          cleanupErr,
        );
      }
    }
    try {
      rmdirSync(tmpDir);
    } catch (cleanupErr) {
      if (!isErrnoCode(cleanupErr, 'ENOENT')) {
        console.warn(
          `[saveProviderSecret] failed to rmdir tmp dir ${tmpDir}`,
          cleanupErr,
        );
      }
    }
  }

  await atomicWriteSecret(secretsPath, encrypted);
  invalidateSecretsCache(secretsPath);
  await maybeAuditForceOverwrite(ctx, args, secretsPath, prepared, auth);
  await syncProviderToGateway(ctx, args.organizationId, args.providerName);

  return null;
}

/**
 * Write a `force_overwrite_provider_secret` audit row when the operator just
 * discarded a previously-undecryptable on-disk file. No-op on the normal
 * (non-force) save path — the audit table only sees the destructive case so
 * the noise floor stays low. Mirrors integrations/credential_mutations.ts
 * audit-on-state-change pattern.
 *
 * Failures here are best-effort: a credential write that succeeded should
 * not be reported as failed because the audit log was unreachable. We log
 * the failure to the server console instead.
 */
async function maybeAuditForceOverwrite(
  ctx: ActionCtx,
  args: { organizationId: string; providerName: string; force?: boolean },
  secretsPath: string,
  prepared: Awaited<ReturnType<typeof prepareMergedSecrets>>,
  auth: Awaited<ReturnType<typeof requireOrgMembership>>,
): Promise<void> {
  if (!args.force || !prepared.forced) return;
  try {
    await ctx.runMutation(
      internal.audit_logs.internal_mutations.createAuditLog,
      {
        organizationId: auth.orgId,
        actorId: auth.userId,
        actorEmail: auth.email,
        actorRole: auth.member.role,
        actorType: 'user',
        action: 'force_overwrite_provider_secret',
        category: 'security',
        resourceType: 'provider',
        resourceId: args.providerName,
        resourceName: args.providerName,
        status: 'success',
        metadata: {
          forceReason: prepared.forceReason ?? 'unknown',
          path: secretsPath,
        },
      },
    );
  } catch (err) {
    console.warn(
      `[saveProviderSecret] failed to write force-overwrite audit log for ${args.providerName}`,
      sanitizeError(err),
    );
  }
}

/**
 * Check if a provider has a secrets file configured.
 * Returns a masked API key (e.g. "sk-or-••••••abc") if configured, or null.
 */
export const hasProviderSecret = action({
  args: {
    organizationId: v.string(),
    providerName: v.string(),
    modelId: v.optional(v.string()),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    // Returns the masked-key preview, gate on developerSettings.
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );

    const secretsPath = resolveProviderSecretsPath(orgSlug, args.providerName);

    const { stat: statFile } = await import('node:fs/promises');
    try {
      await statFile(secretsPath);
    } catch {
      return null;
    }

    try {
      const secrets = await decryptSecretsFile(secretsPath);
      const parsed = parseProviderSecrets(secrets);

      if (args.modelId) {
        const modelKey = parsed.modelKeys?.[args.modelId];
        if (!modelKey) return null;
        return maskApiKey(modelKey);
      }

      const key = parsed.apiKey;
      if (!key) return null;
      return maskApiKey(key);
    } catch (err) {
      // Don't lie about "Configured" status when the file is encrypted-no-key
      // — surface the actionable error as a structured ConvexError so the UI
      // can dispatch on `error.data.code` and render an Alert banner.
      if (err instanceof EncryptedFileWithoutKeyError) {
        throw new ConvexError({
          code: 'PROVIDER_SECRET_ENCRYPTED_NO_KEY',
          path: secretsPath,
        });
      }
      // Other failures (zod-shape, decrypt-with-wrong-key): file exists but
      // unusable. Still mask as configured to avoid losing the "click Save"
      // affordance — the actual save will surface a clearer error.
      // Sanitise the err message because a SOPS / decrypt-failure error
      // can include partial cleartext.
      console.warn(
        `Provider "${args.providerName}": secrets file unreadable`,
        sanitizeError(err),
      );
      return '••••••••••';
    }
  },
});
