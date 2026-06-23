/**
 * Base settings for Tale services.
 *
 * Provides a common Zod-based configuration base with shared patterns across
 * the crawler and RAG services, replacing the pydantic-settings
 * `BaseServiceSettings`. Each service extends {@link baseServiceSettingsSchema}
 * with its own fields and reads from `process.env` via {@link parseEnv}.
 *
 * Provider lookups require an org slug under the org-first config layout — each
 * org owns its own provider catalog at `<TALE_CONFIG_DIR>/<org_slug>/providers/`.
 * The accessors accept an explicit `orgSlug` and surface a clear error if the
 * caller forgot to thread one through, rather than silently pinning every org
 * to `default`.
 */

import { z } from 'zod';

import {
  getChatModel,
  getEmbeddingModel,
  getVisionModel,
  type ChatModel,
  type EmbeddingModel,
  type VisionModel,
} from './providers';

/** Coerce a comma-separated env string into a number with a default. */
const intFromEnv = (fallback: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().int());

const stringWithDefault = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v));

/**
 * The shared base settings schema. Services compose it with `.extend(...)`.
 * Field names use snake_case env-style keys so the same `process.env` mapping
 * works consistently across services.
 */
export const baseServiceSettingsSchema = z.object({
  host: stringWithDefault('0.0.0.0'),
  port: intFromEnv(8000),
  log_level: stringWithDefault('info'),
  allowed_origins: stringWithDefault('*'),
  database_url: z.string().optional(),
  vision_pdf_dpi: intFromEnv(150),
  vision_request_timeout: intFromEnv(180),
  vision_max_concurrent_pages: intFromEnv(1),
});

export type BaseServiceSettings = z.infer<typeof baseServiceSettingsSchema>;

/**
 * Parse a settings object from an env-like record against a schema. Keys are
 * lower-cased and an optional `prefix` (e.g. `RAG_`) is stripped first, so a
 * `RAG_PORT` env var maps onto the `port` field.
 */
export function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  env: NodeJS.ProcessEnv = process.env,
  prefix = '',
): z.infer<TSchema> {
  const mapped: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (prefix && !key.startsWith(prefix)) {
      continue;
    }
    mapped[key.slice(prefix.length).toLowerCase()] = value;
  }
  return schema.parse(mapped);
}

/** Parse the comma-separated allowed-origins setting into a list. */
export function getAllowedOriginsList(settings: BaseServiceSettings): string[] {
  if (settings.allowed_origins === '*') {
    return ['*'];
  }
  return settings.allowed_origins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/** Get the (base_url, api_key, model_id) for an org's chat model. */
export function getChatConfig(orgSlug: string): ChatModel {
  return getChatModel(orgSlug);
}

/** Get the (base_url, api_key, model_id, dimensions) for an org's embedding model. */
export function getEmbeddingConfig(orgSlug: string): EmbeddingModel {
  return getEmbeddingModel(orgSlug);
}

/** Get the (base_url, api_key, model_id) for an org's vision model. */
export function getVisionConfig(orgSlug: string): VisionModel {
  return getVisionModel(orgSlug);
}

/** Get the fast/chat LLM model id for an org from provider files. */
export function getFastModel(orgSlug: string): string {
  return getChatModel(orgSlug).modelId;
}

/** Get the embedding model id for an org from provider files. */
export function getEmbeddingModelId(orgSlug: string): string {
  return getEmbeddingModel(orgSlug).modelId;
}

/** Get the vision model id for an org from provider files. */
export function getVisionModelId(orgSlug: string): string {
  return getVisionModel(orgSlug).modelId;
}

/** Get the embedding dimensions for an org from provider files. */
export function getEmbeddingDimensions(orgSlug: string): number {
  return getEmbeddingModel(orgSlug).dimensions;
}
