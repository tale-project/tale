import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Refreshable model-capability cache, populated from a proven external catalog
 * (OpenRouter's public `/api/v1/models`, plus configured-provider `/v1/models`).
 * This is the layer that replaces hand-maintaining capability facts in code:
 *
 *   operator provider JSON  >  THIS cache (fetched)  >  none
 *
 * Capabilities are global facts about a model, so rows are keyed by `modelId`
 * (the `vendor/model` id as it appears in catalogs) — not per-org. A row is a
 * disposable, refreshable snapshot; operator config always wins at resolution.
 */
const reasoning = v.object({
  knob: v.union(
    v.literal('effort'),
    v.literal('budgetTokens'),
    v.literal('none'),
  ),
  supportsMinimal: v.optional(v.boolean()),
  minBudgetTokens: v.optional(v.number()),
  maxBudgetTokens: v.optional(v.number()),
});
const promptCaching = v.object({
  mode: v.union(
    v.literal('explicit-breakpoints'),
    v.literal('auto-server'),
    v.literal('none'),
  ),
  maxBreakpoints: v.optional(v.number()),
});

export const modelCapabilityCacheTable = defineTable({
  modelId: v.string(),
  reasoning: v.optional(reasoning),
  promptCaching: v.optional(promptCaching),
  inputCentsPerMillion: v.optional(v.number()),
  outputCentsPerMillion: v.optional(v.number()),
  contextWindow: v.optional(v.number()),
  maxOutputTokens: v.optional(v.number()),
  supportsTools: v.optional(v.boolean()),
  supportsVision: v.optional(v.boolean()),
  /** Where this row came from, e.g. 'openrouter' or a provider name. */
  source: v.string(),
  fetchedAt: v.number(),
}).index('by_modelId', ['modelId']);

/**
 * Singleton-ish sync bookkeeping for the UI ("last synced", counts). One row
 * per source; the UI reads the most recent.
 */
export const modelCatalogSyncTable = defineTable({
  source: v.string(),
  lastSyncedAt: v.number(),
  modelCount: v.number(),
  ok: v.boolean(),
  error: v.optional(v.string()),
}).index('by_source', ['source']);

// The per-org auto-sync opt-out moved to the file-based governance policy
// `model_sync` (`<org>/governance/model-sync.json`, schema `modelSyncConfigSchema`).
// The legacy `modelSyncSettings` table was dropped in migration 0.2.87/04;
// the absence of a file still means "enabled". See `model_catalog/queries.ts`.
