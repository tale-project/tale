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

import type { ProviderSecrets } from '../../lib/shared/schemas/providers';
import { providerJsonSchema } from '../../lib/shared/schemas/providers';
import { parseModelRef } from '../../lib/shared/utils/model-ref';
import { internal } from '../_generated/api';
import { action, internalAction, type ActionCtx } from '../_generated/server';
import { resolveAgeRecipients } from '../lib/age_keygen';
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
import { requireDeveloperSettingsAccess, requireOrgMembership } from './auth';
import { NoProviderAvailableError } from './errors';
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
import {
  UndecryptableExistingSecretError,
  prepareMergedSecrets,
} from './secret_io';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Mask an API key for "configured?" display in the dashboard. Shows only
 * the first 6 characters (low-entropy, mostly the well-known provider
 * prefix like `sk-proj-`) followed by bullets. Never includes the tail —
 * those are real ciphertext bytes and would help an attacker brute-force
 * a stolen partial.
 */
function maskApiKey(key: string): string {
  if (key.length <= 6) return '••••••••••';
  return key.slice(0, 6) + '••••••';
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

/** True iff `err` is a Node ErrnoException with the given code. */
function isErrnoCode(err: unknown, code: string): boolean {
  return err instanceof Error && 'code' in err && err.code === code;
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
  secrets: ProviderSecrets;
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

  const jsonFiles = entries.filter(
    (e) =>
      e.endsWith('.json') && !e.startsWith('.') && !e.endsWith('.secrets.json'),
  );

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
    let secrets: ProviderSecrets;
    try {
      const raw = await decryptSecretsFile(secretsPath);
      secrets = parseProviderSecrets(raw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // ENOENT on the secrets file means the operator has a provider
      // config but no API key yet — the common "I just created an org"
      // case. Classify so the UI can point at Settings → Providers.
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

// ---------------------------------------------------------------------------
// Public CRUD actions (called from frontend)
// ---------------------------------------------------------------------------

export const readProvider = action({
  args: { orgSlug: v.string(), providerName: v.string() },
  returns: v.any(),
  handler: async (
    ctx,
    args,
  ): Promise<
    ProviderReadResult & { maskedModelKeys?: Record<string, string> }
  > => {
    // Returns the masked-key preview, so gate on developerSettings to match
    // the dashboard route that's the only legit consumer.
    await requireDeveloperSettingsAccess(ctx, args.orgSlug);
    const result = await readProviderFile(args.orgSlug, args.providerName);
    if (!result.ok) return result;

    // Attach masked per-model API keys (modelId → masked key). Failures here
    // — including encrypted-no-key — degrade silently so the rest of the page
    // still renders. The actionable encrypted-no-key signal lives on
    // `hasProviderSecret` (whose entire purpose is the secret state); the API
    // Key section consumes that and renders the banner.
    const maskedModelKeys: Record<string, string> = {};
    try {
      const secretsPath = resolveProviderSecretsPath(
        args.orgSlug,
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
      console.warn(
        `Provider "${args.providerName}": failed to read model key overrides`,
        err instanceof Error ? err.message : String(err),
      );
    }

    return { ...result, maskedModelKeys };
  },
});

export const listProviders = action({
  args: { orgSlug: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args.orgSlug);

    const dir = resolveProvidersDir(args.orgSlug);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    const jsonFiles = entries.filter(
      (e) =>
        e.endsWith('.json') &&
        !e.startsWith('.') &&
        !e.endsWith('.secrets.json'),
    );

    const results = await Promise.all(
      jsonFiles.map(async (fileName) => {
        const name = providerNameFromFileName(fileName);
        if (!validateProviderName(name)) return null;
        const result = await readProviderFile(args.orgSlug, name);
        if (result.ok) {
          // Try reading secrets to detect per-model API key overrides
          let modelKeys: Record<string, string> | undefined;
          try {
            const secretsPath = resolveProviderSecretsPath(args.orgSlug, name);
            const raw = await decryptSecretsFile(secretsPath);
            const secrets = parseProviderSecrets(raw);
            modelKeys = secrets.modelKeys;
          } catch (err) {
            console.warn(
              `Provider "${name}": failed to read model key overrides`,
              err instanceof Error ? err.message : String(err),
            );
          }

          return {
            name,
            displayName: result.config.displayName,
            description: result.config.description,
            baseUrl: result.config.baseUrl,
            modelCount: result.config.models.length,
            defaults: result.config.defaults,
            models: result.config.models.map((m) => ({
              id: m.id,
              displayName: m.displayName,
              description: m.description ?? '',
              tags: m.tags,
              hasBaseUrlOverride: m.baseUrl != null,
              hasApiKeyOverride: modelKeys?.[m.id] != null,
              // Surface quantization variants so the UI selectors can split
              // each model into one selectable entry per declared weight
              // format. Read from merged provider+model providerOptions to
              // match resolveModelData's runtime view.
              quantizations: readEffectiveQuantizations(
                result.config.providerOptions,
                m.providerOptions,
              ),
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
    orgSlug: v.string(),
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
    await requireDeveloperSettingsAccess(ctx, args.orgSlug);

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
    // Optimistic concurrency: if the caller passed `expectedHash`, the file
    // on disk must hash to that value. Reading + writing isn't truly atomic
    // here, but combined with `atomicWrite`'s same-tmp-then-rename it
    // narrows the clobber window enough to surface concurrent edits to the
    // dashboard rather than silently overwriting them.
    if (args.expectedHash !== undefined) {
      const existing = await readProviderFile(args.orgSlug, args.providerName);
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
    const filePath = resolveProviderFilePath(args.orgSlug, args.providerName);
    await atomicWrite(filePath, content);
    return { hash: sha256(content) };
  },
});

export const deleteProvider = action({
  args: { orgSlug: v.string(), providerName: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const auth = await requireDeveloperSettingsAccess(ctx, args.orgSlug);
    const filePath = resolveProviderFilePath(args.orgSlug, args.providerName);
    const secretsPath = resolveProviderSecretsPath(
      args.orgSlug,
      args.providerName,
    );
    // Order: secrets first, then public config. If the secrets unlink fails
    // (rare — EACCES / EIO on a network FS), the public file remains and the
    // entry stays visible in the provider list so the operator can retry the
    // delete. The reversed order would leave an orphaned ciphertext that
    // discovery can't enumerate (loadAllProviders only iterates *.json),
    // requiring shell access to recover.
    await unlink(secretsPath).catch((err: unknown) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node.js errors always have .code
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    });
    await unlink(filePath).catch((err: unknown) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node.js errors always have .code
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
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
        err instanceof Error ? err.message : String(err),
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
    orgSlug: v.optional(v.string()),
    providerName: v.optional(v.string()),
  },
  returns: v.object({
    providerName: v.string(),
    baseUrl: v.string(),
    apiKey: v.string(),
    modelId: v.string(),
    tags: v.array(v.string()),
    dimensions: v.optional(v.number()),
    maxOutputTokens: v.optional(v.number()),
    supportsStructuredOutputs: v.boolean(),
    imageGenerationMode: v.optional(
      v.union(v.literal('images-api'), v.literal('chat-multimodal')),
    ),
    inputCentsPerMillion: v.optional(v.number()),
    outputCentsPerMillion: v.optional(v.number()),
    imageCentsPerImage: v.optional(v.number()),
    centsPerAudioMinute: v.optional(v.number()),
    centsPerMillionCharacters: v.optional(v.number()),
    defaultVoice: v.optional(v.string()),
    voicesByLocale: v.optional(v.record(v.string(), v.string())),
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
  }),
  handler: async (_ctx, args) => {
    const orgSlug = args.orgSlug ?? 'default';
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
      const definition = provider.config.models.find(
        (m) => m.id === bareModelId,
      );
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

      return {
        providerName: provider.name,
        baseUrl: definition.baseUrl ?? provider.config.baseUrl,
        apiKey:
          provider.secrets.modelKeys?.[definition.id] ??
          provider.secrets.apiKey,
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
        inputCentsPerMillion: definition.cost?.inputCentsPerMillion,
        outputCentsPerMillion: definition.cost?.outputCentsPerMillion,
        imageCentsPerImage: definition.cost?.imageCentsPerImage,
        centsPerAudioMinute: definition.cost?.centsPerAudioMinute,
        centsPerMillionCharacters: definition.cost?.centsPerMillionCharacters,
        defaultVoice: definition.defaultVoice,
        voicesByLocale: definition.voicesByLocale,
        audioFormat: definition.audioFormat,
        providerOptions,
      };
    }

    const allModelIds = candidates.flatMap((p) =>
      p.config.models.map((m) => m.id),
    );
    throw new ConvexError({
      code: 'UNKNOWN_MODEL',
      message: `Model "${bareModelId}" not found${effectiveProviderName ? ` in provider "${effectiveProviderName}"` : ' in any provider'}. Available: ${allModelIds.join(', ')}`,
    });
  },
});

/**
 * Resolve provider data for the first model matching a tag (chat/vision/embedding).
 */
export const resolveModelByTag = internalAction({
  args: {
    tag: v.string(),
    orgSlug: v.optional(v.string()),
    providerName: v.optional(v.string()),
  },
  returns: v.object({
    providerName: v.string(),
    baseUrl: v.string(),
    apiKey: v.string(),
    modelId: v.string(),
    tags: v.array(v.string()),
    dimensions: v.optional(v.number()),
    maxOutputTokens: v.optional(v.number()),
    supportsStructuredOutputs: v.boolean(),
    imageGenerationMode: v.optional(
      v.union(v.literal('images-api'), v.literal('chat-multimodal')),
    ),
    inputCentsPerMillion: v.optional(v.number()),
    outputCentsPerMillion: v.optional(v.number()),
    imageCentsPerImage: v.optional(v.number()),
    centsPerAudioMinute: v.optional(v.number()),
    centsPerMillionCharacters: v.optional(v.number()),
    defaultVoice: v.optional(v.string()),
    voicesByLocale: v.optional(v.record(v.string(), v.string())),
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
  }),
  handler: async (_ctx, args) => {
    const orgSlug = args.orgSlug ?? 'default';
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

    // First pass: check for explicit per-tag default
    for (const provider of candidates) {
      const defaults = provider.config.defaults;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- defaults keys are 'chat' | 'vision' | 'embedding'; tag may not match but undefined access is handled below
      const tagKey = args.tag as keyof NonNullable<typeof defaults>;
      const defaultModelId = defaults?.[tagKey];
      if (defaultModelId) {
        const definition = provider.config.models.find(
          (m) => m.id === defaultModelId,
        );
        if (definition) {
          return {
            providerName: provider.name,
            baseUrl: definition.baseUrl ?? provider.config.baseUrl,
            apiKey:
              provider.secrets.modelKeys?.[definition.id] ??
              provider.secrets.apiKey,
            modelId: definition.id,
            tags: [...definition.tags],
            dimensions: definition.dimensions,
            maxOutputTokens: definition.maxOutputTokens,
            supportsStructuredOutputs:
              definition.supportsStructuredOutputs ??
              provider.config.supportsStructuredOutputs ??
              false,
            imageGenerationMode: definition.imageGenerationMode,
            inputCentsPerMillion: definition.cost?.inputCentsPerMillion,
            outputCentsPerMillion: definition.cost?.outputCentsPerMillion,
            imageCentsPerImage: definition.cost?.imageCentsPerImage,
            centsPerAudioMinute: definition.cost?.centsPerAudioMinute,
            centsPerMillionCharacters:
              definition.cost?.centsPerMillionCharacters,
            defaultVoice: definition.defaultVoice,
            voicesByLocale: definition.voicesByLocale,
            audioFormat: definition.audioFormat,
            providerOptions: mergeModelLevel(
              provider.config.providerOptions,
              definition.providerOptions,
            ),
          };
        }
      }
    }

    // Fallback: first model with matching tag
    for (const provider of candidates) {
      const definition = provider.config.models.find((m) =>
        (m.tags as readonly string[]).includes(args.tag),
      );
      if (definition) {
        return {
          providerName: provider.name,
          baseUrl: definition.baseUrl ?? provider.config.baseUrl,
          apiKey:
            provider.secrets.modelKeys?.[definition.id] ??
            provider.secrets.apiKey,
          modelId: definition.id,
          tags: [...definition.tags],
          dimensions: definition.dimensions,
          maxOutputTokens: definition.maxOutputTokens,
          supportsStructuredOutputs:
            definition.supportsStructuredOutputs ??
            provider.config.supportsStructuredOutputs ??
            false,
          imageGenerationMode: definition.imageGenerationMode,
          inputCentsPerMillion: definition.cost?.inputCentsPerMillion,
          outputCentsPerMillion: definition.cost?.outputCentsPerMillion,
          imageCentsPerImage: definition.cost?.imageCentsPerImage,
          centsPerAudioMinute: definition.cost?.centsPerAudioMinute,
          centsPerMillionCharacters: definition.cost?.centsPerMillionCharacters,
          defaultVoice: definition.defaultVoice,
          voicesByLocale: definition.voicesByLocale,
          audioFormat: definition.audioFormat,
          providerOptions: mergeModelLevel(
            provider.config.providerOptions,
            definition.providerOptions,
          ),
        };
      }
    }

    throw new ConvexError({
      code: 'UNKNOWN_MODEL',
      message: `No model with tag "${args.tag}" found${args.providerName ? ` in provider "${args.providerName}"` : ' in any provider'}.`,
    });
  },
});

/**
 * Get all model IDs with their tags across all providers.
 * Used for cross-validation of agent supportedModels at config time.
 */
export const getAllModelIds = internalAction({
  args: { orgSlug: v.optional(v.string()) },
  returns: v.array(
    v.object({
      id: v.string(),
      tags: v.array(v.string()),
      providerName: v.string(),
      displayName: v.optional(v.string()),
      quantizations: v.optional(v.array(v.string())),
    }),
  ),
  handler: async (_ctx, args) => {
    const orgSlug = args.orgSlug ?? 'default';
    let providers: ProviderWithSecrets[];
    try {
      providers = await loadAllProviders(orgSlug);
    } catch {
      return [];
    }
    const models: Array<{
      id: string;
      tags: string[];
      providerName: string;
      displayName?: string;
      quantizations?: string[];
    }> = [];
    for (const provider of providers) {
      for (const m of provider.config.models) {
        models.push({
          id: m.id,
          tags: [...m.tags],
          providerName: provider.name,
          displayName: m.displayName,
          quantizations: readEffectiveQuantizations(
            provider.config.providerOptions,
            m.providerOptions,
          ),
        });
      }
    }
    return models;
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
  args: { orgSlug: v.optional(v.string()) },
  returns: v.array(
    v.object({
      id: v.string(),
      tags: v.array(v.string()),
      providerName: v.string(),
      displayName: v.optional(v.string()),
      quantizations: v.optional(v.array(v.string())),
    }),
  ),
  handler: async (_ctx, args) => {
    const orgSlug = args.orgSlug ?? 'default';
    const dir = resolveProvidersDir(orgSlug);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }
    const jsonFiles = entries.filter(
      (e) =>
        e.endsWith('.json') &&
        !e.startsWith('.') &&
        !e.endsWith('.secrets.json'),
    );
    const models: Array<{
      id: string;
      tags: string[];
      providerName: string;
      displayName?: string;
      quantizations?: string[];
    }> = [];
    await Promise.all(
      jsonFiles.map(async (fileName) => {
        const name = providerNameFromFileName(fileName);
        if (!validateProviderName(name)) return;
        const result = await readProviderFile(orgSlug, name);
        if (!result.ok) return;
        for (const m of result.config.models) {
          models.push({
            id: m.id,
            tags: [...m.tags],
            providerName: name,
            displayName: m.displayName,
            quantizations: readEffectiveQuantizations(
              result.config.providerOptions,
              m.providerOptions,
            ),
          });
        }
      }),
    );
    return models;
  },
});

/**
 * Get all provider configs (public data only, no secrets).
 */
export const getAllProviderConfigs = action({
  args: { orgSlug: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args.orgSlug);

    const dir = resolveProvidersDir(args.orgSlug);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    const jsonFiles = entries.filter(
      (e) =>
        e.endsWith('.json') &&
        !e.startsWith('.') &&
        !e.endsWith('.secrets.json'),
    );

    const results = await Promise.all(
      jsonFiles.map(async (fileName) => {
        const name = providerNameFromFileName(fileName);
        if (!validateProviderName(name)) return null;
        const result = await readProviderFile(args.orgSlug, name);
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

/**
 * Fetch available models from an OpenAI-compatible /v1/models endpoint.
 * Used by the "Add provider" panel to auto-populate models.
 */
export const fetchProviderModels = action({
  args: {
    orgSlug: v.string(),
    baseUrl: v.string(),
    apiKey: v.string(),
  },
  returns: v.array(v.object({ id: v.string() })),
  handler: async (ctx, args): Promise<Array<{ id: string }>> => {
    // Same gate as the rest of the provider mutations — operators with
    // developerSettings access only. Pre-this-fix, this action accepted any
    // authenticated user (`authComponent.getAuthUser`) and any baseUrl, which
    // allowed any logged-in member to issue authenticated GETs from inside
    // the Convex action runtime to internal services / cloud metadata.
    await requireDeveloperSettingsAccess(ctx, args.orgSlug);

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
      // Log the body server-side for ops visibility.
      console.warn(
        `[fetchProviderModels] non-2xx ${response.status} from ${url}: ${response.body.slice(0, 500)}`,
      );
      throw new ConvexError({
        code: 'PROVIDER_FETCH_FAILED',
        message: `Failed to fetch models (${response.status} ${response.statusText})`,
      });
    }

    let json: unknown;
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- raw JSON narrowed below
      json = JSON.parse(response.body);
    } catch {
      throw new ConvexError({
        code: 'PROVIDER_FETCH_FAILED',
        message: 'Provider returned non-JSON response',
      });
    }
    const models =
      json != null &&
      typeof json === 'object' &&
      'data' in json &&
      Array.isArray(json.data)
        ? (json.data as Array<unknown>)
        : null;

    if (!models) {
      throw new ConvexError({
        code: 'PROVIDER_FETCH_FAILED',
        message:
          'Unexpected response format: expected { data: [...] } from /v1/models',
      });
    }

    return models
      .filter(
        (m): m is { id: string } =>
          m != null &&
          typeof m === 'object' &&
          'id' in m &&
          typeof (m as Record<string, unknown>).id === 'string',
      )
      .map((m) => ({ id: m.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
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
): Promise<ProbeResult> {
  const url = buildProbeUrl(baseUrl, 'audio/transcriptions');
  const start = Date.now();
  try {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([makeSilentWav()], { type: 'audio/wav' }),
      'probe.wav',
    );
    formData.append('model', modelId);
    // safeFetch enforces redirect: 'manual' + per-hop host policy so a 302
    // to IMDS can't carry the bearer token along.
    const response = await safeFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
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
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by 'data' in check above
      Array.isArray((json as Record<string, unknown>).data)
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Array.isArray narrows the value
          ((json as Record<string, unknown>).data as Array<unknown>)
        : null;
    if (!data) {
      return { ok: false, error: 'Unexpected response from /v1/models' };
    }
    const ids = new Set<string>();
    for (const m of data) {
      if (m != null && typeof m === 'object' && 'id' in m) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by 'id' in check above
        const id = (m as Record<string, unknown>).id;
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
  args: { orgSlug: v.string(), providerName: v.string() },
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
    await requireDeveloperSettingsAccess(ctx, args.orgSlug);

    if (!validateProviderName(args.providerName))
      throw new Error(`Invalid provider name: ${args.providerName}`);

    const configResult = await readProviderFile(
      args.orgSlug,
      args.providerName,
    );
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

    const secretsPath = resolveProviderSecretsPath(
      args.orgSlug,
      args.providerName,
    );
    const secrets = parseProviderSecrets(await decryptSecretsFile(secretsPath));

    const probes: Promise<ProbeResult>[] = [];
    const skipped: { modelId: string; reason: string }[] = [];
    const listingCache = new Map<string, Promise<ListingResult>>();

    for (const model of config.models) {
      const apiKey = secrets.modelKeys?.[model.id] ?? secrets.apiKey;
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
        probes.push(runTranscriptionProbe(config.baseUrl, apiKey, model.id));
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
    orgSlug: v.string(),
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
    const auth = await requireDeveloperSettingsAccess(ctx, args.orgSlug);

    if (!validateProviderName(args.providerName))
      throw new Error(`Invalid provider name: ${args.providerName}`);

    const secretsPath = resolveProviderSecretsPath(
      args.orgSlug,
      args.providerName,
    );

    // Per-(orgSlug, providerName) advisory lock. `prepareMergedSecrets`
    // is read-modify-write on the secrets file with no transactional
    // guarantee, so two concurrent saves on the same provider can
    // clobber one another's `modelKeys` additions. Within a single Node
    // process the lock serializes them; cross-process safety is a
    // follow-up that would require a real `expectedHash` round-trip
    // (also exposed via the read query).
    const lockKey = `${args.orgSlug}:${args.providerName}`;
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
    orgSlug: string;
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
  args: { orgSlug: string; providerName: string; force?: boolean },
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
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Check if a provider has a secrets file configured.
 * Returns a masked API key (e.g. "sk-or-••••••abc") if configured, or null.
 */
export const hasProviderSecret = action({
  args: {
    orgSlug: v.string(),
    providerName: v.string(),
    modelId: v.optional(v.string()),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    // Returns the masked-key preview, gate on developerSettings.
    await requireDeveloperSettingsAccess(ctx, args.orgSlug);

    const secretsPath = resolveProviderSecretsPath(
      args.orgSlug,
      args.providerName,
    );

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
      console.warn(
        `Provider "${args.providerName}": secrets file unreadable`,
        err instanceof Error ? err.message : String(err),
      );
      return '••••••••••';
    }
  },
});
