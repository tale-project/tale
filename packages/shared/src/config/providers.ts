/**
 * Provider configuration reader for file-based LLM provider config.
 *
 * Under the org-first config layout each org owns its own provider catalog at
 * `<root>/<org_slug>/providers/`. `orgSlug` is required — pinning RAG/crawler
 * globally to the `default` org's providers would quietly serve the wrong
 * models to other orgs.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { decryptSecretsFile } from '../utils/sops';
import { validateOrgSlug } from './org-slug';

const DEFAULT_CONFIG_DIR = '/app/data';

/**
 * Reserved prefix every env-var name sourcing a provider API key must carry
 * (issue #1711). Fail-closed: any name outside the prefix is rejected. Mirrors
 * `SECRETS_ENV_PREFIX` in `services/platform/lib/shared/schemas/providers.ts`
 * and the runtime gate in `services/platform/convex/providers/secret_resolver.ts`.
 */
const SECRETS_ENV_PREFIX = 'TALE_PROVIDER_KEY_';

export interface ModelConfig {
  id: string;
  displayName: string;
  tags: string[];
  description: string;
  dimensions: number | null;
  secretsEnv: string | null;
}

export interface ProviderConfig {
  name: string;
  displayName: string;
  baseUrl: string;
  models: ModelConfig[];
  description: string;
  supportsStructuredOutputs: boolean;
  apiKey: string | null;
  defaults: Record<string, string>;
  secretsEnv: string | null;
}

export type ChatModel = { baseUrl: string; apiKey: string; modelId: string };
export type EmbeddingModel = ChatModel & { dimensions: number };
export type VisionModel = ChatModel;

const stringRecord = z.record(z.string(), z.string());

const rawModelSchema = z.looseObject({
  id: z.string(),
  displayName: z.string().optional(),
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
  dimensions: z.number().optional(),
  secretsEnv: z.unknown().optional(),
  default: z.unknown().optional(),
});

const rawProviderSchema = z.looseObject({
  displayName: z.string().optional(),
  baseUrl: z.string().optional(),
  description: z.string().optional(),
  supportsStructuredOutputs: z.boolean().optional(),
  secretsEnv: z.unknown().optional(),
  defaults: z.unknown().optional(),
  models: z.array(rawModelSchema).optional(),
});

/**
 * Resolve an env-var name to its trimmed value, honoring the reserved prefix.
 *
 * Returns null when the name is missing, not a string, not prefixed, or the
 * env var is empty/whitespace. Trailing-newline normalization (a common
 * Vault/k8s injection footgun) is applied to env values here. A hand-edited
 * non-string `secretsEnv` degrades to the file fallback rather than throwing.
 */
function envSecret(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) {
    return null;
  }
  if (!name.startsWith(SECRETS_ENV_PREFIX)) {
    console.warn(
      `secretsEnv ${JSON.stringify(name)} does not start with the reserved prefix ` +
        `${SECRETS_ENV_PREFIX} — falling back to the secrets file`,
    );
    return null;
  }
  const value = (process.env[name] ?? '').trim();
  if (!value) {
    console.warn(
      `secretsEnv ${JSON.stringify(name)} is set but the env var is empty/unset — ` +
        `falling back to the secrets file`,
    );
    return null;
  }
  return value;
}

/**
 * Resolve the effective API key for a model (issue #1711).
 *
 * Order: model env -> provider env -> provider file key. Returns "" (never
 * null) when nothing resolves, preserving the config-equality used by the
 * rag/crawler per-org client caches.
 */
function resolveApiKey(provider: ProviderConfig, model: ModelConfig): string {
  for (const name of [model.secretsEnv, provider.secretsEnv]) {
    const value = envSecret(name);
    if (value) {
      return value;
    }
  }
  return provider.apiKey ?? '';
}

function resolveBaseDir(configDir: string | null | undefined): string {
  const sharedConfig = process.env.TALE_PLATFORM_SHARED_CONFIG_DIR;
  if (sharedConfig) {
    return sharedConfig;
  }
  return (
    configDir ??
    process.env.TALE_CONFIG_DIR ??
    process.env.CONFIG_DIR ??
    DEFAULT_CONFIG_DIR
  );
}

/**
 * Read all provider JSON files from `{configDir}/{orgSlug}/providers/`.
 *
 * Reads `*.json` (excluding `*.secrets.json`) and decrypts matching
 * `*.secrets.json` files via SOPS.
 */
export function loadProviders(
  orgSlug: string,
  configDir?: string | null,
): ProviderConfig[] {
  validateOrgSlug(orgSlug);

  const base = resolveBaseDir(configDir);
  const providersDir = path.join(base, orgSlug, 'providers');

  if (!existsSync(providersDir) || !statSync(providersDir).isDirectory()) {
    console.warn(
      `Providers directory not found for org '${orgSlug}': ${providersDir}`,
    );
    return [];
  }

  const jsonFiles = readdirSync(providersDir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.secrets.json'))
    .sort();

  const providers: ProviderConfig[] = [];

  for (const fileName of jsonFiles) {
    const jsonFile = path.join(providersDir, fileName);

    let raw: z.infer<typeof rawProviderSchema>;
    try {
      raw = rawProviderSchema.parse(
        JSON.parse(readFileSync(jsonFile, 'utf-8')),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to read provider file ${jsonFile}: ${message}`);
      continue;
    }

    const providerName = path.basename(fileName, '.json');

    let apiKey: string | null = null;
    const secretsFile = path.join(providersDir, `${providerName}.secrets.json`);
    if (existsSync(secretsFile)) {
      try {
        const secrets = decryptSecretsFile(secretsFile);
        const candidate = secrets.apiKey;
        apiKey = typeof candidate === 'string' ? candidate : null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `Failed to decrypt secrets for ${providerName}: ${message}`,
        );
      }
    }

    const rawModels = raw.models ?? [];
    const models: ModelConfig[] = rawModels.map((m) => ({
      id: m.id,
      displayName: m.displayName ?? m.id,
      tags: m.tags ?? [],
      description: m.description ?? '',
      dimensions: m.dimensions ?? null,
      secretsEnv: typeof m.secretsEnv === 'string' ? m.secretsEnv : null,
    }));

    let defaults: Record<string, string> = {};
    const rawDefaults = stringRecord.safeParse(raw.defaults);
    if (rawDefaults.success) {
      defaults = rawDefaults.data;
    } else {
      // Migrate legacy format: model-level `default: true`.
      for (const m of rawModels) {
        if (m.default === true) {
          for (const tag of m.tags ?? []) {
            if (!(tag in defaults)) {
              defaults[tag] = m.id;
            }
          }
        }
      }
    }

    providers.push({
      name: providerName,
      displayName: raw.displayName ?? providerName,
      baseUrl: raw.baseUrl ?? '',
      models,
      description: raw.description ?? '',
      supportsStructuredOutputs: raw.supportsStructuredOutputs ?? false,
      apiKey,
      defaults,
      secretsEnv: typeof raw.secretsEnv === 'string' ? raw.secretsEnv : null,
    });
  }

  return providers;
}

/**
 * Find a model by tag across all providers. If `preferDefault` is true, check
 * the provider-level defaults map first, falling back to the first model with
 * the tag.
 */
function findModel(
  providers: ProviderConfig[],
  tag: string,
  preferDefault: boolean,
): { provider: ProviderConfig; model: ModelConfig } | null {
  if (preferDefault) {
    for (const provider of providers) {
      const defaultModelId = provider.defaults[tag];
      if (defaultModelId) {
        for (const model of provider.models) {
          if (model.id === defaultModelId) {
            return { provider, model };
          }
        }
      }
    }
  }

  for (const provider of providers) {
    for (const model of provider.models) {
      if (model.tags.includes(tag)) {
        return { provider, model };
      }
    }
  }

  return null;
}

/** Return the chat model config for the org's default chat model. */
export function getChatModel(
  orgSlug: string,
  configDir?: string | null,
): ChatModel {
  const providers = loadProviders(orgSlug, configDir);
  const match = findModel(providers, 'chat', true);
  if (match === null) {
    throw new Error(
      `No chat model found in provider configuration files for org '${orgSlug}'.`,
    );
  }
  return {
    baseUrl: match.provider.baseUrl,
    apiKey: resolveApiKey(match.provider, match.model),
    modelId: match.model.id,
  };
}

/** Return the embedding model config (incl. dimensions) for the org. */
export function getEmbeddingModel(
  orgSlug: string,
  configDir?: string | null,
): EmbeddingModel {
  const providers = loadProviders(orgSlug, configDir);
  const match = findModel(providers, 'embedding', true);
  if (match === null) {
    throw new Error(
      `No embedding model found in provider configuration files for org '${orgSlug}'.`,
    );
  }
  const { dimensions } = match.model;
  if (dimensions === null) {
    throw new Error(
      `Embedding model ${match.model.id} does not specify dimensions. Add a ` +
        `'dimensions' field to the model definition.`,
    );
  }
  return {
    baseUrl: match.provider.baseUrl,
    apiKey: resolveApiKey(match.provider, match.model),
    modelId: match.model.id,
    dimensions,
  };
}

/** Return the vision model config for the org. */
export function getVisionModel(
  orgSlug: string,
  configDir?: string | null,
): VisionModel {
  const providers = loadProviders(orgSlug, configDir);
  const match = findModel(providers, 'vision', true);
  if (match === null) {
    throw new Error(
      `No vision model found in provider configuration files for org '${orgSlug}'.`,
    );
  }
  return {
    baseUrl: match.provider.baseUrl,
    apiKey: resolveApiKey(match.provider, match.model),
    modelId: match.model.id,
  };
}
