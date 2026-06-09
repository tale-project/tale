import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/** Mirrors `BucketStats` in `lib/agent_response/reasoning/types.ts`. */
const bucket = v.object({
  count: v.number(),
  mean: v.number(),
  m2: v.number(),
  underResourcedEma: v.number(),
  // Added after the initial schema; optional so legacy rows keep validating.
  wastefulEma: v.optional(v.number()),
  // Response-quality EMA per class (quality-feedback governor). Optional;
  // legacy rows omit it and readers coalesce to a neutral 1.0.
  qualityEma: v.optional(v.number()),
});

/**
 * Cross-thread Adaptive Reasoning Governor profile: the per-(organization,
 * scope) aggregate of reasoning-need statistics, where `scope` is currently the
 * resolved model id. New threads — and the stateless OpenAI-compat path, which
 * has no thread state at all — inherit this as their warm-start shrinkage
 * anchor, so the governor is effective from the first turn instead of
 * re-learning per conversation. `state` mirrors `ReasoningState`.
 *
 * One row per (org, scope) is a write-hot document under heavy concurrency;
 * updates are fire-and-forget and rely on Convex's OCC retries. If a single
 * org/model ever saturates it, shard `scopeKey` with a small suffix and sum on
 * read.
 */
export const reasoningProfilesTable = defineTable({
  organizationId: v.string(),
  scopeKey: v.string(),
  state: v.object({
    easy: bucket,
    medium: bucket,
    hard: bucket,
    turns: v.number(),
    // Cross-class intensity distribution (self-calibrating thresholds).
    intensityCount: v.optional(v.number()),
    intensityMean: v.optional(v.number()),
    intensityM2: v.optional(v.number()),
  }),
  updatedAt: v.number(),
}).index('by_org_scope', ['organizationId', 'scopeKey']);
