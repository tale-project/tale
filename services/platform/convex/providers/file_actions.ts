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

import { v } from 'convex/values';
import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { ProviderSecrets } from '../../lib/shared/schemas/providers';
import type { ProviderJson, ProviderReadResult } from './file_utils';

import { providerJsonSchema } from '../../lib/shared/schemas/providers';
import { action, internalAction } from '../_generated/server';
import { authComponent } from '../auth';
import { deriveAgePublicKey } from '../lib/age_keygen';
import { atomicWrite, readJsonFile, sha256 } from '../lib/file_io';
import { decryptSecretsFile } from '../lib/sops';
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

  for (const fileName of jsonFiles) {
    const providerName = path.basename(fileName, '.json');
    if (!validateProviderName(providerName)) {
      console.warn(`Provider "${providerName}": invalid name, skipping.`);
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
      continue;
    }

    const secretsPath = path.join(dir, `${providerName}.secrets.json`);
    let secrets: ProviderSecrets;
    try {
      const raw = await decryptSecretsFile(secretsPath);
      secrets = parseProviderSecrets(raw);
    } catch (err) {
      console.warn(
        `Provider "${providerName}": secrets not available, skipping.`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    providers.push({ name: providerName, config: result.data, secrets });
  }

  return providers;
}

// ---------------------------------------------------------------------------
// Public CRUD actions (called from frontend)
// ---------------------------------------------------------------------------

export const readProvider = action({
  args: { orgSlug: v.string(), providerName: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<ProviderReadResult> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    return readProviderFile(args.orgSlug, args.providerName);
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
          return {
            name,
            displayName: result.config.displayName,
            description: result.config.description,
            baseUrl: result.config.baseUrl,
            modelCount: result.config.models.length,
            models: result.config.models.map((m) => ({
              id: m.id,
              displayName: m.displayName,
              tags: m.tags,
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
    supportsStructuredOutputs: v.boolean(),
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
          baseUrl: provider.config.baseUrl,
          apiKey: provider.secrets.apiKey,
          modelId: args.modelId,
          supportsStructuredOutputs:
            provider.config.supportsStructuredOutputs ?? false,
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
    supportsStructuredOutputs: v.boolean(),
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
      const definition = provider.config.models.find((m) =>
        (m.tags as readonly string[]).includes(args.tag),
      );
      if (definition) {
        return {
          providerName: provider.name,
          baseUrl: provider.config.baseUrl,
          apiKey: provider.secrets.apiKey,
          modelId: definition.id,
          dimensions: definition.dimensions,
          supportsStructuredOutputs:
            provider.config.supportsStructuredOutputs ?? false,
        };
      }
    }

    throw new Error(
      `No model with tag "${args.tag}" found${args.providerName ? ` in provider "${args.providerName}"` : ' in any provider'}.`,
    );
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
// Secret management actions
// ---------------------------------------------------------------------------

/**
 * Save an API key for a provider by writing a SOPS-encrypted .secrets.json file.
 */
export const saveProviderSecret = action({
  args: {
    orgSlug: v.string(),
    providerName: v.string(),
    apiKey: v.string(),
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

    const plaintext = JSON.stringify({ apiKey: args.apiKey }, null, 2) + '\n';
    const { execFileSync } = await import('node:child_process');

    let encrypted: string;
    try {
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
          '/dev/stdin',
        ],
        {
          input: plaintext,
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
      const key = parsed.apiKey;
      if (!key) return null;
      return maskApiKey(key);
    } catch {
      // File exists but can't be decrypted — still report as configured
      return '••••••••••';
    }
  },
});
