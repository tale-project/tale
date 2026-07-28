/**
 * Convex wire validators for the provider-catalog surface — the Convex-side
 * mirror of `modelCatalogEntrySchema` in `lib/shared/schemas/providers.ts`,
 * which stays the single source of truth for what a catalog entry may carry.
 *
 * Every field the Zod schema admits MUST be representable here: one shipped
 * entry with an unmirrored field fails return validation and blanks the
 * whole provider-settings listing. `catalog_validators.test.ts` locks the
 * mirror against the shipped catalogs and a maximal entry.
 */

import { v } from 'convex/values';

import { audioFormatLiterals } from '../../../lib/shared/schemas/providers';

/** Mirrors `modelCatalogTtsSchema` (parsed shape — `audioFormat` defaulted). */
const ttsValidator = v.object({
  defaultVoice: v.optional(v.string()),
  voicesByLocale: v.optional(v.record(v.string(), v.string())),
  defaultInstructions: v.optional(v.string()),
  instructionsByLocale: v.optional(v.record(v.string(), v.string())),
  audioFormat: v.union(
    ...audioFormatLiterals.map((literal) => v.literal(literal)),
  ),
  centsPerMillionCharacters: v.optional(v.number()),
});

export const modelEntryValidator = v.object({
  id: v.string(),
  provider: v.string(),
  tags: v.array(v.string()),
  supportsTools: v.boolean(),
  supportsVision: v.boolean(),
  reasoning: v.optional(
    v.object({
      knob: v.union(v.literal('effort'), v.literal('budget-tokens')),
    }),
  ),
  contextWindow: v.number(),
  maxOutputTokens: v.optional(v.number()),
  pricing: v.optional(
    v.object({
      inputCentsPerMillion: v.number(),
      outputCentsPerMillion: v.number(),
    }),
  ),
  tts: v.optional(ttsValidator),
});

export const connectorCatalogValidator = v.object({
  name: v.string(),
  displayName: v.string(),
  /** The connector's shipped `icon.svg`, inlined as a data URL. */
  iconUrl: v.optional(v.string()),
  apiFormat: v.union(v.literal('openai'), v.literal('anthropic')),
  /** Absent for per-credential-endpoint connectors (Azure). */
  baseUrl: v.optional(v.string()),
  endpointMode: v.optional(
    v.union(v.literal('fixed'), v.literal('per-credential')),
  ),
  catalogSource: v.union(
    v.literal('static'),
    v.literal('openrouter-api'),
    v.literal('models-endpoint'),
    v.literal('none'),
  ),
  /** The auth methods this connector's credentials may use. */
  authMethods: v.array(v.string()),
  models: v.array(modelEntryValidator),
  /** Present when the live catalog could not be served at all. */
  catalogError: v.optional(v.string()),
});
