import { type Infer, v } from 'convex/values';

import { modelSyncConfigSchema } from '../../lib/shared/schemas/governance';
import type { Doc } from '../_generated/dataModel';
import { internalQuery, type QueryCtx, query } from '../_generated/server';
import { readConfigCacheRow } from '../lib/config_cache/read';
import { getOrganizationMember } from '../lib/rls';

/**
 * Resolve the org's effective `autoSyncEnabled` from the file-based `model_sync`
 * governance policy (via `configCache`). A missing/invalid config falls back to
 * the schema default (enabled). Shared by the UI query + the cron's internal read.
 */
async function readAutoSyncEnabled(
  ctx: QueryCtx,
  organizationId: string,
): Promise<boolean> {
  const row = await readConfigCacheRow(
    ctx.db,
    organizationId,
    'governance',
    'model_sync',
  );
  const parsed = modelSyncConfigSchema.safeParse(row?.config ?? {});
  return parsed.success ? parsed.data.autoSyncEnabled : true;
}

const capabilityShape = {
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
  inputCentsPerMillion: v.optional(v.number()),
  outputCentsPerMillion: v.optional(v.number()),
  contextWindow: v.optional(v.number()),
  maxOutputTokens: v.optional(v.number()),
  supportsTools: v.optional(v.boolean()),
  supportsVision: v.optional(v.boolean()),
} as const;

/** The capability fields shared by both lookup shapes, lifted off a cache row. */
function pickCapabilityFields(row: Doc<'modelCapabilityCache'>) {
  return {
    reasoning: row.reasoning,
    promptCaching: row.promptCaching,
    inputCentsPerMillion: row.inputCentsPerMillion,
    outputCentsPerMillion: row.outputCentsPerMillion,
    contextWindow: row.contextWindow,
    maxOutputTokens: row.maxOutputTokens,
    supportsTools: row.supportsTools,
    supportsVision: row.supportsVision,
  };
}

/**
 * Point-lookup of a model's fetched capability row, consulted by
 * `resolveModelData` to fill gaps the operator JSON leaves open. Returns `null`
 * when the model isn't in the cache (resolution then leaves the field unset).
 */
export const getModelCapabilityInternal = internalQuery({
  args: { modelId: v.string() },
  returns: v.union(
    v.object({ source: v.string(), fetchedAt: v.number(), ...capabilityShape }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('modelCapabilityCache')
      .withIndex('by_modelId', (q) => q.eq('modelId', args.modelId))
      .first();
    if (!row) return null;
    return {
      source: row.source,
      fetchedAt: row.fetchedAt,
      ...pickCapabilityFields(row),
    };
  },
});

/**
 * Public batch lookup of cached capability rows for the provider settings UI.
 * Powers the editor's per-model "Fill from catalog" and the provider-level
 * "Sync all from catalog" — both let an operator pull the live OpenRouter facts
 * into the visible, editable provider config. Returns only the modelIds that
 * have a cache row (missing ones are simply absent). Org-gated; the data itself
 * is org-agnostic, but the endpoint must not be world-readable.
 */
const capabilityRow = v.object({
  modelId: v.string(),
  source: v.string(),
  ...capabilityShape,
});
type CapabilityRow = Infer<typeof capabilityRow>;

export const getModelCapabilities = query({
  args: { organizationId: v.string(), modelIds: v.array(v.string()) },
  returns: v.array(capabilityRow),
  handler: async (ctx, args) => {
    await getOrganizationMember(ctx, args.organizationId);
    const out: CapabilityRow[] = [];
    // De-dupe so a config with repeated ids doesn't fan out duplicate reads.
    for (const modelId of new Set(args.modelIds)) {
      const row = await ctx.db
        .query('modelCapabilityCache')
        .withIndex('by_modelId', (q) => q.eq('modelId', modelId))
        .first();
      if (!row) continue;
      out.push({
        modelId: row.modelId,
        source: row.source,
        ...pickCapabilityFields(row),
      });
    }
    return out;
  },
});

/**
 * Whether the weekly in-instance provider-config auto-sync is enabled for this
 * org. The source of truth is the file-based governance policy `model_sync`
 * (mirrored into `configCache`); a missing file ⇒ enabled (default on).
 * Org-gated read for the settings UI.
 */
export const getModelSyncSettings = query({
  args: { organizationId: v.string() },
  returns: v.object({ autoSyncEnabled: v.boolean() }),
  handler: async (ctx, args) => {
    await getOrganizationMember(ctx, args.organizationId);
    return {
      autoSyncEnabled: await readAutoSyncEnabled(ctx, args.organizationId),
    };
  },
});

/** Internal variant for the cron — no auth gate (runs system-side). */
export const isAutoSyncEnabledInternal = internalQuery({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await readAutoSyncEnabled(ctx, args.organizationId);
  },
});

/** Sync status for the providers settings UI (last sync time + counts). */
export const getCatalogStatus = query({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      source: v.string(),
      lastSyncedAt: v.number(),
      modelCount: v.number(),
      ok: v.boolean(),
      error: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    // Gate on org membership — status is org-agnostic data but the endpoint
    // must not be world-readable.
    await getOrganizationMember(ctx, args.organizationId);
    const rows: Array<{
      source: string;
      lastSyncedAt: number;
      modelCount: number;
      ok: boolean;
      error?: string;
    }> = [];
    for await (const r of ctx.db.query('modelCatalogSync')) {
      rows.push({
        source: r.source,
        lastSyncedAt: r.lastSyncedAt,
        modelCount: r.modelCount,
        ok: r.ok,
        error: r.error,
      });
    }
    return rows.sort((a, b) => b.lastSyncedAt - a.lastSyncedAt);
  },
});
