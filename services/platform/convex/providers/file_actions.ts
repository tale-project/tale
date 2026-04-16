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

import { v } from 'convex/values';

import type { ProviderSecrets } from '../../lib/shared/schemas/providers';
import { providerJsonSchema } from '../../lib/shared/schemas/providers';
import { action, internalAction } from '../_generated/server';
import { authComponent } from '../auth';
import { deriveAgePublicKey } from '../lib/age_keygen';
import { atomicWrite, readJsonFile, sha256 } from '../lib/file_io';
import { decryptSecretsFile } from '../lib/sops';
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Mask an API key showing the first 6 and last 3 characters. */
function maskApiKey(key: string): string {
  if (key.length <= 9) return '••••••••••';
  return key.slice(0, 6) + '••••••' + key.slice(-3);
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

async function loadAllProviders(
  orgSlug: string,
): Promise<ProviderWithSecrets[]> {
  const dir = resolveProvidersDir(orgSlug);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw new Error(
      `Provider directory not found: ${dir}. ` +
        'Create at least one provider JSON file in TALE_CONFIG_DIR/providers/.',
    );
  }

  const jsonFiles = entries.filter(
    (e) =>
      e.endsWith('.json') && !e.startsWith('.') && !e.endsWith('.secrets.json'),
  );

  if (jsonFiles.length === 0) {
    throw new Error(
      `No provider JSON files found in ${dir}. ` +
        'Create at least one provider configuration file.',
    );
  }

  const providers: ProviderWithSecrets[] = [];
  const skippedReasons: string[] = [];

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
    throw new Error(
      `All ${skippedReasons.length} provider(s) failed to load:\n` +
        skippedReasons.join('\n') +
        '\nEnsure API keys are configured and SOPS_AGE_KEY is set.',
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const result = await readProviderFile(args.orgSlug, args.providerName);
    if (!result.ok) return result;

    // Attach masked per-model API keys (modelId → masked key)
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

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
  args: { orgSlug: v.string(), providerName: v.string(), config: v.any() },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateProviderName(args.providerName))
      throw new Error(`Invalid provider name: ${args.providerName}`);
    const config = providerJsonSchema.parse(args.config);
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const filePath = resolveProviderFilePath(args.orgSlug, args.providerName);
    const secretsPath = resolveProviderSecretsPath(
      args.orgSlug,
      args.providerName,
    );
    await unlink(filePath).catch((err: unknown) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node.js errors always have .code
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    });
    await unlink(secretsPath).catch((err: unknown) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node.js errors always have .code
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    });
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
    dimensions: v.optional(v.number()),
    maxOutputTokens: v.optional(v.number()),
    supportsStructuredOutputs: v.boolean(),
    inputCentsPerMillion: v.optional(v.number()),
    outputCentsPerMillion: v.optional(v.number()),
  }),
  handler: async (_ctx, args) => {
    const orgSlug = args.orgSlug ?? 'default';
    const providers = await loadAllProviders(orgSlug);

    const candidates = args.providerName
      ? providers.filter((p) => p.name === args.providerName)
      : providers;

    if (args.providerName && candidates.length === 0) {
      const available = providers.map((p) => p.name);
      throw new Error(
        `Provider "${args.providerName}" not found. Available: ${available.join(', ')}`,
      );
    }

    for (const provider of candidates) {
      const definition = provider.config.models.find(
        (m) => m.id === args.modelId,
      );
      if (definition) {
        return {
          providerName: provider.name,
          baseUrl: definition.baseUrl ?? provider.config.baseUrl,
          apiKey:
            provider.secrets.modelKeys?.[definition.id] ??
            provider.secrets.apiKey,
          modelId: args.modelId,
          maxOutputTokens: definition.maxOutputTokens,
          supportsStructuredOutputs:
            definition.supportsStructuredOutputs ??
            provider.config.supportsStructuredOutputs ??
            false,
          inputCentsPerMillion: definition.cost?.inputCentsPerMillion,
          outputCentsPerMillion: definition.cost?.outputCentsPerMillion,
        };
      }
    }

    const allModelIds = candidates.flatMap((p) =>
      p.config.models.map((m) => m.id),
    );
    throw new Error(
      `Model "${args.modelId}" not found${args.providerName ? ` in provider "${args.providerName}"` : ' in any provider'}. Available: ${allModelIds.join(', ')}`,
    );
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
    dimensions: v.optional(v.number()),
    maxOutputTokens: v.optional(v.number()),
    supportsStructuredOutputs: v.boolean(),
    inputCentsPerMillion: v.optional(v.number()),
    outputCentsPerMillion: v.optional(v.number()),
  }),
  handler: async (_ctx, args) => {
    const orgSlug = args.orgSlug ?? 'default';
    const providers = await loadAllProviders(orgSlug);

    const candidates = args.providerName
      ? providers.filter((p) => p.name === args.providerName)
      : providers;

    if (args.providerName && candidates.length === 0) {
      const available = providers.map((p) => p.name);
      throw new Error(
        `Provider "${args.providerName}" not found. Available: ${available.join(', ')}`,
      );
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
            dimensions: definition.dimensions,
            maxOutputTokens: definition.maxOutputTokens,
            supportsStructuredOutputs:
              definition.supportsStructuredOutputs ??
              provider.config.supportsStructuredOutputs ??
              false,
            inputCentsPerMillion: definition.cost?.inputCentsPerMillion,
            outputCentsPerMillion: definition.cost?.outputCentsPerMillion,
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
          dimensions: definition.dimensions,
          maxOutputTokens: definition.maxOutputTokens,
          supportsStructuredOutputs:
            definition.supportsStructuredOutputs ??
            provider.config.supportsStructuredOutputs ??
            false,
          inputCentsPerMillion: definition.cost?.inputCentsPerMillion,
          outputCentsPerMillion: definition.cost?.outputCentsPerMillion,
        };
      }
    }

    throw new Error(
      `No model with tag "${args.tag}" found${args.providerName ? ` in provider "${args.providerName}"` : ' in any provider'}.`,
    );
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
    }> = [];
    for (const provider of providers) {
      for (const m of provider.config.models) {
        models.push({
          id: m.id,
          tags: [...m.tags],
          providerName: provider.name,
          displayName: m.displayName,
        });
      }
    }
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

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
  args: { baseUrl: v.string(), apiKey: v.string() },
  returns: v.array(v.object({ id: v.string() })),
  handler: async (ctx, args): Promise<Array<{ id: string }>> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    // Normalize base URL: strip trailing slash, append /models if needed
    let url = args.baseUrl.replace(/\/+$/, '');
    if (!url.endsWith('/models')) {
      url = url.endsWith('/v1') ? `${url}/models` : `${url}/v1/models`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Failed to fetch models (${response.status}): ${errorText || response.statusText}`,
      );
    }

    const json: unknown = await response.json();
    const models =
      json != null &&
      typeof json === 'object' &&
      'data' in json &&
      Array.isArray(json.data)
        ? (json.data as Array<unknown>)
        : null;

    if (!models) {
      throw new Error(
        'Unexpected response format: expected { data: [...] } from /v1/models',
      );
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
// Secret management actions
// ---------------------------------------------------------------------------

/**
 * Save an API key for a provider by writing a SOPS-encrypted .secrets.json file.
 */
export const saveProviderSecret = action({
  args: {
    orgSlug: v.string(),
    providerName: v.string(),
    apiKey: v.optional(v.string()),
    modelKeys: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateProviderName(args.providerName))
      throw new Error(`Invalid provider name: ${args.providerName}`);

    const secretsPath = resolveProviderSecretsPath(
      args.orgSlug,
      args.providerName,
    );

    const sopsAgeKey = process.env.SOPS_AGE_KEY;
    if (!sopsAgeKey) {
      throw new Error(
        'SOPS_AGE_KEY environment variable is not set. ' +
          'Set it in .env to enable provider secret encryption.',
      );
    }
    const agePublicKey = deriveAgePublicKey(sopsAgeKey);

    // Read existing secrets to merge with new values
    let existing: ProviderSecrets | null = null;
    try {
      const raw = await decryptSecretsFile(secretsPath);
      existing = parseProviderSecrets(raw);
    } catch {
      // No existing secrets or decryption failed — start fresh
    }

    const mergedApiKey = args.apiKey ?? existing?.apiKey;
    if (!mergedApiKey) {
      throw new Error(
        'A provider-level API key is required. ' +
          'Provide an apiKey or ensure one is already configured.',
      );
    }

    // Merge model keys: existing + new (new values overwrite existing per model ID)
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- modelKeys validated as Record<string, string> by caller
    const incomingModelKeys = args.modelKeys as
      | Record<string, string>
      | undefined;
    const mergedModelKeys = {
      ...existing?.modelKeys,
      ...incomingModelKeys,
    };

    // Remove entries with empty string values (signals deletion)
    for (const [key, value] of Object.entries(mergedModelKeys)) {
      if (!value) delete mergedModelKeys[key];
    }

    const secretsData: Record<string, unknown> = { apiKey: mergedApiKey };
    if (Object.keys(mergedModelKeys).length > 0) {
      secretsData.modelKeys = mergedModelKeys;
    }

    const plaintext = JSON.stringify(secretsData, null, 2) + '\n';
    const { execFileSync } = await import('node:child_process');
    const { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } =
      await import('node:fs');
    const { tmpdir } = await import('node:os');

    const tmpDir = mkdtempSync(path.join(tmpdir(), 'sops-'));
    const tmpFile = path.join(tmpDir, 'plain.json');
    let encrypted: string;
    try {
      writeFileSync(tmpFile, plaintext, 'utf-8');
      encrypted = execFileSync(
        'sops',
        [
          '-e',
          '--input-type',
          'json',
          '--output-type',
          'json',
          '--age',
          agePublicKey,
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
      try {
        unlinkSync(tmpFile);
        rmdirSync(tmpDir);
      } catch {
        // best-effort cleanup
      }
    }

    await atomicWrite(secretsPath, encrypted);

    return null;
  },
});

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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

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
    } catch {
      // File exists but can't be decrypted — still report as configured
      return '••••••••••';
    }
  },
});
