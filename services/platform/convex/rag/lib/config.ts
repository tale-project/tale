'use node';

/**
 * Configuration management for the Tale RAG service.
 *
 * Loaded from environment variables with the `RAG_` prefix, on top of the
 * shared base settings schema. LLM/embedding/vision settings are resolved
 * per-org from provider configuration files via `@tale/shared`.
 */

import { z } from 'zod';

import {
  baseServiceSettingsSchema,
  getAllowedOriginsList,
  getChatConfig,
  getEmbeddingConfig,
  parseEnv,
} from '../../lib/knowledge/config/base';

const boolFromEnv = (fallback: boolean) =>
  z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') {
        return fallback;
      }
      if (typeof v === 'boolean') {
        return v;
      }
      return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    });

const intFromEnv = (fallback: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().int());

const floatFromEnv = (fallback: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number());

const optionalInt = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : Number(v)))
  .pipe(z.number().int().nullable());

const optionalFloat = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : Number(v)))
  .pipe(z.number().nullable());

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : v));

/**
 * RAG service settings schema. Extends the shared base with RAG-specific
 * fields. Env var names carry the `RAG_` prefix, stripped during parsing.
 */
export const ragSettingsSchema = baseServiceSettingsSchema.extend({
  // Override base default (base = 8000).
  port: intFromEnv(8001),

  // Shared-secret auth token. When set (`RAG_AUTH_TOKEN`), Bearer auth is
  // enforced on protected routes; when unset, the service runs open.
  auth_token: optionalString,

  // Database pool sizing.
  database_pool_min: intFromEnv(2),
  database_pool_max: intFromEnv(10),

  // Extended LLM settings.
  openai_max_tokens: optionalInt,
  openai_temperature: optionalFloat,

  // Chunking & search.
  chunk_size: intFromEnv(2048),
  chunk_overlap: intFromEnv(200),
  top_k: intFromEnv(5),
  similarity_threshold: floatFromEnv(0.4),
  max_document_size_mb: intFromEnv(100),
  ingestion_timeout_seconds: intFromEnv(10800),

  // Vision (additional settings beyond base).
  vision_extraction_prompt: optionalString,
  vision_preprocessing_timeout: intFromEnv(0),

  // Recency boost.
  recency_boost_enabled: boolFromEnv(false),
  recency_decay_base: floatFromEnv(0.85),
  recency_max_age_days: intFromEnv(730),

  // Semantic cache (RAG search results).
  semantic_cache_enabled: boolFromEnv(false),
  semantic_cache_similarity_threshold: floatFromEnv(0.95),
  semantic_cache_ttl_hours: intFromEnv(24),

  // Re-ranking (cross-encoder). `provider` is API-only now; `local` fails fast.
  reranking_enabled: boolFromEnv(false),
  reranking_model: z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v === '' ? 'cross-encoder/ms-marco-MiniLM-L-6-v2' : v,
    ),
  reranking_top_k: intFromEnv(10),
  reranking_provider: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 'local' : v)),
  reranking_api_base_url: optionalString,
  reranking_api_key: optionalString,
  reranking_candidates: intFromEnv(30),

  // Feature flags.
  enable_metrics: boolFromEnv(true),
  enable_query_logging: boolFromEnv(false),
});

export type RagSettings = z.infer<typeof ragSettingsSchema>;

/** Resolved LLM configuration for a single org, sourced from provider files. */
export interface LlmConfig {
  provider: 'openai';
  model: string;
  embeddingModel: string;
  apiKey: string;
  baseUrl: string;
  embeddingApiKey: string;
  embeddingBaseUrl: string;
  maxTokens?: number;
  temperature?: number;
}

/** Parse RAG settings from the environment. */
export function loadSettings(
  env: NodeJS.ProcessEnv = process.env,
): RagSettings {
  return parseEnv(ragSettingsSchema, env, 'RAG_');
}

/**
 * Resolve the database URL from `RAG_DATABASE_URL`. There is no fallback —
 * the entrypoint is responsible for building it from `DB_*` or deployment
 * config before the server starts.
 */
export function getDatabaseUrl(settings: RagSettings): string {
  if (settings.database_url) {
    return settings.database_url;
  }
  throw new Error('RAG_DATABASE_URL must be set in environment');
}

/** Resolve the per-org LLM configuration from provider files. */
export function getLlmConfig(
  settings: RagSettings,
  orgSlug: string,
): LlmConfig {
  const chat = getChatConfig(orgSlug);
  const embedding = getEmbeddingConfig(orgSlug);

  const config: LlmConfig = {
    provider: 'openai',
    model: chat.modelId,
    embeddingModel: embedding.modelId,
    apiKey: chat.apiKey,
    baseUrl: chat.baseUrl,
    embeddingApiKey: embedding.apiKey,
    embeddingBaseUrl: embedding.baseUrl,
  };

  if (settings.openai_max_tokens !== null) {
    config.maxTokens = settings.openai_max_tokens;
  }
  if (settings.openai_temperature !== null) {
    config.temperature = settings.openai_temperature;
  }

  return config;
}

/** The parsed singleton settings instance. */
export const settings: RagSettings = loadSettings();

export { getAllowedOriginsList };
